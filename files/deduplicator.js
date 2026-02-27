/**
 * deduplicator.js — Exact + Near-Duplicate Detection
 *
 * Two layers:
 *
 * 1. EXACT DEDUP — SHA-256 fingerprint stored in Redis with TTL.
 *    Matches if user + event_type + normalized_message + source are identical.
 *    Also checks provided dedupe_key if present.
 *    TTL: 10 min for transactional, 24h for promotions.
 *
 * 2. NEAR-DEDUP — SimHash of message tokens stored in Redis sorted set.
 *    Matches if Hamming distance between hashes < 5 (85%+ similar content).
 *    Prevents slightly-reworded duplicate promotions slipping through.
 */

const crypto = require('crypto');
const { getRedis } = require('../services/redisService');
const logger = require('../utils/logger');

const TTL_TRANSACTIONAL = 600;    // 10 minutes
const TTL_PROMO         = 86400;  // 24 hours
const NEAR_DUP_WINDOW   = 600;    // 10 min sliding window
const HAMMING_THRESHOLD = 5;      // max bit differences for near-dup

/**
 * Check whether an incoming event is a duplicate.
 *
 * @param {Object} event
 * @returns {{ isDuplicate: boolean, type: string|null, detail: string|null }}
 */
async function checkDuplicate(event) {

  // 1. Check provided dedupe_key (if given and reliable)
  if (event.dedupe_key) {
    const exists = await redisGet(`dedup:key:${event.dedupe_key}`);
    if (exists) return { isDuplicate: true, type: 'EXACT_KEY', detail: `dedupe_key=${event.dedupe_key}` };
  }

  // 2. Check SHA-256 content fingerprint
  const fp = buildFingerprint(event);
  const fpExists = await redisGet(`dedup:fp:${fp}`);
  if (fpExists) return { isDuplicate: true, type: 'EXACT_FINGERPRINT', detail: `sha256=${fp.slice(0, 16)}...` };

  // 3. Check SimHash near-duplicate
  const near = await checkNearDuplicate(event);
  if (near.found) return { isDuplicate: true, type: 'NEAR_DUPLICATE', detail: `hamming_dist=${near.distance}` };

  return { isDuplicate: false, type: null, detail: null };
}

/**
 * Store fingerprints in Redis after a send/defer decision.
 * Prevents re-delivery of the same event within the TTL window.
 *
 * @param {Object} event
 */
async function storeFingerprint(event) {
  const redis = getRedis();
  const ttl   = isPromo(event.event_type) ? TTL_PROMO : TTL_TRANSACTIONAL;
  const fp    = buildFingerprint(event);

  try {
    // Store content fingerprint
    await redis.set(`dedup:fp:${fp}`, '1', 'EX', ttl);

    // Store dedupe_key if provided
    if (event.dedupe_key) {
      await redis.set(`dedup:key:${event.dedupe_key}`, '1', 'EX', ttl);
    }

    // Store SimHash for near-dup detection
    const simhash  = computeSimHash(event.message || '');
    const simKey   = `sim:${event.user_id}:${event.event_type}`;
    const now      = Date.now();

    await redis.zadd(simKey, now, simhash.toString());
    await redis.expire(simKey, NEAR_DUP_WINDOW);

    // Prune entries older than the window
    await redis.zremrangebyscore(simKey, '-inf', now - NEAR_DUP_WINDOW * 1000);

  } catch (err) {
    // Non-fatal — don't block the engine on Redis write failure
    logger.warn(`[DEDUP STORE] Redis write failed: ${err.message}`);
  }
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Build SHA-256 fingerprint from the event's key fields.
 * Normalizes message text to catch whitespace/case variations.
 */
function buildFingerprint(event) {
  const msg = (event.message || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const raw = `${event.user_id}|${event.event_type}|${msg}|${event.source || ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Check for near-duplicates using stored SimHashes.
 * Returns found=true if any stored hash is within HAMMING_THRESHOLD bits.
 */
async function checkNearDuplicate(event) {
  if ((event.message || '').length < 10) return { found: false };

  try {
    const redis     = getRedis();
    const simKey    = `sim:${event.user_id}:${event.event_type}`;
    const stored    = await redis.zrange(simKey, 0, -1);
    const current   = computeSimHash(event.message || '');

    for (const s of stored) {
      const dist = hammingDistance(current, BigInt(s));
      if (dist < HAMMING_THRESHOLD) return { found: true, distance: dist };
    }
  } catch (err) {
    logger.warn(`[NEAR DEDUP] Redis unavailable — skipping: ${err.message}`);
  }

  return { found: false };
}

/**
 * Token-level SimHash — converts text to a 64-bit BigInt fingerprint.
 * Similar messages produce hashes with small Hamming distances.
 */
function computeSimHash(text) {
  const tokens = text.toLowerCase().split(/\W+/).filter(t => t.length > 2);
  const v      = new Array(64).fill(0);

  for (const token of tokens) {
    const h = BigInt('0x' + crypto.createHash('md5').update(token).digest('hex').slice(0, 16));
    for (let i = 0; i < 64; i++) {
      v[i] += ((h >> BigInt(i)) & 1n) === 1n ? 1 : -1;
    }
  }

  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (v[i] > 0) hash |= (1n << BigInt(i));
  }
  return hash;
}

/** Count differing bits between two BigInt hashes. */
function hammingDistance(a, b) {
  let xor = a ^ b, count = 0;
  while (xor > 0n) { count += Number(xor & 1n); xor >>= 1n; }
  return count;
}

function isPromo(t) { return ['promotion', 'low_value_promo'].includes(t); }

async function redisGet(key) {
  try { return await getRedis().get(key); }
  catch (err) { logger.warn(`[DEDUP GET] ${key}: ${err.message}`); return null; }
}

module.exports = { checkDuplicate, storeFingerprint, buildFingerprint };
