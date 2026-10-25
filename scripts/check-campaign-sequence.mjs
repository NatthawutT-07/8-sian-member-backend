// Uses only an isolated disposable schema. Never changes application member data.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config/env.js';
import { hashPassword } from '../src/shared/security.js';

const schema = `qa_sequence_${randomBytes(8).toString('hex')}`;
assert.match(schema, /^qa_sequence_[a-f0-9]{16}$/);
const testUrl = new URL(process.env.DATABASE_URL);
testUrl.searchParams.set('schema', schema);
const bootstrap = new PrismaClient();
const db = new PrismaClient({ datasourceUrl: testUrl.href });
const require = createRequire(import.meta.url);
const origin = 'http://localhost:5173';
let server,
  created = false;
try {
  await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  await promisify(execFile)(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: testUrl.href },
      timeout: 60000,
    },
  );
  const app = await createApp({ db, config: readConfig({ FRONTEND_ORIGIN: origin }) });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const call = (path, cookie, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
  const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
  const password = randomUUID();
  await db.admin.create({
    data: { username: 'admin', passwordHash: await hashPassword(password) },
  });
  const login = await call('/api/admin/login', null, { username: 'admin', password });
  assert.equal(login.status, 200);
  const admin = cookieOf(login);
  const cookies = [],
    members = [];
  for (const phone of ['0812345678', '0899999999']) {
    const response = await call('/api/auth/register', null, {
      firstName: 'Sequence',
      lastName: 'Test',
      phone,
      birthDate: '2000-02-29',
      password: randomUUID(),
      privacyConsent: true,
    });
    assert.equal(response.status, 201);
    cookies.push(cookieOf(response));
    members.push(await db.member.findUnique({ where: { phone } }));
  }
  const firstId = 'seafood79_welcome_v1';
  const makeCampaign = async (title, parent) => {
    const response = await call('/api/admin/campaigns', admin, {
      title,
      description: title,
      extraPrice: 0,
      validityDays: 30,
      prerequisiteCampaignId: parent,
    });
    assert.equal(response.status, 201);
    return (await response.json()).campaign;
  };
  assert.equal(
    (
      await call('/api/admin/campaigns', admin, {
        title: 'Invalid parent',
        description: 'No such campaign',
        extraPrice: 0,
        validityDays: 30,
        prerequisiteCampaignId: 'missing',
      })
    ).status,
    400,
  );
  const second = await makeCampaign('Second visit', firstId);
  const third = await makeCampaign('Third visit', second.id);
  const campaignsFor = async () =>
    (await (await call('/api/campaigns', cookies[0])).json()).campaigns;
  assert.equal((await campaignsFor()).find((c) => c.id === second.id).locked, true);
  assert.equal(
    (await call(`/api/campaigns/${second.id}/claim`, cookies[0], { memberId: members[1].id }))
      .status,
    403,
  );
  assert.equal(
    (await call(`/api/admin/members/${members[0].id}/coupons`, admin, { campaignId: second.id }))
      .status,
    403,
  );
  assert.equal((await call(`/api/campaigns/${firstId}/claim`, cookies[0], {})).status, 201);
  const firstCoupon = await db.coupon.findUnique({
    where: { memberId_campaign: { memberId: members[0].id, campaign: firstId } },
  });
  assert.equal((await call(`/api/coupons/${firstCoupon.id}/barcode`, cookies[0], {})).status, 200);
  assert.equal(
    (await campaignsFor()).find((c) => c.id === second.id).locked,
    true,
    'Opening barcode is not use confirmation',
  );
  // Simulate an unused coupon that was granted before this feature existed.
  const legacy = await db.coupon.create({
    data: {
      memberId: members[0].id,
      campaign: second.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const lockedDetail = await (await call(`/api/admin/members/${members[0].id}`, admin)).json();
  assert.equal(lockedDetail.coupons.find((c) => c.id === legacy.id).status, 'LOCKED');
  assert.equal(lockedDetail.usedCampaignIds.includes(firstId), false);
  assert.equal((await call(`/api/coupons/${legacy.id}/barcode`, cookies[0], {})).status, 403);
  assert.equal(
    (await (await call('/api/coupons', cookies[0])).json()).coupons.find((c) => c.id === legacy.id)
      .locked,
    true,
  );
  await db.coupon.create({
    data: {
      memberId: members[1].id,
      campaign: firstId,
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  assert.equal(
    (await campaignsFor()).find((c) => c.id === second.id).locked,
    true,
    'Another member cannot unlock a coupon',
  );
  assert.equal((await call(`/api/coupons/${firstCoupon.id}/redeem`, cookies[0], {})).status, 410);
  assert.equal((await campaignsFor()).find((c) => c.id === second.id).locked, true);
  // Represents a trusted payment confirmation; tests never expose a customer redemption endpoint.
  await db.coupon.update({
    where: { id: firstCoupon.id },
    data: { usedAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) },
  });
  assert.equal((await campaignsFor()).find((c) => c.id === second.id).locked, false);
  assert.equal((await call(`/api/coupons/${legacy.id}/barcode`, cookies[0], {})).status, 200);
  assert.equal(
    (await call(`/api/campaigns/${third.id}/claim`, cookies[0], {})).status,
    403,
    'Second barcode alone must not unlock third',
  );
  await db.coupon.update({ where: { id: legacy.id }, data: { usedAt: new Date() } });
  assert.equal((await call(`/api/campaigns/${third.id}/claim`, cookies[0], {})).status, 201);
  assert.equal((await call(`/api/campaigns/${third.id}/claim`, cookies[0], {})).status, 409);
  assert.equal(
    (await call(`/api/admin/members/${members[1].id}/coupons`, admin, { campaignId: second.id }))
      .status,
    201,
  );
  await assert.rejects(
    db.campaign.update({ where: { id: third.id }, data: { prerequisiteCampaignId: third.id } }),
  );
  assert.equal(
    (await db.coupon.findUnique({ where: { id: legacy.id } })).usedAt instanceof Date,
    true,
  );
  console.log(
    'PASS: three-step sequence, claim/grant/barcode enforcement, legacy coupons, member isolation, immutable usage, duplicate claims and self-dependency constraint',
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.$disconnect();
  if (created) {
    assert.match(schema, /^qa_sequence_[a-f0-9]{16}$/);
    await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  }
  await bootstrap.$disconnect();
}
