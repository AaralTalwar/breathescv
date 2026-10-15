// Run with:  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide, categoryFor, dominantPollutant, hourLabel } from '../js/decide.js';

const guidance = JSON.parse(readFileSync(new URL('../data/guidance.json', import.meta.url)));

const NOW = '2026-10-15T12:00:00-07:00';
function at(hoursAgo) {
  const d = new Date(new Date(NOW).getTime() - hoursAgo * 3_600_000);
  // Keep the -07:00 offset so hourLabel reads local time.
  return toLocalIso(d, -7);
}
function toLocalIso(d, offsetH) {
  const shifted = new Date(d.getTime() + offsetH * 3_600_000);
  const s = shifted.toISOString().slice(0, 16);
  const sign = offsetH < 0 ? '-' : '+';
  const abs = Math.abs(offsetH).toString().padStart(2, '0');
  return `${s}:00${sign}${abs}:00`;
}
function hoursFromNow(h) { return at(-h); }

function run(aqi, dominant, persona, ageH, extra = {}) {
  return decide({ aqi, dominant, persona, guidance, now: NOW, readingTime: at(ageH), hourly: [], daily: [], ...extra });
}

// ── §11.3 test vectors ────────────────────────────────────────────────
const vectors = [
  [42,  'o3',    'asthma',  0.5, 'good',      0],
  [50,  'pm2_5', 'general', 1,   'good',      0],   // boundary
  [51,  'pm2_5', 'general', 1,   'moderate',  0],
  [51,  'pm2_5', 'asthma',  1,   'moderate',  1],
  [118, 'pm2_5', 'general', 0.2, 'usg',       1],
  [118, 'pm2_5', 'athlete', 0.2, 'usg',       2],
  [118, 'pm2_5', 'asthma',  0.2, 'usg',       2],
  [165, 'pm2_5', 'general', 0.2, 'unhealthy', 2],
  [165, 'pm2_5', 'asthma',  0.2, 'unhealthy', 3],
  [240, 'pm2_5', 'general', 0.2, 'very',      3],
  [310, 'pm2_5', 'general', 0.2, 'hazardous', 4],
];
for (const [aqi, dom, persona, age, cat, level] of vectors) {
  test(`vector aqi=${aqi} ${persona} age=${age}h → ${cat} level ${level}`, () => {
    const out = run(aqi, dom, persona, age);
    assert.equal(out.state, 'ok');
    assert.equal(out.category.id, cat);
    assert.equal(out.level, level);
    assert.ok(out.decision.length > 0);
    assert.ok(out.reason.includes(`AQI ${aqi}`));
  });
}

test('vector: 42 o3 asthma at 3.5 h → stale, grey, no Green decision', () => {
  const out = run(42, 'o3', 'asthma', 3.5);
  assert.equal(out.state, 'stale');
  assert.equal(out.flag.colour, guidance.stale.colour);
  assert.equal(out.level, null);
  assert.match(out.decision, /Check again/);
  assert.match(out.decision, /4 hours old/);
  assert.notEqual(out.flag.colour, '#00E400');
});

test('vector: 42 now then 120 at +2 h → Good now + lookahead "gets worse by"', () => {
  const hourly = [
    { time: hoursFromNow(1), aqi: 45 },
    { time: hoursFromNow(2), aqi: 120 },
    { time: hoursFromNow(3), aqi: 130 },
  ];
  const out = run(42, 'pm2_5', 'asthma', 0.2, { hourly });
  assert.equal(out.category.id, 'good');
  assert.equal(out.level, 0);
  assert.ok(out.lookahead, 'lookahead should be set');
  assert.equal(out.lookahead.time, hourly[1].time);
  assert.match(out.decision, /gets worse by 2 pm/);
});

// ── Boundaries (inclusive upper bounds) ──────────────────────────────
for (const [aqi, cat] of [[100, 'moderate'], [101, 'usg'], [150, 'usg'], [151, 'unhealthy'], [200, 'unhealthy'], [201, 'very'], [300, 'very'], [301, 'hazardous']]) {
  test(`boundary ${aqi} → ${cat}`, () => assert.equal(categoryFor(aqi, guidance).id, cat));
}
test('fractional AQI rounds before classifying (50.4 → Good, 50.5 → Moderate)', () => {
  assert.equal(categoryFor(50.4, guidance).id, 'good');
  assert.equal(categoryFor(50.5, guidance).id, 'moderate');
});
test('AQI above 999 is still Hazardous', () => assert.equal(categoryFor(1200, guidance).id, 'hazardous'));

// ── Dominant pollutant tie-break ──────────────────────────────────────
test('dominant tie-break prefers pm2_5, then o3, then pm10, then no2', () => {
  assert.equal(dominantPollutant({ pm2_5: 60, o3: 60, pm10: 60, no2: 60 }), 'pm2_5');
  assert.equal(dominantPollutant({ pm2_5: 10, o3: 60, pm10: 60 }), 'o3');
  assert.equal(dominantPollutant({ pm2_5: 10, o3: 5, pm10: 60, no2: 60 }), 'pm10');
  assert.equal(dominantPollutant({ pm2_5: null, o3: null, pm10: 30, no2: 40 }), 'no2');
});

// ── Persona switch leaves category and schoolFlag unchanged ──────────
test('persona change never changes state, category, or schoolFlag', () => {
  const daily = [{ date: '2026-10-15', max: 160 }];
  const outs = ['asthma', 'athlete', 'general'].map(p => run(118, 'o3', p, 0.5, { daily }));
  for (const o of outs) {
    assert.equal(o.state, 'ok');
    assert.equal(o.category.id, 'usg');
    assert.equal(o.schoolFlag.id, 'unhealthy');
  }
  assert.deepEqual(outs.map(o => o.level), [2, 2, 1]);
});

// ── Improve-by ────────────────────────────────────────────────────────
test('improve-by finds the first hour at level ≤ 1 within 24 h', () => {
  const hourly = [];
  for (let h = 1; h <= 24; h++) hourly.push({ time: hoursFromNow(h), aqi: h < 6 ? 170 : 60 });
  const out = run(165, 'pm2_5', 'asthma', 0.2, { hourly });
  assert.equal(out.level, 3);
  assert.equal(out.improveBy, hourly[5].time);     // +6 h → AQI 60 → Moderate → level 1 for asthma
  assert.equal(hourLabel(out.improveBy), '6 pm');
});
test('improve-by says "not in the next 24 hours" when it never clears', () => {
  const hourly = [];
  for (let h = 1; h <= 30; h++) hourly.push({ time: hoursFromNow(h), aqi: h > 25 ? 40 : 170 });
  const out = run(165, 'pm2_5', 'general', 0.2, { hourly });
  assert.equal(out.improveBy, 'not in the next 24 hours');
});
test('improve-by is null when current level < 2', () => {
  assert.equal(run(60, 'pm2_5', 'general', 0.2).improveBy, null);
});

// ── Stale never yields level 0 (for every persona, with and without data) ──
test('stale never yields level 0', () => {
  for (const p of ['asthma', 'athlete', 'general']) {
    assert.equal(run(20, 'o3', p, 3.01).level, null);
    assert.equal(run(null, 'o3', p, 0.1).state, 'stale');
    assert.equal(decide({ aqi: 20, persona: p, guidance, now: NOW, readingTime: null }).state, 'stale');
  }
});
test('exactly 3.0 h old is still fresh', () => assert.equal(run(20, 'o3', 'asthma', 3).state, 'ok'));

// ── Safer option carries the nearest facility at level ≥ 3 ───────────
test('safer option names the nearest facility at level 3', () => {
  const out = run(165, 'pm2_5', 'asthma', 0.2, { facility: { name: 'Valencia Library', distanceMi: 1.23 } });
  assert.match(out.saferOption, /Valencia Library, 1\.2 mi/);
});
test('safer option degrades gracefully with no facility', () => {
  assert.match(run(165, 'pm2_5', 'asthma', 0.2).saferOption, /library or community center/);
});

// ── School flag ──────────────────────────────────────────────────────
test('school flag uses today\'s daily max, else current category', () => {
  assert.equal(run(42, 'o3', 'general', 0.1, { daily: [{ date: '2026-10-15', max: 110 }] }).schoolFlag.word, 'Orange');
  assert.equal(run(42, 'o3', 'general', 0.1).schoolFlag.word, 'Green');
});

// ── Age arithmetic across DST (Nov 1, 2026 fall-back) ────────────────
test('age is computed from absolute instants, so DST does not add an hour', () => {
  const reading = '2026-11-01T00:30:00-07:00';  // PDT
  const now     = '2026-11-01T01:30:00-08:00';  // PST, 2 real hours later
  const out = decide({ aqi: 42, dominant: 'o3', persona: 'general', guidance, now, readingTime: reading });
  assert.equal(out.ageH, 2);
  assert.equal(out.state, 'ok');
});
