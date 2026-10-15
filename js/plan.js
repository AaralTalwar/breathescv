// plan.js — asthma action-plan card (B3). Structure only: the app never supplies
// symptoms, medicines, doses or triggers (spec §7.4). All text is the family's own.
import { storage } from './storage.js';

const ZONES = [
  { id: 'green',  name: 'Green — doing well' },
  { id: 'yellow', name: 'Yellow — getting worse' },
  { id: 'red',    name: 'Red — medical alert' },
];
const FIELDS = [
  { id: 'feel',     label: 'How I feel',                         ph: 'Write how you feel in this zone' },
  { id: 'do',       label: 'What I do',                          ph: 'Write what your plan says to do' },
  { id: 'medicine', label: 'My medicine, as my doctor wrote it', ph: 'Copy exactly what your doctor wrote' },
  { id: 'call',     label: 'Who I call',                         ph: 'Name and phone number' },
];

export function emptyPlan() {
  const p = { updatedAt: null };
  for (const z of ZONES) { p[z.id] = {}; for (const f of FIELDS) p[z.id][f.id] = ''; }
  return p;
}
export function load() { return { ...emptyPlan(), ...(storage.get('plan') || {}) }; }
export function save(plan) { plan.updatedAt = new Date().toISOString(); storage.set('plan', plan); return plan; }
export function clear() { storage.remove('plan'); }

export function mount() {
  const form = document.getElementById('plan-form');
  form.textContent = '';
  const plan = load();
  for (const z of ZONES) {
    const sec = document.createElement('section');
    sec.className = `zone zone-${z.id}`;
    const h = document.createElement('h2'); h.textContent = z.name; sec.append(h);
    for (const f of FIELDS) {
      const wrap = document.createElement('div'); wrap.className = 'field';
      const id = `plan-${z.id}-${f.id}`;
      const label = document.createElement('label'); label.htmlFor = id; label.textContent = f.label;
      const ta = document.createElement('textarea');
      ta.id = id; ta.name = id; ta.placeholder = f.ph; ta.rows = 2;
      ta.value = plan[z.id]?.[f.id] || '';
      ta.dataset.zone = z.id; ta.dataset.field = f.id;
      if (f.id === 'call') ta.setAttribute('autocomplete', 'off');
      wrap.append(label, ta);
      sec.append(wrap);
    }
    form.append(sec);
  }

  let timer = null;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const p = emptyPlan();
      form.querySelectorAll('textarea').forEach(ta => { p[ta.dataset.zone][ta.dataset.field] = ta.value; });
      save(p);
      document.getElementById('plan-saved').textContent = 'Saved on this device.';
    }, 300);
  });
  form.addEventListener('submit', e => e.preventDefault());

  document.getElementById('plan-print').addEventListener('click', () => window.print());
  document.getElementById('plan-clear').addEventListener('click', () => {
    if (confirm('Clear every field of your action plan? This cannot be undone.')) {
      clear();
      form.querySelectorAll('textarea').forEach(ta => { ta.value = ''; });
      document.getElementById('plan-saved').textContent = 'Cleared.';
    }
  });
  const saved = load();
  if (saved.updatedAt) document.getElementById('plan-saved').textContent = `Last saved ${new Date(saved.updatedAt).toLocaleString()}.`;
}
