import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBarcode, BARCODE_TTL_MS } from '../../src/modules/coupons/barcode.service.js';
import { digest } from '../../src/shared/security.js';
test('barcode is random numeric CODE128-C payload, with only its digest stored', () => {
  const now = new Date('2026-10-25T00:00:00Z'),
    expiry = new Date(now.getTime() + 86400000);
  const a = createBarcode(expiry, now),
    b = createBarcode(expiry, now);
  assert.match(a.code, /^88\d{30}$/);
  assert.notEqual(a.code, b.code);
  assert.equal(a.hash, digest(a.code));
  assert.notEqual(a.hash, a.code);
  assert.equal(a.expiresAt.getTime() - now.getTime(), BARCODE_TTL_MS);
});
test('barcode cannot outlive its coupon', () => {
  const now = new Date(),
    expiry = new Date(now.getTime() + 1000);
  assert.equal(createBarcode(expiry, now).expiresAt.getTime(), expiry.getTime());
});
