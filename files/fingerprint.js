const crypto = require('crypto');

/**
 * Build a SHA-256 fingerprint from event identifying fields.
 * Used for exact duplicate detection.
 *
 * @param {Object} event
 * @returns {string} 64-character hex string
 */
function buildFingerprint(event) {
  const msg = (event.message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const raw = `${event.user_id}|${event.event_type}|${msg}|${event.source || ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Generate a short random ID with an optional prefix.
 * @param {string} prefix
 * @returns {string}
 */
function shortId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = { buildFingerprint, shortId };
