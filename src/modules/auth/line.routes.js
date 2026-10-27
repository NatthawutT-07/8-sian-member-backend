import { z } from 'zod';
import { digest, sessionToken, hashPassword, verifyPassword } from '../../shared/security.js';
import { login } from './auth.validation.js';
import { createAuthLimits } from './auth.limits.js';
import { createMemberSessionManager } from './member-session.service.js';
import { authorizationUrl, verifyLineIdentity } from './line-client.js';
import { publicMember } from '../members/member.presenter.js';

const linkInput = login.extend({ privacyConsent: z.literal(true) });
const ttl = 10 * 60 * 1000;
const expired = () => Object.assign(new Error('LINE_FLOW_EXPIRED'), { status: 401 });

export async function mountLineAuth(app, db, config, verifyIdentity = verifyLineIdentity) {
  const limits = createAuthLimits();
  const sessions = createMemberSessionManager(db, config);
  const cookieName = config.production ? '__Host-line_flow' : 'line_flow';
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
  const dummyHash = await hashPassword(sessionToken());
  const tokenHash = (req) => {
    const token = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return token && /^[0-9a-f]{64}$/.test(token) ? digest(token) : null;
  };
  const readFlow = async (req) => {
    const hash = tokenHash(req);
    if (!hash) return null;
    const flow = await db.lineAuthFlow.findUnique({ where: { tokenHash: hash } });
    return flow && flow.expiresAt > new Date() ? flow : null;
  };
  async function saveFlow(req, res, data) {
    const old = tokenHash(req);
    if (old) await db.lineAuthFlow.deleteMany({ where: { tokenHash: old } });
    await db.lineAuthFlow.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const token = sessionToken();
    await db.lineAuthFlow.create({
      data: { tokenHash: digest(token), ...data, expiresAt: new Date(Date.now() + ttl) },
    });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: ttl });
  }
  app.use('/api/auth/line', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  app.get('/api/auth/line/status', (req, res) => res.json({ enabled: Boolean(config.line) }));
  const enabled = (req, res, next) =>
    config.line
      ? next()
      : res
          .status(503)
          .json({ message: 'การเข้าสู่ระบบด้วย LINE ยังไม่พร้อม กรุณาใช้บัญชีเดิมหรือติดต่อร้าน' });
  app.get('/api/auth/line', enabled, limits.loginIp, async (req, res) => {
    const state = sessionToken(),
      nonce = sessionToken(),
      verifier = sessionToken();
    await saveFlow(req, res, {
      stateHash: digest(state),
      nonce,
      verifier,
      linkExisting: req.query.intent === 'link',
    });
    res.redirect(authorizationUrl(config.line, { state, nonce, verifier }));
  });
  app.get('/api/auth/line/callback', enabled, async (req, res) => {
    const fail = (reason) => res.redirect(`${config.origin}/login?line_error=${reason}`);
    try {
      const flow = await readFlow(req);
      if (
        !flow?.stateHash ||
        typeof req.query.state !== 'string' ||
        req.query.state.length > 128 ||
        digest(req.query.state) !== flow.stateHash
      )
        return fail('expired');
      // Atomic consumption prevents duplicate callbacks across multiple API instances.
      const consumed = await db.lineAuthFlow.deleteMany({
        where: {
          tokenHash: flow.tokenHash,
          stateHash: flow.stateHash,
          expiresAt: { gt: new Date() },
        },
      });
      if (consumed.count !== 1) return fail('expired');
      res.clearCookie(cookieName, cookieOptions);
      if (req.query.error) return fail('cancelled');
      if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 2048)
        return fail('failed');
      const { lineUserId, displayName } = await verifyIdentity(config.line, {
        code: req.query.code,
        nonce: flow.nonce,
        verifier: flow.verifier,
      });
      if (flow.linkExisting) {
        const existing = await db.member.findUnique({ where: { lineUserId } });
        if (!existing) {
          await saveFlow(req, res, { lineUserId, displayName, linkExisting: true });
          return res.redirect(`${config.origin}/line/complete`);
        }
      }
      // Unique LINE identity is the account key; names are display-only and can change.
      const data = {
        lineUserId,
        firstName: displayName,
        lastName: '',
        lineDisplayName: displayName,
        privacyVersion: '2026-10-27',
      };
      let member;
      try {
        member = await db.member.upsert({
          where: { lineUserId },
          create: data,
          update: { lineDisplayName: displayName },
        });
      } catch (error) {
        if (error.code !== 'P2002') throw error;
        member = await db.member.findUnique({ where: { lineUserId } });
        if (!member) throw error;
      }
      await sessions.createSession(res, member);
      return res.redirect(`${config.origin}/coupons`);
    } catch {
      // Never expose authorization codes, tokens, secrets or LINE error bodies.
      return fail('failed');
    }
  });
  app.get('/api/auth/line/pending', enabled, async (req, res) => {
    const flow = await readFlow(req);
    if (!flow?.lineUserId || !flow.linkExisting)
      return res
        .status(401)
        .json({ message: 'หมดเวลาทำรายการ กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง' });
    res.json({ ready: true });
  });
  async function finish(req, res, link) {
    const parsed = linkInput.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: 'กรุณากรอกข้อมูลให้ครบและยอมรับนโยบายความเป็นส่วนตัว' });
    const flow = await readFlow(req);
    if (!flow?.lineUserId || !flow.linkExisting)
      return res
        .status(401)
        .json({ message: 'หมดเวลาทำรายการ กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง' });
    let existing;
    if (link) {
      existing = await db.member.findUnique({ where: { phone: parsed.data.phone } });
      const valid = await verifyPassword(parsed.data.password, existing?.passwordHash || dummyHash);
      if (!existing?.passwordHash || !valid)
        return res.status(401).json({ message: 'เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง' });
      if (existing.lineUserId && existing.lineUserId !== flow.lineUserId)
        return res
          .status(409)
          .json({ message: 'บัญชีสมาชิกนี้ผูกกับ LINE อื่นแล้ว กรุณาติดต่อร้าน' });
    }
    try {
      const member = await db.$transaction(async (tx) => {
        const consumed = await tx.lineAuthFlow.deleteMany({
          where: {
            tokenHash: flow.tokenHash,
            lineUserId: flow.lineUserId,
            expiresAt: { gt: new Date() },
          },
        });
        if (consumed.count !== 1) throw expired();
        if (link) {
          // Guard against concurrent password resets or another LINE linking this member.
          const updated = await tx.member.updateMany({
            where: {
              id: existing.id,
              passwordHash: existing.passwordHash,
              OR: [{ lineUserId: null }, { lineUserId: flow.lineUserId }],
            },
            data: {
              lineUserId: flow.lineUserId,
              lineDisplayName: flow.displayName,
              privacyVersion: '2026-10-27',
              consentedAt: new Date(),
            },
          });
          if (updated.count !== 1) throw expired();
          await tx.auditLog.create({
            data: {
              actor: existing.id,
              action: 'LINK_LINE',
              memberId: existing.id,
              details: { method: 'password' },
            },
          });
          return tx.member.findUnique({ where: { id: existing.id } });
        }
        throw expired();
      });
      await sessions.createSession(res, member);
      res.clearCookie(cookieName, cookieOptions);
      res.json({ member: publicMember(member) });
    } catch (error) {
      if (error.status === 401)
        return res
          .status(401)
          .json({ message: 'ข้อมูลบัญชีเปลี่ยนหรือหมดเวลาทำรายการ กรุณาเริ่มใหม่' });
      if (error.code === 'P2002')
        return res
          .status(409)
          .json({ message: 'LINE นี้มีบัญชีสมาชิกแล้ว กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง' });
      throw error;
    }
  }
  app.post('/api/auth/line/register', (req, res) =>
    res.status(410).json({ message: 'ไม่ต้องสมัครสมาชิก กรุณาเข้าสู่ระบบด้วย LINE' }),
  );
  app.post('/api/auth/line/link', enabled, limits.loginIp, limits.loginAccount, (req, res) =>
    finish(req, res, true),
  );
}
