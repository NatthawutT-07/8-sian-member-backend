import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { digest } from '../../shared/security.js';
const options = { windowMs: 15 * 60 * 1000, standardHeaders: 'draft-8', legacyHeaders: false };
const message = { message: 'ทำรายการบ่อยเกินไป กรุณารอตามเวลาที่แจ้งแล้วลองใหม่' };
export function createAuthLimits() {
  return {
    register: rateLimit({ ...options, limit: 5, identifier: 'register-ip', message }),
    loginIp: rateLimit({ ...options, limit: 30, identifier: 'login-ip', message }),
    loginAccount: rateLimit({
      ...options,
      limit: 5,
      identifier: 'login-account-ip',
      skipSuccessfulRequests: true,
      message,
      keyGenerator: (req) =>
        `${ipKeyGenerator(req.ip || '127.0.0.1')}:${digest(typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 40) : 'invalid')}`,
    }),
  };
}
