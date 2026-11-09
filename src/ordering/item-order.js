import { z } from 'zod';
import { orderingError } from './service.js';

export const menuOrderBy = [
  { category: 'asc' },
  { sortOrder: 'asc' },
  { name: 'asc' },
  { zone: 'asc' },
  { id: 'asc' },
];
export const itemOrderInput = z
  .object({
    category: z.string().trim().min(1).max(80),
    itemIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict()
  .refine(({ itemIds }) => new Set(itemIds).size === itemIds.length, { message: 'รายการอาหารซ้ำ' });

export async function saveItemOrder(db, data, actor) {
  return db.$transaction(async (tx) => {
    const items = await tx.orderingMenuItem.findMany({
      where: { category: data.category },
      select: { id: true },
    });
    const ids = new Set(items.map((item) => item.id));
    if (ids.size !== data.itemIds.length || data.itemIds.some((id) => !ids.has(id)))
      throw orderingError(
        'รายการในหมวดหมู่มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่แล้วจัดลำดับอีกครั้ง',
        409,
      );
    for (const [index, id] of data.itemIds.entries())
      await tx.orderingMenuItem.update({ where: { id }, data: { sortOrder: index + 1 } });
    await tx.auditLog.create({
      data: { actor, action: 'ORDERING_ITEMS_REORDERED', details: data },
    });
    return { ok: true };
  });
}
