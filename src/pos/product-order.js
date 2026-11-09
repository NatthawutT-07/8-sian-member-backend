import { z } from 'zod';

export const productOrderBy = [
  { group: 'asc' },
  { sortOrder: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
];
export const productOrderInput = z
  .object({
    group: z.enum(['MAIN', 'DISCOUNT', 'PROMOTION']),
    productIds: z.array(z.string().uuid()).min(1).max(500),
  })
  .strict()
  .refine(({ productIds }) => new Set(productIds).size === productIds.length, {
    message: 'สินค้าซ้ำ',
  });

export async function saveProductOrder(db, data, actor) {
  return db.$transaction(async (tx) => {
    const rows = await tx.posProduct.findMany({
      where: { group: data.group },
      select: { id: true },
    });
    const ids = new Set(rows.map((row) => row.id));
    if (ids.size !== data.productIds.length || data.productIds.some((id) => !ids.has(id)))
      throw Object.assign(
        new Error('สินค้าในกลุ่มมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่แล้วจัดลำดับอีกครั้ง'),
        { status: 409 },
      );
    for (const [index, id] of data.productIds.entries())
      await tx.posProduct.update({ where: { id }, data: { sortOrder: index + 1 } });
    await tx.auditLog.create({ data: { actor, action: 'POS_PRODUCTS_REORDERED', details: data } });
    return { ok: true };
  });
}
