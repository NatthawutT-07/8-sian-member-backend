import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { digest } from '../../src/shared/security.js';

const memberId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const origin = 'https://8sianracha.com';
const memberCookie = `member_session=${'a'.repeat(64)}`;
const otherCookie = `member_session=${'c'.repeat(64)}`;
const adminCookie = `admin_session=${'b'.repeat(64)}`;
function repository() {
  let rows = {
    members: [
      { id: memberId, memberNumber: 1, firstName: 'ชื่อ LINE', lastName: '', phone: null },
      { id: otherId, memberNumber: 2, firstName: 'สมาชิกเดิม', lastName: '', phone: '0899999999' },
    ],
    visits: [],
    audits: [],
  };
  let failAudit = false;
  function matches(row, where) {
    return Object.entries(where).every(([key, value]) => (row[key] ?? null) === value);
  }
  const db = {
    member: {
      findUnique: async ({ where }) => rows.members.find((m) => matches(m, where)) || null,
      updateMany: async ({ where, data }) => {
        const found = rows.members.filter((m) => matches(m, where));
        if (data.phone && rows.members.some((m) => m.phone === data.phone && !found.includes(m)))
          throw Object.assign(new Error(), { code: 'P2002' });
        found.forEach((m) => Object.assign(m, data));
        return { count: found.length };
      },
      update: async ({ where, data }) => {
        const member = rows.members.find((m) => matches(m, where));
        Object.assign(member, data);
        return member;
      },
    },
    diningVisit: {
      count: async ({ where }) => rows.visits.filter((v) => matches(v, where)).length,
      findMany: async ({ where, take }) =>
        rows.visits
          .filter((v) => matches(v, where))
          .slice()
          .reverse()
          .slice(0, take),
      findUnique: async ({ where }) => rows.visits.find((v) => matches(v, where)) || null,
      create: async ({ data }) => {
        if (rows.visits.some((v) => v.receiptNumber === data.receiptNumber))
          throw Object.assign(new Error(), { code: 'P2002' });
        const visit = { id: String(rows.visits.length + 1), createdAt: new Date(), ...data };
        rows.visits.push(visit);
        return visit;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        if (failAudit) throw new Error('AUDIT_FAILED');
        rows.audits.push(data);
        return data;
      },
    },
    session: {
      findUnique: async ({ where }) => {
        const id =
          where.tokenHash === digest('a'.repeat(64))
            ? memberId
            : where.tokenHash === digest('c'.repeat(64))
              ? otherId
              : null;
        return id
          ? {
              expiresAt: new Date(Date.now() + 60000),
              member: rows.members.find((m) => m.id === id),
            }
          : null;
      },
    },
    adminSession: {
      findUnique: async ({ where }) =>
        where.tokenHash === digest('b'.repeat(64))
          ? { expiresAt: new Date(Date.now() + 60000), admin: { id: 'owner', role: 'ADMIN' } }
          : null,
    },
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
  return {
    db,
    rows: () => rows,
    failAudit: () => {
      failAudit = true;
    },
  };
}
async function fixture(run) {
  const repo = repository();
  const app = await createApp({
    db: repo.db,
    config: {
      production: false,
      origin,
      trustProxy: false,
      cookieName: 'member_session',
      cookieOptions: { httpOnly: true, sameSite: 'lax', path: '/' },
      line: null,
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const send = (path, { cookie = memberCookie, body, requestOrigin = origin } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: requestOrigin },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const addPhone = () => send('/api/members/me/phone', { body: { phone: '0812345678' } });
  const code = async () => (await send('/api/members/me/loyalty-code', { body: {} })).json();
  const lookup = (query) =>
    send('/api/admin/loyalty/lookup', { cookie: adminCookie, body: { query } });
  const award = (receiptNumber, patch = {}) =>
    send('/api/admin/loyalty/visits', {
      cookie: adminCookie,
      body: { memberId, receiptNumber, receiptIssued: true, ...patch },
    });
  try {
    await run({ ...repo, send, addPhone, code, lookup, award });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('loyalty endpoints enforce member/admin authentication and origin', () =>
  fixture(async ({ send, rows }) => {
    assert.equal((await send('/api/members/me/loyalty', { cookie: '' })).status, 401);
    for (const cookie of ['', memberCookie]) {
      assert.equal(
        (await send('/api/admin/loyalty/lookup', { cookie, body: { query: '0812345678' } })).status,
        401,
      );
      assert.equal(
        (
          await send('/api/admin/loyalty/visits', {
            cookie,
            body: { memberId, receiptNumber: 'INV-1', receiptIssued: true },
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await send('/api/members/me/phone', {
          body: { phone: '0812345678' },
          requestOrigin: 'https://evil.test',
        })
      ).status,
      403,
    );
    assert.equal(rows().visits.length, 0);
  }));

test('phone is required before QR, unique, added once and cannot overwrite another account', () =>
  fixture(async ({ send, addPhone, rows }) => {
    assert.equal((await send('/api/members/me/loyalty-code', { body: {} })).status, 400);
    for (const phone of ['123', '+66812345678', '08123456789'])
      assert.equal((await send('/api/members/me/phone', { body: { phone } })).status, 400);
    assert.equal(
      (await send('/api/members/me/phone', { body: { phone: '0899999999' } })).status,
      409,
    );
    assert.equal(rows().members[0].phone, null);
    assert.equal((await addPhone()).status, 200);
    assert.equal((await addPhone()).status, 200);
    assert.equal(rows().audits.filter((a) => a.action === 'ADD_LOYALTY_PHONE').length, 1);
    assert.equal(
      (await send('/api/members/me/phone', { body: { phone: '0866666666' } })).status,
      409,
    );
    assert.equal(rows().members[0].phone, '0812345678');
    const summary = await send('/api/members/me/loyalty');
    assert.equal(summary.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await summary.json(), { phone: '0812345678', visitCount: 0, visits: [] });
  }));

test('membership QR uses an opaque expiring token; scanning and phone lookup never award visits', () =>
  fixture(async ({ addPhone, code, lookup, rows }) => {
    await addPhone();
    const first = await code();
    assert.match(first.code, /^8SM-[a-f0-9]{64}$/);
    assert.ok(!first.code.includes('0812345678'));
    assert.equal(rows().members[0].loyaltyQrHash, digest(first.code));
    for (const query of [first.code, '0812345678', '8S-000001']) {
      const response = await lookup(query);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.member.id, memberId);
      assert.equal(result.visitCount, 0);
      assert.equal(result.member.loyaltyQrHash, undefined);
    }
    assert.equal(rows().visits.length, 0);
    const second = await code();
    assert.notEqual(first.code, second.code);
    assert.equal((await lookup(first.code)).status, 404);
    rows().members[0].loyaltyQrExpiresAt = new Date(0);
    assert.equal((await lookup(second.code)).status, 410);
    assert.equal(
      (await lookup('88012345678901234567890123456789')).status,
      400,
      'coupon code is not a member QR',
    );
    assert.equal((await lookup('8S-9999999999')).status, 400);
    assert.equal((await lookup('0866666666')).status, 404);
  }));

test('only an issued receipt adds one visit, retries are idempotent and cannot credit another member', () =>
  fixture(async ({ addPhone, award, send, rows }) => {
    assert.equal((await award('INV-1')).status, 400, 'a phone is required');
    await addPhone();
    for (const receiptIssued of [false, 'true', undefined])
      assert.equal((await award('INV-1', { receiptIssued })).status, 400);
    for (const receipt of ['', 'INV 001', '<script>'])
      assert.equal((await award(receipt)).status, 400);
    const first = await award(' inv-1 ', { points: 999 });
    assert.equal(first.status, 201);
    assert.equal((await first.json()).visitCount, 1);
    const retry = await award('INV-1');
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal((await award('INV-1', { memberId: otherId })).status, 409);
    const simultaneous = await Promise.all([award('INV-2'), award('inv-2')]);
    assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 201]);
    assert.equal(rows().visits.length, 2);
    assert.equal(rows().audits.filter((a) => a.action === 'ADD_DINING_VISIT').length, 2);
    assert.equal(rows().visits[0].recordedBy, 'owner');
    const summary = await (await send('/api/members/me/loyalty')).json();
    assert.equal(summary.visitCount, 2);
    assert.equal(summary.visits.length, 2);
    assert.equal(
      (await (await send('/api/members/me/loyalty', { cookie: otherCookie })).json()).visitCount,
      0,
    );
  }));

test('failed audit rolls back the visit so no points are silently awarded', () =>
  fixture(async ({ addPhone, failAudit, award, rows }) => {
    await addPhone();
    failAudit();
    assert.equal((await award('INV-FAIL')).status, 500);
    assert.equal(rows().visits.length, 0);
  }));
