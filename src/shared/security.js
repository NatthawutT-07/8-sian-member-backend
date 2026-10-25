import { randomBytes, scrypt as deriveKey, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(deriveKey);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [type, salt, hex] = stored.split(':');
  if (type !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const digest = (token) => createHash('sha256').update(token).digest('hex');
export const sessionToken = () => randomBytes(32).toString('hex');
