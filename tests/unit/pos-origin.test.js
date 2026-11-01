import test from 'node:test';
import assert from 'node:assert/strict';
import { originGuard } from '../../src/middleware/origin-guard.js';

test('member website and desktop API origin are allowed, file/null/untrusted origins are rejected', () => {
  const guard = originGuard(['https://8sianracha.com', 'https://api.8sianracha.com']);
  for (const origin of [
    'https://8sianracha.com',
    'https://api.8sianracha.com',
    'null',
    'file://',
    'https://evil.example',
    undefined,
  ]) {
    let allowed = false;
    let status;
    guard(
      { method: 'POST', headers: { origin } },
      {
        status(code) {
          status = code;
          return this;
        },
        json() {},
      },
      () => {
        allowed = true;
      },
    );
    assert.equal(
      allowed,
      ['https://8sianracha.com', 'https://api.8sianracha.com'].includes(origin),
    );
    if (!allowed) assert.equal(status, 403);
  }
});
