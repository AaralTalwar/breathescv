// forecast.js — 24 hourly bars + 3-day row (B2). Colours come from guidance.json.
import { categoryFor, levelFor, hourLabel, hoursBetween } from './decide.js';

const $ = (id) => document.getElementById(id);
const MAX_BAR_AQI = 300;

/** First AQI (lower bound) at which this persona's level reaches 2 ("shorten & lighten"). */
export function thresholdAqi(persona, guidance) {
  for (const c of guidance.categories) {
    if (levelFor(c.id, persona, guidance) >= 2) return c.min;
  }
  return null;
}

export function render(data, persona, guidance, now, onPick) {
  const bars = $('forecast-bars');
  bars.textContent = '';
  const personaDef = guidance.personas[persona];
  $('forecast-persona').textContent = personaDef.label.toLowerCase();

  // Next 24 hours from "now" (plus the current hour).
  const upcoming = (data?.hourly || [])
    .map(h => ({ ...h, dt: hoursBetween(now, h.time) }))
    .filter(h => h.dt !== null && h.dt > -1 && h.dt <= 24)
    .slice(0, 25);

  if (!upcoming.length) {
    $('forecast-note').textContent = 'No forecast available yet. Refresh on the Today tab.';
    $('forecast-daily').textContent = '';
    return;
  }

  const curLevel = levelOf(upcoming[0], persona, guidance);
  let improveMarked = false;

  upcoming.forEach((h, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bar';
    btn.setAttribute('role', 'listitem');
    const cat = categoryFor(h.aqi, guidance);
    const pct = h.aqi === null ? 2 : Math.max(3, Math.min(100, (h.aqi / MAX_BAR_AQI) * 100));
    btn.style.height = `${pct}%`;
    btn.style.backgroundColor = cat ? cat.colour : guidance.stale.colour;
    const lvl = levelOf(h, persona, guidance);
    if (i === 0) btn.classList.add('now');
    if (!improveMarked && i > 0 && curLevel !== null && curLevel >= 2 && lvl !== null && lvl <= 1) {
      btn.classList.add('improve'); improveMarked = true;
    }
    const label = `${hourLabel(h.time)}: AQI ${h.aqi ?? 'unknown'}${cat ? `, ${cat.name}` : ''}${lvl !== null ? `, ${guidance.levels[lvl].name}` : ''}`;
    btn.setAttribute('aria-label', label);
    const lbl = document.createElement('span');
    lbl.className = 'lbl' + (i % 6 === 0 ? '' : ' hidden-lbl');
    lbl.textContent = hourLabel(h.time).replace(' ', '');
    btn.append(lbl);
    btn.addEventListener('click', () => {
      $('forecast-detail-text').textContent = label + (lvl !== null ? ` — ${guidance.levels[lvl].decision}` : '');
      onPick && onPick(h);
    });
    bars.append(btn);
  });

  // Persona threshold line.
  const t = thresholdAqi(persona, guidance);
  if (t) {
    const line = document.createElement('div');
    line.className = 'threshold';
    line.style.bottom = `${(t / MAX_BAR_AQI) * 100}%`;
    const s = document.createElement('span');
    s.textContent = `AQI ${t}: decision changes`;
    line.append(s);
    bars.append(line);
  }
  $('forecast-note').textContent = improveMarked
    ? 'The highlighted bar is the first hour the decision improves.'
    : (curLevel !== null && curLevel >= 2 ? 'No improvement in the next 24 hours.' : '');

  // Daily row.
  const daily = $('forecast-daily');
  daily.textContent = '';
  for (const d of (data.daily || []).slice(0, 3)) {
    const cat = categoryFor(d.max, guidance);
    const el = document.createElement('div');
    el.className = 'day';
    if (cat) { el.style.backgroundColor = cat.colour; el.style.color = cat.ink; }
    const dd = document.createElement('div'); dd.className = 'd'; dd.textContent = dayLabel(d.date, now);
    const m = document.createElement('div'); m.className = 'm'; m.textContent = `${d.max}`;
    const c = document.createElement('div'); c.className = 'c'; c.textContent = cat ? `${cat.name} · peak ${d.maxHour ? hourLabel('T' + d.maxHour) : ''}` : '—';
    el.append(dd, m, c);
    daily.append(el);
  }
}

function levelOf(h, persona, guidance) {
  const c = categoryFor(h.aqi, guidance);
  return c ? levelFor(c.id, persona, guidance) : null;
}

function dayLabel(date, now) {
  const today = (now || '').slice(0, 10);
  if (date === today) return 'Today';
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}
