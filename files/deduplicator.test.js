const { buildFingerprint } = require('../src/engine/deduplicator');

const event = {
  user_id:    'user_001',
  event_type: 'promotion',
  message:    'Big sale today!',
  source:     'marketing',
};

describe('Deduplicator — Fingerprint Logic', () => {

  test('Same event produces same fingerprint', () => {
    expect(buildFingerprint(event)).toBe(buildFingerprint(event));
  });

  test('Different user_id → different fingerprint', () => {
    expect(buildFingerprint(event))
      .not.toBe(buildFingerprint({ ...event, user_id: 'user_002' }));
  });

  test('Different message → different fingerprint', () => {
    expect(buildFingerprint(event))
      .not.toBe(buildFingerprint({ ...event, message: 'Different content' }));
  });

  test('Whitespace variations → same fingerprint (normalized)', () => {
    const fp1 = buildFingerprint({ ...event, message: 'Big sale today!' });
    const fp2 = buildFingerprint({ ...event, message: '  Big  sale  today!  ' });
    expect(fp1).toBe(fp2);
  });

  test('Case insensitive → same fingerprint', () => {
    const fp1 = buildFingerprint({ ...event, message: 'Big Sale TODAY!' });
    const fp2 = buildFingerprint({ ...event, message: 'big sale today!' });
    expect(fp1).toBe(fp2);
  });

  test('Fingerprint is a 64-char hex string (SHA-256)', () => {
    expect(buildFingerprint(event)).toMatch(/^[a-f0-9]{64}$/);
  });

});
