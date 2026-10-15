import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineMi, nearest } from '../js/nearby.js';

// Known pairs (great-circle, miles). Tolerance ±1 % (spec §16).
test('haversine: Valencia Library ↔ Lancaster Library = 30.8 mi (±1 %)', () => {
  const d = haversineMi(34.4155, -118.5560, 34.6975, -118.1370);
  assert.ok(Math.abs(d - 30.79) / 30.79 < 0.01, `got ${d}`);
});
test('haversine: LAX ↔ SFO = 337.8 mi (±1 %)', () => {
  const d = haversineMi(33.9416, -118.4085, 37.6213, -122.3790);
  assert.ok(Math.abs(d - 337.82) / 337.82 < 0.01, `got ${d}`);
});
test('haversine: same point is 0', () => assert.equal(haversineMi(34.4, -118.5, 34.4, -118.5), 0));
test('haversine: one degree of latitude ≈ 69.1 mi (±1 %)', () => {
  const d = haversineMi(34, -118, 35, -118);
  assert.ok(Math.abs(d - 69.09) / 69.09 < 0.01, `got ${d}`);
});

const items = [
  { name: 'A', type: 'library', lat: 34.40, lon: -118.55 },
  { name: 'B', type: 'cooling_center', lat: 34.70, lon: -118.14 },
  { name: 'C', type: 'library', lat: 34.42, lon: -118.45 },
  { name: 'D', type: 'indoor_rec', lat: 34.38, lon: -118.53 },
  { name: 'E (no coords)', type: 'library', lat: null, lon: null },
];
test('nearest three are ordered by distance and carry distanceMi + typeLabel', () => {
  const n = nearest(34.3985, -118.5535, items, 3);
  assert.deepEqual(n.map(x => x.name), ['A', 'D', 'C']);
  assert.ok(n[0].distanceMi < n[1].distanceMi && n[1].distanceMi < n[2].distanceMi);
  assert.equal(n[0].typeLabel, 'Library');
});
test('nearest respects a type filter', () => {
  assert.deepEqual(nearest(34.3985, -118.5535, items, 3, ['cooling_center']).map(x => x.name), ['B']);
});
test('nearest with an empty list returns []', () => assert.deepEqual(nearest(34, -118, [], 3), []));
