import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAuthLimits } from '../../src/modules/auth/auth.limits.js';
async function serverTest(run) {
  const app = express(),
    limits = createAuthLimits();
  app.use(express.json());
  app.post('/register', limits.register, (req, res) => res.json({ ok: true }));
  app.post('/login', limits.loginIp, limits.loginAccount, (req, res) =>
    res.status(req.body.success ? 200 : 401).json({ ok: Boolean(req.body.success) }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const send = async (path, body = {}) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await res.json();
    return res;
  };
  try {
    await run(send);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test('registration spam returns 429 and retry time after five attempts', () =>
  serverTest(async (send) => {
    for (let i = 0; i < 5; i++) assert.equal((await send('/register')).status, 200);
    const blocked = await send('/register');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  }));
test('five failed logins limit the phone/IP pair without locking another phone', () =>
  serverTest(async (send) => {
    for (let i = 0; i < 5; i++)
      assert.equal((await send('/login', { phone: '0812345678' })).status, 401);
    assert.equal((await send('/login', { phone: '0812345678' })).status, 429);
    assert.equal((await send('/login', { phone: '0899999999' })).status, 401);
  }));
test('successful logins do not consume the failed login quota', () =>
  serverTest(async (send) => {
    for (let i = 0; i < 7; i++)
      assert.equal((await send('/login', { phone: '0812345678', success: true })).status, 200);
  }));
test('rotating phone numbers still hits the overall login IP limit', () =>
  serverTest(async (send) => {
    for (let i = 0; i < 30; i++)
      assert.equal((await send('/login', { phone: `phone-${i}` })).status, 401);
    assert.equal((await send('/login', { phone: 'another-phone' })).status, 429);
  }));
