import { orderingError } from './service.js';

export const ORDER_GAP_MS = 5000;
export const ORDER_WINDOW_MS = 60000;
export const ORDER_WINDOW_LIMIT = 12;

export function checkOrderThrottle(table, now) {
  const last = table.lastOrderAt ? new Date(table.lastOrderAt).getTime() : 0;
  const windowStart = table.orderWindowAt ? new Date(table.orderWindowAt).getTime() : 0;
  let wait = table.lastOrderAt ? Math.max(0, last + ORDER_GAP_MS - now.getTime()) : 0;
  if (windowStart + ORDER_WINDOW_MS > now.getTime() && table.orderWindowCount >= ORDER_WINDOW_LIMIT)
    wait = Math.max(wait, windowStart + ORDER_WINDOW_MS - now.getTime());
  if (wait > 0)
    throw Object.assign(
      orderingError('โต๊ะนี้เพิ่งส่งรายการ กรุณารอสักครู่แล้วส่งรายการเดิมอีกครั้ง', 429),
      { retryAfter: Math.ceil(wait / 1000) },
    );
  return {
    lastOrderAt: now,
    orderWindowAt: windowStart + ORDER_WINDOW_MS > now.getTime() ? table.orderWindowAt : now,
    orderWindowCount:
      windowStart + ORDER_WINDOW_MS > now.getTime() ? (table.orderWindowCount || 0) + 1 : 1,
  };
}
