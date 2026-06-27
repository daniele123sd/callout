import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { BCRYPT_ROUNDS, hashPassword, sanitizePlainText, schemas, signAccessToken, signRefreshToken, verifyRefreshToken } from '../server/security.mjs';

test('plain-text sanitizer removes executable markup and control characters', () => {
  assert.equal(sanitizePlainText('<script>alert(1)</script><b>Safe</b>\u0000'), 'Safe');
});

test('signup validation enforces the 13+ confirmation', () => {
  const result = schemas.signup.validate({ email: 'person@example.com', password: 'SecurePass123!', displayName: 'Person', ageConfirmed: false });
  assert.ok(result.error);
});

test('passwords use bcrypt with twelve salt rounds', async () => {
  const hash = await hashPassword('SecurePass123!');
  assert.equal(BCRYPT_ROUNDS, 12);
  assert.equal(bcrypt.getRounds(hash), 12);
  assert.equal(await bcrypt.compare('SecurePass123!', hash), true);
});

test('access and refresh JWTs use distinct token types', () => {
  const access = signAccessToken('test-user');
  const refresh = signRefreshToken('test-user');
  assert.notEqual(access, refresh);
  assert.equal(verifyRefreshToken(refresh).type, 'refresh');
});
