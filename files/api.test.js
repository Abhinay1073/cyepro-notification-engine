const request = require('supertest');
const app     = require('../server');

describe('API Integration Tests', () => {

  test('POST /v1/notifications/evaluate — CRITICAL → 200 + NOW', async () => {
    const res = await request(app)
      .post('/v1/notifications/evaluate')
      .send({
        user_id:       'api_test_user',
        event_type:    'security_alert',
        message:       'New login detected',
        source:        'auth-service',
        priority_hint: 'CRITICAL',
        channel:       'push',
      });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('NOW');
    expect(res.body).toHaveProperty('audit_id');
    expect(res.body).toHaveProperty('score');
    expect(res.body).toHaveProperty('reason');
  });

  test('POST /v1/notifications/evaluate — missing user_id → 400', async () => {
    const res = await request(app)
      .post('/v1/notifications/evaluate')
      .send({ event_type: 'promotion' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /v1/notifications/evaluate — expired event → NEVER', async () => {
    const res = await request(app)
      .post('/v1/notifications/evaluate')
      .send({
        user_id:    'api_test_user',
        event_type: 'reminder',
        message:    'Old meeting reminder',
        expires_at: '2020-01-01T00:00:00Z',
        channel:    'push',
      });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('NEVER');
    expect(res.body.reason).toMatch(/expired/i);
  });

  test('GET /health → 200 + ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /v1/audit/:id — non-existent → 404', async () => {
    const res = await request(app).get('/v1/audit/nonexistent_000');
    expect(res.status).toBe(404);
  });

  test('GET /v1/notifications/history/:user_id → 200', async () => {
    const res = await request(app).get('/v1/notifications/history/api_test_user');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user_id');
    expect(res.body).toHaveProperty('fatigue');
    expect(res.body).toHaveProperty('count');
  });

});
