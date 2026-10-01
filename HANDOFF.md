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
- App live at https://steady.brilliantwear.com (GitHub Pages custom domain: Route 53 CNAME `steady` → `jguard22.github.io`, `CNAME` file in this repo, HTTPS enforced; the old github.io URL 301-redirects) (demos: `#/demo/wearer`, `#/demo/family`, `#/demo/clinic`).
- Headless checks: `scripts/shoot.mjs` (all screens, no page errors), `scripts/e2e-demo.mjs` (Steady Check, exercise, possible fall, dizzy log — 11/11), `scripts/e2e-cloud.mjs` against a local `/v1/steady` API (accounts, invites, scopes, clinician time log + program, urgent alert + ack — 14/14).
- Cloud module: cloud_app branch `steady-api` (also has the phone-app sign-in broker in `mobile/web/cloud/app-signin.js`). 363/363 cloud tests, 1321 mobile tests.

Waiting on a person:
- **Deploy the cloud module**: `git -C ~/Documents/GitHub/cloud_app push origin steady-api:jeff-wip` (auto-deploys API + portal; migrations create the Steady tables, OAuth client `steady-web` and the published listing). Until then the app's sign-in fails; demo and on-device modes work.
- Rebuild the phone app (Xcode Run) so it answers `brilliantwear:authorize`.
- First real-insole session in the phone app (rates, pressure orientation, heel/toe y, pitch sign for toe-up).

Next ideas: background capture (Home Station is the stop-gap), push notifications (email only today), relay-based live view for telehealth visits, insole-side step/fall models.

## Verification

`node scripts/shoot.mjs <outdir> "today=#/demo/wearer" …` takes headless
screenshots (system Chrome via playwright-core) and prints page errors.

## Onboarding (2026-10-01)

Real-world test failed: a family member registered on the portal, was told to
verify her email, the link opened a raw JSON page, and the invite was lost.
New flow (Jeff: "minimal steps, clear instructions, as much automation as
possible"):

- Everyone: name + email → 6-digit code (phones autofill it; the email's
  "Open Steady" button signs in by itself) → in. No passwords. Existing
  accounts work too (the code verifies an unverified account).
- Invites: the wearer types a name + email and Steady emails the invite; the
  link pre-fills the invitee's email and name, shows "<Name> invited you", and
  checking the code joins the circle in the same request.
- Wearers who started "on this device" keep their data: it is uploaded on
  first sign-in.
- Today shows a "Getting started" checklist that ticks itself off (name,
  insoles connected, a week of wear, someone invited).
- "I already have a BrilliantWear password" keeps the portal/OAuth path.
- Backend: `/v1/steady/auth/email/{start,verify}`, `/v1/steady/invites/:code/preview`,
  emailed invites, portal verify-email link redirects to the portal (cloud_app
  branch `steady-onboarding`). **Deploy the backend before publishing this
  front end** — otherwise invite links show "expired".

## Log

- 2026-10-01 morning: custom domain steady.brilliantwear.com live; cloud branch updated to trust only that origin (OAuth redirect, CORS, listing URL, email link).

- 2026-10-01 00:00: app + cloud module + phone-app broker built and tested; Pages live; prod deploy push blocked by the auto-mode classifier — left for Jeff.

- 2026-09-30 night: project started (Jeff approved: public repo + Pages under
  jguard22, cloud endpoints to prod, name "Steady").
