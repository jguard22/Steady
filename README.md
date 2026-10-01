# Steady by BrilliantWear

**Everyday walking and balance, measured by smart insoles, compared with your
own usual — and shared with the people who look out for you.**

Live: https://jguard22.github.io/Steady/ · Try the demos:
[wearer](https://jguard22.github.io/Steady/#/demo/wearer) ·
[family](https://jguard22.github.io/Steady/#/demo/family) ·
[clinician](https://jguard22.github.io/Steady/#/demo/clinic)

Steady is a web app that runs as one of your apps inside the BrilliantWear
phone app — alongside your other wearable apps, using only the readings you
allow — or in a desktop browser with Web Bluetooth.

## Three perspectives, one picture

| Who | What they get |
|---|---|
| **The wearer** | A calm daily status ("Steady" / "A little different" / "Worth a check-in"), today's walking vs their usual, a 6-minute guided Steady Check, balance practice with live insole coaching, "I feel dizzy" and "I need help" one tap away, and an "Are you OK?" screen after a possible fall. Big type, plain words. |
| **Family & caregivers** | Is Mom OK today? What changed this week, in plain language. Alerts that need them (possible fall with no answer, a help request), "I've checked on her", notes and medicine changes. Only what the wearer chooses to share. |
| **Clinicians** | A triage panel sorted by change from each person's own baseline; the full measurement set (activity & stance time, stride timing, variability, speed and length estimates, double support, asymmetry, quiet-stance sway, weight distribution, point of contact, strike angle, sit-to-stand); Steady Check history with published reference values; dizziness log with insole context; home-program assignment; monthly days-with-data and time logs for remote-monitoring programs. |

## How it works

- **Measured in everyday life, not in a lab.** The insoles stream pressure
  and motion; Steady classifies each second (sitting, standing, walking, legs
  raised…), measures every walk longer than five seconds, quiet-stance sway
  whenever the person stands still, and every rise from a chair.
- **Compared with your own usual.** Each measure is compared with a 28-day
  personal baseline (robust median/MAD). A change has to persist — 3 of the
  last 5 days — before Steady mentions it. One odd day never does.
- **Computed on the phone.** Raw readings stay on the device; only daily
  summaries, checks and events reach the cloud.
- **Shares the wearables.** Steady states the sensor rates it wants and never
  connects, disconnects or reconfigures devices for other apps.

Inventive pieces: dizziness log that records what the insoles saw at that
moment (e.g. "within 6 seconds of standing up"); Rise & Pause — a gentle insole
buzz after standing to pause before walking; unsteady-moment detection (a
broken rhythm followed by a catch step); Talk & Walk dual-task test; haptic
rhythm walking; foot-sensation check using the insoles' vibration motors; Home
Station mode for an always-on screen at home.

## Not a medical device

Steady shows everyday measurements and changes from each person's own usual.
It does not diagnose, treat or predict falls.

## Development

No build step: static ES modules, Lit bundled in `vendor/lit.js`.

```bash
npm install
npm test            # engine, baselines, checks, demo data
npm run serve       # http://localhost:5199
npm run vendor      # rebuild vendor/lit.js
```

- `src/engine/` — signal processing and baselines (pure, tested)
- `src/sense/` — wearable adapter, simulator
- `src/cloud/` — sign-in (OAuth PKCE), API client, on-device and demo back ends
- `src/views/` — wearer, family and clinician screens
- `docs/API.md` — cloud API contract

© BrilliantWear. All rights reserved.
