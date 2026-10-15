// nearby.js — Leaflet map + nearest-three list (B4). Haversine is pure and tested.

export const TYPE_LABELS = {
  library: 'Library',
  community_center: 'Community center',
  senior_center: 'Senior center',
  cooling_center: 'Cooling center',
  indoor_rec: 'Indoor recreation',
};

const EARTH_RADIUS_MI = 3958.7613;

/** Great-circle distance in miles between two lat/lon points. */
export function haversineMi(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

/** The n nearest facilities, each with distanceMi and typeLabel. */
export function nearest(lat, lon, items, n = 3, types = null) {
  return (items || [])
    .filter(f => typeof f.lat === 'number' && typeof f.lon === 'number')
    .filter(f => !types || types.length === 0 || types.includes(f.type))
    .map(f => ({ ...f, distanceMi: haversineMi(lat, lon, f.lat, f.lon), typeLabel: TYPE_LABELS[f.type] || f.type }))
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, n);
}

/** Directions URL that opens the device's maps app (FR-13). */
export function directionsUrl(f) {
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent || '');
  const q = encodeURIComponent(`${f.lat},${f.lon}`);
  return isApple
    ? `https://maps.apple.com/?daddr=${q}&q=${encodeURIComponent(f.name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

let map = null, markerLayer = null, meMarker = null;
let items = [];
let activeTypes = new Set();

export async function loadFacilities(path = 'data/facilities.json') {
  try {
    const r = await fetch(path);
    const j = await r.json();
    items = j.items || [];
  } catch (_) { items = []; }
  return items;
}
export function getFacilities() { return items; }

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

function pinIcon(type) {
  return window.L.divIcon({ className: '', html: `<div class="marker-pin ${type}"></div>`, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
}

export function mount(lat, lon) {
  const note = document.getElementById('map-note');
  if (!window.L) {
    note.textContent = 'Map library did not load — the list below still works.';
    return renderList(lat, lon);
  }
  if (!map) {
    map = window.L.map('map', { zoomControl: true, attributionControl: true });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    markerLayer = window.L.layerGroup().addTo(map);
    renderFilters(lat, lon);
  }
  map.setView([lat, lon], 11);
  setTimeout(() => map.invalidateSize(), 50);

  if (meMarker) meMarker.remove();
  meMarker = window.L.marker([lat, lon], { icon: window.L.divIcon({ className: '', html: '<div class="marker-pin me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), keyboard: false })
    .addTo(map).bindPopup('You are here');

  note.textContent = navigator.onLine ? '' : 'Map needs internet for tiles; the list still works offline.';
  renderMarkers();
  renderList(lat, lon);
}

function renderFilters(lat, lon) {
  const box = document.getElementById('nearby-filters');
  box.textContent = '';
  const present = [...new Set(items.map(f => f.type))];
  for (const t of present) {
    const b = el('button', 'chip', TYPE_LABELS[t] || t);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      if (activeTypes.has(t)) activeTypes.delete(t); else activeTypes.add(t);
      b.setAttribute('aria-pressed', String(activeTypes.has(t)));
      renderMarkers();
      renderList(lat, lon);
    });
    box.append(b);
  }
}

function visible() { return activeTypes.size ? items.filter(f => activeTypes.has(f.type)) : items; }

function renderMarkers() {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  for (const f of visible()) {
    const m = window.L.marker([f.lat, f.lon], { icon: pinIcon(f.type), alt: f.name });
    const p = document.createElement('div');
    p.append(el('strong', '', f.name), document.createElement('br'), el('span', '', `${TYPE_LABELS[f.type] || f.type} · ${f.address}, ${f.city}`), document.createElement('br'), el('span', '', f.hoursNote || ''));
    m.bindPopup(p);
    markerLayer.addLayer(m);
  }
}

export function renderList(lat, lon) {
  const list = document.getElementById('nearby-list');
  list.textContent = '';
  const near = nearest(lat, lon, visible(), 3);
  if (!near.length) {
    const li = el('li', '', '');
    li.append(el('div', 'n', items.length ? 'No places match this filter.' : 'No verified places yet.'));
    li.append(el('div', 'meta', items.length ? '' : 'Add rows to data/facilities.csv and run tools/build_facilities.py.'));
    list.append(li);
    return;
  }
  for (const f of near) {
    const li = document.createElement('li');
    li.append(el('div', 'n', `${f.name} — ${f.distanceMi.toFixed(1)} mi`));
    li.append(el('div', 'meta', `${f.typeLabel} · ${f.address}, ${f.city} ${f.zip || ''}`));
    if (f.hoursNote) li.append(el('div', 'meta', f.hoursNote));
    if (f.verified === false) li.append(el('div', 'unverified', 'Not yet verified'));
    const row = el('div', 'row');
    const a = el('a', 'btn btn-secondary', 'Directions');
    a.href = directionsUrl(f); a.target = '_blank'; a.rel = 'noopener';
    row.append(a);
    if (f.sourceUrl) { const s = el('a', 'btn btn-ghost', 'Official page'); s.href = f.sourceUrl; s.target = '_blank'; s.rel = 'noopener'; row.append(s); }
    li.append(row);
    list.append(li);
  }
}
