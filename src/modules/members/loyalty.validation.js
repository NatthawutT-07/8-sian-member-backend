import { z } from 'zod';
import { phone } from '../auth/auth.validation.js';
export const loyaltyPhoneInput = z.object({ phone });
export const loyaltyLookupInput = z.object({ query: z.string().trim().min(1).max(80) });
export const diningVisitInput = z.object({
  memberId: z.string().uuid(),
  receiptNumber: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[\p{L}\p{N}./_-]+$/u.test(value)),
  receiptIssued: z.literal(true),
});
