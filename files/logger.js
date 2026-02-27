const winston = require('winston');

/**
 * Structured logger using Winston.
 * Outputs JSON in production, colorized text in development.
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp }) =>
              `${timestamp} ${level}: ${message}`
            )
          ),
    }),
  ],
});

module.exports = logger;
