/**
 * default.js — Central Configuration
 * All values are overridable via environment variables (.env)
 */

module.exports = {
  server: {
    port: process.env.PORT       || 3000,
    env:  process.env.NODE_ENV   || 'development',
  },

  redis: {
    host:     process.env.REDIS_HOST     || 'localhost',
    port:     parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  engine: {
    // Decision score thresholds
    nowThreshold:   60,
    laterThreshold: 30,

    // Alert fatigue caps
    maxNotifsPerHour:    parseInt(process.env.MAX_NOTIFS_PER_HOUR)     || 5,
    maxPerSourcePerHour: parseInt(process.env.MAX_PER_SOURCE_PER_HOUR) || 2,
    maxPromoPer4h:       parseInt(process.env.MAX_PROMO_PER_4H)        || 1,

    // Dedup TTLs (seconds)
    dedupTtlTransactional: 600,
    dedupTtlPromo:         86400,

    // AI scorer
    aiTimeoutMs:   parseInt(process.env.AI_SERVICE_TIMEOUT_MS) || 200,
    aiServiceUrl:  process.env.AI_SERVICE_URL || null,

    // Rule hot-reload
    ruleReloadIntervalMs: parseInt(process.env.RULE_RELOAD_INTERVAL_MS) || 30000,

    // DND window (24-hour clock)
    dndStartHour: 23,
    dndEndHour:    8,
  },
};
