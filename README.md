# BreatheSCV

**Is it OK to be active outside right now?** One flag, one decision, the reason, and the next safer option — using the EPA Air Quality Flag Program rules schools follow, for the air where you actually are in California's 27th Congressional District (Santa Clarita Valley and the Antelope Valley).

Live app: [_(GitHub Pages link goes here)_](https://aaraltalwar.github.io/breathescv/) · 2026 Congressional App Challenge, CA-27.

## What the flag means and where the rules come from
- The flag colour is the US Air Quality Index category (EPA): Green 0–50 · Yellow 51–100 · Orange 101–150 · Red 151–200 · Purple 201–300 · Maroon 301+. The category name and AQI number are always shown as text, never colour alone.
- The decision follows EPA's *Air Quality and Outdoor Activity Guidance for Schools* (EPA-456/F-14-003, the Air Quality Flag Program chart): https://www.airnow.gov/air-quality-flag-program/
- The rules live in `data/guidance.json`, not in code. `js/decide.js` is a pure function that turns (AQI, pollutant, reading age, persona, forecast) into a decision; `tests/decide.test.js` checks every row of the level table and every boundary.
- **A reading more than 3 hours old never produces a Green decision.** The flag goes grey and says "check again".

## The three personas
| Persona | EPA column | Notes |
|---|---|---|
| Student with asthma | Sensitive students | tightens at Orange |
| Student athlete | All students, "longer / more intense" | Orange already means shorter + more breaks |
| Everyone else | All students, as written | |

## Data sources and their limits
- **Open-Meteo Air Quality API** (CC BY 4.0, based on CAMS and other model data) — current and 3-day hourly US AQI with per-pollutant indices. These are **model estimates**, not EPA monitor readings; the app says so and links to airnow.gov. Version 2 adds official AirNow readings through a small relay.
- **ZIP → location**: `data/zips.json` (CA-27 centroids, offline) with Zippopotam / Open-Meteo geocoding as fallbacks for other ZIPs.
- **Map**: Leaflet 1.9.4 (BSD-2, self-hosted in `vendor/`) + OpenStreetMap tiles (ODbL).
- **Facilities**: `data/facilities.csv` → `tools/build_facilities.py` → `data/facilities.json`. Only rows with a `verified_on` date ship (`--include-unverified` builds a dev file for testing the map).

## Privacy
No accounts, no analytics, no third-party scripts. ZIP/location is stored on the device only if you tap *Save*. The action plan and symptom log never leave the device. Settings → *Delete all my data* removes every `bscv.*` key.

## Run it
```
python3 -m http.server 8080      # then open http://localhost:8080
npm test                         # node --test (decide, api, nearby)
npm run facilities               # rebuild data/facilities.json from the CSV
```
Demo/backup modes (query string): `?fixture=smoke-day` (also `good-day`, `ozone-afternoon`, `missing-data`), `&age=4` to show the stale state, `&facilities=dev` to use the unverified facility list, `?reset=1` to clear the device.

## Project layout
```
index.html  manifest.json  sw.js
css/app.css
js/app.js      bootstrap, tabs, first run, settings
js/api.js      Open-Meteo client, cache, retry/backoff, geocoding
js/decide.js   the decision engine (pure, tested)
js/today.js  js/forecast.js  js/plan.js  js/nearby.js  js/storage.js
data/guidance.json  zips.json  facilities.csv  facilities.json
tools/build_facilities.py
tests/*.test.js  tests/fixtures/
```

## Authorship
_(Student: list here what you wrote, what was scaffolded with help, and what you can explain unaided — the decision engine, the API client and the Python script are yours.)_

## Review
_(Clinician / school-nurse copy review credit goes here.)_

## Licence
MIT. EPA guidance text is public domain. Open-Meteo data CC BY 4.0; OpenStreetMap data ODbL; Leaflet BSD-2; Nunito font OFL 1.1.
