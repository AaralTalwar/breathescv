import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOpenMeteo, localToIso, offsetString } from '../js/api.js';
import { decide } from '../js/decide.js';

const guidance = JSON.parse(readFileSync(new URL('../data/guidance.json', import.meta.url)));
const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('offsetString formats PDT/PST and positive offsets', () => {
  assert.equal(offsetString(-25200), '-07:00');
  assert.equal(offsetString(-28800), '-08:00');
  assert.equal(offsetString(19800), '+05:30');
});

test('localToIso attaches the API offset and leaves full ISO alone', () => {
  assert.equal(localToIso('2026-10-15T07:00', -25200), '2026-10-15T07:00:00-07:00');
  assert.equal(localToIso('2026-10-15T07:00:00Z', -25200), '2026-10-15T07:00:00Z');
  assert.equal(localToIso(null, -25200), null);
});

test('parses the good-day fixture: current, components, dominant, 72 hourly, 3 daily', () => {
  const d = parseOpenMeteo(fx('good-day.json'), '2026-10-15T07:05:00-07:00');
  assert.equal(d.current.time, '2026-10-15T07:00:00-07:00');
  assert.equal(d.current.aqi, 33);
  assert.equal(d.current.dominant, 'o3');   // fixture: pm2_5 28, o3 33
  assert.equal(d.hourly.length, 72);
  assert.equal(d.daily.length, 3);
  assert.equal(d.daily[0].date, '2026-10-15');
  assert.equal(d.utcOffsetSeconds, -25200);
});

test('missing us_aqi → aqi null → engine reports stale/missing, never Green', () => {
  const d = parseOpenMeteo(fx('missing-data.json'));
  assert.equal(d.current.aqi, null);
  assert.equal(d.daily.length, 0);
  const out = decide({ ...d.current, readingTime: d.current.time, now: '2026-10-15T07:10:00-07:00', hourly: d.hourly, daily: d.daily, persona: 'general', guidance });
  assert.equal(out.state, 'stale');
  assert.notEqual(out.flag.colour, '#00E400');
});

test('AC-04 smoke day: asthma → level 3, improve-by 18:00, facility in safer option', () => {
  const d = parseOpenMeteo(fx('smoke-day.json'));
  const out = decide({
    aqi: d.current.aqi, dominant: d.current.dominant, readingTime: d.current.time,
    now: '2026-10-15T07:20:00-07:00', hourly: d.hourly, daily: d.daily, persona: 'asthma', guidance,
    facility: { name: 'Valencia Library', distanceMi: 1.2 },
  });
  assert.equal(out.category.id, 'unhealthy');
  assert.equal(out.level, 3);
  assert.equal(out.improveBy, '2026-10-15T18:00:00-07:00');
  assert.match(out.saferOption, /Valencia Library/);
  assert.equal(out.schoolFlag.word, 'Red');
});

test('ozone afternoon: asthma at 10:00 is Good but gets a lookahead warning for 1 pm', () => {
  const d = parseOpenMeteo(fx('ozone-afternoon.json'));
  const out = decide({
    aqi: d.current.aqi, dominant: d.current.dominant, readingTime: d.current.time,
    now: '2026-10-15T10:05:00-07:00', hourly: d.hourly, daily: d.daily, persona: 'asthma', guidance,
  });
  assert.equal(out.category.id, 'good');
  assert.equal(out.level, 0);
  assert.ok(out.lookahead);
  assert.match(out.decision, /gets worse by 12 pm|gets worse by 1 pm/);
  assert.equal(out.schoolFlag.word, 'Orange');   // daily max 135
  // Everyone-else persona: 12:00 = 95 → Moderate → level 0, so the first worse hour is 13:00 (level 1)
  const gen = decide({ aqi: d.current.aqi, dominant: d.current.dominant, readingTime: d.current.time,
    now: '2026-10-15T10:05:00-07:00', hourly: d.hourly, daily: d.daily, persona: 'general', guidance });
  assert.match(gen.decision, /gets worse by 1 pm/);
});

test('cache age arithmetic across DST fall-back (reading 00:30 PDT, now 01:30 PST = 2 h)', () => {
  const reading = localToIso('2026-11-01T00:30', -25200);
  const now = localToIso('2026-11-01T01:30', -28800);
  const out = decide({ aqi: 40, dominant: 'o3', readingTime: reading, now, persona: 'general', guidance });
  assert.equal(out.ageH, 2);
});

test('API error payload throws', () => {
  assert.throws(() => parseOpenMeteo({ error: true, reason: 'Latitude must be in range' }), /Latitude/);
});
