/**
 * aiService.js — AI Context Scorer (Non-Blocking)
 *
 * Provides an additive score adjustment (-10 to +15) based on:
 *  - User's historical engagement with this notification type
 *  - Time-of-day delivery patterns for this user
 *  - Message relevance signals from the AI model
 *
 * CRITICAL DESIGN RULE:
 *  AI scoring is intentionally non-blocking and timeout-capped at 200ms.
 *  If the AI service is slow, overloaded, or unavailable:
 *    → The classifier catches the error and skips AI adjustment silently
 *    → Decision proceeds with rule-based scoring only
 *    → audit.stages.ai is set to 'SKIPPED' for visibility
 *
 *  AI is a bonus signal — never a gatekeeper.
 */

const logger = require('../utils/logger');

const TIMEOUT_MS     = parseInt(process.env.AI_SERVICE_TIMEOUT_MS) || 200;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL;

/**
 * Get AI context score for a notification event.
 *
 * @param {Object} event
 * @returns {Promise<number>} adjustment in range [-10, +15]
 * @throws {Error} if request times out or service is unavailable
 */
async function getAiScore(event) {
  // Fall back to mock scorer if no AI service URL configured
  if (!AI_SERVICE_URL) {
    return getMockAiScore(event);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${AI_SERVICE_URL}/score`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        user_id:     event.user_id,
        event_type:  event.event_type,
        channel:     event.channel,
        source:      event.source,
        hour_of_day: new Date().getHours(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`AI service HTTP ${response.status}`);

    const data       = await response.json();
    const adjustment = Math.max(-10, Math.min(15, data.score_adjustment ?? 0));

    logger.debug(`[AI SCORE] user=${event.user_id} adjustment=${adjustment}`);
    return adjustment;

  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`AI timeout (>${TIMEOUT_MS}ms)`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mock AI scorer for local development when no AI service is configured.
 * Simulates realistic engagement-based adjustments per event type.
 *
 * @param {Object} event
 * @returns {number}
 */
function getMockAiScore(event) {
  const base = {
    security_alert:  12,
    direct_message:  10,
    payment_alert:   11,
    reminder:         8,
    system_update:    2,
    promotion:       -5,
    low_value_promo: -8,
  }[event.event_type] ?? 0;

  const jitter = Math.floor(Math.random() * 6) - 3; // ±3
  return Math.max(-10, Math.min(15, base + jitter));
}

module.exports = { getAiScore, getMockAiScore };
