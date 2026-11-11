import { z } from 'zod';
import { phone } from '../modules/auth/auth.validation.js';

export const productInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    barcode: z.string().trim().min(1).max(100),
    priceSatang: z.number().int().min(-10000000).max(10000000),
    group: z.enum(['MAIN', 'DISCOUNT', 'PROMOTION']).default('MAIN'),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((p) => (p.group === 'DISCOUNT' ? p.priceSatang < 0 : p.priceSatang >= 0), {
    message: 'ราคาส่วนลดต้องติดลบ ส่วนสินค้าและโปรโมชั่นต้องไม่ติดลบ',
  });
const items = z
  .array(
    z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(999) }).strict(),
  )
  .min(1)
  .max(100);
const member = {
  memberCode: z
    .string()
    .regex(/^8SM-[a-f0-9]{64}$/)
    .optional(),
  memberPhone: phone.optional(),
};
const oneMember = (data) => !(data.memberCode && data.memberPhone);
export const checkoutInput = z
  .object({
    key: z.string().uuid(),
    shiftId: z.string().uuid(),
    tableId: z.string().uuid().optional(),
    ordering: z
      .object({
        zones: z.array(z.string().trim().min(1).max(80)).max(100),
        qrHours: z.number().int().min(1).max(168),
      })
      .strict()
      .optional(),
    printQr: z.boolean().optional(),
    items,
    method: z.enum(['CASH', 'TRANSFER']),
    receivedSatang: z.number().int().min(0).max(100000000),
    expectedTotalSatang: z.number().int().min(0).max(100000000),
    ...member,
    couponReservationId: z.string().uuid().optional(),
  })
  .strict()
  .refine(oneMember, { message: 'เลือกสมาชิกจาก QR หรือเบอร์โทรอย่างใดอย่างหนึ่ง' })
  .refine((data) => !data.ordering || !!data.tableId, { message: 'เลือกโต๊ะก่อนกำหนดโซนอาหาร' });
export const couponReserveInput = z
  .object({ billKey: z.string().uuid(), code: z.string().regex(/^88\d{30}$/), items, ...member })
  .strict()
  .refine(oneMember);
export const couponReleaseInput = z
  .object({ billKey: z.string().uuid(), reservationId: z.string().uuid() })
  .strict();
