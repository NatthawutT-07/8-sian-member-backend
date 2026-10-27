import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountLineAuth } from '../../src/modules/auth/line.routes.js';
import { originGuard } from '../../src/middleware/origin-guard.js';
import { hashPassword } from '../../src/shared/security.js';

const lineId = 'U' + 'a'.repeat(32);
const origin = 'https://8sianracha.com';
const profile = {
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  birthDate: '1990-01-01',
  privacyConsent: true,
};

// In-memory repository for HTTP contract tests; no development/production database is touched.
function repository(initial) {
  let rows = { flows: [], members: initial, sessions: [], audits: [] };
  function matches(row, where) {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return value.some((condition) => matches(row, condition));
      if (value && typeof value === 'object') {
        if ('gt' in value) return row[key] > value.gt;
        if ('lte' in value) return row[key] <= value.lte;
        if ('lt' in value) return row[key] < value.lt;
      }
      return (row[key] ?? null) === value;
    });
  }
  function model(key) {
    return {
      upsert: async ({ where, create, update }) => {
        const old = rows[key].find((row) => matches(row, where));
        if (old) {
          Object.assign(old, update);
          return old;
        }
        return model(key).create({ data: create });
      },
      findUnique: async ({ where }) => rows[key].find((row) => matches(row, where)) || null,
      deleteMany: async ({ where }) => {
        const before = rows[key].length;
        rows[key] = rows[key].filter((row) => !matches(row, where));
        return { count: before - rows[key].length };
      },
      create: async ({ data }) => {
        if (key === 'members' && rows.members.some((row) => row.lineUserId === data.lineUserId))
          throw Object.assign(new Error(), { code: 'P2002' });
        const row = {
          id: `${key}-${rows[key].length}`,
          memberNumber: rows[key].length + 1,
          phone: null,
          ...data,
        };
        rows[key].push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const targets = rows[key].filter((row) => matches(row, where));
        for (const row of targets) {
          if (
            rows[key].some((other) => other.id !== row.id && other.lineUserId === data.lineUserId)
          )
            throw Object.assign(new Error(), { code: 'P2002' });
          Object.assign(row, data);
        }
        return { count: targets.length };
      },
    };
  }
  const db = {
    lineAuthFlow: model('flows'),
    member: model('members'),
    session: model('sessions'),
    auditLog: model('audits'),
  };
  let tail = Promise.resolve();
  db.$transaction = (fn) => {
    const work = tail.then(async () => {
      const backup = structuredClone(rows);
      try {
        return await fn(db);
      } catch (e) {
        rows = backup;
        throw e;
      }
    });
    tail = work.catch(() => {});
    return work;
  };
  return { db, rows: () => rows };
}
async function fixture(run, { members = [], enabled = true, rejectIdentity = false } = {}) {
  const repo = repository(members),
    app = express();
  let verifies = 0;
  app.use(express.json(), originGuard(origin));
  await mountLineAuth(
    app,
    repo.db,
    {
      production: true,
      origin,
      cookieName: '__Host-member_session',
      cookieOptions: { httpOnly: true, secure: true, sameSite: 'none', path: '/' },
      line: enabled
        ? {
            channelId: '2012229080',
            channelSecret: 'fake',
            callbackUrl: 'https://api.8sianracha.com/api/auth/line/callback',
          }
        : null,
    },
    async () => {
      verifies++;
      if (rejectIdentity) throw new Error('upstream');
      return { lineUserId: lineId, displayName: 'ชื่อ LINE 🐱' };
    },
  );
  app.use((err, req, res, next) => res.status(500).json({ error: err.name }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const send = (path, { cookie, body, requestOrigin = origin } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'manual',
      headers: {
        Origin: requestOrigin,
        ...(cookie ? { Cookie: cookie } : {}),
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const flowCookie = (response) =>
    response.headers
      .getSetCookie()
      .filter((v) => v.startsWith('__Host-line_flow=') && !v.startsWith('__Host-line_flow=;'))
      .at(-1)
      ?.split(';')[0];
  async function start(intent = 'link') {
    const response = await send('/api/auth/line' + (intent === 'link' ? '?intent=link' : ''));
    return {
      response,
      cookie: flowCookie(response),
      state: new URL(response.headers.get('location')).searchParams.get('state'),
    };
  }
  const callback = (flow, query = '') =>
    send(`/api/auth/line/callback?state=${flow.state}&code=valid${query}`, { cookie: flow.cookie });
  try {
    await run({ ...repo, send, start, callback, flowCookie, verifies: () => verifies });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test('disabled LINE returns status and blocks entry without creating flows', () =>
  fixture(
    async ({ send, rows }) => {
      assert.deepEqual(await (await send('/api/auth/line/status')).json(), { enabled: false });
      assert.equal((await send('/api/auth/line')).status, 503);
      assert.equal(rows().flows.length, 0);
    },
    { enabled: false },
  ));
test('callback is browser-bound, expiring, one-use and does not expose tokens in redirects', () =>
  fixture(async ({ start, callback, send, verifies, flowCookie, rows }) => {
    const flow = await start();
    assert.match(flow.response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(flow.response.headers.get('set-cookie'), /Secure/);
    assert.match(flow.response.headers.get('set-cookie'), /SameSite=Lax/);
    const wrong = await callback({ ...flow, state: 'wrong' });
    assert.match(wrong.headers.get('location'), /line_error=expired/);
    assert.match(
      (await callback({ ...flow, cookie: undefined })).headers.get('location'),
      /expired/,
    );
    assert.equal(verifies(), 0);
    const done = await callback(flow);
    assert.equal(done.headers.get('location'), origin + '/line/complete');
    assert.notEqual(flowCookie(done), flow.cookie);
    assert.equal(rows().members.length, 0);
    assert.equal((await send('/api/auth/line/pending', { cookie: flowCookie(done) })).status, 200);
    assert.match((await callback(flow)).headers.get('location'), /expired/);
    assert.equal(verifies(), 1);
    const expired = await start();
    rows().flows.find((f) => f.stateHash).expiresAt = new Date(0);
    assert.match((await callback(expired)).headers.get('location'), /expired/);
  }));
test('cancelled or rejected LINE never creates a member session', async () => {
  await fixture(async ({ start, callback, rows, verifies }) => {
    assert.match(
      (await callback(await start(), '&error=access_denied')).headers.get('location'),
      /cancelled/,
    );
    assert.equal(verifies(), 0);
    assert.equal(rows().sessions.length, 0);
  });
  await fixture(
    async ({ start, callback, rows }) => {
      assert.match((await callback(await start())).headers.get('location'), /failed/);
      assert.equal(rows().sessions.length, 0);
    },
    { rejectIdentity: true },
  );
});
test('ordinary LINE login creates a member automatically from verified display name', () =>
  fixture(async ({ start, callback, send, rows }) => {
    const response = await callback(await start('login'));
    assert.equal(response.headers.get('location'), origin + '/coupons');
    assert.equal(rows().members.length, 1);
    assert.equal(rows().members[0].firstName, 'ชื่อ LINE 🐱');
    assert.equal(rows().members[0].lineDisplayName, 'ชื่อ LINE 🐱');
    assert.equal(rows().members[0].lastName, '');
    assert.equal(rows().members[0].phone, null);
    assert.equal(rows().flows.length, 0);
    assert.equal(rows().sessions.length, 1);
    assert.equal((await send('/api/auth/line/register', { body: profile })).status, 410);
    await callback(await start('login'));
    assert.equal(rows().members.length, 1);
  }));

test('existing LINE logs into the same member without a duplicate or new registration', () =>
  fixture(
    async ({ start, callback, rows }) => {
      const result = await callback(await start());
      assert.equal(result.headers.get('location'), origin + '/coupons');
      assert.equal(rows().sessions[0].memberId, 'existing');
      assert.equal(rows().members.length, 1);
    },
    { members: [{ id: 'existing', lineUserId: lineId, memberNumber: 42, ...profile }] },
  ));
test('linking requires existing password and preserves member ID and number', async () => {
  const member = {
    id: 'old',
    memberNumber: 99,
    phone: '0812345678',
    passwordHash: await hashPassword('test-password'),
    lineUserId: null,
    ...profile,
  };
  await fixture(
    async ({ start, callback, flowCookie, send, rows }) => {
      const cookie = flowCookie(await callback(await start()));
      const body = { phone: member.phone, password: 'wrong', privacyConsent: true };
      assert.equal((await send('/api/auth/line/link', { cookie, body })).status, 401);
      assert.equal(rows().members[0].lineUserId, null);
      const result = await send('/api/auth/line/link', {
        cookie,
        body: { ...body, password: 'test-password' },
      });
      assert.equal(result.status, 200);
      assert.equal((await result.json()).member.memberNumber, '8S-000099');
      assert.equal(rows().members.length, 1);
      assert.equal(rows().sessions[0].memberId, 'old');
      assert.equal(rows().audits[0].action, 'LINK_LINE');
    },
    { members: [member] },
  );
});
test('a member already linked to another LINE cannot be overwritten', async () => {
  const member = {
    id: 'old',
    memberNumber: 1,
    phone: '0812345678',
    passwordHash: await hashPassword('test-password'),
    lineUserId: 'U' + 'b'.repeat(32),
    ...profile,
  };
  await fixture(
    async ({ start, callback, flowCookie, send, rows }) => {
      const cookie = flowCookie(await callback(await start()));
      const result = await send('/api/auth/line/link', {
        cookie,
        body: { phone: member.phone, password: 'test-password', privacyConsent: true },
      });
      assert.equal(result.status, 409);
      assert.equal(rows().members[0].lineUserId, member.lineUserId);
      assert.equal(rows().sessions.length, 0);
    },
    { members: [member] },
  );
});
test('simultaneous LINE logins do not create duplicate members', () =>
  fixture(async ({ start, callback, rows }) => {
    const first = await start('login'),
      second = await start('login');
    const results = await Promise.all([callback(first), callback(second)]);
    assert.ok(results.every((r) => r.headers.get('location') === origin + '/coupons'));
    assert.equal(rows().members.length, 1);
  }));
