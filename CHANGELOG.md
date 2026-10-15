# Changelog — one line a day on the hardest problem (feeds the "difficulty" short answer)

## 2026-10-15
- Scaffolded the full P0 vertical slice: decision engine with 34 tests, Open-Meteo client, first-run cards, Today/Forecast/My plan/Nearby/Settings, service worker, facilities validator.
- Hardest problem: Open-Meteo returns *local* wall-clock times with no offset. Subtracting them from `Date.now()` gave wrong ages, and would break by an hour on Nov 1 (DST). Fix: `api.js` attaches `utc_offset_seconds` to every timestamp so the engine only ever compares absolute instants (`tests/api.test.js` has the DST case).
