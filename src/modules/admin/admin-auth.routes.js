import rateLimit from 'express-rate-limit';
import { adminLogin } from './admin.validation.js';
import { hashPassword, verifyPassword, digest, sessionToken } from '../../shared/security.js';
import { parseBody as parse } from '../../shared/http-validation.js';
export async function mountAdminAuth(app, db, { production, cookieOptions }) {
  const name = production ? '__Host-admin_session' : 'admin_session';
  const tokenFrom = (req) =>
    req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1);
  const dummyHash = await hashPassword(sessionToken());
  const loginLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'ลองเข้าสู่ระบบแอดมินบ่อยเกินไป กรุณารอ 15 นาที' },
  });
  app.use('/api/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.post('/api/admin/login', loginLimit, async (req, res) => {
    const data = parse(adminLogin, req.body, res);
    if (!data) return;
    const admin = await db.admin.findUnique({ where: { id: 'owner' } });
    const matches = await verifyPassword(data.password, admin?.passwordHash || dummyHash);
    if (!admin || admin.role !== 'ADMIN' || admin.username !== data.username || !matches)
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านแอดมินไม่ถูกต้อง' });
    const token = sessionToken(),
      expiresAt = new Date(Date.now() + 8 * 3600000);
    await db.$transaction(async (tx) => {
      await tx.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await tx.adminSession.create({
        data: { tokenHash: digest(token), adminId: admin.id, expiresAt },
      });
      await tx.auditLog.create({ data: { actor: admin.id, action: 'ADMIN_LOGIN', details: {} } });
    });
    res.cookie(name, token, { ...cookieOptions, expires: expiresAt });
    res.json({ admin: { username: admin.username, role: admin.role } });
  });
  async function requireAdmin(req, res, next) {
    const token = tokenFrom(req);
    if (!token) return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบแอดมิน' });
    const session = await db.adminSession.findUnique({
      where: { tokenHash: digest(token) },
      include: { admin: true },
    });
    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.admin.id !== 'owner' ||
      session.admin.role !== 'ADMIN'
    )
      return res.status(401).json({ message: 'เซสชันแอดมินหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
    req.admin = session.admin;
    next();
  }
  app.use('/api/admin', requireAdmin);
  app.get('/api/admin/me', (req, res) =>
    res.json({ admin: { username: req.admin.username, role: req.admin.role } }),
  );
  app.post('/api/admin/logout', async (req, res) => {
    await db.adminSession.deleteMany({ where: { tokenHash: digest(tokenFrom(req)) } });
    res.clearCookie(name, cookieOptions);
    res.json({ message: 'ออกจากระบบแล้ว' });
  });
}
