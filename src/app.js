import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { originGuard } from './middleware/origin-guard.js';
import { errorHandler } from './middleware/error-handler.js';
import { mountAuth } from './modules/auth/auth.routes.js';
import { mountLineAuth } from './modules/auth/line.routes.js';
import { mountMembers } from './modules/members/member.routes.js';
import { mountMemberLoyalty } from './modules/members/loyalty.routes.js';
import { mountCoupons } from './modules/coupons/coupons.routes.js';
import { mountAdmin } from './modules/admin/admin.routes.js';
import { mountPos } from './pos/routes.js';

export async function createApp({ db, config }) {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet(),
    cors({
      origin: [config.origin, config.posOrigin].filter(Boolean),
      credentials: true,
      exposedHeaders: ['Retry-After'],
    }),
    express.json({ limit: '8kb' }),
  );
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  // Account responses must never be reused for another visitor by a browser or CDN.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.vary('Cookie');
    next();
  });
  app.use('/api', originGuard([config.origin, config.posOrigin].filter(Boolean)));
  app.get('/api/health', async (req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  const { requireMember } = await mountAuth(app, db, config);
  await mountLineAuth(app, db, config);
  mountMembers(app, requireMember);
  mountMemberLoyalty(app, db, requireMember);
  mountCoupons(app, db, requireMember);
  await mountAdmin(app, db, config);
  await mountPos(app, db, config);
  app.use(errorHandler);
  return app;
}
