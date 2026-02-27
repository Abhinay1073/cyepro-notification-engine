/**
 * auditService.js — Decision Audit Log
 *
 * Every decision (NOW, LATER, NEVER) is recorded here.
 * Records are append-only and never modified after creation.
 * Provides full explainability for every classification decision.
 *
 * In production: replace in-memory store with PostgreSQL
 * using the schema defined in src/models/decision.js
 */

const logger = require('../utils/logger');

// In-memory stores (replace with PostgreSQL in production)
const auditStore   = new Map(); // audit_id → record
const historyStore = new Map(); // user_id  → recent decisions[]

/**
 * Write a decision audit record.
 * Called for every event — regardless of decision outcome.
 *
 * @param {Object} record
 */
async function writeAudit(record) {
  try {
    auditStore.set(record.audit_id, record);

    // Update per-user history (keep last 100)
    const history = historyStore.get(record.user_id) || [];
    history.unshift({
      audit_id:   record.audit_id,
      decision:   record.decision,
      event_type: record.event_type,
      score:      record.score,
      created_at: record.created_at,
    });
    historyStore.set(record.user_id, history.slice(0, 100));

    logger.debug(`[AUDIT] Written ${record.audit_id} → ${record.decision} (score=${record.score})`);
  } catch (err) {
    // Audit failure must NEVER crash the engine
    logger.error(`[AUDIT WRITE FAIL] ${err.message}`);
  }
}

/**
 * Retrieve a single audit record by ID.
 *
 * @param {string} auditId
 * @returns {Object|null}
 */
async function getAuditLog(auditId) {
  return auditStore.get(auditId) || null;
}

/**
 * Get notification history and fatigue context for a user.
 *
 * @param {string} userId
 * @param {string} window - '1h' | '4h' | '24h'
 * @param {string} source - 'all' or specific source
 * @returns {Object}
 */
async function getHistory(userId, window = '1h', source = 'all') {
  const windowMs = { '1h': 3600000, '4h': 14400000, '24h': 86400000 }[window] || 3600000;
  const cutoff   = Date.now() - windowMs;
  const history  = historyStore.get(userId) || [];
  const filtered = history.filter(h => new Date(h.created_at).getTime() > cutoff);

  const count        = filtered.length;
  const cap          = 5;
  const fatigueLevel = count === 0        ? 'NONE'
    : count < cap * 0.5 ? 'LOW'
    : count < cap * 0.8 ? 'MEDIUM'
    : count < cap       ? 'HIGH'
    : 'MAXED';

  return {
    user_id: userId,
    window,
    count,
    cap,
    fatigue: fatigueLevel,
    events:  filtered.slice(0, 20),
  };
}

module.exports = { writeAudit, getAuditLog, getHistory };
