/**
 * decision.js — Decision / Audit Log Schema
 *
 * Every classification decision is written here — NOW, LATER, or NEVER.
 * This is the source of truth for explainability and auditing.
 * Records are append-only and never deleted.
 *
 * SQL (PostgreSQL):
 * ─────────────────
 * CREATE TABLE decisions (
 *   audit_id      VARCHAR(32)  PRIMARY KEY,
 *   event_id      VARCHAR(256),
 *   user_id       VARCHAR(64)  NOT NULL,
 *   event_type    VARCHAR(64),
 *   decision      VARCHAR(8)   NOT NULL CHECK (decision IN ('NOW','LATER','NEVER')),
 *   score         SMALLINT,
 *   reason        TEXT,
 *   stages        JSONB,          -- per-stage diagnostic info
 *   rules_matched JSONB,          -- array of matched rule IDs
 *   schedule_at   TIMESTAMPTZ,    -- populated for LATER decisions
 *   ai_skipped    BOOLEAN DEFAULT FALSE,
 *   created_at    TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE INDEX idx_decisions_user_ts ON decisions(user_id, created_at DESC);
 * CREATE INDEX idx_decisions_decision  ON decisions(decision);
 *
 * Example record:
 * ───────────────
 * {
 *   "audit_id":      "aud_a1b2c3d4",
 *   "event_id":      "auth_login_8821_1708",
 *   "user_id":       "user_8821",
 *   "event_type":    "security_alert",
 *   "decision":      "NOW",
 *   "score":         97,
 *   "reason":        "CRITICAL priority — bypasses all guards.",
 *   "stages": {
 *     "expiry":   "VALID",
 *     "dedup":    "PASS",
 *     "rules":    "CRITICAL_OVERRIDE",
 *     "dnd":      "CLEAR",
 *     "scorer":   "base_score=75",
 *     "fatigue":  "count=2/hr, penalty=5, level=LOW",
 *     "ai":       "adjustment=+12",
 *     "conflict": "No conflict detected",
 *     "decision": "score=97 → NOW"
 *   },
 *   "rules_matched": ["critical-always-now"],
 *   "schedule_at":   null,
 *   "created_at":    "2025-02-25T14:00:02Z"
 * }
 */

module.exports = {};
