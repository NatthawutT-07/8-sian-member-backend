// Uses its own disposable PostgreSQL schema; never resets the application's schema.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from '../src/shared/security.js';
const require = createRequire(import.meta.url),
  exec = promisify(execFile);
const schema = `qa_admin_${randomBytes(8).toString('hex')}`;
assert.match(schema, /^qa_admin_[a-f0-9]{16}$/);
const sourceUrl = new URL(process.env.DATABASE_URL),
  testUrl = new URL(sourceUrl);
testUrl.searchParams.set('schema', schema);
const bootstrap = new PrismaClient(),
  db = new PrismaClient({ datasourceUrl: testUrl.href });
const cwd = fileURLToPath(new URL('..', import.meta.url)),
  origin = 'http://localhost:5173',
  base = 'http://127.0.0.1:3101';
const ownerPassword = randomUUID(),
  newPassword = randomUUID();
const fixture = {
  firstName: 'QA Admin',
  lastName: 'Integration',
  phone: '0912345678',
  birthDate: '2000-02-29',
  password: randomUUID(),
  privacyConsent: true,
};
let child,
  created = false;
async function call(path, body, cookie, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  return response;
}
const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
try {
  await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  await exec(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd,
    env: { ...process.env, DATABASE_URL: testUrl.href },
    timeout: 60000,
  });
  await db.admin.create({
    data: { id: 'owner', username: 'admin', passwordHash: await hashPassword(ownerPassword) },
  });
  await assert.rejects(
    db.admin.create({ data: { id: 'another-admin', username: 'other', passwordHash: 'not-used' } }),
  );
  await assert.rejects(
    db.admin.create({ data: { username: 'second-owner', passwordHash: 'not-used' } }),
  );
  child = spawn(process.execPath, ['src/server.js'], {
    cwd,
    env: {
      ...process.env,
      DATABASE_URL: testUrl.href,
      NODE_ENV: 'development',
      PORT: '3101',
      FRONTEND_ORIGIN: origin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Admin test server startup timed out')), 10000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('API ready')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Test server exited: ${code}`));
    });
  });
  assert.equal((await call('/api/admin/members')).status, 401);
  let response = await call('/api/auth/register', { ...fixture, role: 'ADMIN' });
  assert.equal(response.status, 201);
  const memberCookie = cookieOf(response);
  const member = await db.member.findUnique({ where: { phone: fixture.phone } });
  assert.equal((await call('/api/admin/overview', null, memberCookie)).status, 401);
  assert.equal((await call('/api/coupons/claim', {}, memberCookie)).status, 404);
  assert.equal((await (await call('/api/coupons', null, memberCookie)).json()).coupons.length, 0);
  assert.equal(
    (await call('/api/admin/login', { username: 'admin', password: 'wrong' })).status,
    401,
  );
  response = await call('/api/admin/login', { username: 'admin', password: ownerPassword });
  assert.equal(response.status, 200);
  const adminCookie = cookieOf(response);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  assert.equal((await response.json()).admin.role, 'ADMIN');
  assert.equal((await call('/api/members/me', null, adminCookie)).status, 401);
  const listing = await (
    await call(`/api/admin/members?q=${fixture.phone}`, null, adminCookie)
  ).json();
  assert.equal(listing.total, 1);
  assert.equal(listing.members[0].passwordHash, undefined);
  assert.equal(
    (
      await call(
        '/api/admin/campaigns',
        { title: 'Invalid', description: 'Bad expiry', extraPrice: 79, validityDays: 0 },
        adminCookie,
      )
    ).status,
    400,
  );
  response = await call(
    '/api/admin/campaigns',
    { title: 'QA Seafood +79', description: 'Unlimited seafood', extraPrice: 79, validityDays: 30 },
    adminCookie,
  );
  assert.equal(response.status, 201);
  const campaign = (await response.json()).campaign;
  assert.equal(
    (
      await call(
        `/api/admin/members/${member.id}/coupons`,
        { campaignId: campaign.id },
        memberCookie,
      )
    ).status,
    401,
  );
  response = await call(
    `/api/admin/members/${member.id}/coupons`,
    { campaignId: campaign.id },
    adminCookie,
  );
  assert.equal(response.status, 201);
  const coupon = (await response.json()).coupon;
  assert.equal(new Date(coupon.expiresAt) - new Date(coupon.issuedAt), 30 * 86400000);
  assert.equal(
    (
      await call(
        `/api/admin/members/${member.id}/coupons`,
        { campaignId: campaign.id },
        adminCookie,
      )
    ).status,
    409,
  );
  const wallet = await (await call('/api/coupons', null, memberCookie)).json();
  assert.equal(wallet.coupons[0].title, campaign.title);
  assert.equal(wallet.coupons.length, 1);
  assert.equal((await call(`/api/coupons/${coupon.id}/redeem`, {}, memberCookie)).status, 410);
  response = await call(`/api/coupons/${coupon.id}/barcode`, {}, memberCookie);
  assert.equal(response.status, 200);
  const firstBarcode = (await response.json()).barcode;
  assert.match(firstBarcode.code, /^88\d{30}$/);
  assert.equal((await db.coupon.findUnique({ where: { id: coupon.id } })).usedAt, null);
  const oldHash = (await db.coupon.findUnique({ where: { id: coupon.id } })).barcodeTokenHash;
  assert.notEqual(oldHash, firstBarcode.code);
  response = await call(`/api/coupons/${coupon.id}/barcode`, {}, memberCookie);
  const secondBarcode = (await response.json()).barcode;
  assert.notEqual(secondBarcode.code, firstBarcode.code);
  assert.notEqual(
    (await db.coupon.findUnique({ where: { id: coupon.id } })).barcodeTokenHash,
    oldHash,
  );
  // Simulate a trusted POS settlement only in the isolated test schema.
  await db.coupon.update({
    where: { id: coupon.id },
    data: { usedAt: new Date(), barcodeTokenHash: null, barcodeExpiresAt: null },
  });
  assert.equal(
    (await (await call(`/api/coupons/${coupon.id}/status`, null, memberCookie)).json()).status,
    'USED',
  );
  assert.equal((await call(`/api/coupons/${coupon.id}/barcode`, {}, memberCookie)).status, 409);
  assert.equal(
    (
      await call(
        `/api/admin/members/${member.id}/coupons`,
        { campaignId: campaign.id },
        adminCookie,
      )
    ).status,
    409,
  );
  let detail = await (await call(`/api/admin/members/${member.id}`, null, adminCookie)).json();
  assert.equal(detail.coupons[0].status, 'USED');
  response = await call(
    '/api/admin/campaigns',
    { title: 'QA Other', description: 'Other offer', extraPrice: 0, validityDays: 7 },
    adminCookie,
  );
  const other = (await response.json()).campaign;
  const grants = await Promise.all([
    call(`/api/admin/members/${member.id}/coupons`, { campaignId: other.id }, adminCookie),
    call(`/api/admin/members/${member.id}/coupons`, { campaignId: other.id }, adminCookie),
  ]);
  assert.deepEqual(grants.map((r) => r.status).sort(), [201, 409]);
  await db.coupon.updateMany({
    where: { campaign: other.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  detail = await (await call(`/api/admin/members/${member.id}`, null, adminCookie)).json();
  assert.equal(detail.coupons.find((c) => c.campaignId === other.id).status, 'EXPIRED');
  assert.equal(
    (await call('/api/admin/campaigns/' + other.id, { active: false }, adminCookie, 'PATCH'))
      .status,
    200,
  );
  // Member self-claim is limited to open campaigns and shares the admin's uniqueness constraint.
  assert.equal((await call('/api/campaigns')).status, 401);
  assert.equal((await call(`/api/campaigns/${other.id}/claim`, {}, memberCookie)).status, 404);
  assert.equal((await call(`/api/campaigns/${campaign.id}/claim`, {}, memberCookie)).status, 409);
  const claimOffer = await db.campaign.create({
    data: { title: 'QA Self claim', description: 'Claim once', extraPrice: 79, validityDays: 30 },
  });
  let offers = await (await call('/api/campaigns', null, memberCookie)).json();
  assert.equal(
    offers.campaigns.some((c) => c.id === other.id),
    false,
  );
  assert.equal(offers.campaigns.find((c) => c.id === claimOffer.id).received, false);
  const claims = await Promise.all([
    call(`/api/campaigns/${claimOffer.id}/claim`, {}, memberCookie),
    call(`/api/campaigns/${claimOffer.id}/claim`, {}, memberCookie),
  ]);
  assert.deepEqual(claims.map((r) => r.status).sort(), [201, 409]);
  offers = await (await call('/api/campaigns', null, memberCookie)).json();
  assert.equal(offers.campaigns.find((c) => c.id === claimOffer.id).received, true);
  const claimed = await db.coupon.findUnique({
    where: { memberId_campaign: { memberId: member.id, campaign: claimOffer.id } },
  });
  assert.equal(new Date(claimed.expiresAt) - new Date(claimed.issuedAt), 30 * 86400000);
  assert.equal((await call(`/api/coupons/${claimed.id}/barcode`, {}, memberCookie)).status, 200);
  await db.coupon.update({
    where: { id: claimed.id },
    data: { usedAt: new Date(), barcodeTokenHash: null, barcodeExpiresAt: null },
  });
  assert.equal((await call(`/api/campaigns/${claimOffer.id}/claim`, {}, memberCookie)).status, 409);
  assert.equal(
    (
      await call(
        `/api/admin/members/${member.id}/coupons`,
        { campaignId: claimOffer.id },
        adminCookie,
      )
    ).status,
    409,
  );
  const reset = { newPassword, adminPassword: 'wrong', reason: 'Identity checked at store' };
  assert.equal(
    (await call(`/api/admin/members/${member.id}/password`, reset, adminCookie)).status,
    403,
  );
  assert.equal(
    await verifyPassword(
      fixture.password,
      (await db.member.findUnique({ where: { id: member.id } })).passwordHash,
    ),
    true,
  );
  assert.equal(
    (
      await call(
        `/api/admin/members/${member.id}/password`,
        { ...reset, adminPassword: ownerPassword },
        adminCookie,
      )
    ).status,
    200,
  );
  assert.equal((await call('/api/members/me', null, memberCookie)).status, 401);
  assert.equal(
    (await call('/api/auth/login', { phone: fixture.phone, password: fixture.password })).status,
    401,
  );
  assert.equal(
    (await call('/api/auth/login', { phone: fixture.phone, password: newPassword })).status,
    200,
  );
  const audits = await db.auditLog.findMany();
  assert.equal(audits.filter((a) => a.action === 'GRANT_COUPON').length, 2);
  assert.equal(audits.filter((a) => a.action === 'RESET_MEMBER_PASSWORD').length, 1);
  assert.equal(audits.filter((a) => a.action === 'MEMBER_CLAIM_COUPON').length, 1);
  const auditText = JSON.stringify(audits);
  for (const secret of [ownerPassword, newPassword, fixture.password])
    assert.equal(auditText.includes(secret), false);
  assert.equal((await call('/api/admin/logout', {}, adminCookie)).status, 200);
  assert.equal((await call('/api/admin/me', null, adminCookie)).status, 401);
  console.log(
    'PASS: isolated database, single admin, role isolation, manual coupon grants, no duplicates, one redemption, expiry, password reset, session revocation, audit privacy and logout',
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
  await db.$disconnect();
  if (created) await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await bootstrap.$disconnect();
}
