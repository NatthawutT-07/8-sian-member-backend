import { digest } from '../shared/security.js';
import { menuFields, presentMenuItem } from './images.js';
import { menuOrderBy } from './item-order.js';
import { orderedCategories } from './categories.js';

const catalogs = new WeakMap();
const TTL = 60000;

export function invalidateOrderingMenu(db) {
  catalogs.delete(db);
}

// Cache menu content across tables; never cache a table's paid session or rights.
// Share an in-flight query as well, so 100 first visitors do not load 100 catalogs.
export async function orderingCatalog(db, now = Date.now()) {
  let entry = catalogs.get(db);
  if (entry?.value && entry.expiresAt > now) return entry.value;
  if (entry?.pending) return entry.pending;
  entry = { pending: null };
  catalogs.set(db, entry);
  entry.pending = (async () => {
    const [items, positions] = await Promise.all([
      db.orderingMenuItem.findMany({
        where: { active: true },
        orderBy: menuOrderBy,
        select: menuFields,
      }),
      db.orderingCategory.findMany(),
    ]);
    const menu = items.map(presentMenuItem);
    const categories = orderedCategories(menu, positions);
    const value = { menu, categories, version: digest(JSON.stringify({ menu, categories })) };
    entry.value = value;
    entry.expiresAt = Date.now() + TTL;
    return value;
  })();
  try {
    return await entry.pending;
  } catch (error) {
    if (catalogs.get(db) === entry) catalogs.delete(db);
    throw error;
  } finally {
    entry.pending = null;
  }
}

export function tableMenuVersion(table, catalog) {
  return digest(
    JSON.stringify({
      catalog: catalog.version,
      session: table.sessionId,
      zones: [...table.zones].sort(),
    }),
  );
}

export function tableMenu(table, catalog) {
  const zones = new Set(table.zones);
  const menu = catalog.menu.filter((item) => zones.has(item.zone));
  const categories = new Set(menu.map((item) => item.category));
  return {
    tableNumber: table.number,
    sessionId: table.sessionId,
    menuVersion: tableMenuVersion(table, catalog),
    categories: catalog.categories.filter((name) => categories.has(name)),
    menu,
  };
}
