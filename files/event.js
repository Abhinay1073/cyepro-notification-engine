/**
 * event.js — Notification Event Schema
 *
 * Represents a single incoming notification event entering the pipeline.
 *
 * SQL (PostgreSQL):
 * ─────────────────
 * CREATE TABLE events (
 *   id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id     VARCHAR(64)  NOT NULL,
 *   event_type  VARCHAR(64)  NOT NULL,
 *   message     TEXT,
 *   title       TEXT,
 *   source      VARCHAR(128),
 *   priority    VARCHAR(16)  CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
 *   channel     VARCHAR(16)  CHECK (channel IN ('push','email','sms','in-app')),
 *   dedupe_key  VARCHAR(256),
 *   expires_at  TIMESTAMPTZ,
 *   metadata    JSONB,
 *   received_at TIMESTAMPTZ  DEFAULT NOW()
 * );
 */

/**
 * Validate and normalize a raw incoming event object.
 * Fills in safe defaults for optional fields.
 *
 * @param {Object} raw
 * @returns {Object} normalized event
 */
function normalizeEvent(raw) {
  return {
    user_id:       String(raw.user_id       || ''),
    event_type:    String(raw.event_type    || 'unknown'),
    message:       String(raw.message       || raw.title || ''),
    title:         String(raw.title         || ''),
    source:        String(raw.source        || raw.service || 'unknown'),
    priority_hint: validatePriority(raw.priority_hint),
    timestamp:     raw.timestamp            || new Date().toISOString(),
    channel:       validateChannel(raw.channel),
    metadata:      (raw.metadata && typeof raw.metadata === 'object') ? raw.metadata : {},
    dedupe_key:    raw.dedupe_key           || null,
    expires_at:    raw.expires_at           || null,
  };
}

function validatePriority(p) {
  return ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(p) ? p : 'MEDIUM';
}

function validateChannel(c) {
  return ['push', 'email', 'sms', 'in-app'].includes(c) ? c : 'push';
}

module.exports = { normalizeEvent };
