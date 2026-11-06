import test from 'node:test';
import assert from 'node:assert/strict';
import { locationError, restaurantLocation } from '../../src/ordering/location.js';
import { mountPublicOrdering } from '../../src/ordering/routes.js';
import { randomUUID } from 'node:crypto';

const now = 1800000000000;
const position = (meters = 0) => ({
  latitude: restaurantLocation.latitude + meters / 6371000 * 180 / Math.PI,
  longitude: restaurantLocation.longitude,
  accuracy: 20,
  timestamp: now,
});

test('accepts center and positions inside 200m; rejects outside in either direction', () => {
  for (const meters of [0, 199, -199]) assert.equal(locationError(position(meters), now), null);
  for (const meters of [201, -201]) assert.match(locationError(position(meters), now), /200/);
});

test('requires fresh, accurate, valid coordinates', () => {
  for (const value of [
    undefined, {}, { ...position(), latitude: 91 }, { ...position(), longitude: NaN },
    { ...position(), accuracy: 101 }, { ...position(), accuracy: -1 },
    { ...position(), timestamp: now - 30001 }, { ...position(), timestamp: now + 5001 },
  ]) assert.equal(typeof locationError(value, now), 'string');
});

test('public submission rejects missing/outside locations before any database operation', async () => {
  let submit;
  mountPublicOrdering({
    use() {}, get() {},
    post(path, ...handlers) { if (path.endsWith('/orders')) submit = handlers.at(-1); },
  }, {});
  for (const location of [undefined, { ...position(201), timestamp: Date.now() }]) {
    let status;
    await submit({ params: { token: randomUUID() }, body: { location } }, {
      status(value) { status = value; return this; },
      json(body) { assert.equal(typeof body.message, 'string'); },
    }, (error) => { throw error; });
    assert.equal(status, 422);
  }
});
