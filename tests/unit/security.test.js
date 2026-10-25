import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, sessionToken, digest } from '../../src/shared/security.js';
test('password hashes use separate salts and verify only correct passwords', async () => {
  const a = await hashPassword('correct-password'),
    b = await hashPassword('correct-password');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('correct-password', a), true);
  assert.equal(await verifyPassword('wrong-password', a), false);
  assert.equal(await verifyPassword('correct-password', null), false);
});
test('session tokens are random and stored as digests', () => {
  const a = sessionToken(),
    b = sessionToken();
  assert.notEqual(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(a, digest(a));
});
