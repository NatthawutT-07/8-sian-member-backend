import { orderingError } from './service.js';
import { z } from 'zod';
import { parseBody } from '../shared/http-validation.js';

const cancelInput = z.object({
  sessionId: z.string().uuid(),
  menuItemId: z.string().uuid().optional(),
}).strict();

export async function cancelKitchenOrder(db, id, data, actor) {
  return db.$transaction(async (tx) => {
    const order = await tx.tableOrder.findUnique({ where: { id } });
    if (!order) throw orderingError('ไม่พบออเดอร์', 404);
    if (order.sessionId !== data.sessionId || order.status !== 'NEW')
      throw orderingError('ออเดอร์เปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลใหม่');
    const locked = await tx.diningTable.updateMany({
      where: { id: order.tableId, sessionId: data.sessionId },
      data: { version: { increment: 1 } },
    });
    if (locked.count !== 1) throw orderingError('โต๊ะปิดแล้วหรือเปลี่ยนรอบลูกค้า');
    const removed = data.menuItemId
      ? order.items.filter((item) => item.menuItemId === data.menuItemId)
      : order.items;
    if (!removed.length) throw orderingError('รายการนี้ถูกยกเลิกแล้ว กรุณาโหลดข้อมูลใหม่');
    const remaining = data.menuItemId
      ? order.items.filter((item) => item.menuItemId !== data.menuItemId)
      : [];
    const changed = await tx.tableOrder.updateMany({
      where: { id, sessionId: data.sessionId, status: 'NEW' },
      data: remaining.length ? { items: remaining } : { status: 'CANCELLED' },
    });
    if (changed.count !== 1) throw orderingError('ออเดอร์เปลี่ยนสถานะแล้ว กรุณาโหลดข้อมูลใหม่');
    await tx.auditLog.create({ data: {
      actor, action: data.menuItemId ? 'KITCHEN_ITEM_CANCELLED' : 'KITCHEN_ORDER_CANCELLED',
      details: { orderId: id, tableId: order.tableId, sessionId: data.sessionId,
        removedItems: removed, remainingItems: remaining },
    } });
    return { ok: true };
  }, { isolationLevel: 'Serializable' });
}

export async function kitchenTicket(db, id) {
  const order = await db.tableOrder.findUnique({
    where: { id },
    include: { table: { select: { number: true, sessionId: true } } },
  });
  if (!order || order.status === 'CANCELLED' || order.table.sessionId !== order.sessionId)
    throw orderingError('โต๊ะปิดแล้วหรือรายการนี้ถูกยกเลิก', 409);
  return {
    id: order.id,
    tableId: order.tableId,
    tableNumber: order.table.number,
    sessionId: order.sessionId,
    createdAt: order.createdAt,
    items: order.items,
  };
}

export async function tableSummary(db, id, sessionId) {
  return db.$transaction(
    async (tx) => {
      const table = await tx.diningTable.findUnique({ where: { id } });
      if (!table?.sessionId || table.sessionId !== sessionId)
        throw orderingError('โต๊ะปิดแล้วหรือเปลี่ยนรอบลูกค้า', 409);
      const orders = await tx.tableOrder.findMany({
        where: { tableId: id, sessionId, status: 'DONE' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const items = new Map();
      for (const order of orders)
        for (const item of order.items) {
          const row = items.get(item.menuItemId) || {
            menuItemId: item.menuItemId,
            name: item.name,
            quantity: 0,
            pending: 0,
            completed: 0,
          };
          row.quantity += item.quantity;
          row[order.status === 'DONE' ? 'completed' : 'pending'] += item.quantity;
          items.set(item.menuItemId, row);
        }
      const sale = await tx.posSale.findFirst({
        where: { tableId: id, tableSessionId: sessionId },
        select: { receiptNumber: true },
      });
      return {
        tableNumber: table.number,
        sessionId,
        receiptNumber: sale?.receiptNumber || '',
        orderCount: orders.length,
        quantity: [...items.values()].reduce((sum, item) => sum + item.quantity, 0),
        items: [...items.values()],
      };
    },
    { isolationLevel: 'Serializable' },
  );
}

export async function completeKitchenOrder(db, id, actor) {
  return db.$transaction(
    async (tx) => {
      const order = await tx.tableOrder.findUnique({ where: { id } });
      if (!order) throw orderingError('ไม่พบออเดอร์', 404);
      const locked = await tx.diningTable.updateMany({
        where: { id: order.tableId, sessionId: order.sessionId },
        data: { version: { increment: 1 } },
      });
      if (locked.count !== 1 || order.status === 'CANCELLED')
        throw orderingError('โต๊ะปิดแล้วหรือออเดอร์ถูกยกเลิก', 409);
      const result = await tx.tableOrder.updateMany({
        where: { id, status: 'NEW' },
        data: { status: 'DONE', completedAt: new Date() },
      });
      if (result.count)
        await tx.auditLog.create({
          data: {
            actor,
            action: 'KITCHEN_ORDER_DONE',
            details: { orderId: id, tableId: order.tableId, sessionId: order.sessionId },
          },
        });
      return { ok: true };
    },
    { isolationLevel: 'Serializable' },
  );
}

export function mountKitchen(router, db, handler) {
  router.post('/kitchen/orders/:id/cancel', handler(async (req, res) => {
    const data = parseBody(cancelInput, req.body, res);
    if (data) res.json(await cancelKitchenOrder(db, req.params.id, data, req.posActor));
  }));
  router.get(
    '/kitchen/orders',
    handler(async (req, res) => {
      res.json(
        await db.tableOrder.findMany({
          where: { status: 'NEW' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 500,
          include: { table: { select: { number: true, sessionId: true } } },
        }),
      );
    }),
  );
  router.get(
    '/kitchen/tables',
    handler(async (req, res) => {
      res.json(
        await db.diningTable.findMany({
          where: { sessionId: { not: null } },
          select: { id: true, number: true, sessionId: true },
          orderBy: { number: 'asc' },
        }),
      );
    }),
  );
  router.get(
    '/kitchen/tables/:id/:sessionId/summary',
    handler(async (req, res) =>
      res.json(await tableSummary(db, req.params.id, req.params.sessionId)),
    ),
  );
  router.get(
    '/kitchen/orders/:id/ticket',
    handler(async (req, res) => res.json(await kitchenTicket(db, req.params.id))),
  );
  router.post(
    '/kitchen/orders/:id/complete',
    handler(async (req, res) =>
      res.json(await completeKitchenOrder(db, req.params.id, req.posActor)),
    ),
  );
}
