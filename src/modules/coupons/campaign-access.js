export const prerequisiteInclude = {
  prerequisite: { select: { id: true, title: true } },
};

export function campaignAccess(campaign, usedCampaigns) {
  const prerequisiteCampaign = campaign.prerequisite || null;
  const locked = Boolean(
    campaign.prerequisiteCampaignId && !usedCampaigns.has(campaign.prerequisiteCampaignId),
  );
  return { locked, prerequisiteCampaign };
}

export async function usedCampaignsFor(db, memberId) {
  const coupons = await db.coupon.findMany({
    where: { memberId, usedAt: { lte: new Date() } },
    select: { campaign: true },
  });
  return new Set(coupons.map((coupon) => coupon.campaign));
}

// Always check the authenticated recipient, never an ID supplied in a request body.
export async function requireCampaignAccess(db, memberId, campaign) {
  if (!campaign.prerequisiteCampaignId) return;
  const used = await db.coupon.findFirst({
    where: { memberId, campaign: campaign.prerequisiteCampaignId, usedAt: { lte: new Date() } },
    select: { id: true },
  });
  if (!used) {
    const error = new Error(
      `กรุณาใช้คูปอง “${campaign.prerequisite?.title || 'แคมเปญก่อนหน้า'}” ให้ระบบยืนยันสำเร็จก่อน จึงจะปลดล็อกคูปองนี้`,
    );
    error.code = 'CAMPAIGN_LOCKED';
    error.status = 403;
    throw error;
  }
}
