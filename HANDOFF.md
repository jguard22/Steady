# Steady — handoff log

Living status file so any engineer or agent can pick the work up mid-stream.
Newest entries at the top of "Log".

## Goal

"Steady by BrilliantWear": the gait & balance everyday-monitoring app from
the original Brilliant Sole fall-prevention concept, rebuilt
as a web app that runs as a layer in the BrilliantWear phone app (alongside
other wearable apps) and standalone in a browser. Three perspectives:

- **Wearer** (older adult): big, calm, plain language. Today's status vs
  their own usual, guided Steady Check, balance exercises with live insole
  feedback, "I'm OK / I need help" after a possible fall.
- **Family / caregiver** (lower-priced Family plan): is Mom OK today, what
  changed this week, alerts, check in.
- **Clinician** (Clinic plan): patient panel sorted by change from baseline,
  full gait/balance detail (the original concept screens), Steady Check
  history with published references, monthly time log + days-with-data for
  remote-monitoring workflows, plan/program settings.

## Rules that are easy to break

- Public repo. Never name or describe the phone app's internal permission
  system (its codename or its message namespaces) here — say "the
  BrilliantWear app" / "Permissions".
- Wellness language: "changes from your usual", never "diagnose", "treat",
  "fall risk", "predict falls". Every measurement surface carries the
  non-clinical note.
- Never take exclusive control of devices: only state sensor rates; never
  connect/disconnect/reset devices; other apps share the insoles.
- No "Co-Authored-By: Claude" trailers in commits.

## Layout

```
index.html               app shell (no build step; ES modules)
src/engine/              pure algorithms (tested): monitor, gait, sway, baseline, checks
src/sense/               device adapter (hub layer / Web Bluetooth / simulator)
src/cloud/               API client + OAuth PKCE + local store
src/data/                demo personas (deterministic synthetic history)
src/ui/                  components & charts
src/views/               wearer / family / clinician screens
docs/API.md              cloud contract (/v1/steady)
test/                    vitest
```

Run: `npm install`, `npm test`, `npm run serve` (http://localhost:5199).

## Status

- [x] Engine: monitor (activity, bouts, gait, sway, rises, unsteady moments,
      possible fall), baseline evaluation, Steady Check runners — tests
- [x] API contract (docs/API.md)
- [x] Cloud module (cloud_app branch `steady-api`, built in a worktree; 363/363 tests) — review + deploy pending
- [x] App shell, theme (light/dark, text size, iOS Dynamic Type), router, demo personas
- [x] Wearer: Today, Move, Steady Check runner, 8 exercises, My data (concept screens), Circle, Live, Home Station, safety overlays
- [x] Family: people, person, alerts
- [x] Clinician: panel, patient tabs (overview, walking, balance, activity, checks, log, month, program)
- [x] Device adapter (phone-app layer + Web Bluetooth) + simulated insoles
- [x] Sign-in: OAuth PKCE standalone + phone-app hand-off message (`brilliantwear:authorize`)
- [ ] Phone app: answer `brilliantwear:authorize` (consent sheet → one-time code)
- [ ] GitHub repo + Pages
- [ ] Real-hardware test (insoles in the phone app)

## Verification

`node scripts/shoot.mjs <outdir> "today=#/demo/wearer" …` takes headless
screenshots (system Chrome via playwright-core) and prints page errors.

## Log

- 2026-09-30 night: project started (Jeff approved: public repo + Pages under
  jguard22, cloud endpoints to prod, name "Steady").
