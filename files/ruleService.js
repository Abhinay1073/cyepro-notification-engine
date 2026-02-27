/**
 * ruleService.js — Human-Configurable Rules Engine
 *
 * Rules are stored in config/rules.json and hot-reloaded every 30s.
 * No code deployment is required to add, edit, or disable a rule.
 *
 * Rule matching:
 *  - Rules are sorted by priority (descending) before matching
 *  - A rule matches if ALL its condition fields match the event
 *  - Wildcard "*" matches any value for that field
 *  - Multiple rules can match; caller handles precedence
 */

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const RULES_FILE      = path.join(__dirname, '../../config/rules.json');
const RELOAD_INTERVAL = parseInt(process.env.RULE_RELOAD_INTERVAL_MS) || 30000;

let cachedRules = [];

// ── Rule Loading ──────────────────────────────────────────────────────────────

/**
 * Load and cache rules from config/rules.json.
 * Falls back to previously cached rules if file is unavailable.
 */
function loadRules() {
  try {
    const raw    = fs.readFileSync(RULES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cachedRules  = parsed.filter(r => r.enabled !== false);
    logger.info(`[RULES] Loaded ${cachedRules.length} active rules from ${RULES_FILE}`);
  } catch (err) {
    logger.warn(`[RULES] Load failed: ${err.message} — continuing with ${cachedRules.length} cached rules`);
  }
}

/**
 * Start the hot-reload loop.
 * Called once on server startup.
 */
function initRuleLoader() {
  loadRules();
  setInterval(loadRules, RELOAD_INTERVAL);
  logger.info(`[RULES] Hot-reload active every ${RELOAD_INTERVAL / 1000}s`);
}

// ── Rule Access ───────────────────────────────────────────────────────────────

/**
 * Get the current set of active rules.
 * @returns {Promise<Array>}
 */
async function getRules() {
  if (cachedRules.length === 0) loadRules();
  return cachedRules;
}

/**
 * Save or update a rule in config/rules.json.
 * Triggers an immediate cache reload.
 *
 * @param {Object} rule
 * @returns {Object} saved rule
 */
async function saveRule(rule) {
  try {
    let existing = [];
    try {
      existing = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
    } catch (_) {}

    const idx = existing.findIndex(r => r.rule_id === rule.rule_id);
    if (idx >= 0) existing[idx] = { ...existing[idx], ...rule };
    else          existing.push(rule);

    fs.writeFileSync(RULES_FILE, JSON.stringify(existing, null, 2));
    loadRules(); // Immediate reload
    logger.info(`[RULES] Saved rule: ${rule.rule_id}`);
    return rule;
  } catch (err) {
    logger.error(`[RULES SAVE] ${err.message}`);
    throw new Error('Failed to save rule');
  }
}

// ── Rule Matching ─────────────────────────────────────────────────────────────

/**
 * Match an event against a set of rules.
 * Returns all matching rules sorted by priority (highest first).
 *
 * @param {Object} event
 * @param {Array}  rules
 * @returns {Array} matched rules
 */
function matchRules(event, rules) {
  return rules
    .filter(rule => matchesCondition(event, rule.condition || {}))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/**
 * Check if an event matches a rule condition.
 * All non-wildcard condition fields must match.
 *
 * @param {Object} event
 * @param {Object} condition
 * @returns {boolean}
 */
function matchesCondition(event, condition) {
  const checks = [
    ['event_type', event.event_type],
    ['channel',    event.channel],
    ['source',     event.source],
    ['priority',   event.priority_hint],
  ];

  return checks.every(([key, value]) => {
    const cond = condition[key];
    return !cond || cond === '*' || cond === value;
  });
}

module.exports = { getRules, saveRule, matchRules, initRuleLoader };
