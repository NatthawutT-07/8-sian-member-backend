import { z } from 'zod';
export const phone = z.string().regex(/^0[689]\d{8}$/);
export const birthDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return (
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= '1900-01-01' &&
      value <= today
    );
  }, 'วันเกิดไม่ถูกต้อง');
export const registration = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone,
  birthDate,
  password: z.string().min(8).max(128),
  privacyConsent: z.literal(true),
  marketingConsent: z.boolean().default(false),
});
export const login = z.object({ phone, password: z.string().min(1).max(128) });
