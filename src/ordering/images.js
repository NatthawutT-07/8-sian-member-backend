import express from 'express';
import { randomUUID } from 'node:crypto';
import { orderingError } from './service.js';

export const menuFields = {
  id: true,
  zone: true,
  category: true,
  name: true,
  active: true,
  createdAt: true,
  imageVersion: true,
};
export const presentMenuItem = (item) => ({
  ...item,
  imageUrl: item.imageVersion ? `/api/ordering-images/${item.id}/${item.imageVersion}` : null,
});
export const imageBody = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: '2mb',
});

export function imageMime(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 2 * 1024 * 1024)
    throw orderingError('กรุณาเลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 2 MB', 400);
  if (
    bytes.length > 12 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  )
    return 'image/jpeg';
  if (
    bytes.length > 32 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.subarray(-8, -4).toString() === 'IEND'
  )
    return 'image/png';
  if (
    bytes.length > 20 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  )
    return 'image/webp';
  throw orderingError('ไฟล์ไม่ใช่รูป JPG, PNG หรือ WebP ที่รองรับ', 400);
}

export function mountMenuImages(app, db, handler) {
  app.get(
    '/api/ordering-images/:id/:version',
    handler(async (req, res) => {
      const item = await db.orderingMenuItem.findFirst({
        where: { id: req.params.id, imageVersion: req.params.version },
        select: { imageData: true, imageMime: true },
      });
      if (!item?.imageData || !['image/jpeg', 'image/png', 'image/webp'].includes(item.imageMime))
        throw orderingError('ไม่พบรูปอาหาร', 404);
      res.set('Content-Type', item.imageMime);
      res.set('Content-Disposition', 'inline');
      // Allow customer web origins configured by CORS, including split API/web domains.
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(Buffer.from(item.imageData));
    }),
  );
}

export function mountAdminMenuImages(app, db, handler) {
  app.put(
    '/api/admin/ordering-menu/:id/image',
    imageBody,
    handler(async (req, res) => {
      const mime = imageMime(req.body);
      const item = await db.$transaction(async (tx) => {
        const item = await tx.orderingMenuItem.update({
          where: { id: req.params.id },
          data: { imageData: req.body, imageMime: mime, imageVersion: randomUUID() },
          select: menuFields,
        });
        await tx.auditLog.create({
          data: {
            actor: req.admin.id,
            action: 'ORDERING_IMAGE_SAVED',
            details: { menuItemId: item.id, bytes: req.body.length },
          },
        });
        return item;
      });
      res.json(presentMenuItem(item));
    }),
  );
  app.delete(
    '/api/admin/ordering-menu/:id/image',
    handler(async (req, res) => {
      const item = await db.$transaction(async (tx) => {
        const item = await tx.orderingMenuItem.update({
          where: { id: req.params.id },
          data: { imageData: null, imageMime: null, imageVersion: null },
          select: menuFields,
        });
        await tx.auditLog.create({
          data: {
            actor: req.admin.id,
            action: 'ORDERING_IMAGE_REMOVED',
            details: { menuItemId: item.id },
          },
        });
        return item;
      });
      res.json(presentMenuItem(item));
    }),
  );
}
