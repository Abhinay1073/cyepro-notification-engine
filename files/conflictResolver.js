/**
 * conflictResolver.js — Priority Conflict Resolution
 *
 * Handles edge cases where urgency and noise signals contradict.
 *
 * Example conflicts:
 *  - HIGH priority event from a source that fires 20x/hour  → LATER (not NEVER)
 *  - MEDIUM event when user fatigue is maxed                → NEVER
 *  - LOW event that scores ≥ 60 but user is overloaded      → LATER
 *
 * Key principle: Important notifications must NEVER be silently lost.
 * When in doubt, defer rather than suppress.
 */

/**
 * Resolve priority vs fatigue conflicts before final decision boundary.
 *
 * @param {Object} event
 * @param {number} score  - Composite score (0–100)
 * @param {Object} fatigue - { count, penalty, level }
 * @returns {{ resolved: boolean, decision: string|null, reason: string }}
 */
function resolveConflict(event, score, fatigue) {

  // HIGH priority + maxed fatigue → short defer, not suppressed
  if (event.priority_hint === 'HIGH' && fatigue.level === 'MAXED') {
    return {
      resolved: true,
      decision: 'LATER',
      reason:   `CONFLICT RESOLVED: HIGH priority but user fatigue MAXED (${fatigue.count}/hr). ` +
                `Deferred 15 min — not silently dropped.`,
    };
  }

  // HIGH priority + noisy source + high fatigue → short defer
  if (event.priority_hint === 'HIGH' && fatigue.level === 'HIGH' && isNoisySource(event.source)) {
    return {
      resolved: true,
      decision: 'LATER',
      reason:   `CONFLICT RESOLVED: HIGH priority but "${event.source}" is a noisy source ` +
                `and user fatigue is HIGH. Short defer applied.`,
    };
  }

  // MEDIUM + maxed fatigue → suppress (medium is not critical enough to force through)
  if (event.priority_hint === 'MEDIUM' && fatigue.level === 'MAXED') {
    return {
      resolved: true,
      decision: 'NEVER',
      reason:   `CONFLICT RESOLVED: MEDIUM priority suppressed — user at fatigue cap ` +
                `(${fatigue.count}/${5} per hr). Sending now would worsen alert fatigue.`,
    };
  }

  // LOW priority + score ≥ 60 but user overloaded → defer instead of NOW
  if (event.priority_hint === 'LOW' && score >= 60 && fatigue.level === 'MAXED') {
    return {
      resolved: true,
      decision: 'LATER',
      reason:   `CONFLICT RESOLVED: Score ${score} suggests NOW, but LOW priority + MAXED ` +
                `fatigue. Deferred to avoid noise.`,
    };
  }

  // Multi-channel: if same event targets multiple channels, let caller handle channel selection
  // (classifier will pick highest-priority channel, suppress rest)

  return { resolved: false, decision: null, reason: '' };
}

/**
 * Known noisy sources — in production this is dynamically learned
 * from source error rates, complaint signals, and delivery feedback.
 */
function isNoisySource(source) {
  const noisySources = new Set([
    'marketing-svc',
    'promo-service',
    'analytics-alerts',
    'noisy-svc',
    'bulk-sender',
  ]);
  return noisySources.has(source);
}

module.exports = { resolveConflict, isNoisySource };
