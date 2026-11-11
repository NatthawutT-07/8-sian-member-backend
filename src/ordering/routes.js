import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireActiveQr, qrHoursInput, presentTableQr } from './qr-session.js';
import { parseBody } from '../shared/http-validation.js';
import { orderInput, orderingError, submitOrder, closeTable, activateTable } from './service.js';
import { menuFields, presentMenuItem, mountMenuImages, mountAdminMenuImages } from './images.js';
import { menuOrderBy, itemOrderInput, saveItemOrder } from './item-order.js';
import {
  orderingCatalog,
  tableMenu,
  tableMenuVersion,
  invalidateOrderingMenu,
} from './menu-cache.js';
import { getCategories, saveCategoryOrder, categoryOrderInput } from './categories.js';

const uuid = z.string().uuid();
const menuInput = z
  .object({
    zone: z.string().trim().min(1).max(80),
    category: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    active: z.boolean().default(true),
  })
  .strict();
export const orderingHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.orderingStatus) {
      if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
      return res.status(error.orderingStatus).json({ message: error.message });
    }
    if (['P2002', 'P2034'].includes(error.code))
      return res
        .status(409)
        .json({ message: 'ข้อมูลซ้ำหรือมีรายการพร้อมกัน กรุณาลองใหม่ด้วยรายการเดิม' });
    if (error.code === 'P2025') return res.status(404).json({ message: 'ไม่พบรายการ' });
    next(error);
  }
};

export function mountPublicOrdering(app, db) {
  app.use(
    '/api/ordering-images',
    rateLimit({ windowMs: 60000, limit: 6000, standardHeaders: 'draft-8', legacyHeaders: false }),
  );
  mountMenuImages(app, db, orderingHandler);
  // Customers often share the restaurant Wi-Fi IP. Allow menu polling separately
  // from account APIs and limit submissions per table rather than per shared IP.
  app.use(
    '/api/ordering',
    rateLimit({
      windowMs: 60000,
      limit: 1800,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'มีคำขอจำนวนมาก กรุณารอสักครู่' },
    }),
  );
  const activeTable = async (token) => {
    if (!uuid.safeParse(token).success) throw orderingError('ไม่พบ QR โต๊ะนี้', 404);
    const table = await db.diningTable.findUnique({
      where: { qrToken: token },
      select: {
        number: true,
        sessionId: true,
        orderingEnabled: true,
        zones: true,
        qrExpiresAt: true,
      },
    });
    if (!table) throw orderingError('ไม่พบ QR โต๊ะนี้', 404);
    return requireActiveQr(table);
  };
  app.get(
    '/api/ordering/:token',
    orderingHandler(async (req, res) => {
      const table = await activeTable(req.params.token);
      res.json(tableMenu(table, await orderingCatalog(db)));
    }),
  );
  app.get(
    '/api/ordering/:token/status',
    orderingHandler(async (req, res) => {
      const table = await activeTable(req.params.token);
      const catalog = await orderingCatalog(db);
      res.json({
        tableNumber: table.number,
        sessionId: table.sessionId,
        qrExpiresAt: table.qrExpiresAt,
        menuVersion: tableMenuVersion(table, catalog),
      });
    }),
  );
  app.post(
    '/api/ordering/:token/orders',
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) =>
        uuid.safeParse(req.params.token).success ? req.params.token : 'invalid-table',
      message: { message: 'ส่งรายการบ่อยเกินไป กรุณารอสักครู่' },
    }),
    orderingHandler(async (req, res) => {
      if (!uuid.safeParse(req.params.token).success) throw orderingError('ไม่พบ QR โต๊ะนี้', 404);
      const { location, ...order } = req.body || {};
      // Ignore location sent by older clients; GPS is no longer required.
      const data = parseBody(orderInput, order, res);
      if (data) res.json(await submitOrder(db, req.params.token, data));
    }),
  );
}

export function mountPosOrdering(router, db, config = { origin: 'http://localhost:5173' }) {
  router.post(
    '/tables/:id/qr',
    orderingHandler(async (req, res) => {
      if (!uuid.safeParse(req.params.id).success)
        return res.status(400).json({ message: 'รหัสโต๊ะไม่ถูกต้อง' });
      const data = parseBody(z.object({ sessionId: uuid }).strict(), req.body, res);
      if (!data) return;
      const table = await db.diningTable.findUnique({ where: { id: req.params.id } });
      requireActiveQr(table);
      if (table.sessionId !== data.sessionId)
        throw orderingError('รอบโต๊ะเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่', 403);
      res.json(presentTableQr(table, config.origin));
    }),
  );
  router.get(
    '/tables',
    orderingHandler(async (req, res) => {
      res.json(
        await db.diningTable.findMany({
          orderBy: { number: 'asc' },
          select: {
            id: true,
            number: true,
            sessionId: true,
            orderingEnabled: true,
            zones: true,
            openedAt: true,
            qrDurationHours: true,
            qrExpiresAt: true,
          },
        }),
      );
    }),
  );
  router.get(
    '/ordering-zones',
    orderingHandler(async (req, res) => {
      const rows = await db.orderingMenuItem.findMany({
        select: { zone: true },
        distinct: ['zone'],
        orderBy: { zone: 'asc' },
      });
      res.json(rows.map((row) => row.zone));
    }),
  );
  router.post(
    '/tables/:id/activate',
    orderingHandler(async (req, res) => {
      const data = parseBody(
        z
          .object({
            sessionId: uuid,
            zones: z.array(z.string().trim().min(1).max(80)).max(100),
            qrHours: qrHoursInput.optional(),
          })
          .strict(),
        req.body,
        res,
      );
      if (data)
        res.json(
          await activateTable(
            db,
            req.params.id,
            data.sessionId,
            data.zones,
            req.posActor,
            data.qrHours,
          ),
        );
    }),
  );
  router.post(
    '/tables/:id/close',
    orderingHandler(async (req, res) => {
      const data = parseBody(z.object({ sessionId: uuid }).strict(), req.body, res);
      if (data) res.json(await closeTable(db, req.params.id, data.sessionId, req.posActor));
    }),
  );
  router.get(
    '/table-orders',
    orderingHandler(async (req, res) => {
      res.json(
        await db.tableOrder.findMany({
          where: { status: 'NEW' },
          orderBy: { createdAt: 'asc' },
          take: 200,
          include: { table: { select: { number: true, sessionId: true } } },
        }),
      );
    }),
  );
  router.post(
    '/table-orders/:id/complete',
    orderingHandler(async (req, res) => {
      await db.tableOrder.updateMany({
        where: { id: req.params.id, status: 'NEW' },
        data: { status: 'DONE', completedAt: new Date() },
      });
      res.json({ ok: true });
    }),
  );
}

// Mounted after the existing admin authentication middleware.
export function mountOrderingAdmin(app, db, config) {
  mountAdminMenuImages(app, db, orderingHandler);
  app.put(
    '/api/admin/ordering-item-order',
    orderingHandler(async (req, res) => {
      const data = parseBody(itemOrderInput, req.body, res);
      if (data) {
        const result = await saveItemOrder(db, data, req.admin.id);
        invalidateOrderingMenu(db);
        res.json(result);
      }
    }),
  );
  app.get(
    '/api/admin/ordering-categories',
    orderingHandler(async (req, res) => {
      res.json(await getCategories(db));
    }),
  );
  app.put(
    '/api/admin/ordering-categories',
    orderingHandler(async (req, res) => {
      const data = parseBody(categoryOrderInput, req.body, res);
      if (data) {
        const result = await saveCategoryOrder(db, data.categories, req.admin.id);
        invalidateOrderingMenu(db);
        res.json(result);
      }
    }),
  );
  const tables = () => db.diningTable.findMany({ orderBy: { number: 'asc' } });
  const present = (table) => ({
    ...table,
    url: presentTableQr(table, config.origin).url,
  });
  app.get(
    '/api/admin/dining-tables',
    orderingHandler(async (req, res) => res.json((await tables()).map(present))),
  );
  app.put(
    '/api/admin/dining-tables/:id/settings',
    orderingHandler(async (req, res) => {
      if (!uuid.safeParse(req.params.id).success)
        return res.status(400).json({ message: 'รหัสโต๊ะไม่ถูกต้อง' });
      const data = parseBody(z.object({ qrHours: qrHoursInput }).strict(), req.body, res);
      if (!data) return;
      const table = await db.$transaction(async (tx) => {
        const table = await tx.diningTable.update({
          where: { id: req.params.id },
          data: { qrDurationHours: data.qrHours },
        });
        await tx.auditLog.create({
          data: {
            actor: req.admin.id,
            action: 'TABLE_QR_DURATION_CHANGED',
            details: { tableId: table.id, qrHours: data.qrHours },
          },
        });
        return table;
      });
      res.json(present(table));
    }),
  );
  app.post(
    '/api/admin/dining-tables',
    orderingHandler(async (req, res) => {
      const data = parseBody(
        z
          .object({
            from: z.number().int().min(1).max(9999),
            to: z.number().int().min(1).max(9999),
          })
          .strict()
          .refine((data) => data.to >= data.from && data.to - data.from < 200),
        req.body,
        res,
      );
      if (!data) return;
      // Adding table numbers never opens a round or issues a QR.
      await db.$transaction(async (tx) => {
        for (let number = data.from; number <= data.to; number++)
          await tx.diningTable.upsert({ where: { number }, create: { number }, update: {} });
        await tx.auditLog.create({
          data: { actor: req.admin.id, action: 'TABLES_ADDED', details: data },
        });
      });
      res.json((await tables()).map(present));
    }),
  );
  app.get(
    '/api/admin/ordering-menu',
    orderingHandler(async (req, res) => {
      res.json(
        (
          await db.orderingMenuItem.findMany({
            orderBy: menuOrderBy,
            select: menuFields,
          })
        ).map(presentMenuItem),
      );
    }),
  );
  const saveMenu = async (req, res) => {
    const data = parseBody(menuInput, req.body, res);
    if (!data) return;
    const item = await db.$transaction(async (tx) => {
      const item = req.params.id
        ? await tx.orderingMenuItem.update({
            where: { id: req.params.id },
            data,
            select: menuFields,
          })
        : await tx.orderingMenuItem.create({ data, select: menuFields });
      await tx.auditLog.create({
        data: {
          actor: req.admin.id,
          action: 'ORDERING_MENU_SAVED',
          details: { id: item.id, ...data },
        },
      });
      return item;
    });
    invalidateOrderingMenu(db);
    res.json(presentMenuItem(item));
  };
  app.post('/api/admin/ordering-menu', orderingHandler(saveMenu));
  app.put('/api/admin/ordering-menu/:id', orderingHandler(saveMenu));
}
