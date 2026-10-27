import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { originGuard } from './middleware/origin-guard.js';
import { errorHandler } from './middleware/error-handler.js';
import { mountAuth } from './modules/auth/auth.routes.js';
import { mountLineAuth } from './modules/auth/line.routes.js';
import { mountMembers } from './modules/members/member.routes.js';
import { mountCoupons } from './modules/coupons/coupons.routes.js';
import { mountAdmin } from './modules/admin/admin.routes.js';

export async function createApp({ db, config }) {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet(),
    cors({ origin: config.origin, credentials: true, exposedHeaders: ['Retry-After'] }),
    express.json({ limit: '8kb' }),
  );
  app.use(
    '/api',
    rateLimit({ windowMs: 60000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  app.use('/api', originGuard(config.origin));
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
  mountCoupons(app, db, requireMember);
  await mountAdmin(app, db, config);
  app.use(errorHandler);
  return app;
}
