// today.js — renders the flag screen (B1) from a decide() output. No logic here beyond formatting.
import { hourLabel } from './decide.js';

const $ = (id) => document.getElementById(id);

export function ageText(ageH) {
  if (ageH === null || ageH === undefined) return 'no reading';
  const mins = Math.round(ageH * 60);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(ageH);
  return `${h} h ago`;
}

export function render(out, place, personaDef, guidance, nearest) {
  const flag = $('flag');
  flag.style.backgroundColor = out.flag.colour;
  flag.style.color = out.flag.ink;
  flag.classList.toggle('is-stale', out.state === 'stale');

  $('flag-cat').textContent = out.state === 'stale'
    ? (out.category ? `${out.category.name} (stale)` : 'No reading')
    : out.category.name;
  $('flag-aqi').textContent = out.aqi ?? '—';
  $('flag-pollutant').textContent = out.aqi === null ? '—' : `mainly ${out.pollutantName}`;
  $('flag-time').textContent = out.readingTime ? `reading at ${hourLabel(out.readingTime)}` : '';
  $('flag-age').textContent = ageText(out.ageH);

  $('today-place').textContent = place ? (place.label + (place.zip ? ` · ${place.zip}` : '')) : '—';
  $('decision-for').textContent = `For: ${personaDef.label.toLowerCase()}`;
  $('decision-text').textContent = out.decision;

  // Reason: plain sentence + the quoted EPA line, rendered with textContent (no innerHTML with data).
  const reason = $('reason-text');
  reason.textContent = '';
  const idx = out.reason.indexOf('EPA says:');
  if (idx >= 0) {
    reason.append(document.createTextNode(out.reason.slice(0, idx).trim() + ' '));
    const q = document.createElement('span');
    q.className = 'quote';
    q.textContent = out.reason.slice(idx);
    reason.append(q);
  } else {
    reason.textContent = out.reason;
  }

  const safer = $('safer-card');
  if (out.saferOption) { $('safer-text').textContent = out.saferOption; safer.hidden = false; } else { safer.hidden = true; }

  const imp = $('improve-card');
  if (out.improveBy) {
    $('improve-text').textContent = out.improveBy === 'not in the next 24 hours'
      ? 'Not in the next 24 hours — check the forecast tab.'
      : `Around ${hourLabel(out.improveBy)}${sameDay(out.improveBy, out.now) ? '' : ' tomorrow'}, the forecast drops to a level where it is OK to be outside with care.`;
    imp.hidden = false;
  } else { imp.hidden = true; }

  if (out.schoolFlag) {
    const sf = $('school-flag');
    sf.textContent = `${out.schoolFlag.word} (${out.schoolFlag.name})`;
  } else {
    $('school-flag').textContent = 'unknown — no forecast';
  }

  const nc = $('nearest-card');
  if (nearest) {
    $('nearest-text').textContent = `${nearest.name} — ${nearest.distanceMi.toFixed(1)} mi · ${nearest.typeLabel}`;
    nc.hidden = false;
  } else { nc.hidden = true; }
}

function sameDay(a, b) { return a && b && a.slice(0, 10) === b.slice(0, 10); }

export function showError(message, hasCache) {
  const card = document.getElementById('error-card');
  document.getElementById('error-text').textContent = (message || "Couldn't reach the air-quality service.") +
    (hasCache ? ' Showing the last saved reading with its age.' : ' No saved reading yet — the action plan and map still work.');
  card.hidden = false;
}
export function hideError() { document.getElementById('error-card').hidden = true; }
