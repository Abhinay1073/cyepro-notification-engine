/**
 * fatigueGuard.js — Alert Fatigue Detection & Rate Limiting
 *
 * Uses Redis sorted sets as sliding window counters.
 * Caps enforced:
 *   - Max 5 notifications / hour  (total per user)
 *   - Max 2 per source / hour     (prevents single-service flooding)
 *   - Max 1 promotion / 4 hours   (promo-specific cap)
 *
 * All caps are configurable via environment variables.
 * Fatigue penalty (0–30) is subtracted from the composite score.
 */

const { getRedis } = require('../services/redisService');
const logger = require('../utils/logger');

const CAPS = {
  total:  parseInt(process.env.MAX_NOTIFS_PER_HOUR)     || 5,
  source: parseInt(process.env.MAX_PER_SOURCE_PER_HOUR) || 2,
  promo:  parseInt(process.env.MAX_PROMO_PER_4H)        || 1,
};

const W1H = 3600;    // 1 hour in seconds
const W4H = 14400;   // 4 hours in seconds

/**
 * Get fatigue level and penalty for a user.
 *
 * @param {string} userId
 * @param {string} source
 * @returns {{ count: number, penalty: number, level: string }}
 */
async function getFatiguePenalty(userId, source) {
  let count = 0;

  try {
    const redis = getRedis();
    const now   = Date.now();
    count = await redis.zcount(`freq:${userId}:total`, now - W1H * 1000, now);
  } catch (err) {
    logger.warn(`[FATIGUE] Redis unavailable — returning 0 penalty: ${err.message}`);
    return { count: 0, penalty: 0, level: 'UNKNOWN' };
  }

  // Smooth penalty curve based on proximity to cap
  let penalty;
  const ratio = count / CAPS.total;
  if (ratio >= 1.0)     penalty = 30;  // At or over cap
  else if (ratio >= 0.8) penalty = 20; // 80% of cap
  else if (ratio >= 0.5) penalty = 10; // 50% of cap
  else if (count >= 2)   penalty = 5;  // Light usage
  else                   penalty = 0;

  const level = penalty === 0 ? 'LOW'
    : penalty <= 10 ? 'MEDIUM'
    : penalty <= 20 ? 'HIGH'
    : 'MAXED';

  return { count, penalty, level };
}

/**
 * Increment notification counters after a NOW or LATER decision.
 * Uses Redis sorted sets with ms timestamps as scores.
 *
 * @param {Object} event
 */
async function incrementCounter(event) {
  try {
    const redis  = getRedis();
    const now    = Date.now();
    const member = `${now}:${event.event_type}`;

    // Total user counter (1h window)
    const totalKey = `freq:${event.user_id}:total`;
    await redis.zadd(totalKey, now, member);
    await redis.expire(totalKey, W4H);
    await redis.zremrangebyscore(totalKey, '-inf', now - W1H * 1000);

    // Per-source counter (1h window)
    const srcKey = `freq:${event.user_id}:${event.source}`;
    await redis.zadd(srcKey, now, member);
    await redis.expire(srcKey, W4H);
    await redis.zremrangebyscore(srcKey, '-inf', now - W1H * 1000);

    // Promo counter (4h window)
    if (['promotion', 'low_value_promo'].includes(event.event_type)) {
      const promoKey = `freq:${event.user_id}:promo`;
      await redis.zadd(promoKey, now, member);
      await redis.expire(promoKey, W4H);
      await redis.zremrangebyscore(promoKey, '-inf', now - W4H * 1000);
    }

  } catch (err) {
    logger.warn(`[COUNTER] Redis write failed: ${err.message}`);
  }
}

/**
 * Check if a specific cap is already exceeded.
 * @param {string} userId
 * @param {'total'|'source'|'promo'} capType
 * @param {string} [source]
 * @returns {Promise<boolean>}
 */
async function isCapExceeded(userId, capType, source = '') {
  try {
    const redis = getRedis();
    const now   = Date.now();

    if (capType === 'total') {
      const n = await redis.zcount(`freq:${userId}:total`, now - W1H * 1000, now);
      return n >= CAPS.total;
    }
    if (capType === 'source') {
      const n = await redis.zcount(`freq:${userId}:${source}`, now - W1H * 1000, now);
      return n >= CAPS.source;
    }
    if (capType === 'promo') {
      const n = await redis.zcount(`freq:${userId}:promo`, now - W4H * 1000, now);
      return n >= CAPS.promo;
    }
  } catch (err) {
    logger.warn(`[CAP CHECK] Redis unavailable — returning false: ${err.message}`);
  }
  return false;
}

module.exports = { getFatiguePenalty, incrementCounter, isCapExceeded, CAPS };
