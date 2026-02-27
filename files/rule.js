/**
 * rule.js — Configurable Rule Schema
 *
 * Rules are stored in config/rules.json and hot-reloaded every 30s.
 * Operators can add, edit, or disable rules without any code deployment.
 *
 * SQL (PostgreSQL — for production persistence):
 * ──────────────────────────────────────────────
 * CREATE TABLE rules (
 *   rule_id    VARCHAR(64)  PRIMARY KEY,
 *   condition  JSONB        NOT NULL,
 *   action     VARCHAR(16)  NOT NULL CHECK (action IN ('DEFER','SUPPRESS','SEND_NOW','CAP')),
 *   max_per    JSONB,          -- { count, window } — used with CAP action
 *   priority   SMALLINT     DEFAULT 10,  -- higher = evaluated first
 *   enabled    BOOLEAN      DEFAULT TRUE,
 *   updated_at TIMESTAMPTZ  DEFAULT NOW(),
 *   updated_by VARCHAR(64)
 * );
 *
 * Rule actions:
 * ─────────────
 *   DEFER      — Move to LATER queue (respects max_per cap)
 *   SUPPRESS   — Hard NEVER — event is dropped
 *   SEND_NOW   — Force NOW regardless of score
 *   CAP        — Allow up to max_per.count per max_per.window, defer rest
 *
 * Condition fields (all optional, use "*" for wildcard):
 * ───────────────────────────────────────────────────────
 *   event_type, channel, source, priority
 *
 * Example rules:
 * ──────────────
 * {
 *   "rule_id":   "promo-cap-email",
 *   "condition": { "event_type": "promotion", "channel": "email" },
 *   "action":    "CAP",
 *   "max_per":   { "count": 1, "window": "4h" },
 *   "priority":  10,
 *   "enabled":   true
 * }
 *
 * {
 *   "rule_id":   "security-fast-lane",
 *   "condition": { "event_type": "security_alert" },
 *   "action":    "SEND_NOW",
 *   "priority":  90,
 *   "enabled":   true
 * }
 */

module.exports = {};
