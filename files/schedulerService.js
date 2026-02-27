/**
 * schedulerService.js — Deferred Notification Scheduler
 *
 * Handles LATER decisions:
 *  - Queues deferred events with a scheduled delivery time
 *  - Processes due events every 30 seconds
 *  - Supports operator override (force NOW / force NEVER)
 *
 * In production: replace in-memory queue with Kafka topic or Redis queue.
 * The scheduler consumer re-evaluates events at schedule_at time before dispatch.
 */

const logger = require('../utils/logger');

// In-memory queue (replace with Kafka/Redis in production)
const deferredQueue = [];

/**
 * Add a LATER event to the deferred delivery queue.
 *
 * @param {Object} event      - Original notification event
 * @param {string} scheduleAt - ISO timestamp for delivery
 * @param {string} auditId    - For traceability
 */
async function scheduleDeferred(event, scheduleAt, auditId) {
  deferredQueue.push({
    event,
    scheduleAt,
    auditId,
    queuedAt: new Date().toISOString(),
    status:   'PENDING',
  });
  logger.info(`[SCHEDULER] Queued ${event.event_type} for user=${event.user_id} at ${scheduleAt} | audit=${auditId}`);
}

/**
 * Force-send or force-suppress a notification.
 * Used by operators for emergency broadcasts or escalation.
 * Requires operator_id and a mandatory reason (logged for audit).
 *
 * @param {{ notification_id, override_to, operator_id, reason }}
 * @returns {Object}
 */
async function forceOverride({ notification_id, override_to, operator_id, reason }) {
  // In production: look up event from DB/queue by notification_id and re-dispatch
  logger.warn(`[OVERRIDE] ${notification_id} → ${override_to} by operator=${operator_id} | reason: ${reason}`);

  return {
    success:         true,
    notification_id,
    override_to,
    operator_id,
    reason,
    override_at:     new Date().toISOString(),
    message:         `Notification ${notification_id} overridden to ${override_to} by ${operator_id}`,
  };
}

/**
 * Process pending deferred events that are now due.
 * Called every 30 seconds via setInterval.
 */
async function processDeferredQueue() {
  const now = new Date();
  const due = deferredQueue.filter(e => e.status === 'PENDING' && new Date(e.scheduleAt) <= now);

  for (const entry of due) {
    try {
      // In production: publish to delivery service / push gateway
      entry.status = 'DISPATCHED';
      logger.info(`[SCHEDULER] Dispatched deferred event | audit=${entry.auditId}`);
    } catch (err) {
      entry.status = 'FAILED';
      logger.error(`[SCHEDULER] Dispatch failed for audit=${entry.auditId}: ${err.message}`);
    }
  }

  if (due.length > 0) {
    logger.info(`[SCHEDULER] Processed ${due.length} deferred events`);
  }
}

// Process deferred queue every 30 seconds
setInterval(processDeferredQueue, 30000);

/**
 * Get current queue statistics (for monitoring).
 */
function getQueueStats() {
  return {
    pending:    deferredQueue.filter(e => e.status === 'PENDING').length,
    dispatched: deferredQueue.filter(e => e.status === 'DISPATCHED').length,
    failed:     deferredQueue.filter(e => e.status === 'FAILED').length,
    total:      deferredQueue.length,
  };
}

module.exports = { scheduleDeferred, forceOverride, processDeferredQueue, getQueueStats };
