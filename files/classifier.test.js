const { evaluate } = require('../src/engine/classifier');

jest.mock('../src/services/redisService', () => ({
  getRedis: () => ({
    get:              jest.fn().mockResolvedValue(null),
    set:              jest.fn().mockResolvedValue('OK'),
    zadd:             jest.fn().mockResolvedValue(1),
    zrange:           jest.fn().mockResolvedValue([]),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    zcount:           jest.fn().mockResolvedValue(0),
    expire:           jest.fn().mockResolvedValue(1),
  }),
}));

jest.mock('../src/services/aiService',   () => ({ getAiScore: jest.fn().mockResolvedValue(5) }));
jest.mock('../src/services/ruleService', () => ({
  getRules:       jest.fn().mockResolvedValue([]),
  matchRules:     jest.fn().mockReturnValue([]),
  initRuleLoader: jest.fn(),
}));

const base = {
  user_id:       'test_user',
  event_type:    'reminder',
  message:       'Meeting in 15 minutes',
  source:        'reminder-svc',
  priority_hint: 'MEDIUM',
  timestamp:     new Date().toISOString(),
  channel:       'push',
  dedupe_key:    null,
  expires_at:    null,
  metadata:      {},
};

describe('Classifier — Core Decision Logic', () => {

  test('CRITICAL event → always NOW', async () => {
    const r = await evaluate({ ...base, priority_hint: 'CRITICAL', event_type: 'security_alert' });
    expect(r.decision).toBe('NOW');
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  test('Expired event → always NEVER', async () => {
    const r = await evaluate({ ...base, expires_at: '2020-01-01T00:00:00Z' });
    expect(r.decision).toBe('NEVER');
    expect(r.reason).toMatch(/expired/i);
  });

  test('High-value event (direct_message HIGH) → NOW', async () => {
    const r = await evaluate({ ...base, event_type: 'direct_message', priority_hint: 'HIGH' });
    expect(r.decision).toBe('NOW');
  });

  test('Low-value promo LOW priority → NEVER or LATER', async () => {
    const r = await evaluate({ ...base, event_type: 'low_value_promo', priority_hint: 'LOW' });
    expect(['NEVER', 'LATER']).toContain(r.decision);
  });

  test('Result always contains required fields', async () => {
    const r = await evaluate(base);
    expect(r).toHaveProperty('decision');
    expect(r).toHaveProperty('score');
    expect(r).toHaveProperty('reason');
    expect(r).toHaveProperty('audit_id');
    expect(['NOW', 'LATER', 'NEVER']).toContain(r.decision);
  });

  test('audit_id always has aud_ prefix', async () => {
    const r = await evaluate(base);
    expect(r.audit_id).toMatch(/^aud_/);
  });

  test('LATER decision includes schedule_at timestamp', async () => {
    const r = await evaluate({ ...base, event_type: 'promotion', priority_hint: 'LOW', channel: 'email' });
    if (r.decision === 'LATER') {
      expect(r.schedule_at).not.toBeNull();
      expect(new Date(r.schedule_at)).toBeInstanceOf(Date);
    }
  });

});
