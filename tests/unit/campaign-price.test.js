import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountAdminCampaigns } from '../../src/modules/admin/admin-campaigns.routes.js';

test('admin API stores discounts and surcharges with their original signs', async () => {
  const campaigns = [],
    audits = [];
  const db = {
    campaign: {
      create: async ({ data }) => {
        const row = { id: String(campaigns.length + 1), ...data };
        campaigns.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audits.push(data);
        return data;
      },
    },
  };
  db.$transaction = (fn) => fn(db);
  const app = express();
  app.use(express.json(), (req, res, next) => {
    req.admin = { id: 'test-admin' };
    next();
  });
  mountAdminCampaigns(app, db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const send = (extraPrice) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/admin/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'ส่วนลดหรือค่าเพิ่ม',
        description: 'จำนวนบาท',
        extraPrice,
        validityDays: 30,
      }),
    });
  try {
    for (const amount of [-100000, -20, 0, 79, 100000]) {
      const response = await send(amount);
      assert.equal(response.status, 201);
      assert.equal((await response.json()).campaign.extraPrice, amount);
    }
    for (const amount of [-100001, 100001, -0.5, 1.5])
      assert.equal((await send(amount)).status, 400);
    assert.deepEqual(
      campaigns.map((c) => c.extraPrice),
      [-100000, -20, 0, 79, 100000],
    );
    assert.equal(audits.length, 5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
