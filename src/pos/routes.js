import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { hashPassword, verifyPassword, sessionToken, digest } from '../shared/security.js';
import { parseBody } from '../shared/http-validation.js';
import { checkoutInput, completeSale, requestHash } from './checkout.js';
import { withCashierNames } from './sale-receipts.js';
import { mountHardware } from './hardware.js';
import { mountShiftReports } from './shift-reports.js';
import { phone } from '../modules/auth/auth.validation.js';
import { couponReserveInput, couponReleaseInput } from './validation.js';
import { reserveCoupon } from './coupon-discounts.js';
import {
  openInput,
  closeInput,
  openShift,
  closeShift,
  salesSummary,
  dayRange,
  businessDate,
} from './shifts.js';

const loginInput = z
  .object({ username: z.string().trim().min(3).max(80), password: z.string().min(1).max(128) })
  .strict();

export async function mountPos(app, db, config) {
  const router = express.Router();
  const cookieName = config.production ? '__Host-pos_session' : 'pos_session';
  const cookie = { ...config.cookieOptions, sameSite: 'strict' };
  const token = (req) =>
    req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
  const dummy = await hashPassword(sessionToken());
  router.post(
    '/login',
    rateLimit({ windowMs: 900000, limit: 5, skipSuccessfulRequests: true }),
    async (req, res) => {
      const data = parseBody(loginInput, req.body, res);
      if (!data) return;
      const user = await db.posUser.findUnique({ where: { username: data.username } });
      const valid = await verifyPassword(data.password, user?.passwordHash || dummy);
      if (!valid || !user?.active || user?.role !== 'USER')
        return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      const value = sessionToken(),
        expiresAt = new Date(Date.now() + 8 * 3600000);
      await db.posSession.create({
        data: { tokenHash: digest(value), userId: user.id, expiresAt },
      });
      res.cookie(cookieName, value, { ...cookie, expires: expiresAt }).json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      });
    },
  );
  router.use(async (req, res, next) => {
    const value = token(req);
    const session =
      value &&
      (await db.posSession.findUnique({
        where: { tokenHash: digest(value) },
        include: { user: true },
      }));
    if (
      !session ||
      session.expiresAt <= new Date() ||
      !session.user.active ||
      session.user.role !== 'USER'
    )
      return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบ POS' });
    req.posActor = session.user.id;
    req.posUsername = session.user.username;
    req.posDisplayName = session.user.displayName;
    next();
  });
  router.get('/me', (req, res) =>
    res.json({
      id: req.posActor,
      username: req.posUsername,
      displayName: req.posDisplayName,
      role: 'USER',
    }),
  );
  mountHardware(router, db);
  mountShiftReports(router, db);
  router.post('/logout', async (req, res) => {
    await db.posSession.deleteMany({ where: { tokenHash: digest(token(req)) } });
    res.clearCookie(cookieName, cookie).json({ ok: true });
  });
  router.get('/products', async (req, res) =>
    res.json(await db.posProduct.findMany({ orderBy: { name: 'asc' }, take: 2000 })),
  );
  router.all('/products', (req, res) =>
    res.status(403).json({ message: 'พนักงานไม่มีสิทธิ์แก้สินค้า กรุณาติดต่อแอดมินผ่านเว็บ' }),
  );
  router.all('/products/:id', (req, res) =>
    res.status(403).json({ message: 'พนักงานไม่มีสิทธิ์แก้สินค้า' }),
  );
  const handleShift = (schema, operation) => async (req, res, next) => {
    const data = parseBody(schema, req.body, res);
    if (!data) return;
    try {
      res.json(await operation(db, data, req.posActor));
    } catch (error) {
      if (['P2002', 'P2034'].includes(error.code))
        return res.status(409).json({ message: 'มีรายการพร้อมกัน กรุณาโหลดสถานะร้านแล้วลองใหม่' });
      if (!error.code && error.constructor === Error)
        return res.status(400).json({ message: error.message });
      next(error);
    }
  };
  router.get('/shift', async (req, res) => {
    const shift = await db.posShift.findUnique({ where: { activeSlot: 'STORE' } });
    res.json({ shift, summary: shift ? await salesSummary(db, { shiftId: shift.id }) : null });
  });
  router.post('/shift/open', handleShift(openInput, openShift));
  router.post('/shift/close', handleShift(closeInput, closeShift));
  router.post('/coupons/reserve', async (req, res, next) => {
    const data = parseBody(couponReserveInput, req.body, res);
    if (!data) return;
    try {
      res.json(await reserveCoupon(db, data, req.posActor));
    } catch (error) {
      if (['P2002', 'P2034'].includes(error.code))
        return res.status(409).json({ message: 'คูปองกำลังถูกตรวจสอบ กรุณาลองอีกครั้ง' });
      if (error.code === 'POS_COUPON_CONFLICT')
        return res.status(409).json({ message: error.message });
      if (!error.code && error.constructor === Error)
        return res.status(400).json({ message: error.message });
      if (error.code === 'CAMPAIGN_LOCKED') return res.status(400).json({ message: error.message });
      next(error);
    }
  });
  router.post('/coupons/release', async (req, res) => {
    const data = parseBody(couponReleaseInput, req.body, res);
    if (!data) return;
    await db.posCouponReservation.deleteMany({
      where: { id: data.reservationId, billKey: data.billKey, actor: req.posActor },
    });
    res.json({ ok: true });
  });
  router.get('/reports/daily', async (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : businessDate();
    let range;
    try {
      range = dayRange(date);
    } catch {
      return res.status(400).json({ message: 'วันที่ไม่ถูกต้อง' });
    }
    res.json({
      date,
      timezone: 'Asia/Bangkok',
      summary: await salesSummary(db, { createdAt: range }),
      shifts: await db.posShift.findMany({
        where: { businessDate: date },
        orderBy: { openedAt: 'asc' },
      }),
    });
  });
  router.post('/scan', async (req, res) => {
    const input = parseBody(
      z.object({ code: z.string().trim().min(1).max(200) }).strict(),
      req.body,
      res,
    );
    if (!input) return;
    if (/^8SM-[a-f0-9]{64}$/.test(input.code)) {
      const member = await db.member.findFirst({
        where: { loyaltyQrHash: digest(input.code), loyaltyQrExpiresAt: { gt: new Date() } },
        select: { firstName: true, memberNumber: true, phone: true },
      });
      return member
        ? res.json({ type: 'MEMBER', member, selection: { memberCode: input.code } })
        : res.status(400).json({ message: 'QR สมาชิกหมดอายุ' });
    }
    if (/^88\d{30}$/.test(input.code))
      return res.status(400).json({ message: 'กรุณาสแกนหรือกรอกรหัสนี้ในช่องคูปองด้านล่าง' });
    const product = await db.posProduct.findUnique({ where: { barcode: input.code } });
    if (product?.active) return res.json({ type: 'PRODUCT', product });
    const normalizedPhone = input.code.replace(/[\s-]/g, '');
    if (phone.safeParse(normalizedPhone).success) {
      const member = await db.member.findUnique({
        where: { phone: normalizedPhone },
        select: { firstName: true, memberNumber: true, phone: true },
      });
      return member
        ? res.json({ type: 'MEMBER', member, selection: { memberPhone: normalizedPhone } })
        : res
            .status(404)
            .json({ message: 'ไม่พบสมาชิกจากเบอร์นี้ กรุณาตรวจเบอร์ที่ลูกค้าลงทะเบียนไว้' });
    }
    if (input.code.startsWith('8SM-'))
      return res
        .status(400)
        .json({ message: 'รูปแบบ QR สมาชิกไม่ถูกต้อง กรุณาให้ลูกค้าเปิด QR สะสมครั้งใหม่' });
    return res
      .status(404)
      .json({ message: 'ไม่พบสินค้า หรือกรุณากรอกเบอร์สมาชิก 10 หลัก / สแกน QR สะสมครั้ง' });
  });
  router.get('/sales', async (req, res) => {
    const sales = await db.posSale.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(await withCashierNames(db, sales));
  });
  router.post('/checkout', async (req, res, next) => {
    const data = parseBody(checkoutInput, req.body, res);
    if (!data) return;
    try {
      const sale = await completeSale(db, data, req.posActor);
      res.json((await withCashierNames(db, [sale]))[0]);
    } catch (error) {
      if (error.code === 'POS_COUPON_CONFLICT') {
        const saved = await db.posSale.findUnique({ where: { key: data.key } });
        if (saved && saved.actor === req.posActor && saved.requestHash === requestHash(data))
          return res.json((await withCashierNames(db, [saved]))[0]);
        return res.status(400).json({ message: error.message });
      }
      if (error.code === 'CAMPAIGN_LOCKED') return res.status(400).json({ message: error.message });
      if (error.code === 'POS_KEY_MISMATCH')
        return res.status(409).json({ message: error.message });
      if (['P2002', 'P2034'].includes(error.code))
        return res
          .status(409)
          .json({ message: 'รายการกำลังประมวลผล กรุณาลองยืนยันบิลเดิมอีกครั้ง' });
      if (!error.code && error.constructor === Error)
        return res.status(400).json({ message: error.message });
      next(error);
    }
  });
  app.use('/api/pos', router);
}
