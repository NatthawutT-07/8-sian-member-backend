import { digest, sessionToken } from '../../shared/security.js';
export function createMemberSessionManager(db, { cookieName, cookieOptions }) {
  function readToken(req) {
    return req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
  }
  async function auth(req, res, next) {
    const token = readToken(req);
    if (!token) return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบ' });
    const session = await db.session.findUnique({
      where: { tokenHash: digest(token) },
      include: { member: true },
    });
    if (!session || session.expiresAt <= new Date())
      return res.status(401).json({ message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' });
    req.member = session.member;
    next();
  }
  async function createSession(res, member) {
    const token = sessionToken(),
      expiresAt = new Date(Date.now() + 7 * 86400000);
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.session.create({ data: { tokenHash: digest(token), memberId: member.id, expiresAt } });
    res.cookie(cookieName, token, { ...cookieOptions, expires: expiresAt });
  }
  return { readToken, requireMember: auth, createSession };
}
