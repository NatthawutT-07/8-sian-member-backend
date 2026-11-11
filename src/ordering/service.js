import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest } from '../shared/security.js';
import { checkOrderThrottle } from './order-throttle.js';
import { requireActiveQr, qrHoursInput } from './qr-session.js';

export const orderInput = z
  .object({
    key: z.string().uuid(),
    sessionId: z.string().uuid(),
    items: z
      .array(
        z
          .object({ menuItemId: z.string().uuid(), quantity: z.number().int().min(1).max(10) })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine((data) => new Set(data.items.map((item) => item.menuItemId)).size === data.items.length, {
    message: 'รายการอาหารซ้ำ',
  });
export const orderingError = (message, status = 409) =>
  Object.assign(new Error(message), { orderingStatus: status });
export const orderHash = (data, token) =>
  digest(
    JSON.stringify({
      token,
      ...data,
      items: [...data.items].sort((a, b) => a.menuItemId.localeCompare(b.menuItemId)),
    }),
  );

// New clients activate the selected zones in the payment transaction.
// Older clients can still reserve a round and confirm zones afterwards.
export async function openPaidTable(tx, id, actor, ordering) {
  const table = await tx.diningTable.findUnique({ where: { id } });
  if (!table) throw new Error('ไม่พบโต๊ะที่เลือก');
  if (table.sessionId) throw new Error('โต๊ะนี้เปิดใช้งานอยู่ กรุณาปิดรอบเดิมก่อนรับลูกค้ารอบใหม่');
  const zones = ordering ? [...new Set(ordering.zones)].sort() : [];
  if (ordering) {
    const available = await tx.orderingMenuItem.findMany({
      select: { zone: true },
      distinct: ['zone'],
    });
    if (zones.some((zone) => !available.some((item) => item.zone === zone)))
      throw new Error('บางโซนไม่มีในเมนูแล้ว กรุณาโหลดข้อมูลใหม่ก่อนรับเงิน');
  }
  const qrHours = ordering ? qrHoursInput.parse(ordering.qrHours) : null;
  const sessionId = randomUUID();
  const locked = await tx.diningTable.updateMany({
    where: { id, sessionId: null, version: table.version },
    data: {
      sessionId,
      qrToken: randomUUID(),
      qrExpiresAt: ordering ? new Date(Date.now() + qrHours * 3600000) : null,
      ...(ordering ? { qrDurationHours: qrHours } : {}),
      orderingEnabled: !!ordering,
      zones,
      openedAt: new Date(),
      openedBy: actor,
      closedAt: null,
      lastOrderAt: null,
      orderWindowAt: null,
      orderWindowCount: 0,
      version: { increment: 1 },
    },
  });
  if (locked.count !== 1) throw new Error('สถานะโต๊ะเปลี่ยนแล้ว กรุณาเลือกโต๊ะใหม่');
  return { ...table, sessionId };
}

export async function closeTable(db, id, sessionId, actor) {
  return db.$transaction(
    async (tx) => {
      const result = await tx.diningTable.updateMany({
        where: { id, sessionId },
        data: {
          sessionId: null,
          qrToken: null,
          qrExpiresAt: null,
          orderingEnabled: false,
          zones: [],
          closedAt: new Date(),
          lastOrderAt: null,
          orderWindowAt: null,
          orderWindowCount: 0,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw orderingError('สถานะโต๊ะเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่');
      const cancelled = await tx.tableOrder.updateMany({
        where: { tableId: id, sessionId, status: 'NEW' },
        data: { status: 'CANCELLED' },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'TABLE_CLOSED',
          details: { tableId: id, sessionId, cancelledOrders: cancelled.count },
        },
      });
      return { ok: true };
    },
    { isolationLevel: 'Serializable' },
  );
}

export async function activateTable(db, id, sessionId, zones, actor, qrHours) {
  const selected = [...new Set(zones)].sort();
  return db.$transaction(
    async (tx) => {
      const table = await tx.diningTable.findUnique({ where: { id } });
      if (!table || table.sessionId !== sessionId)
        throw orderingError('รอบโต๊ะเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่');
      if (table.orderingEnabled) {
        requireActiveQr(table);
        if (JSON.stringify([...table.zones].sort()) === JSON.stringify(selected))
          return { ok: true };
        throw orderingError('โต๊ะเปิดสิทธิ์ไปแล้ว กรุณาโหลดสถานะล่าสุด');
      }
      const available = await tx.orderingMenuItem.findMany({
        select: { zone: true },
        distinct: ['zone'],
      });
      if (selected.some((zone) => !available.some((item) => item.zone === zone)))
        throw orderingError('บางโซนไม่มีในเมนูแล้ว กรุณาโหลดข้อมูลใหม่', 400);
      const locked = await tx.diningTable.updateMany({
        where: { id, sessionId, orderingEnabled: false, version: table.version },
        data: {
          orderingEnabled: true,
          zones: selected,
          version: { increment: 1 },
          qrToken: table.qrToken || randomUUID(),
          qrDurationHours: qrHoursInput.parse(qrHours ?? table.qrDurationHours ?? 2),
          qrExpiresAt: new Date(Date.now() + (qrHours ?? table.qrDurationHours ?? 2) * 3600000),
        },
      });
      if (locked.count !== 1) throw orderingError('สถานะโต๊ะเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่');
      await tx.auditLog.create({
        data: {
          actor,
          action: 'TABLE_ACTIVATED',
          details: { tableId: id, sessionId, zones: selected },
        },
      });
      return { ok: true };
    },
    { isolationLevel: 'Serializable' },
  );
}

async function saveOrderOnce(db, token, data) {
  const hash = orderHash(data, token);
  return db.$transaction(
    async (tx) => {
      const saved = await tx.tableOrder.findUnique({ where: { key: data.key } });
      if (saved) {
        if (saved.requestHash !== hash) throw orderingError('รหัสรายการนี้ถูกใช้แล้ว');
        if (saved.status === 'CANCELLED')
          throw orderingError('โต๊ะปิดแล้ว รายการค้างนี้ถูกยกเลิก กรุณาติดต่อพนักงาน', 403);
      }
      const table = await tx.diningTable.findUnique({ where: { qrToken: token } });
      requireActiveQr(table);
      if (!table?.sessionId || !table.orderingEnabled || table.sessionId !== data.sessionId)
        throw orderingError('โต๊ะปิดแล้วหรือเปลี่ยนรอบลูกค้า กรุณาติดต่อพนักงาน', 403);
      if (saved) return { ok: true }; // Acknowledgements also require the live, unexpired QR.
      const throttle = checkOrderThrottle(table, new Date());
      // Serialize orders with closing/reopening the table, including requests already in flight.
      const locked = await tx.diningTable.updateMany({
        where: {
          id: table.id,
          sessionId: data.sessionId,
          orderingEnabled: true,
          version: table.version,
        },
        data: { version: { increment: 1 }, ...throttle },
      });
      if (locked.count !== 1)
        throw Object.assign(orderingError('สถานะโต๊ะกำลังเปลี่ยน กรุณาลองรายการเดิมอีกครั้ง'), {
          code: 'ORDER_RACE',
        });
      requireActiveQr(table);
      const menu = await tx.orderingMenuItem.findMany({
        where: { id: { in: data.items.map((item) => item.menuItemId) }, active: true },
        select: { id: true, zone: true, category: true, name: true },
      });
      const items = data.items.map((item) => {
        const entry = menu.find((entry) => entry.id === item.menuItemId);
        if (!entry) throw orderingError('บางรายการหมดหรือปิดขายแล้ว กรุณาโหลดเมนูใหม่', 400);
        if (!table.zones.includes(entry.zone))
          throw orderingError('โต๊ะนี้ไม่มีสิทธิ์สั่งอาหารจากโซนที่เลือก', 403);
        return {
          menuItemId: entry.id,
          zone: entry.zone,
          category: entry.category,
          name: entry.name,
          quantity: item.quantity,
        };
      });
      requireActiveQr(table);
      await tx.tableOrder.create({
        data: {
          key: data.key,
          requestHash: hash,
          tableId: table.id,
          sessionId: data.sessionId,
          items,
        },
      });
      return { ok: true };
    },
    // The conditional update takes a row lock until commit and rechecks the
    // session/version after waiting. It serializes this table with other orders
    // and closing, without serializable predicate conflicts between 100 tables.
    { isolationLevel: 'ReadCommitted' },
  );
}

export async function submitOrder(db, token, data) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await saveOrderOnce(db, token, data);
    } catch (error) {
      if (attempt >= 3 || !['ORDER_RACE', 'P2002', 'P2034'].includes(error.code)) throw error;
      // Keep exactly the same idempotency key; a competing commit is acknowledged
      // on the next read, while a new order must pass the durable table throttle.
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.floor(Math.random() * 30)));
    }
  }
}
