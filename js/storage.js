// storage.js — every localStorage key lives under the "bscv." prefix (spec §10)
// so "Delete all my data" can remove exactly our keys and nothing else.

const PREFIX = 'bscv.';

function safeStorage() {
  try { return window.localStorage; } catch (_) { return null; }
}

export const storage = {
  get(key, fallback = null) {
    const ls = safeStorage();
    if (!ls) return fallback;
    try {
      const raw = ls.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  },
  set(key, value) {
    const ls = safeStorage();
    if (!ls) return false;
    try { ls.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch (_) { return false; }
  },
  remove(key) {
    const ls = safeStorage();
    if (!ls) return;
    try { ls.removeItem(PREFIX + key); } catch (_) { /* ignore */ }
  },
  /** Remove every bscv.* key (Settings → Delete all my data). */
  clearAll() {
    const ls = safeStorage();
    if (!ls) return 0;
    const keys = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach(k => ls.removeItem(k));
    return keys.length;
  },
};

export const defaultSettings = () => ({
  persona: null,          // 'asthma' | 'athlete' | 'general'
  home: null,             // {zip, lat, lon, label, inDistrict} | null
  units: 'us',
  textSize: 'm',
  onboarded: false,
});

export function loadSettings() { return { ...defaultSettings(), ...(storage.get('settings') || {}) }; }
export function saveSettings(s) { storage.set('settings', s); return s; }
