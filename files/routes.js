const { body, validationResult } = require('express-validator');
const { evaluate } = require('../engine/classifier');
const { getHistory, getAuditLog } = require('../services/auditService');
const { saveRule } = require('../services/ruleService');
const { forceOverride } = require('../services/schedulerService');
const logger = require('../utils/logger');

// ─── Validation ───────────────────────────────────────────────────────────────

const evaluateRules = [
  body('user_id').notEmpty().withMessage('user_id is required'),
  body('event_type').notEmpty().withMessage('event_type is required'),
  body('priority_hint').optional().isIn(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  body('channel').optional().isIn(['push', 'email', 'sms', 'in-app']),
  body('expires_at').optional().isISO8601(),
  body('timestamp').optional().isISO8601(),
];

// ─── Routes ───────────────────────────────────────────────────────────────────

function setupRoutes(app) {

  /**
   * POST /v1/notifications/evaluate
   * Core decision endpoint — classifies event as NOW / LATER / NEVER
   *
   * Body: { user_id, event_type, message, source, priority_hint,
   *         timestamp, channel, metadata, dedupe_key, expires_at }
   *
   * Response: { decision, score, reason, schedule_at, audit_id }
   */
  app.post('/v1/notifications/evaluate', evaluateRules, async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const event = {
        user_id:       req.body.user_id,
        event_type:    req.body.event_type,
        message:       req.body.message || '',
        source:        req.body.source  || 'unknown',
        priority_hint: req.body.priority_hint || 'MEDIUM',
        timestamp:     req.body.timestamp || new Date().toISOString(),
        channel:       req.body.channel  || 'push',
        dedupe_key:    req.body.dedupe_key || null,
        expires_at:    req.body.expires_at || null,
        metadata:      req.body.metadata  || {},
      };

      logger.info(`[EVALUATE] user=${event.user_id} type=${event.event_type} priority=${event.priority_hint}`);
      const result = await evaluate(event);
      res.status(200).json(result);

    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/notifications/history/:user_id
   * Returns notification history and fatigue context for a user
   *
   * Query: ?window=1h&source=all
   * Response: { user_id, window, count, cap, fatigue, events[] }
   */
  app.get('/v1/notifications/history/:user_id', async (req, res, next) => {
    try {
      const { user_id } = req.params;
      const window = req.query.window || '1h';
      const source = req.query.source || 'all';
      const history = await getHistory(user_id, window, source);
      res.status(200).json(history);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/rules
   * Create or update a human-configurable rule (no redeploy needed)
   *
   * Body: { rule_id, condition, action, max_per, priority, enabled }
   * Response: { success, rule }
   */
  app.post('/v1/rules', [
    body('rule_id').notEmpty(),
    body('condition').isObject(),
    body('action').isIn(['DEFER', 'SUPPRESS', 'SEND_NOW', 'CAP']),
    body('enabled').optional().isBoolean(),
  ], async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const rule = {
        rule_id:   req.body.rule_id,
        condition: req.body.condition,
        action:    req.body.action,
        max_per:   req.body.max_per  || null,
        priority:  req.body.priority || 10,
        enabled:   req.body.enabled  !== false,
      };

      const saved = await saveRule(rule);
      logger.info(`[RULE SAVED] ${rule.rule_id} → ${rule.action}`);
      res.status(200).json({ success: true, rule: saved });

    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/notifications/override
   * Force-send a suppressed or deferred notification (operators only)
   *
   * Body: { notification_id, override_to, operator_id, reason }
   * Response: { success, notification_id, override_to, override_at }
   */
  app.post('/v1/notifications/override', [
    body('notification_id').notEmpty(),
    body('override_to').isIn(['NOW', 'LATER', 'NEVER']),
    body('operator_id').notEmpty(),
    body('reason').notEmpty(),
  ], async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const result = await forceOverride(req.body);
      logger.warn(`[OVERRIDE] ${req.body.notification_id} → ${req.body.override_to} by ${req.body.operator_id}`);
      res.status(200).json(result);

    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /v1/audit/:audit_id
   * Retrieve the complete decision audit trail for any notification
   *
   * Response: { audit_id, decision, score, reason, stages, rules_matched, created_at }
   */
  app.get('/v1/audit/:audit_id', async (req, res, next) => {
    try {
      const audit = await getAuditLog(req.params.audit_id);
      if (!audit) return res.status(404).json({ error: 'Audit record not found' });
      res.status(200).json(audit);
    } catch (err) {
      next(err);
    }
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'notification-prioritization-engine' });
  });
}

module.exports = { setupRoutes };
