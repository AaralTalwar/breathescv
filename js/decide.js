// decide.js — the BreatheSCV decision engine (spec §11).
//
// A PURE function: no fetch, no DOM, no localStorage, no Date.now().
// Everything it needs comes in through `input`; everything it knows
// goes out through the returned object. That is what makes it testable
// (tests/decide.test.js) and explainable in 20 lines on camera.
//
// decide({ aqi, dominant, readingTime, now, hourly, daily, persona, guidance, facility })
//   → { state, category, flag, level, levelName, decision, reason,
//       saferOption, improveBy, schoolFlag, ageH, lookahead }

const STALE_AFTER_HOURS = 3;   // spec §7.3 / §11.1 step 1
const LOOKAHEAD_HOURS   = 3;   // spec §11.1 step 8
const IMPROVE_WINDOW_H  = 24;  // spec §11.1 step 9

// Tie-break order when two pollutants share the top AQI (spec §11.2).
const POLLUTANT_PRIORITY = ['pm2_5', 'o3', 'pm10', 'no2'];

/** Round a possibly-fractional AQI to an integer (spec §11.2). */
export function roundAqi(aqi) {
  if (aqi === null || aqi === undefined || Number.isNaN(Number(aqi))) return null;
  return Math.round(Number(aqi));
}

/** Look up the EPA category for an integer AQI. Ranges are inclusive. */
export function categoryFor(aqi, guidance) {
  const n = roundAqi(aqi);
  if (n === null) return null;
  const cats = guidance.categories;
  for (const c of cats) {
    if (n >= c.min && n <= c.max) return c;
  }
  // Anything above the last max (e.g. 999+) is still Hazardous.
  return n > cats[cats.length - 1].max ? cats[cats.length - 1] : null;
}

/** Pick the dominant pollutant from component AQIs, with the tie-break order. */
export function dominantPollutant(components) {
  if (!components) return null;
  let best = null;
  let bestVal = -Infinity;
  for (const key of POLLUTANT_PRIORITY) {
    const v = components[key];
    if (v === null || v === undefined) continue;
    if (v > bestVal) { bestVal = v; best = key; }   // strict > keeps the earlier key on ties
  }
  return best;
}

/** Decision level (0–4) for a category id and persona, from the data table. */
export function levelFor(categoryId, persona, guidance) {
  const table = guidance.levelTable;
  const idx = table.personaOrder.indexOf(persona);
  if (idx < 0) throw new Error(`Unknown persona: ${persona}`);
  const row = table[categoryId];
  if (!row) throw new Error(`Unknown category: ${categoryId}`);
  return row[idx];
}

/** Hours between two ISO strings (with offsets). Positive when `later` is later. */
export function hoursBetween(earlier, later) {
  const a = new Date(earlier).getTime();
  const b = new Date(later).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 3_600_000;
}

/** "3 pm" style label for an ISO time, in the time's own offset (no TZ conversion). */
export function hourLabel(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  let h = parseInt(m[1], 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `${h} ${ampm}`;
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

export function decide(input) {
  const { guidance, persona, hourly = [], daily = [], facility = null, now, readingTime } = input;
  const personaDef = guidance.personas[persona];
  if (!personaDef) throw new Error(`Unknown persona: ${persona}`);

  const aqi = roundAqi(input.aqi);
  const category = categoryFor(aqi, guidance);
  const ageH = (readingTime && now) ? hoursBetween(readingTime, now) : null;
  const pollutantName = guidance.pollutantNames[input.dominant] || 'mixed pollutants';

  // ── Step 10 (computed early because it is persona-independent): school flag.
  // Flags are raised for the whole day, so use today's forecast maximum.
  const todayMax = daily.length ? daily[0].max : null;
  const schoolCat = categoryFor(todayMax, guidance) || category;
  const schoolFlag = schoolCat ? { id: schoolCat.id, name: schoolCat.name, word: schoolCat.flagWord, colour: schoolCat.colour } : null;

  // ── Step 1: freshness. Old or missing data never produces a Green decision.
  if (aqi === null || category === null || ageH === null || ageH > STALE_AFTER_HOURS) {
    const whole = ageH === null ? null : Math.max(1, Math.round(ageH));
    return {
      state: 'stale',
      category: category ? { id: category.id, name: category.name, colour: category.colour, ink: category.ink } : null,
      flag: { colour: guidance.stale.colour, ink: guidance.stale.ink, name: guidance.stale.name },
      aqi, pollutantName, ageH, readingTime, now,
      level: null, levelName: null,
      decision: aqi === null || ageH === null ? guidance.stale.missing : fill(guidance.stale.decision, { ageH: whole }),
      reason: category
        ? `Last reading: ${category.name} (AQI ${aqi}, mainly ${pollutantName}) at ${hourLabel(readingTime)}.`
        : 'No reading is available.',
      saferOption: guidance.stale.safer,
      improveBy: null,
      lookahead: null,
      schoolFlag,
    };
  }

  // ── Steps 2–4: category → persona group → decision level.
  const group = personaDef.group;                     // 'sensitive' | 'all'
  const level = levelFor(category.id, persona, guidance);
  const levelDef = guidance.levels[level];

  // ── Step 5: decision sentence.
  let decision = levelDef.decision;

  // ── Step 6: reason, quoting the EPA guidance line for this group.
  const reason = `${category.name} (AQI ${aqi}, mainly ${pollutantName}) at ${hourLabel(readingTime)}. EPA says: “${category[group]}”`;

  // ── Step 7: next safer option.
  let saferOption = levelDef.safer;
  if (saferOption && saferOption.includes('{facility}')) {
    const f = facility
      ? `${facility.name}, ${facility.distanceMi.toFixed(1)} mi`
      : 'a library or community center with filtered air';
    saferOption = fill(saferOption, { facility: f });
  }

  // Helper: level for an hourly entry under this persona.
  const levelOfHour = (h) => {
    const c = categoryFor(h.aqi, guidance);
    return c ? levelFor(c.id, persona, guidance) : null;
  };
  const future = hourly
    .map(h => ({ ...h, dt: hoursBetween(now, h.time) }))
    .filter(h => h.dt !== null && h.dt > 0)
    .sort((a, b) => a.dt - b.dt);

  // ── Step 8: lookahead — does it get worse within the next 3 hours?
  let lookahead = null;
  for (const h of future) {
    if (h.dt > LOOKAHEAD_HOURS) break;
    const l = levelOfHour(h);
    if (l !== null && l > level) {
      lookahead = { time: h.time, level: l };
      decision += fill(guidance.lookahead, { hour: hourLabel(h.time) });
      break;
    }
  }

  // ── Step 9: improve-by — when does it drop back to level ≤ 1?
  let improveBy = null;
  if (level >= 2) {
    improveBy = 'not in the next 24 hours';
    for (const h of future) {
      if (h.dt > IMPROVE_WINDOW_H) break;
      const l = levelOfHour(h);
      if (l !== null && l <= 1) { improveBy = h.time; break; }
    }
  }

  return {
    state: 'ok',
    category: { id: category.id, name: category.name, colour: category.colour, ink: category.ink },
    flag: { colour: category.colour, ink: category.ink, name: category.name },
    aqi, pollutantName, ageH, readingTime, now,
    level, levelName: levelDef.name,
    decision, reason, saferOption, improveBy, lookahead, schoolFlag,
  };
}

export default decide;
