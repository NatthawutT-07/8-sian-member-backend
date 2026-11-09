import { z } from 'zod';
import { orderingError } from './service.js';

export const categoryOrderInput = z
  .object({
    categories: z.array(z.string().trim().min(1).max(80)).max(500),
  })
  .strict()
  .refine(({ categories }) => new Set(categories).size === categories.length, {
    message: 'หมวดหมู่ซ้ำ',
  });

// Existing menus need no backfill: categories without a saved position follow
// configured categories, in a stable Thai alphabetical order.
export function orderedCategories(menu, positions) {
  const ranks = new Map(positions.map((row) => [row.name, row.sortOrder]));
  return [...new Set(menu.map((item) => item.category))].sort(
    (a, b) =>
      (ranks.get(a) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      a.localeCompare(b, 'th'),
  );
}

export async function getCategories(db) {
  const [menu, positions] = await Promise.all([
    db.orderingMenuItem.findMany({ select: { category: true }, distinct: ['category'] }),
    db.orderingCategory.findMany(),
  ]);
  return orderedCategories(menu, positions);
}

export async function saveCategoryOrder(db, names, actor) {
  return db.$transaction(async (tx) => {
    const current = await getCategories(tx);
    if (current.length !== names.length || current.some((name) => !names.includes(name)))
      throw orderingError('หมวดหมู่มีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่แล้วจัดลำดับอีกครั้ง', 409);
    for (const [sortOrder, name] of names.entries())
      await tx.orderingCategory.upsert({
        where: { name },
        create: { name, sortOrder },
        update: { sortOrder },
      });
    await tx.auditLog.create({
      data: { actor, action: 'ORDERING_CATEGORIES_REORDERED', details: { categories: names } },
    });
    return names;
  });
}
