import test from 'node:test';
import assert from 'node:assert/strict';
import { imageMime, presentMenuItem } from '../../src/ordering/images.js';

test('menu image accepts PNG bytes and refuses scripts, oversized files and empty input', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=',
    'base64',
  );
  assert.equal(imageMime(png), 'image/png');
  for (const bytes of [
    undefined,
    Buffer.alloc(0),
    Buffer.from('<svg onload="alert(1)"/>'),
    Buffer.alloc(2 * 1024 * 1024 + 1),
  ])
    assert.throws(() => imageMime(bytes), { orderingStatus: 400 });
});
test('menu images have versioned URLs and menus without photos remain supported', () => {
  assert.equal(
    presentMenuItem({ id: 'item', imageVersion: 'v1' }).imageUrl,
    '/api/ordering-images/item/v1',
  );
  assert.equal(presentMenuItem({ id: 'item', imageVersion: null }).imageUrl, null);
});
