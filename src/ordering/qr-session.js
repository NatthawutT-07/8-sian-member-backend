import { z } from 'zod';

export const qrHoursInput = z.number().int().min(1).max(168);
export function requireActiveQr(table, now = new Date()) {
  if (!table?.sessionId || !table.orderingEnabled)
    throw Object.assign(
      new Error('QR นี้ถูกยกเลิกหรือโต๊ะยังไม่เปิด กรุณาขอ QR รอบปัจจุบันจากพนักงาน'),
      { orderingStatus: 403 },
    );
  if (
    !table.qrExpiresAt ||
    !Number.isFinite(new Date(table.qrExpiresAt).getTime()) ||
    new Date(table.qrExpiresAt).getTime() <= now.getTime()
  )
    throw Object.assign(new Error('QR นี้หมดอายุแล้ว กรุณาติดต่อพนักงานเพื่อเปิดรอบใหม่'), {
      orderingStatus: 403,
    });
  return table;
}
export function presentTableQr(table, origin) {
  const valid =
    table.sessionId &&
    table.orderingEnabled &&
    table.qrToken &&
    table.qrExpiresAt &&
    new Date(table.qrExpiresAt) > new Date();
  return {
    tableNumber: table.number,
    sessionId: table.sessionId,
    qrExpiresAt: table.qrExpiresAt,
    url: valid ? `${origin.replace(/\/$/, '')}/order/${table.qrToken}` : null,
  };
}
