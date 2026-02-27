/**
 * scorer.js — Composite Scoring Engine
 *
 * Assigns a base score (0–75) based on event signals.
 * Final score = base - fatiguePenalty + aiScore (clamped 0–100)
 *
 * Score thresholds (applied in classifier.js):
 *   ≥ 60 → NOW
 *   ≥ 30 → LATER
 *   < 30 → NEVER
 */

const PRIORITY_SCORES = {
  CRITICAL: 40,
  HIGH:     25,
  MEDIUM:   15,
  LOW:       5,
};

const EVENT_TYPE_SCORES = {
  security_alert:  30,
  direct_message:  25,
  payment_alert:   28,
  reminder:        20,
  system_alert:    18,
  system_update:   10,
  promotion:        5,
  low_value_promo:  2,
  digest:           3,
};

const CHANNEL_SCORES = {
  sms:      10,
  push:      8,
  email:     5,
  'in-app':  3,
};

/**
 * Compute base score from event fields.
 * @param {Object} event
 * @returns {number} 0–75
 */
function computeScore(event) {
  const p = PRIORITY_SCORES[event.priority_hint]  ?? 10;
  const e = EVENT_TYPE_SCORES[event.event_type]   ?? 5;
  const c = CHANNEL_SCORES[event.channel]          ?? 3;
  const f = freshnessScore(event.timestamp);
  return Math.min(75, p + e + c + f);
}

/**
 * Reward fresh events, penalize stale ones.
 * @param {string} timestamp - ISO8601
 * @returns {number} 0–10
 */
function freshnessScore(timestamp) {
  if (!timestamp) return 5;
  const ageMin = (Date.now() - new Date(timestamp).getTime()) / 60000;
  if (ageMin < 1)  return 10;
  if (ageMin < 5)  return 8;
  if (ageMin < 15) return 5;
  if (ageMin < 60) return 2;
  return 0;
}

module.exports = { computeScore, PRIORITY_SCORES, EVENT_TYPE_SCORES, CHANNEL_SCORES };
