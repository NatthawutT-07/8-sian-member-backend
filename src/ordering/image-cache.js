const caches = new WeakMap();
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 64;
const TTL = 10 * 60000;

// Image URLs contain immutable versions. Bound the cache by both count and bytes.
export async function menuImage(db, id, version) {
  let cache = caches.get(db);
  if (!cache) {
    cache = { entries: new Map(), pending: new Map(), bytes: 0 };
    caches.set(db, cache);
  }
  const key = `${id}/${version}`;
  const hit = cache.entries.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    cache.entries.delete(key);
    cache.entries.set(key, hit);
    return hit.item;
  }
  if (hit) {
    cache.bytes -= hit.bytes;
    cache.entries.delete(key);
  }
  if (cache.pending.has(key)) return cache.pending.get(key);
  const pending = (async () => {
    const item = await db.orderingMenuItem.findFirst({
      where: { id, imageVersion: version },
      select: { imageData: true, imageMime: true },
    });
    if (item?.imageData && ['image/jpeg', 'image/png', 'image/webp'].includes(item.imageMime)) {
      const bytes = item.imageData.length;
      if (bytes <= MAX_BYTES) {
        while (
          cache.entries.size &&
          (cache.bytes + bytes > MAX_BYTES || cache.entries.size >= MAX_ENTRIES)
        ) {
          const oldest = cache.entries.keys().next().value;
          cache.bytes -= cache.entries.get(oldest).bytes;
          cache.entries.delete(oldest);
        }
        cache.entries.set(key, { item, bytes, expiresAt: Date.now() + TTL });
        cache.bytes += bytes;
      }
    }
    return item;
  })();
  cache.pending.set(key, pending);
  try {
    return await pending;
  } finally {
    cache.pending.delete(key);
  }
}
