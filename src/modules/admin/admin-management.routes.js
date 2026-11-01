import { z } from 'zod';
import { registration, phone, birthDate } from '../auth/auth.validation.js';
import { campaignInput } from './admin.validation.js';
import { hashPassword, verifyPassword } from '../../shared/security.js';
import { parseBody } from '../../shared/http-validation.js';

const reason = z.string().trim().min(5).max(300);
const deleteInput = z.object({ confirmName: z.string().trim().min(1).max(200), reason }).strict();
const optionalValue = (schema, fallback = null) =>
  z
    .preprocess(
      (value) => (value == null || (typeof value === 'string' && !value.trim()) ? null : value),
      schema.nullable().optional(),
    )
    .transform((value) => value ?? fallback);
const profileFields = {
  firstName: optionalValue(registration.shape.firstName, ''),
  lastName: optionalValue(registration.shape.lastName, ''),
  phone: optionalValue(phone),
  birthDate: optionalValue(birthDate),
};
export const profileInput = z
  .object({ ...profileFields, reason: optionalValue(reason, 'ปรับปรุงข้อมูลสมาชิก') })
  .strict();
export const adminMemberInput = z
  .object({
    ...profileFields,
    password: optionalValue(registration.shape.password),
    privacyConsent: z.boolean().optional().default(false),
    marketingConsent: z.boolean().optional().default(false),
  })
  .strict();
const fields = {
  id: true,
  memberNumber: true,
  firstName: true,
  lastName: true,
  phone: true,
  birthDate: true,
  createdAt: true,
};
const fail = (message, status = 409) =>
  Object.assign(new Error(message), { managementStatus: status });
const audit = (tx, actor, action, details, memberId) =>
  tx.auditLog.create({
    data: { actor, action, details, ...(memberId ? { memberId } : {}) },
  });

export function managementHandler(schema, operation) {
  return async (req, res, next) => {
    const data = schema ? parseBody(schema, req.body, res) : req.body;
    if (schema && !data) return;
    try {
      res.json(await operation(req, data));
    } catch (error) {
      if (error.managementStatus)
        return res.status(error.managementStatus).json({ message: error.message });
      const messages = {
        P2002: 'ข้อมูลซ้ำ เช่น เบอร์โทร ชื่อผู้ใช้ หรือบาร์โค้ด กรุณาตรวจสอบ',
        P2025: 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว',
        P2003: 'รายการนี้มีประวัติเชื่อมโยงอยู่ ไม่สามารถลบได้',
        P2034: 'มีรายการเปลี่ยนแปลงพร้อมกัน กรุณาโหลดข้อมูลแล้วลองใหม่',
      };
      if (messages[error.code])
        return res
          .status(error.code === 'P2025' ? 404 : 409)
          .json({ message: messages[error.code] });
      next(error);
    }
  };
}

export async function deleteManagedRecord(tx, resource, id, data, actor) {
  const models = {
    members: 'member',
    campaigns: 'campaign',
    products: 'posProduct',
    users: 'posUser',
  };
  const model = models[resource];
  if (!model) throw fail('ประเภทข้อมูลไม่ถูกต้อง', 400);
  const record = await tx[model].findUnique({ where: { id } });
  if (!record) throw fail('ไม่พบรายการนี้', 404);
  const name =
    resource === 'members'
      ? `${record.firstName} ${record.lastName}`
      : resource === 'campaigns'
        ? record.title
        : resource === 'users'
          ? record.username
          : record.name;
  if (data.confirmName !== name) throw fail('ชื่อยืนยันไม่ตรงกับรายการที่จะลบ', 400);
  let linked = 0;
  if (resource === 'members')
    linked =
      (await tx.coupon.count({ where: { memberId: id } })) +
      (await tx.diningVisit.count({ where: { memberId: id } })) +
      (await tx.posSale.count({ where: { memberId: id } }));
  if (resource === 'campaigns')
    linked =
      (await tx.coupon.count({ where: { campaign: id } })) +
      (await tx.campaign.count({ where: { prerequisiteCampaignId: id } }));
  if (resource === 'products')
    linked = await tx.posSale.count({ where: { items: { array_contains: [{ productId: id }] } } });
  if (resource === 'users')
    linked =
      (await tx.posSale.count({ where: { actor: id } })) +
      (await tx.posShift.count({ where: { OR: [{ openedBy: id }, { closedBy: id }] } })) +
      (await tx.posCouponReservation.count({ where: { actor: id } }));
  if (linked)
    throw fail(
      resource === 'members'
        ? 'สมาชิกมีประวัติคูปอง สะสมครั้ง หรือบิลแล้ว ไม่สามารถลบบัญชีนี้ได้'
        : 'รายการนี้มีประวัติใช้งานหรือข้อมูลอ้างอิงแล้ว กรุณาปิดแจก หยุดขาย หรือระงับบัญชีแทนการลบ',
    );
  await tx[model].delete({ where: { id } });
  await audit(
    tx,
    actor,
    `DELETE_${resource.toUpperCase()}`,
    { recordId: id, title: name, reason: data.reason },
    resource === 'members' ? id : undefined,
  );
  return { message: 'ลบรายการที่ยังไม่มีประวัติใช้งานแล้ว' };
}

export function mountAdminManagement(app, db) {
  const transaction = (fn) => db.$transaction(fn, { isolationLevel: 'Serializable' });
  for (const [resource, route] of [
    ['members', '/members'],
    ['campaigns', '/campaigns'],
    ['products', '/pos/products'],
    ['users', '/pos/users'],
  ])
    app.delete(
      `/api/admin${route}/:id`,
      managementHandler(deleteInput, (req, data) =>
        transaction((tx) => deleteManagedRecord(tx, resource, req.params.id, data, req.admin.id)),
      ),
    );

  app.post(
    '/api/admin/members',
    managementHandler(adminMemberInput, async (req, data) => {
      const passwordHash = data.password ? await hashPassword(data.password) : null;
      const member = await transaction(async (tx) => {
        const created = await tx.member.create({
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            birthDate: data.birthDate ? new Date(`${data.birthDate}T00:00:00Z`) : null,
            passwordHash,
            marketingConsent: data.marketingConsent,
            privacyVersion: data.privacyConsent ? '2026-10-25' : 'not-recorded',
          },
          select: fields,
        });
        await audit(
          tx,
          req.admin.id,
          'CREATE_MEMBER',
          { source: 'ADMIN', privacyConsent: data.privacyConsent },
          created.id,
        );
        return created;
      });
      return { member };
    }),
  );
  app.put(
    '/api/admin/members/:id',
    managementHandler(profileInput, (req, data) =>
      transaction(async (tx) => {
        const previous = await tx.member.findUnique({ where: { id: req.params.id } });
        if (!previous) throw fail('ไม่พบสมาชิก', 404);
        const phoneChanged = previous.phone !== data.phone;
        const member = await tx.member.update({
          where: { id: previous.id },
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            birthDate: data.birthDate ? new Date(`${data.birthDate}T00:00:00Z`) : null,
            ...(phoneChanged ? { loyaltyQrHash: null, loyaltyQrExpiresAt: null } : {}),
          },
          select: fields,
        });
        if (phoneChanged) await tx.session.deleteMany({ where: { memberId: previous.id } });
        await audit(
          tx,
          req.admin.id,
          'UPDATE_MEMBER',
          { reason: data.reason, phoneChanged },
          previous.id,
        );
        return {
          member,
          message: phoneChanged
            ? 'แก้ไขข้อมูลติดต่อแล้ว เซสชันเดิมของสมาชิกถูกยกเลิก'
            : 'บันทึกข้อมูลสมาชิกแล้ว',
        };
      }),
    ),
  );
  app.put(
    '/api/admin/campaigns/:id',
    managementHandler(campaignInput.strict(), (req, data) =>
      transaction(async (tx) => {
        const current = await tx.campaign.findUnique({ where: { id: req.params.id } });
        if (!current) throw fail('ไม่พบแคมเปญ', 404);
        if (await tx.coupon.count({ where: { campaign: current.id } }))
          throw fail('แคมเปญนี้แจกคูปองแล้ว กรุณาสร้างแคมเปญใหม่เพื่อคงสิทธิ์เดิมของสมาชิก');
        const seen = new Set([current.id]);
        let parent = data.prerequisiteCampaignId;
        while (parent) {
          if (seen.has(parent)) throw fail('เงื่อนไขแคมเปญวนกลับมาหากัน กรุณาเลือกใหม่', 400);
          seen.add(parent);
          const row = await tx.campaign.findUnique({ where: { id: parent } });
          if (!row) throw fail('ไม่พบแคมเปญก่อนหน้าที่เลือก', 400);
          parent = row.prerequisiteCampaignId;
        }
        const campaign = await tx.campaign.update({ where: { id: current.id }, data });
        await audit(tx, req.admin.id, 'UPDATE_CAMPAIGN', {
          campaignId: current.id,
          title: data.title,
        });
        return { campaign };
      }),
    ),
  );
  app.put(
    '/api/admin/pos/users/:id',
    managementHandler(
      z
        .object({
          displayName: z.string().trim().min(1).max(100),
          active: z.boolean(),
          role: z.enum(['USER', 'CHEF']).optional(),
        })
        .strict(),
      (req, data) =>
        transaction(async (tx) => {
          const previous = data.role
            ? await tx.posUser.findUnique({ where: { id: req.params.id } })
            : null;
          const user = await tx.posUser.update({
            where: { id: req.params.id },
            data,
            select: { id: true, username: true, displayName: true, role: true, active: true },
          });
          if (!data.active || (data.role && data.role !== previous?.role))
            await tx.posSession.deleteMany({ where: { userId: user.id } });
          await audit(tx, req.admin.id, 'POS_USER_UPDATE', {
            userId: user.id,
            active: data.active,
          });
          return user;
        }),
    ),
  );
  app.post(
    '/api/admin/pos/users/:id/password',
    managementHandler(
      z
        .object({
          newPassword: z.string().min(8).max(128),
          adminPassword: z.string().min(1).max(128),
          reason,
        })
        .strict(),
      async (req, data) => {
        if (!(await verifyPassword(data.adminPassword, req.admin.passwordHash)))
          throw fail('รหัสผ่านยืนยันของแอดมินไม่ถูกต้อง', 403);
        const passwordHash = await hashPassword(data.newPassword);
        return transaction(async (tx) => {
          await tx.posUser.update({ where: { id: req.params.id }, data: { passwordHash } });
          await tx.posSession.deleteMany({ where: { userId: req.params.id } });
          await audit(tx, req.admin.id, 'POS_USER_PASSWORD', {
            userId: req.params.id,
            reason: data.reason,
          });
          return { message: 'ตั้งรหัสผ่านพนักงานแล้ว และออกจากระบบ POS ทุกเครื่อง' };
        });
      },
    ),
  );
  app.post(
    '/api/admin/members/:id/coupons/:couponId/revoke',
    managementHandler(z.object({ reason }).strict(), (req, data) =>
      transaction(async (tx) => {
        const coupon = await tx.coupon.findUnique({
          where: { id: req.params.couponId },
          include: { posSale: true, posReservation: true },
        });
        if (!coupon || coupon.memberId !== req.params.id) throw fail('ไม่พบคูปองของสมาชิกนี้', 404);
        if (coupon.usedAt || coupon.posSale)
          throw fail('คูปองที่ใช้กับรายการชำระแล้วไม่สามารถยกเลิกได้');
        if (coupon.posReservation?.expiresAt > new Date())
          throw fail('คูปองกำลังใช้ในบิล POS กรุณาตรวจบิลก่อน');
        await tx.coupon.update({
          where: { id: coupon.id },
          data: { expiresAt: new Date(), barcodeTokenHash: null, barcodeExpiresAt: null },
        });
        await tx.posCouponReservation.deleteMany({ where: { couponId: coupon.id } });
        await audit(
          tx,
          req.admin.id,
          'REVOKE_COUPON',
          { couponId: coupon.id, reason: data.reason },
          coupon.memberId,
        );
        return { message: 'ยกเลิกสิทธิ์คูปองที่ยังไม่ใช้แล้ว ประวัติยังคงอยู่' };
      }),
    ),
  );
}
