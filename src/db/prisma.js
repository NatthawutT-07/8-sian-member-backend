import { PrismaClient } from '@prisma/client';
// Bound each API process to a modest pool; 100 visitors do not need 100 open
// database connections. Explicit settings in DATABASE_URL always take priority.
const options = {};
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  if (['postgres:', 'postgresql:'].includes(url.protocol)) {
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '10');
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '10');
    options.datasources = { db: { url: url.href } };
  }
}
export const db = new PrismaClient(options);
