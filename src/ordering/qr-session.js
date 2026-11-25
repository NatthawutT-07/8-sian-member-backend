import { z } from 'zod';

// Explicit zero means unlimited for this table round; a missing expiry alone
// must never revive a legacy or revoked QR.
export const qrHoursInput = z.number().int().min(0).max(168);
export function requireActiveQr(table, now = new Date()) {
  if (!table?.sessionId || !table.orderingEnabled)
    throw Object.assign(
      new Error('QR นี้ถูกยกเลิกหรือโต๊ะยังไม่เปิด กรุณาขอ QR รอบปัจจุบันจากพนักงาน'),
      { orderingStatus: 403 },
    );
  if (
    !(table.qrUnlimited === true && table.qrExpiresAt == null) && (
    !table.qrExpiresAt ||
    !Number.isFinite(new Date(table.qrExpiresAt).getTime()) ||
    new Date(table.qrExpiresAt).getTime() <= now.getTime())
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
    ((table.qrUnlimited === true && table.qrExpiresAt == null) ||
      (table.qrExpiresAt && new Date(table.qrExpiresAt) > new Date()));
  return {
    tableNumber: table.number,
    sessionId: table.sessionId,
    qrExpiresAt: table.qrExpiresAt,
    qrUnlimited: table.qrUnlimited === true && table.qrExpiresAt == null,
    url: valid ? `${origin.replace(/\/$/, '')}/order/${table.qrToken}` : null,
  };
}
