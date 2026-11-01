// Exercises real PostgreSQL constraints in a disposable local schema, never the store schema.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword, digest } from '../src/shared/security.js';
import { openShift, closeShift, businessDate } from '../src/pos/shifts.js';
import { completeSale } from '../src/pos/checkout.js';
const require = createRequire(import.meta.url);
const schema = `qa_management_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^qa_management_[a-f0-9]{32}$/);
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('Requires local PostgreSQL only');
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasourceUrl: url.href });
let server;
try {
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url.href },
    stdio: 'pipe',
    timeout: 60000,
  });
  const ownerPassword = randomUUID(),
    newPassword = randomUUID(),
    token = randomUUID();
  await db.admin.create({
    data: { id: 'owner', username: 'owner', passwordHash: await hashPassword(ownerPassword) },
  });
  await db.adminSession.create({
    data: { tokenHash: digest(token), adminId: 'owner', expiresAt: new Date(Date.now() + 600000) },
  });
  const app = await createApp({
    db,
    config: {
      origin: 'http://localhost:5173',
      posOrigin: 'http://localhost:5173',
      trustProxy: false,
      cookieOptions: { httpOnly: true, path: '/' },
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  async function call(
    path,
    method = 'GET',
    data,
    cookie = `admin_session=${token}`,
    origin = 'http://localhost:5173',
  ) {
    return fetch(base + path, {
      method,
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  const input = {
    firstName: 'สมชาย',
    lastName: 'ทดสอบ',
    phone: '0912345678',
    birthDate: '2000-02-29',
    password: randomUUID(),
    privacyConsent: true,
    marketingConsent: false,
  };
  assert.equal((await call('/members', 'POST', input, '')).status, 401);
  assert.equal((await call('/members', 'POST', input, 'session=ordinary-member')).status, 401);
  assert.equal(
    (await call('/members', 'POST', input, undefined, 'https://other.example')).status,
    403,
  );
  let response = await call('/members', 'POST', input);
  assert.equal(response.status, 200);
  const member = (await response.json()).member;
  assert.equal(member.passwordHash, undefined);
  await db.session.create({
    data: {
      tokenHash: digest('member-session'),
      memberId: member.id,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.member.update({ where: { id: member.id }, data: { loyaltyQrHash: 'obsolete-code' } });
  response = await call(`/members/${member.id}`, 'PUT', {
    firstName: 'สมชาย',
    lastName: 'แก้ไข',
    phone: '0812345678',
    birthDate: '2000-02-29',
    reason: 'แก้ไขเบอร์ตามเจ้าของบัญชี',
  });
  assert.equal(response.status, 200);
  assert.equal(await db.session.count({ where: { memberId: member.id } }), 0);
  assert.equal((await db.member.findUnique({ where: { id: member.id } })).loyaltyQrHash, null);
  const del = (path, name) =>
    call(path, 'DELETE', { confirmName: name, reason: 'ลบข้อมูลทดสอบที่ยังไม่ใช้' });
  assert.equal((await del(`/members/${member.id}`, 'ผิดชื่อ')).status, 400);
  assert.equal((await del(`/members/${member.id}`, 'สมชาย แก้ไข')).status, 200);
  const usedMember = await db.member.create({
    data: { firstName: 'สมาชิก', lastName: 'มีประวัติ', phone: '0891234567' },
  });
  const campaignInput = {
    title: 'สิทธิ์ทดสอบ',
    description: 'รายละเอียดสิทธิ์',
    extraPrice: -20,
    validityDays: 30,
    prerequisiteCampaignId: null,
  };
  response = await call('/campaigns', 'POST', campaignInput);
  assert.equal(response.status, 201);
  const campaign = (await response.json()).campaign;
  assert.equal(
    (await call(`/campaigns/${campaign.id}`, 'PUT', { ...campaignInput, title: 'แก้ไขก่อนแจก' }))
      .status,
    200,
  );
  const coupon = await db.coupon.create({
    data: {
      campaign: campaign.id,
      memberId: usedMember.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  assert.equal((await call(`/campaigns/${campaign.id}`, 'PUT', campaignInput)).status, 409);
  assert.equal((await del(`/campaigns/${campaign.id}`, 'แก้ไขก่อนแจก')).status, 409);
  assert.equal(
    (
      await call(`/members/${usedMember.id}/coupons/${coupon.id}/revoke`, 'POST', {
        reason: 'เจ้าของสิทธิ์ขอยกเลิก',
      })
    ).status,
    200,
  );
  assert.ok((await db.coupon.findUnique({ where: { id: coupon.id } })).expiresAt <= new Date());
  response = await call('/pos/users', 'POST', {
    username: 'cashier',
    displayName: 'พนักงาน',
    password: randomUUID(),
  });
  assert.equal(response.status, 201);
  const staff = await response.json();
  await db.posSession.create({
    data: {
      tokenHash: digest('staff-session'),
      userId: staff.id,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  assert.equal(
    (
      await call(`/pos/users/${staff.id}/password`, 'POST', {
        newPassword,
        adminPassword: ownerPassword,
        reason: 'พนักงานแจ้งลืมรหัสผ่าน',
      })
    ).status,
    200,
  );
  assert.equal(await db.posSession.count({ where: { userId: staff.id } }), 0);
  assert.equal(
    await verifyPassword(
      newPassword,
      (await db.posUser.findUnique({ where: { id: staff.id } })).passwordHash,
    ),
    true,
  );
  assert.equal(
    (
      await call(`/pos/users/${staff.id}`, 'PUT', {
        displayName: 'แก้ชื่อ',
        active: true,
        role: 'ADMIN',
      })
    ).status,
    400,
  );
  const product = await db.posProduct.create({
    data: { name: 'อาหาร', barcode: 'TEST-P', priceSatang: 19900 },
  });
  const unused = await db.posProduct.create({
    data: { name: 'ยังไม่ขาย', barcode: 'UNUSED-P', priceSatang: 1000 },
  });
  assert.equal((await del(`/pos/products/${unused.id}`, unused.name)).status, 200);
  const shift = await openShift(db, { key: randomUUID(), openingCashSatang: 10000 }, staff.id);
  const saleInput = {
    key: randomUUID(),
    shiftId: shift.id,
    memberPhone: usedMember.phone,
    items: [{ productId: product.id, quantity: 1 }],
    method: 'CASH',
    receivedSatang: 20000,
    expectedTotalSatang: 19900,
  };
  await completeSale(db, saleInput, staff.id);
  await completeSale(
    db,
    { ...saleInput, key: randomUUID(), method: 'TRANSFER', receivedSatang: 19900 },
    staff.id,
  );
  // Real PostgreSQL JSON containment must find the product inside the saved item snapshot.
  assert.equal((await del(`/pos/products/${product.id}`, product.name)).status, 409);
  assert.equal((await del(`/pos/users/${staff.id}`, staff.username)).status, 409);
  assert.equal((await del(`/members/${usedMember.id}`, 'สมาชิก มีประวัติ')).status, 409);
  await closeShift(db, { shiftId: shift.id, countedCashSatang: 29900 }, staff.id);
  const query = `?from=${businessDate()}&to=${businessDate()}`;
  response = await call(`/pos/reports${query}`);
  assert.equal(response.status, 200);
  const summary = (await response.json()).summary;
  assert.deepEqual(summary, {
    billCount: 2,
    cashSatang: 19900,
    transferSatang: 19900,
    totalSatang: 39800,
  });
  assert.equal((await (await call(`/pos/sales${query}`)).json()).total, 2);
  assert.equal((await (await call(`/pos/shifts${query}`)).json()).shifts[0]._count.sales, 2);
  assert.equal((await (await call(`/pos/shifts/${shift.id}/report`)).json()).items[0].quantity, 2);
  assert.equal((await call('/pos/reports?from=2026-01-01&to=2026-12-31')).status, 400);
  const audits = JSON.stringify(await db.auditLog.findMany());
  assert.ok(
    !audits.includes(ownerPassword) &&
      !audits.includes(newPassword) &&
      !audits.includes(input.password),
  );
  console.log(
    'PASS: real PostgreSQL admin/member/staff/product/campaign CRUD, auth/origin, password/session invalidation, coupon revocation, protected history, JSON product references, sales/shift reports and audit secrecy. Store data untouched.',
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
}
