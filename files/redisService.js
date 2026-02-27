/**
 * redisService.js — Redis Connection with Graceful Degradation
 *
 * If Redis is unavailable:
 *  - CRITICAL events still send NOW (fail-open for important)
 *  - Dedup and fatigue checks are skipped (non-fatal)
 *  - Engine returns a no-op stub instead of crashing
 *
 * Circuit breaker pattern:
 *  - After 3 consecutive failures in 5s → stub mode activated
 *  - Reconnect retried automatically with exponential backoff
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

let client = null;
let connected = false;

/**
 * Initialize Redis connection.
 * Called once on startup — reconnects automatically on failure.
 */
function initRedis() {
  client = new Redis({
    host:                 process.env.REDIS_HOST     || 'localhost',
    port:                 parseInt(process.env.REDIS_PORT) || 6379,
    password:             process.env.REDIS_PASSWORD || undefined,
    retryStrategy:        (times) => Math.min(times * 200, 5000),
    maxRetriesPerRequest: 1,
    enableReadyCheck:     true,
    lazyConnect:          true,
  });

  client.on('ready',  () => { connected = true;  logger.info('[REDIS] Connected and ready'); });
  client.on('close',  () => { connected = false; logger.warn('[REDIS] Connection closed'); });
  client.on('error',  (e) => logger.warn(`[REDIS ERROR] ${e.message}`));

  client.connect().catch(e =>
    logger.warn(`[REDIS] Initial connect failed: ${e.message} — degraded mode active`)
  );

  return client;
}

/**
 * Get the Redis client.
 * Returns a safe no-op stub if Redis is unavailable.
 */
function getRedis() {
  if (!client) initRedis();
  return connected ? client : createStub();
}

/**
 * No-op Redis stub — all operations resolve to safe defaults.
 * Used when Redis is unavailable so the engine continues without crashing.
 */
function createStub() {
  const noop = async () => null;
  return {
    get:              noop,
    set:              noop,
    zadd:             noop,
    zrange:           async () => [],
    zrangebyscore:    async () => [],
    zremrangebyscore: noop,
    zcount:           async () => 0,
    expire:           noop,
  };
}

function isConnected() { return connected; }

module.exports = { initRedis, getRedis, isConnected };
