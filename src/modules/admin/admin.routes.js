import { mountAdminAuth } from './admin-auth.routes.js';
import { mountAdminMembers } from './admin-members.routes.js';
import { mountAdminCampaigns } from './admin-campaigns.routes.js';
import { mountAdminReports } from './admin-reports.routes.js';
import { mountAdminLoyalty } from './admin-loyalty.routes.js';
import { mountPosAdmin } from '../../pos/admin.routes.js';
import { mountAdminManagement } from './admin-management.routes.js';
import { mountAdminPosReports } from './admin-pos-reports.routes.js';
export async function mountAdmin(app, db, config) {
  await mountAdminAuth(app, db, config);
  mountAdminMembers(app, db);
  mountAdminCampaigns(app, db);
  mountAdminReports(app, db);
  mountAdminLoyalty(app, db);
  mountPosAdmin(app, db);
  mountAdminManagement(app, db);
  mountAdminPosReports(app, db);
}
