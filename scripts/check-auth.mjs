// Explicit integration check against the configured database. Removes only its own fixture.
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const origin = 'http://localhost:5173',
  base = 'http://127.0.0.1:3099';
const fixture = {
  phone: `09${String(randomInt(100000000)).padStart(8, '0')}`,
  firstName: `QA-${randomUUID().replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)))}`,
  lastName: 'Integration',
  birthDate: '2000-02-29',
  password: randomUUID(),
  privacyConsent: true,
  marketingConsent: false,
};
let child, otherMemberId;
const testCampaignId = `qa-${randomUUID()}`;
async function call(path, body, cookie, source = origin) {
  return fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: source,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
}
try {
  assert.equal(
    await db.member.findUnique({ where: { phone: fixture.phone } }),
    null,
    'Fixture number already exists; retry',
  );
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'development', FRONTEND_ORIGIN: origin, PORT: '3099' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('API ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited: ${code}`));
    });
  });
  assert.equal(
    (await call('/api/auth/register', fixture, null, 'https://other.invalid')).status,
    403,
  );
  assert.equal(
    (await call('/api/auth/register', { ...fixture, birthDate: '2100-01-01' })).status,
    400,
  );
  let response = await call('/api/auth/register', fixture);
  assert.equal(response.status, 201);
  const originalCookie = response.headers.get('set-cookie').split(';')[0];
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  const member = (await response.json()).member;
  assert.ok(member.memberNumber);
  assert.equal(member.passwordHash, undefined);
  const stored = await db.member.findUnique({ where: { phone: fixture.phone } });
  assert.notEqual(stored.passwordHash, fixture.password);
  assert.equal(stored.birthDate.toISOString().slice(0, 10), fixture.birthDate);
  assert.equal((await call('/api/members/me', null, originalCookie)).status, 200);
  assert.equal((await call('/api/auth/register', fixture)).status, 409);
  assert.equal(
    (await call('/api/auth/login', { phone: fixture.phone, password: 'wrong-password' })).status,
    401,
  );
  assert.equal((await call('/api/auth/logout', {}, originalCookie)).status, 200);
  assert.equal((await call('/api/members/me', null, originalCookie)).status, 401);
  response = await call('/api/auth/login', { phone: fixture.phone, password: fixture.password });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/members/me', null, cookie)).status, 200);
  // Coupon grants persist across refreshes/logins and cannot be redeemed twice.
  assert.equal((await call('/api/coupons')).status, 401);
  assert.equal((await call('/api/coupons/claim', {}, cookie)).status, 404);
  assert.equal((await (await call('/api/coupons', null, cookie)).json()).coupons.length, 0);
  const issuedAt = new Date();
  await db.coupon.create({
    data: {
      memberId: stored.id,
      campaign: 'seafood79_welcome_v1',
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 30 * 86400000),
    },
  });
  let listing = await (await call('/api/coupons', null, cookie)).json();
  assert.equal(listing.coupons.length, 1);
  const coupon = listing.coupons[0];
  assert.equal(coupon.extraPrice, 79);
  assert.equal(new Date(coupon.expiresAt) - new Date(coupon.issuedAt), 30 * 86400000);
  await call('/api/coupons/claim', {}, cookie);
  listing = await (await call('/api/coupons', null, cookie)).json();
  assert.equal(listing.coupons.length, 1);
  assert.equal(listing.coupons[0].expiresAt, coupon.expiresAt);
  assert.equal((await call(`/api/coupons/${coupon.id}/redeem`, {}, cookie)).status, 410);
  let barcodeResponse = await call(`/api/coupons/${coupon.id}/barcode`, {}, cookie);
  assert.equal(barcodeResponse.status, 200);
  const barcode = (await barcodeResponse.json()).barcode;
  assert.match(barcode.code, /^88\d{30}$/);
  assert.equal((await db.coupon.findUnique({ where: { id: coupon.id } })).usedAt, null);
  assert.equal(
    (await (await call(`/api/coupons/${coupon.id}/status`, null, cookie)).json()).status,
    'AVAILABLE',
  );
  // Simulate the future trusted POS payment transaction on this disposable fixture only.
  const settle = () =>
    db.coupon.updateMany({
      where: { id: coupon.id, usedAt: null },
      data: { usedAt: new Date(), barcodeTokenHash: null, barcodeExpiresAt: null },
    });
  const results = await Promise.all([settle(), settle()]);
  assert.deepEqual(results.map((r) => r.count).sort(), [0, 1]);
  assert.equal(
    (await db.coupon.findUnique({ where: { id: coupon.id } })).usedAt instanceof Date,
    true,
  );
  assert.equal((await call(`/api/coupons/${coupon.id}/barcode`, {}, cookie)).status, 409);
  assert.equal(
    (await (await call(`/api/coupons/${coupon.id}/status`, null, cookie)).json()).status,
    'USED',
  );
  await call('/api/coupons/claim', {}, cookie);
  listing = await (await call('/api/coupons', null, cookie)).json();
  assert.equal(listing.coupons.length, 0);
  assert.equal(
    await db.coupon.count({ where: { memberId: stored.id, campaign: 'seafood79_welcome_v1' } }),
    1,
  );
  await db.campaign.create({
    data: { id: testCampaignId, title: 'QA campaign', description: 'Temporary test' },
  });
  const expired = await db.coupon.create({
    data: { memberId: stored.id, campaign: testCampaignId, expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal((await call(`/api/coupons/${expired.id}/barcode`, {}, cookie)).status, 409);
  assert.equal((await (await call('/api/coupons', null, cookie)).json()).coupons.length, 0);
  const other = await db.member.create({
    data: {
      phone: `08${String(randomInt(100000000)).padStart(8, '0')}`,
      firstName: fixture.firstName + '-other',
      lastName: 'Integration',
    },
  });
  otherMemberId = other.id;
  const foreign = await db.coupon.create({
    data: {
      memberId: other.id,
      campaign: testCampaignId,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  assert.equal((await call(`/api/coupons/${foreign.id}/barcode`, {}, cookie)).status, 409);
  assert.equal((await call(`/api/coupons/${foreign.id}/status`, null, cookie)).status, 404);
  assert.equal((await db.coupon.findUnique({ where: { id: foreign.id } })).usedAt, null);
  assert.equal((await call('/api/auth/otp', {})).status, 404);
  console.log(
    'PASS: auth, 30-day coupon grant, no reissue, concurrent single redemption, expiry, ownership, removal after use',
  );
} finally {
  if (child) {
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once('exit', resolve);
        setTimeout(resolve, 3000).unref();
      }
    });
  }
  await db.member.deleteMany({ where: { phone: fixture.phone, firstName: fixture.firstName } });
  if (otherMemberId)
    await db.member.deleteMany({
      where: { id: otherMemberId, firstName: fixture.firstName + '-other' },
    });
  await db.campaign.deleteMany({ where: { id: testCampaignId } });
  await db.$disconnect();
}
