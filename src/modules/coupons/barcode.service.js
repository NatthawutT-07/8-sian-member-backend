import { randomBytes } from 'node:crypto';
import { digest } from '../../shared/security.js';
export const BARCODE_TTL_MS = 10 * 60 * 1000;
export function createBarcode(expiresAt, now = new Date()) {
  // A short, numeric CODE128-C payload stays readable on phone displays (96 random bits).
  const digits = BigInt(`0x${randomBytes(12).toString('hex')}`)
    .toString()
    .padStart(30, '0');
  const code = `88${digits}`;
  return {
    code,
    hash: digest(code),
    expiresAt: new Date(Math.min(now.getTime() + BARCODE_TTL_MS, expiresAt.getTime())),
  };
}
