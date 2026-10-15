// api.js — Open-Meteo air-quality client + geocoding + caching (spec §9, §13).
//
// Contracts:
//   getAirQuality(lat, lon, {force}) → Promise<{current, hourly, daily, fetchedAt, utcOffsetSeconds, place}>
//   geocodeZip(zip)                  → Promise<{lat, lon, label, inDistrict}>
//   parseOpenMeteo(json, fetchedAt)  → the same shape as getAirQuality (pure; used by tests)
//
// Times: Open-Meteo returns LOCAL wall-clock strings ("2026-10-15T07:00") when a
// timezone is requested, plus utc_offset_seconds. We attach the offset so every
// stored time is a full ISO string the engine can subtract safely — including
// across the DST change on Nov 1 (spec §19, "time-zone/DST bugs").

import { dominantPollutant } from './decide.js';
import { storage } from './storage.js';

export const AQ_HOST = 'https://air-quality-api.open-meteo.com';
const AQ_URL = (lat, lon) =>
  `${AQ_HOST}/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
  '&current=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,pm2_5,pm10,ozone' +
  '&hourly=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone' +
  '&timezone=America%2FLos_Angeles&forecast_days=3';

const FETCH_TIMEOUT_MS = 8_000;        // §9.6
const RETRY_DELAY_MS   = 2_000;        // §9.6
const MEMORY_TTL_MS    = 15 * 60_000;  // §9.1: cache 15 min
const BACKOFF_MS       = 15 * 60_000;  // §9.6: 429/5xx → back off 15 min

const memory = new Map();              // key → {at, data}

export function offsetString(seconds) {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

/** "2026-10-15T07:00" + offset → "2026-10-15T07:00:00-07:00". Leaves full ISO strings alone. */
export function localToIso(localTime, utcOffsetSeconds) {
  if (!localTime) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(localTime)) return localTime;
  const base = localTime.length === 16 ? `${localTime}:00` : localTime;
  return `${base}${offsetString(utcOffsetSeconds)}`;
}

function num(v) { return (v === null || v === undefined || Number.isNaN(Number(v))) ? null : Number(v); }

/** Pure parser for an Open-Meteo air-quality response. */
export function parseOpenMeteo(json, fetchedAt = new Date().toISOString()) {
  if (!json || typeof json !== 'object') throw new Error('Empty response');
  if (json.error) throw new Error(json.reason || 'API error');
  const off = Number(json.utc_offset_seconds ?? -25200);
  const cur = json.current || {};
  const components = {
    pm2_5: num(cur.us_aqi_pm2_5),
    pm10:  num(cur.us_aqi_pm10),
    o3:    num(cur.us_aqi_ozone),
    no2:   num(cur.us_aqi_nitrogen_dioxide),
  };
  const current = {
    time: localToIso(cur.time, off),
    local: cur.time || null,
    aqi: num(cur.us_aqi),                   // null → engine goes to the stale/missing state
    components,
    dominant: dominantPollutant(components),
    raw: { pm2_5: num(cur.pm2_5), pm10: num(cur.pm10), ozone: num(cur.ozone) },
  };

  const h = json.hourly || {};
  const times = h.time || [];
  const hourly = times.map((t, i) => ({
    time: localToIso(t, off),
    local: t,
    aqi: num(h.us_aqi?.[i]),
    pm2_5: num(h.us_aqi_pm2_5?.[i]),
    pm10: num(h.us_aqi_pm10?.[i]),
    o3: num(h.us_aqi_ozone?.[i]),
  }));

  // Daily max per local date (the Flag Program sets one flag for the whole day).
  const byDate = new Map();
  for (const e of hourly) {
    if (e.aqi === null) continue;
    const date = e.local.slice(0, 10);
    const d = byDate.get(date) || { date, max: -Infinity, maxHour: null };
    if (e.aqi > d.max) { d.max = e.aqi; d.maxHour = e.local.slice(11, 16); }
    byDate.set(date, d);
  }
  const daily = [...byDate.values()].map(d => ({ ...d, max: Math.round(d.max) }));

  return { current, hourly, daily, fetchedAt, utcOffsetSeconds: off };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJsonWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function cacheKey(lat, lon) { return `${lat.toFixed(3)},${lon.toFixed(3)}`; }

export function readCachedReading() { return storage.get('cache'); }

/**
 * Fetch current + forecast AQ for a point. Resolution order:
 *   1. in-memory cache < 15 min (unless force)
 *   2. network, with one retry after 2 s; 429/5xx also sets a 15-min backoff
 *   3. on failure: throws, but the caller can show storage 'cache' (last good) with its age.
 */
export async function getAirQuality(lat, lon, { force = false, place = null } = {}) {
  const key = cacheKey(lat, lon);
  const m = memory.get(key);
  if (!force && m && Date.now() - m.at < MEMORY_TTL_MS) return m.data;

  const backoffUntil = storage.get('backoff') || 0;
  if (!force && Date.now() < backoffUntil) {
    const err = new Error('Backing off after a server error');
    err.code = 'BACKOFF';
    throw err;
  }

  const url = AQ_URL(lat, lon);
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const json = await fetchJsonWithTimeout(url);
      const data = parseOpenMeteo(json, new Date().toISOString());
      data.place = place;
      data.zip = place?.zip ?? null;
      data.lat = lat; data.lon = lon;
      memory.set(key, { at: Date.now(), data });
      storage.set('cache', data);
      storage.remove('backoff');
      return data;
    } catch (e) {
      lastErr = e;
      if (e.status === 429 || (e.status >= 500 && e.status < 600)) {
        storage.set('backoff', Date.now() + BACKOFF_MS);
      }
      if (attempt === 0) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

// ── Geocoding ──────────────────────────────────────────────────────────
let zipsPromise = null;
export function loadZips() {
  if (!zipsPromise) {
    zipsPromise = fetch('data/zips.json').then(r => r.json()).catch(() => ({}));
  }
  return zipsPromise;
}

export function isValidZip(zip) { return /^\d{5}$/.test(String(zip || '').trim()); }

/** ZIP → {lat, lon, label, inDistrict}. In-district ZIPs resolve offline from data/zips.json. */
export async function geocodeZip(zip) {
  zip = String(zip).trim();
  if (!isValidZip(zip)) throw new Error('Enter a 5-digit ZIP code');
  const zips = await loadZips();
  if (zips[zip]) {
    const z = zips[zip];
    return { zip, lat: z.lat, lon: z.lon, label: z.label, inDistrict: !!z.inDistrict };
  }
  // Fallback 1: Zippopotam (keyless, CORS).
  try {
    const j = await fetchJsonWithTimeout(`https://api.zippopotam.us/us/${zip}`);
    const p = j.places && j.places[0];
    if (p) return { zip, lat: Number(p.latitude), lon: Number(p.longitude), label: `${p['place name']}, ${p['state abbreviation']}`, inDistrict: false };
  } catch (_) { /* try the next geocoder */ }
  // Fallback 2: Open-Meteo geocoding.
  try {
    const j = await fetchJsonWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${zip}&country=US&count=1`);
    const r = j.results && j.results[0];
    if (r) return { zip, lat: r.latitude, lon: r.longitude, label: `${r.name}, ${r.admin1 || 'US'}`, inDistrict: false };
  } catch (_) { /* fall through */ }
  throw new Error("Couldn't find that ZIP");
}

/** One-time device location, only ever called from a user tap (FR-02). */
export function locateOnce() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'My location', zip: null, inDistrict: null }),
      err => reject(new Error(err.code === 1 ? 'Location permission was declined' : "Couldn't get your location")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  });
}
