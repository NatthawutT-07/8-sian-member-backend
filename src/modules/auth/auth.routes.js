import { createMemberSessionManager } from './member-session.service.js';
import { registration, login } from './auth.validation.js';
import { hashPassword, verifyPassword, digest, sessionToken } from '../../shared/security.js';
import { createAuthLimits } from './auth.limits.js';
import { publicMember } from '../members/member.presenter.js';
export async function mountAuth(app, db, config) {
  const { cookieName, cookieOptions } = config;
  const { readToken, requireMember: auth, createSession } = createMemberSessionManager(db, config);
  const authLimits = createAuthLimits();
  app.post('/api/auth/register', authLimits.register, async (req, res) => {
    const parsed = registration.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        message: 'กรุณาตรวจสอบข้อมูล รหัสผ่านอย่างน้อย 6 ตัว และการยอมรับนโยบาย',
      });
    const { password, birthDate, privacyConsent, ...data } = parsed.data;
    if (
      await db.member.findUnique({
        where: {
          phone: data.phone,
        },
      })
    )
      return res.status(409).json({
        message: 'เบอร์นี้สมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบ หรือติดต่อร้านหากเข้าไม่ได้',
      });
    const passwordHash = await hashPassword(password);
    const member = await db.member.create({
      data: {
        ...data,
        passwordHash,
        birthDate: new Date(`${birthDate}T00:00:00.000Z`),
      },
    });
    await createSession(res, member);
    res.status(201).json({
      member: publicMember(member),
    });
  });
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
