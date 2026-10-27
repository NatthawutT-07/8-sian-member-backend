import { createMemberSessionManager } from './member-session.service.js';
import { login } from './auth.validation.js';
import { hashPassword, verifyPassword, digest, sessionToken } from '../../shared/security.js';
import { createAuthLimits } from './auth.limits.js';
import { publicMember } from '../members/member.presenter.js';
export async function mountAuth(app, db, config) {
  const { cookieName, cookieOptions } = config;
  const { readToken, requireMember: auth, createSession } = createMemberSessionManager(db, config);
  const authLimits = createAuthLimits();
  app.post('/api/auth/register', (req, res) =>
    res.status(410).json({ message: 'กรุณาเข้าสู่ระบบด้วย LINE เพื่อเริ่มใช้งานสมาชิก' }),
  );
  const dummyPasswordHash = await hashPassword(sessionToken());
  app.post('/api/auth/login', authLimits.loginIp, authLimits.loginAccount, async (req, res) => {
    const parsed = login.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        message: 'กรุณากรอกเบอร์โทรและรหัสผ่านให้ถูกต้อง',
      });
    const member = await db.member.findUnique({
      where: {
        phone: parsed.data.phone,
      },
    });
    const valid = await verifyPassword(
      parsed.data.password,
      member?.passwordHash || dummyPasswordHash,
    );
    if (!member?.passwordHash || !valid)
      return res.status(401).json({
        message: 'เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง',
      });
    await createSession(res, member);
    res.json({
      member: publicMember(member),
    });
  });
  app.post('/api/auth/logout', async (req, res) => {
    const token = readToken(req);
    if (token)
      await db.session.deleteMany({
        where: {
          tokenHash: digest(token),
        },
      });
    res.clearCookie(cookieName, cookieOptions);
    res.json({
      message: 'ออกจากระบบแล้ว',
    });
  });
  return {
    requireMember: auth,
  };
}
