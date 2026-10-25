export function mountAdminReports(app, db) {
  app.get('/api/admin/overview', async (req, res) => {
    const now = new Date();
    const [members, campaigns, issued, used, available, expired] = await Promise.all([
      db.member.count(),
      db.campaign.count(),
      db.coupon.count(),
      db.coupon.count({ where: { usedAt: { not: null } } }),
      db.coupon.count({ where: { usedAt: null, expiresAt: { gt: now } } }),
      db.coupon.count({ where: { usedAt: null, expiresAt: { lte: now } } }),
    ]);
    res.json({ members, campaigns, issued, used, available, expired });
  });
  app.get('/api/admin/audits', async (req, res) => {
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const [audits, total] = await Promise.all([
      db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * 30, take: 30 }),
      db.auditLog.count(),
    ]);
    res.json({ audits, total, page, pages: Math.ceil(total / 30) });
  });
}
