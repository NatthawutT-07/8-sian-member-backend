import { mountAdminAuth } from './admin-auth.routes.js';
import { mountAdminMembers } from './admin-members.routes.js';
import { mountAdminCampaigns } from './admin-campaigns.routes.js';
import { mountAdminReports } from './admin-reports.routes.js';
import { mountAdminLoyalty } from './admin-loyalty.routes.js';
export async function mountAdmin(app, db, config) {
  await mountAdminAuth(app, db, config);
  mountAdminMembers(app, db);
  mountAdminCampaigns(app, db);
  mountAdminReports(app, db);
  mountAdminLoyalty(app, db);
}
