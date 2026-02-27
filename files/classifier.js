/**
 * classifier.js — Core Decision Engine
 *
 * Runs every incoming notification event through a 9-stage pipeline
 * and returns one of three decisions: NOW | LATER | NEVER
 *
 * Pipeline:
 *  1. Expiry Guard        — drop stale events immediately
 *  2. Dedup Guard         — exact SHA-256 + near-dup SimHash
 *  3. Rules Engine        — human-configurable JSON rules (hot-reload)
 *  4. DND / Quiet Hours   — respect user sleep/focus hours
 *  5. Composite Scorer    — priority + type + channel + freshness
 *  6. Fatigue Guard       — Redis sliding window penalty
 *  7. AI Scorer           — async, non-blocking enrichment
 *  8. Conflict Resolver   — urgent + noisy → LATER not NEVER
 *  9. Decision Boundary   — score ≥ 60 → NOW, ≥ 30 → LATER, else NEVER
 */

const { v4: uuidv4 } = require('uuid');
const { checkDuplicate, storeFingerprint } = require('./deduplicator');
const { computeScore } = require('./scorer');
const { getFatiguePenalty, incrementCounter } = require('./fatigueGuard');
const { resolveConflict } = require('./conflictResolver');
const { getAiScore } = require('../services/aiService');
const { writeAudit } = require('../services/auditService');
const { scheduleDeferred } = require('../services/schedulerService');
const { getRules, matchRules } = require('../services/ruleService');
const logger = require('../utils/logger');

/**
 * Main entry point — evaluate a single notification event.
 *
 * @param {Object} event
 * @returns {Promise<{ decision, score, reason, schedule_at, audit_id }>}
 */
async function evaluate(event) {
  const auditId = `aud_${uuidv4().slice(0, 8)}`;
  const stages = {};
  const ruleMatches = [];

  try {

    // ── Stage 1: Expiry Guard ─────────────────────────────────────────────
    if (event.expires_at && new Date(event.expires_at) < new Date()) {
      stages.expiry = 'EXPIRED';
      return await finalize('NEVER', 0,
        'Event expired (expires_at in the past). Delivery has no value.',
        null, stages, ruleMatches, auditId, event);
    }
    stages.expiry = 'VALID';

    // ── Stage 2: Dedup Guard ──────────────────────────────────────────────
    const dup = await checkDuplicate(event);
    stages.dedup = dup.isDuplicate ? `${dup.type}: ${dup.detail}` : 'PASS';
    if (dup.isDuplicate) {
      return await finalize('NEVER', 0,
        `Duplicate suppressed (${dup.type}): ${dup.detail}`,
        null, stages, ruleMatches, auditId, event);
    }

    // ── Stage 3: Hard Rules ───────────────────────────────────────────────
    // CRITICAL always wins — no scoring needed
    if (event.priority_hint === 'CRITICAL') {
      stages.rules = 'CRITICAL_OVERRIDE';
      ruleMatches.push('critical-always-now');
      await storeFingerprint(event);
      await incrementCounter(event);
      return await finalize('NOW', 97,
        'CRITICAL priority — bypasses all guards and sends immediately.',
        null, stages, ruleMatches, auditId, event);
    }

    // Check human-configured rules
    const rules = await getRules();
    const matched = matchRules(event, rules);
    matched.forEach(r => ruleMatches.push(r.rule_id));

    const suppressRule = matched.find(r => r.action === 'SUPPRESS');
    if (suppressRule) {
      stages.rules = `SUPPRESSED by rule: ${suppressRule.rule_id}`;
      return await finalize('NEVER', 0,
        `Suppressed by operator rule: ${suppressRule.rule_id}`,
        null, stages, ruleMatches, auditId, event);
    }
    stages.rules = ruleMatches.length > 0
      ? `Matched: [${ruleMatches.join(', ')}]`
      : 'No rules matched';

    // ── Stage 4: DND / Quiet Hours ────────────────────────────────────────
    const dnd = checkDND(event);
    stages.dnd = dnd.inDND ? `IN_DND (${dnd.window})` : 'CLEAR';
    if (dnd.inDND) {
      const scheduleAt = getNextOpenWindow();
      await storeFingerprint(event);
      return await finalize('LATER', 35,
        `User in DND window (${dnd.window}). Deferred to next open slot.`,
        scheduleAt, stages, ruleMatches, auditId, event);
    }

    // ── Stage 5: Composite Scoring ────────────────────────────────────────
    const baseScore = computeScore(event);
    stages.scorer = `base_score=${baseScore}`;

    // ── Stage 6: Fatigue Guard ────────────────────────────────────────────
    const fatigue = await getFatiguePenalty(event.user_id, event.source);
    stages.fatigue = `count=${fatigue.count}/hr, penalty=${fatigue.penalty}, level=${fatigue.level}`;

    // ── Stage 7: AI Scorer (non-blocking) ─────────────────────────────────
    let aiScore = 0;
    try {
      aiScore = await getAiScore(event);
      stages.ai = `adjustment=${aiScore >= 0 ? '+' : ''}${aiScore}`;
    } catch (aiErr) {
      stages.ai = `SKIPPED (${aiErr.message})`;
      logger.warn(`[AI SKIP] ${aiErr.message} — proceeding without AI score`);
    }

    // ── Stage 8: Conflict Resolver ────────────────────────────────────────
    const finalScore = Math.max(0, Math.min(100, baseScore - fatigue.penalty + aiScore));
    const conflict = resolveConflict(event, finalScore, fatigue);
    stages.conflict = conflict.resolved ? conflict.reason : 'No conflict detected';

    if (conflict.resolved) {
      const schedAt = conflict.decision === 'LATER' ? getShortDefer() : null;
      await storeFingerprint(event);
      await incrementCounter(event);
      return await finalize(conflict.decision, finalScore,
        conflict.reason, schedAt, stages, ruleMatches, auditId, event);
    }

    // ── Stage 9: Decision Boundary ────────────────────────────────────────
    let decision, scheduleAt = null, reason;

    if (finalScore >= 60) {
      decision   = 'NOW';
      reason     = `Score ${finalScore} ≥ 60 — dispatching immediately.`;
    } else if (finalScore >= 30) {
      decision   = 'LATER';
      scheduleAt = getOptimalWindow(event.event_type);
      reason     = `Score ${finalScore} in [30,60) — scheduled for ${scheduleAt}.`;
    } else {
      decision   = 'NEVER';
      reason     = `Score ${finalScore} < 30 — low-value notification suppressed.`;
    }

    stages.decision = `score=${finalScore} → ${decision}`;
    await storeFingerprint(event);
    await incrementCounter(event);
    return await finalize(decision, finalScore, reason, scheduleAt, stages, ruleMatches, auditId, event);

  } catch (err) {
    logger.error(`[CLASSIFIER ERROR] ${err.message}`);

    // FAILSAFE: never silently lose a CRITICAL event
    if (event.priority_hint === 'CRITICAL') {
      logger.warn('[FAILSAFE] Pipeline error — CRITICAL event sent NOW by failsafe');
      return await finalize('NOW', 90,
        'FAILSAFE: pipeline error caught — CRITICAL sent NOW to prevent loss.',
        null, { failsafe: true }, [], auditId, event);
    }
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function checkDND(event) {
  // In production: look up user DND preferences from user profile DB
  const hour = new Date().getHours();
  return {
    inDND:  hour >= 23 || hour < 8,
    window: '23:00–08:00',
  };
}

function getNextOpenWindow() {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  if (new Date().getHours() >= 8) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function getShortDefer() {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString(); // +15 min
}

function getOptimalWindow(eventType) {
  const delayMs = ['promotion', 'low_value_promo', 'system_update'].includes(eventType)
    ? (2 + Math.random() * 3) * 3600000   // 2–5 hours for low-priority
    : (15 + Math.random() * 30) * 60000;  // 15–45 min for medium-priority
  return new Date(Date.now() + delayMs).toISOString();
}

async function finalize(decision, score, reason, scheduleAt, stages, ruleMatches, auditId, event) {
  const result = { decision, score, reason, schedule_at: scheduleAt, audit_id: auditId };

  await writeAudit({
    audit_id:      auditId,
    event_id:      event.dedupe_key || uuidv4(),
    user_id:       event.user_id,
    event_type:    event.event_type,
    decision,
    score,
    reason,
    stages,
    rules_matched: ruleMatches,
    schedule_at:   scheduleAt,
    created_at:    new Date().toISOString(),
  });

  if (decision === 'LATER' && scheduleAt) {
    await scheduleDeferred(event, scheduleAt, auditId);
  }

  logger.info(`[DECISION] ${decision} | score=${score} | user=${event.user_id} | type=${event.event_type} | audit=${auditId}`);
  return result;
}

module.exports = { evaluate };
