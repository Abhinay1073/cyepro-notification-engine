const logger = require('../utils/logger');

/**
 * Global error handler middleware.
 * Must be registered last in Express.
 */
function errorHandler(err, req, res, next) {
  logger.error(`[ERROR] ${err.message}`, { stack: err.stack, path: req.path });

  if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      fallback: 'Engine retrying with rule-based scoring only',
      retry_after: 5,
    });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
}

/**
 * Request logger middleware — logs method, path, status, and latency.
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
}

module.exports = { errorHandler, requestLogger };
