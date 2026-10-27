import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizationUrl,
  pkceChallenge,
  verifyLineIdentity,
} from '../../src/modules/auth/line-client.js';
import { readConfig } from '../../src/config/env.js';
const config = {
  channelId: '2012229080',
  channelSecret: 'test-secret',
  callbackUrl: 'https://api.8sianracha.com/api/auth/line/callback',
};
const input = { code: 'test-code', nonce: 'test-nonce', verifier: 'x'.repeat(64) };
const claims = {
  iss: 'https://access.line.me',
  aud: config.channelId,
  nonce: input.nonce,
  exp: Math.floor(Date.now() / 1000) + 300,
  sub: 'U' + 'a'.repeat(32),
  name: 'ชื่อ LINE 🐱',
};
test('PKCE matches RFC 7636 S256 vector and authorization does not leak secret', () => {
  assert.equal(
    pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
  const url = new URL(authorizationUrl(config, { ...input, state: 'state' }));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), config.callbackUrl);
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  assert.equal(url.searchParams.get('state'), 'state');
  assert.ok(!url.toString().includes(config.channelSecret));
});
test('exchanges code server-side and verifies ID token through LINE', async () => {
  const calls = [];
  const sub = await verifyLineIdentity(config, input, async (url, init) => {
    calls.push({ url, body: Object.fromEntries(init.body) });
    return {
      ok: true,
      json: async () => (url.endsWith('/token') ? { id_token: 'signed-token' } : claims),
    };
  });
  assert.deepEqual(sub, { lineUserId: claims.sub, displayName: claims.name });
  assert.equal(calls[0].body.code_verifier, input.verifier);
  assert.equal(calls[0].body.client_secret, config.channelSecret);
  assert.equal(calls[1].body.nonce, input.nonce);
  assert.equal(calls[1].body.client_id, config.channelId);
});
test('rejects wrong nonce, audience, issuer, expired or invalid identity', async () => {
  for (const patch of [
    { nonce: 'wrong' },
    { aud: 'wrong' },
    { iss: 'https://attacker.test' },
    { exp: 1 },
    { sub: '' },
    { sub: undefined },
    { name: undefined },
    { name: '' },
  ]) {
    await assert.rejects(
      verifyLineIdentity(config, input, async (url) => ({
        ok: true,
        json: async () => (url.endsWith('/token') ? { id_token: 'test' } : { ...claims, ...patch }),
      })),
    );
  }
});
test('fails closed when LINE rejects the token or omits an ID token', async () => {
  await assert.rejects(verifyLineIdentity(config, input, async () => ({ ok: false })));
  await assert.rejects(
    verifyLineIdentity(config, input, async () => ({ ok: true, json: async () => ({}) })),
  );
});
test('LINE configuration is all-or-none and requires HTTPS in production', () => {
  assert.equal(readConfig({}).line, null);
  assert.throws(() => readConfig({ LINE_LOGIN_CHANNEL_ID: config.channelId }));
  const env = {
    NODE_ENV: 'production',
    FRONTEND_ORIGIN: 'https://8sianracha.com',
    LINE_LOGIN_CHANNEL_ID: config.channelId,
    LINE_LOGIN_CHANNEL_SECRET: config.channelSecret,
    LINE_LOGIN_CALLBACK_URL: config.callbackUrl,
  };
  assert.deepEqual(readConfig(env).line, config);
  for (const url of [
    'http://api.8sianracha.com/api/auth/line/callback',
    'https://api.8sianracha.com/wrong',
    config.callbackUrl + '?next=evil',
  ])
    assert.throws(() => readConfig({ ...env, LINE_LOGIN_CALLBACK_URL: url }));
});
