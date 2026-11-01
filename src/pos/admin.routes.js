import { z } from 'zod';
import { hashPassword } from '../shared/security.js';
import { parseBody } from '../shared/http-validation.js';
import { productInput } from './checkout.js';

const userInput = z
  .object({
    username: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9._-]{3,80}$/),
    displayName: z.string().trim().min(1).max(100),
    password: z.string().min(8).max(128),
  })
  .strict();
const userSelect = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  active: true,
  createdAt: true,
};
// Mounted only after the existing /api/admin authentication middleware.
export function mountPosAdmin(app, db) {
  app.get('/api/admin/pos/coupon-rules', async (req, res) =>
    res.json(
      await db.campaign.findMany({
        select: {
          id: true,
          title: true,
          active: true,
          extraPrice: true,
          posMinSubtotalSatang: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ),
  );
  app.put('/api/admin/pos/coupon-rules/:id', async (req, res) => {
    if (!req.params.id || req.params.id.length > 100)
      return res.status(400).json({ message: 'รหัสแคมเปญไม่ถูกต้อง' });
    const data = parseBody(
      z
        .object({
          posMinSubtotalSatang: z.number().int().min(0).max(100000000),
        })
        .strict(),
      req.body,
      res,
    );
    if (!data) return;
    res.json(
      await db.$transaction(async (tx) => {
        const campaign = await tx.campaign.update({
          where: { id: req.params.id },
          data,
          select: { id: true, title: true, extraPrice: true, posMinSubtotalSatang: true },
        });
        await tx.auditLog.create({
          data: {
            actor: req.admin.id,
            action: 'POS_COUPON_RULE',
            details: { campaignId: campaign.id, ...data },
          },
        });
        return campaign;
      }),
    );
  });
  app.get('/api/admin/pos/users', async (req, res) =>
    res.json(await db.posUser.findMany({ select: userSelect, orderBy: { username: 'asc' } })),
  );
  app.post('/api/admin/pos/users', async (req, res) => {
    const data = parseBody(userInput, req.body, res);
    if (!data) return;
    const { password, ...fields } = data;
    const passwordHash = await hashPassword(password);
    const user = await db.$transaction(async (tx) => {
      const user = await tx.posUser.create({
        data: { ...fields, passwordHash, role: 'USER' },
        select: userSelect,
      });
      await tx.auditLog.create({
        data: { actor: req.admin.id, action: 'POS_USER_CREATE', details: { userId: user.id } },
      });
      return user;
    });
    res.status(201).json(user);
  });
  app.patch('/api/admin/pos/users/:id', async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success)
      return res.status(400).json({ message: 'รหัสพนักงานไม่ถูกต้อง' });
    const data = parseBody(z.object({ active: z.boolean() }).strict(), req.body, res);
    if (!data) return;
    const user = await db.$transaction(async (tx) => {
      const user = await tx.posUser.update({
        where: { id: req.params.id },
        data,
        select: userSelect,
      });
      if (!data.active) await tx.posSession.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          actor: req.admin.id,
          action: 'POS_USER_STATUS',
          details: { userId: user.id, active: data.active },
        },
      });
      return user;
    });
    res.json(user);
  });
  app.get('/api/admin/pos/products', async (req, res) =>
    res.json(await db.posProduct.findMany({ orderBy: { name: 'asc' }, take: 2000 })),
  );
  app.post('/api/admin/pos/products', async (req, res) => {
    const data = parseBody(productInput, req.body, res);
    if (!data) return;
    const product = await db.$transaction(async (tx) => {
      const product = await tx.posProduct.create({ data });
      await tx.auditLog.create({
        data: {
          actor: req.admin.id,
          action: 'POS_PRODUCT_CREATE',
          details: { productId: product.id },
        },
      });
      return product;
    });
    res.status(201).json(product);
  });
  app.put('/api/admin/pos/products/:id', async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success)
      return res.status(400).json({ message: 'รหัสสินค้าไม่ถูกต้อง' });
    const data = parseBody(productInput, req.body, res);
    if (!data) return;
    res.json(
      await db.$transaction(async (tx) => {
        const product = await tx.posProduct.update({ where: { id: req.params.id }, data });
        await tx.auditLog.create({
          data: {
            actor: req.admin.id,
            action: 'POS_PRODUCT_UPDATE',
            details: { productId: product.id },
          },
        });
        return product;
      }),
    );
  });
}
