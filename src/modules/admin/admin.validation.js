import { z } from 'zod';
export const adminLogin = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(1).max(128),
});
export const campaignInput = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  extraPrice: z.number().int().min(0).max(100000),
  validityDays: z.number().int().min(1).max(365),
  prerequisiteCampaignId: z.string().trim().min(1).max(100).nullable().optional(),
});
export const resetInput = z.object({
  newPassword: z.string().min(8).max(128),
  adminPassword: z.string().min(1).max(128),
  reason: z.string().trim().min(5).max(300),
});
export const grantInput = z.object({ campaignId: z.string().min(1).max(100) });
