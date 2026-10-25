import { parseBody as parse } from '../../shared/http-validation.js';
import { campaignInput } from './admin.validation.js';

export function mountAdminCampaigns(app, db) {
  app.get('/api/admin/campaigns', async (req, res) => {
    const campaigns = await db.campaign.findMany({
      include: { _count: { select: { coupons: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ campaigns });
  });
  app.post('/api/admin/campaigns', async (req, res) => {
    const data = parse(campaignInput, req.body, res);
    if (!data) return;
    const campaign = await db.$transaction(async (tx) => {
      const created = await tx.campaign.create({ data });
      await tx.auditLog.create({
        data: {
          actor: req.admin.id,
          action: 'CREATE_CAMPAIGN',
          details: { campaignId: created.id, title: created.title },
        },
      });
      return created;
    });
    res.status(201).json({ campaign });
  });
  app.patch('/api/admin/campaigns/:id', async (req, res) => {
    if (typeof req.body?.active !== 'boolean')
      return res.status(400).json({ message: 'สถานะแคมเปญไม่ถูกต้อง' });
    const exists = await db.campaign.findUnique({ where: { id: req.params.id } });
    if (!exists) return res.status(404).json({ message: 'ไม่พบแคมเปญ' });
    const campaign = await db.$transaction(async (tx) => {
      const updated = await tx.campaign.update({
        where: { id: exists.id },
        data: { active: req.body.active },
      });
      await tx.auditLog.create({
        data: {
          actor: req.admin.id,
          action: 'SET_CAMPAIGN_STATUS',
          details: { campaignId: exists.id, active: req.body.active },
        },
      });
      return updated;
    });
    res.json({ campaign });
  });
}
