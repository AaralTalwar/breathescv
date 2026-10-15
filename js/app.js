// app.js — bootstrap, tabs, first run, settings, and the one place that wires
// api.js → decide.js → the screens. No decision logic lives here (NFR-08).
import { decide } from './decide.js';
import * as api from './api.js';
import * as today from './today.js';
import * as forecast from './forecast.js';
import * as plan from './plan.js';
import * as nearby from './nearby.js';
import { storage, loadSettings, saveSettings } from './storage.js';

const APP_VERSION = '0.1.0';
const $ = (id) => document.getElementById(id);

const state = {
  guidance: null,
  settings: loadSettings(),
  place: null,        // active location {zip, lat, lon, label, inDistrict}
  data: null,         // last api result (fresh or cached)
  fromCache: false,
  tab: 'today',
  failures: 0,
  fixture: null,      // ?fixture=smoke-day → tests/fixtures/*.json (demo/backup footage)
  fixtureAge: 0,      // ?fixture=…&age=4 → pretend the reading is 4 h old (AC-05 stale demo)
};

/** ISO "now" with the device's current UTC offset (so hourLabel reads local time). */
export function nowIso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const pad = (n) => String(n).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

// ── Views & tabs ───────────────────────────────────────────────────────
const VIEWS = ['onboard', 'today', 'forecast', 'plan', 'nearby', 'settings', 'loading'];
function showView(name) {
  for (const v of VIEWS) { const el = $(`view-${v}`); if (el) el.hidden = v !== name; }
  document.body.dataset.view = name;
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.tab === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  const onboarding = name === 'onboard';
  document.querySelector('.tabs').hidden = onboarding;
  $('persona-chip').hidden = onboarding || !state.settings.persona;
  $('btn-settings').hidden = onboarding;
  if (name === 'forecast') renderForecast();
  if (name === 'nearby' && state.place) nearby.mount(state.place.lat, state.place.lon);
  if (name === 'settings') renderSettings();
  state.tab = name;
  window.scrollTo({ top: 0 });
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.tab)));
$('btn-settings').addEventListener('click', () => showView('settings'));
$('persona-chip').addEventListener('click', () => showView('settings'));
window.addEventListener('popstate', () => { if (state.tab !== 'today' && state.settings.onboarded) showView('today'); });

// ── Persona radios (shared by onboarding and settings) ────────────────
function personaRadios(container, name, selected, onChange) {
  container.textContent = '';
  for (const [id, p] of Object.entries(state.guidance.personas)) {
    const label = document.createElement('label'); label.className = 'persona-opt';
    const input = document.createElement('input'); input.type = 'radio'; input.name = name; input.value = id; input.checked = selected === id;
    const box = document.createElement('div');
    const t = document.createElement('div'); t.className = 't'; t.textContent = p.label;
    const d = document.createElement('div'); d.className = 'd'; d.textContent = p.blurb;
    box.append(t, d); label.append(input, box); container.append(label);
    input.addEventListener('change', () => onChange(id));
  }
}

function setPersona(id) {
  state.settings.persona = id; saveSettings(state.settings);
  $('persona-chip').textContent = state.guidance.personas[id].short;
  $('persona-chip').hidden = false;
  renderToday();            // FR-06: recompute, no network
}

// ── Location ──────────────────────────────────────────────────────────
async function setPlace(place, { save }) {
  state.place = place;
  if (save) { state.settings.home = place; saveSettings(state.settings); }
  await refresh({ force: true });
}

async function handleZipForm(input, msgEl, saveBox) {
  const zip = input.value.trim();
  msgEl.className = 'msg'; msgEl.textContent = '';
  if (!api.isValidZip(zip)) { msgEl.textContent = 'Enter a 5-digit ZIP code.'; input.focus(); return false; }
  msgEl.textContent = 'Looking up…'; msgEl.className = 'msg ok';
  try {
    const place = await api.geocodeZip(zip);
    if (!place.inDistrict) {
      msgEl.textContent = `${place.label} is outside CA-27 — the app still works, but the Nearby map lists district places only.`;
      msgEl.className = 'msg ok';
    } else msgEl.textContent = '';
    await setPlace(place, { save: saveBox ? saveBox.checked : true });
    return true;
  } catch (e) {
    msgEl.className = 'msg'; msgEl.textContent = e.message || "Couldn't find that ZIP";
    input.focus();
    return false;
  }
}

async function handleLocate(msgEl, saveBox) {
  msgEl.className = 'msg ok'; msgEl.textContent = 'Asking for your location…';
  try {
    const place = await api.locateOnce();
    msgEl.textContent = '';
    await setPlace(place, { save: saveBox ? saveBox.checked : false });
    return true;
  } catch (e) {
    msgEl.className = 'msg'; msgEl.textContent = `${e.message}. You can enter a ZIP instead.`;
    return false;
  }
}

// ── Onboarding (B0) ───────────────────────────────────────────────────
function mountOnboarding() {
  const cards = [...document.querySelectorAll('.ob-card')];
  let step = 1;
  const go = (n) => { step = n; cards.forEach(c => { c.hidden = Number(c.dataset.step) !== n; }); cards[n - 1].querySelector('h1,h2')?.focus?.(); };
  document.querySelectorAll('[data-ob-next]').forEach(b => b.addEventListener('click', () => go(step + 1)));
  document.querySelectorAll('[data-ob-back]').forEach(b => b.addEventListener('click', () => go(step - 1)));
  personaRadios($('ob-persona'), 'ob-persona', state.settings.persona, (id) => {
    state.settings.persona = id; saveSettings(state.settings);
    $('ob-persona-next').disabled = false;
  });
  $('ob-persona-next').disabled = !state.settings.persona;
  $('ob-location').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await handleZipForm($('ob-zip'), $('ob-zip-msg'), $('ob-save-home'))) finishOnboarding();
  });
  $('ob-locate').addEventListener('click', async () => {
    if (await handleLocate($('ob-zip-msg'), $('ob-save-home'))) finishOnboarding();
  });
  go(1);
}
function finishOnboarding() {
  state.settings.onboarded = true; saveSettings(state.settings);
  $('persona-chip').textContent = state.guidance.personas[state.settings.persona].short;
  showView('today');
}

// ── Today (B1) ────────────────────────────────────────────────────────
function currentOutput() {
  const d = state.data;
  const now = nowIso();
  const items = nearby.getFacilities();
  const near = state.place ? nearby.nearest(state.place.lat, state.place.lon, items, 1)[0] || null : null;
  const out = decide({
    aqi: d?.current?.aqi ?? null,
    dominant: d?.current?.dominant ?? null,
    readingTime: d?.current?.time ?? null,
    now,
    hourly: d?.hourly || [],
    daily: d?.daily || [],
    persona: state.settings.persona || 'general',
    guidance: state.guidance,
    facility: near,
  });
  return { out, near };
}

function renderToday() {
  if (!state.settings.persona || !state.guidance) return;
  const { out, near } = currentOutput();
  today.render(out, state.place, state.guidance.personas[state.settings.persona], state.guidance, near);
  if (state.tab === 'forecast') renderForecast();
}

function renderForecast() {
  if (!state.guidance) return;
  forecast.render(state.data, state.settings.persona || 'general', state.guidance, nowIso());
}

async function loadFixture(name) {
  const r = await fetch(`tests/fixtures/${name}.json`);
  if (!r.ok) throw new Error('fixture not found');
  return api.parseOpenMeteo(await r.json(), new Date().toISOString());
}

/** Render from cache immediately, then refresh in the background (FR-08). */
async function refresh({ force = false } = {}) {
  if (!state.place) return;
  const btn = $('btn-refresh');
  btn.disabled = true;
  if (!navigator.onLine) { btn.disabled = true; btn.title = 'Offline — refresh when you are back online'; } else { btn.title = ''; }

  try {
    let data;
    if (state.fixture) {
      data = await loadFixture(state.fixture);
      // Make the fixture "current": shift its clock so the reading is the current hour.
      data = rebaseFixture(data);
    } else {
      data = await api.getAirQuality(state.place.lat, state.place.lon, { force, place: state.place });
    }
    state.data = data; state.fromCache = false; state.failures = 0;
    today.hideError();
  } catch (e) {
    state.failures += 1;
    const cached = api.readCachedReading();
    if (cached) { state.data = cached; state.fromCache = true; }
    if (state.failures >= 2 || !cached) today.showError(e.code === 'BACKOFF' ? 'The air-quality service had an error recently; trying again later.' : null, !!cached);
    else toast('Could not refresh — showing the saved reading.');
  } finally {
    btn.disabled = !navigator.onLine;
  }
  renderToday();
}

/** Shift a fixture's timestamps so its "current" hour equals the real current hour (demo backup). */
function rebaseFixture(data) {
  const now = new Date();
  const real = new Date(data.current.time).getTime();
  const target = new Date(now.getTime() - (state.fixtureAge || 0) * 3_600_000); target.setMinutes(0, 0, 0);
  const delta = target.getTime() - real;
  const shift = (iso) => {
    const d = new Date(new Date(iso).getTime() + delta);
    const off = -d.getTimezoneOffset();
    const l = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
    const sign = off < 0 ? '-' : '+'; const abs = Math.abs(off);
    return `${l}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  };
  data.current.time = shift(data.current.time);
  data.hourly = data.hourly.map(h => ({ ...h, time: shift(h.time), local: shift(h.time).slice(0, 16) }));
  const byDate = new Map();
  for (const h of data.hourly) {
    if (h.aqi === null) continue;
    const date = h.local.slice(0, 10);
    const d = byDate.get(date) || { date, max: -Infinity, maxHour: null };
    if (h.aqi > d.max) { d.max = h.aqi; d.maxHour = h.local.slice(11, 16); }
    byDate.set(date, d);
  }
  data.daily = [...byDate.values()];
  return data;
}

$('btn-refresh').addEventListener('click', () => refresh({ force: true }));
$('btn-retry').addEventListener('click', () => { state.failures = 0; refresh({ force: true }); });
$('today-change-place').addEventListener('click', () => { showView('settings'); $('settings-zip').focus(); });
$('nearest-card').addEventListener('click', () => showView('nearby'));
window.addEventListener('online', () => { toast('Back online — refreshing'); refresh({ force: true }); });
window.addEventListener('offline', () => { $('btn-refresh').disabled = true; toast('Offline — showing the saved reading'); });
document.addEventListener('visibilitychange', () => {
  // Morning check: re-open the app → quiet background refresh, never more than every 30 min (§9.1).
  if (document.visibilityState === 'visible' && state.place && !state.fixture) {
    const last = state.data?.fetchedAt ? new Date(state.data.fetchedAt).getTime() : 0;
    if (Date.now() - last > 30 * 60_000) refresh();
    else renderToday();   // age chip updates even without a fetch
  }
});
setInterval(() => { if (state.tab === 'today') renderToday(); }, 60_000);   // keep the age chip honest

// ── Settings (B5) ─────────────────────────────────────────────────────
let settingsMounted = false;
function renderSettings() {
  if (!settingsMounted) {
    settingsMounted = true;
    personaRadios($('settings-persona'), 'settings-persona', state.settings.persona, setPersona);
    $('settings-location').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await handleZipForm($('settings-zip'), $('settings-zip-msg'), null)) { renderHome(); toast('Home location saved'); }
    });
    $('settings-locate').addEventListener('click', async () => {
      if (await handleLocate($('settings-zip-msg'), null)) { renderHome(); }
    });
    document.querySelectorAll('[data-textsize]').forEach(b => b.addEventListener('click', () => {
      state.settings.textSize = b.dataset.textsize; saveSettings(state.settings); applyTextSize();
    }));
    $('btn-delete-all').addEventListener('click', () => {
      if (confirm('Delete your saved location, action plan, symptom log and cached readings from this device?')) {
        const n = storage.clearAll();
        toast(`Deleted ${n} item${n === 1 ? '' : 's'}. Restarting…`);
        setTimeout(() => location.reload(), 900);
      }
    });
    renderThresholdTable();
    $('about-version').textContent = `BreatheSCV v${APP_VERSION} · built for the 2026 Congressional App Challenge, CA-27.`;
  } else {
    $('settings-persona').querySelectorAll('input').forEach(i => { i.checked = i.value === state.settings.persona; });
  }
  renderHome();
}
function renderHome() {
  const h = state.settings.home;
  $('settings-home').textContent = h ? `${h.label}${h.zip ? ` · ${h.zip}` : ''} (saved on this device)` : (state.place ? `${state.place.label} (this session only — not saved)` : 'Not saved');
}
function renderThresholdTable() {
  const t = $('threshold-table');
  t.textContent = '';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of ['AQI', 'Category', 'Students with asthma', 'All students']) { const th = document.createElement('th'); th.textContent = h; hr.append(th); }
  thead.append(hr); t.append(thead);
  const tb = document.createElement('tbody');
  for (const c of state.guidance.categories) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.textContent = c.max >= 999 ? `${c.min}+` : `${c.min}–${c.max}`;
    const td2 = document.createElement('td'); const sw = document.createElement('span'); sw.className = 'sw'; sw.style.backgroundColor = c.colour; td2.append(sw, document.createTextNode(c.name));
    const td3 = document.createElement('td'); td3.textContent = c.sensitive;
    const td4 = document.createElement('td'); td4.textContent = c.all;
    tr.append(td1, td2, td3, td4); tb.append(tr);
  }
  t.append(tb);
  const src = state.guidance.source;
  $('guidance-link').href = src.url;
  $('guidance-verbatim-note').textContent = src.verbatim
    ? `EPA wording copied verbatim from ${src.documentNumber}, retrieved ${src.retrieved}.`
    : `Guidance wording is a close paraphrase of ${src.documentNumber}; verbatim text pending verification.`;
}
function applyTextSize() { document.documentElement.dataset.textsize = state.settings.textSize || 'm'; }

// ── Boot ──────────────────────────────────────────────────────────────
async function boot() {
  const params = new URLSearchParams(location.search);
  state.fixture = params.get('fixture');
  state.fixtureAge = Number(params.get('age') || 0);
  applyTextSize();

  state.guidance = await fetch('data/guidance.json').then(r => r.json());
  document.querySelectorAll('[data-disclaimer]').forEach(p => { p.textContent = state.guidance.disclaimer; });
  plan.mount();
  nearby.loadFacilities(params.get('facilities') === 'dev' ? 'data/facilities.dev.json' : 'data/facilities.json').then(() => renderToday());

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is progressive */ });
  }

  if (params.get('reset') === '1') storage.clearAll();
  state.settings = loadSettings();

  if (!state.settings.onboarded || !state.settings.persona) {
    mountOnboarding();
    showView('onboard');
    return;
  }

  $('persona-chip').textContent = state.guidance.personas[state.settings.persona].short;
  state.place = state.settings.home;
  const cached = api.readCachedReading();
  const samePlace = cached && state.place && Math.abs(cached.lat - state.place.lat) < 0.002 && Math.abs(cached.lon - state.place.lon) < 0.002;
  if (samePlace) { state.data = cached; state.fromCache = true; }
  showView('today');
  renderToday();                       // instant from cache (FR-08)
  if (state.place) refresh();          // then background refresh
  else { mountOnboarding(); showView('onboard'); }
}

boot().catch(err => {
  $('view-loading').textContent = `Something went wrong while starting: ${err.message}`;
  showView('loading');
});
