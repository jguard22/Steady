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

## Status (2026-10-01, ~00:00)

Done and verified:
- Engine + baselines + checks — `npm test` (27 tests).
- App live on GitHub Pages: https://jguard22.github.io/Steady/ (demos: `#/demo/wearer`, `#/demo/family`, `#/demo/clinic`).
- Headless checks: `scripts/shoot.mjs` (all screens, no page errors), `scripts/e2e-demo.mjs` (Steady Check, exercise, possible fall, dizzy log — 11/11), `scripts/e2e-cloud.mjs` against a local `/v1/steady` API (accounts, invites, scopes, clinician time log + program, urgent alert + ack — 14/14).
- Cloud module: cloud_app branch `steady-api` (also has the phone-app sign-in broker in `mobile/web/cloud/app-signin.js`). 363/363 cloud tests, 1321 mobile tests.

Waiting on a person:
- **Deploy the cloud module**: `git -C ~/Documents/GitHub/cloud_app push origin steady-api:jeff-wip` (auto-deploys API + portal; migrations create the Steady tables, OAuth client `steady-web` and the published listing). Until then the app's sign-in fails; demo and on-device modes work.
- Rebuild the phone app (Xcode Run) so it answers `brilliantwear:authorize`.
- First real-insole session in the phone app (rates, pressure orientation, heel/toe y, pitch sign for toe-up).
- Custom domain (e.g. steady.brilliantwear.com): Steady currently shares the `jguard22.github.io` origin (permissions, storage, CORS) with every other Pages project there.

Next ideas: background capture (Home Station is the stop-gap), push notifications (email only today), relay-based live view for telehealth visits, insole-side step/fall models.

## Verification

`node scripts/shoot.mjs <outdir> "today=#/demo/wearer" …` takes headless
screenshots (system Chrome via playwright-core) and prints page errors.

## Log

- 2026-10-01 00:00: app + cloud module + phone-app broker built and tested; Pages live; prod deploy push blocked by the auto-mode classifier — left for Jeff.

- 2026-09-30 night: project started (Jeff approved: public repo + Pages under
  jguard22, cloud endpoints to prod, name "Steady").
