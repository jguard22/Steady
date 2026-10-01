# Steady cloud API (v1)

Base: `https://api.brilliantwear.com/v1/steady` (in-browser stand-in for the demo: `src/cloud/demo-api.js`).

Steady computes everything it can on the wearer's phone. The cloud stores one
summary per day, Steady Check results, events, and the care circle, and works
out alerts so family and clinicians see the same picture without the
wearer's phone being on.

## Auth

- **User session** (BrilliantWear account JWT), or
- **OAuth 2 access token** (authorization code + PKCE, public client
  `steady-web`) with scopes `CARE_READ` (GET) and `CARE_WRITE` (everything
  else). The token must belong to a user. API keys are refused (403): they
  belong to no person.

### OAuth (PKCE, no client secret)

1. Send the browser to
   `GET https://api.brilliantwear.com/v1/oauth/authorize?response_type=code&client_id=steady-web&redirect_uri=<uri>&scope=CARE_READ%20CARE_WRITE%20PROFILE_READ&state=<random>&code_challenge=<b64url(sha256(verifier))>&code_challenge_method=S256`.
   It hands off to the portal consent screen (sign-in if needed), which
   returns to `<uri>?code=…&state=…` (or `?error=access_denied&state=…`).
   Registered redirect URIs (exact match, trailing slash included):
   `https://steady.brilliantwear.com/`, `http://localhost:5199/`, `http://127.0.0.1:5199/`.
2. `POST https://api.brilliantwear.com/v1/oauth/token` with JSON or
   `application/x-www-form-urlencoded`:
   `{grant_type: "authorization_code", client_id: "steady-web", code, code_verifier, redirect_uri}`
   → `{access_token, token_type: "Bearer", expires_in: 900, refresh_token, scope}`.
   Codes live 10 minutes and are single use.
3. Refresh (rotating; refresh tokens live 30 days):
   `{grant_type: "refresh_token", client_id: "steady-web", refresh_token}`.
4. Sign out: `POST /v1/oauth/revoke` `{token, client_id: "steady-web"}`.

Call the API with `Authorization: Bearer <access_token>`. CORS allows
`https://steady.brilliantwear.com` (credentials on); other origins (e.g. a local dev
server calling production) must be added to the API's `CORS_EXTRA_ORIGINS`.

### Errors

`{error, message}` with 400 (validation), 401 (no/expired token), 403
(missing OAuth scope, missing link scope, wrong link role), 404 (unknown
resource — and every watcher route when there is no active link to that
wearer, so wearer ids can't be probed), 409 (conflict). Creates answer 201,
deletes 204.

Every route answers for the signed-in person. Watcher routes additionally
require an active care link to the wearer, and each link carries **scopes**
the wearer controls.

## Data shapes

`DailySummary` (written by the app, one per local date — see
`src/engine/monitor.js#summarizeDay`):

```json
{
  "date": "2026-09-30", "algo": 1,
  "minutes": {"worn": 612, "walk": 48, "run": 0, "stand": 140, "standLeft": 12, "standRight": 9,
              "sit": 380, "sitLeftRaised": 20, "sitRightRaised": 15, "unloaded": 44},
  "steps": 4312,
  "gait": {"boutCount": 19, "walkSteps": 2900, "longestBoutS": 210, "cadenceSpm": 103.5,
           "strideTimeMs": 1159, "strideTimeCvPct": 2.4, "stancePct": 62, "doubleSupportPct": 24.1,
           "stepAsymPct": 3.2, "stanceAsymPct": 2.1, "loadAsymPct": 4.4, "strideLengthM": 1.14,
           "gaitSpeedMps": 0.98, "stepTimeMs": {"left": 580, "right": 579},
           "toeUpDeg": {"left": 14.1, "right": 13.2}, "rollDeg": {"left": 1.3, "right": -0.8},
           "strikePct": {"heel": 87, "mid": 9, "fore": 3, "toe": 1}, "unsteadyMoments": 1},
  "balance": {"windows": 22, "swayRmsMm": 6.1, "swayMlMm": 3.9, "swayApMm": 4.6, "swayAreaMm2": 310,
              "swayVelMmS": 11.2, "weightLeftPct": 51.5, "toePct": 41},
  "transitions": {"sitToStand": 31, "failedRises": 0, "riseTimeS": 1.5, "riseToWalkPauseS": 2.1},
  "events": {"possibleFalls": 0, "unsteady": 1, "help": 0, "dizzy": 0}
}
```

Any field may be `null` (not enough data that day). The server stores the
JSON as sent (validated for shape and size) and never edits it. Validation:
`date` a real `YYYY-MM-DD` no later than tomorrow (UTC), at most 16 KB of JSON
per day, and the fields the evaluation reads (`minutes.worn/walk`, `steps`,
`gait.cadenceSpm/gaitSpeedMps/strideLengthM/strideTimeCvPct/doubleSupportPct/stepAsymPct`,
`balance.swayRmsMm`, `transitions.riseTimeS`, `events.unsteady`) must be
numbers or `null`. Other fields pass through untouched. A date sent twice in
one batch keeps the last copy; re-sending a date replaces it.

`Evaluation` (computed by the server with the same rules as
`src/engine/baseline.js`): `{asOf, status, metrics[], coverage, notes[]}`
where `status ∈ learning | steady | watch | review | nodata`. `PUT /me/days`
evaluates as of the wearer's local today (profile `timezone`, else UTC) or the
newest uploaded date if later; summaries default to local today.

`Summary` (`GET /me/summary`, `GET /people/:wearerId/summary`):

```json
{
  "link": {"id": "…", "role": "clinician", "scopes": ["status", "…"]},
  "profile": {"userId": "…", "displayName": "Ada", "timezone": "Europe/London", "plan": "HOME",
              "settings": {}, "program": {"checkEveryDays": 14, "sensitivity": "standard", "program": {}, "updatedAt": "…", "updatedBy": "…"},
              "birthYear": 1948, "sex": "female", "age": 78},
  "evaluation": {"asOf": "2026-09-30", "status": "steady", "metrics": [], "coverage": {}, "notes": []},
  "days": [],
  "checks": [],
  "events": [],
  "alerts": [],
  "openAlerts": [],
  "plan": {"tier": "HOME", "checkEveryDays": 14, "sensitivity": "standard", "program": {}, "updatedAt": "…"},
  "nonClinical": "Steady shows everyday measurements and changes from this person's own usual. It does not diagnose, treat or predict falls."
}
```

- `link` only on the watcher route. `profile` for the wearer also has
  `birthYear`, `sex`, `createdAt`, `updatedAt`; for watchers `birthYear`, `sex`
  and `age` appear on clinician links only.
- `days`: the 35 days ending `asOf` (oldest first; missing days absent).
- `checks`: latest 8. `events`: latest 30 (watchers: see scopes).
- `alerts`: every open alert plus the 20 most recent others (omitted without
  the `alerts` scope). `openAlerts`: the open ones plus the computed `noData`
  alert when due (empty without `alerts`).
- `evaluation` is `null` for a watcher without the `status` scope.

`Alert`: `{id, kind, severity, title, detail, status, createdAt, eventId?, ackBy?: {id, name}, ackAt?, ackNote?}`
(optional fields omitted when unset; `ackBy.name` is the name the watcher gave
when joining, else their Steady display name). The computed `noData` alert is
`{id: "noData", kind: "noData", severity: "info", title: "No recent data", detail: {lastSeen, daysSince}, status: "open", computed: true, createdAt}`
and is never stored.

## Wearer (me)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/me` | | `{profile, circle: {members, pending}, openAlerts: Alert[]}` (creates the profile on first call, `displayName: ""`) |
| PUT | `/me/profile` | `{displayName?, birthYear?, sex?, timezone?, settings?}` | `{profile}` |
| PUT | `/me/days` | `{days: DailySummary[]}` (≤ 31) | `{stored, evaluation}` |
| GET | `/me/days` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 400 days) | `{days}` |
| GET | `/me/summary` | `?asOf=YYYY-MM-DD` | `Summary` (above) |
| POST | `/me/checks` | `{takenAt, results, summary, score?}` (≤ 64 KB; `score` defaults to `summary.score`, rounded) | `{check}` |
| GET | `/me/checks` | `?limit=20` | `{checks}` |
| POST | `/me/events` | `{kind, at, detail?, outcome?}` | `{event, alert?}` |
| PATCH | `/me/events/:id` | `{outcome}` | `{event}` |
| GET | `/me/events` | `?from&to` (date or ISO time; default last 90 days, ≤ 500 newest) | `{events}` |
| GET | `/me/alerts` | `?status=open\|acked\|resolved\|all` (default all) | `{alerts}` |
| GET | `/me/circle` | | `{members, invites}` |
| POST | `/me/circle/invites` | `{role: "family" \| "clinician", label?, scopes?}` | `{invite: {id, code, expiresAt, role, scopes, label}}` — code shown once (8 chars, Crockford base32: no I/L/O/U; valid 7 days, single use; ≤ 20 open invites) |
| PATCH | `/me/circle/:linkId` | `{scopes}` | `{link}` |
| DELETE | `/me/circle/:linkId` | | `204` (revokes a member or cancels an invite) |

Event `kind`: `possibleFall`, `help`, `dizzy`, `medChange`, `note`,
`unsteady`, `practice`, `sensation`. `outcome` (possibleFall only, default
`pending`): `pending | ok | needHelp | noResponse`. `detail` ≤ 8 KB.

- `practice` — a balance-exercise session; `detail` must be
  `{exercise, reps?, durationS, score?}` (extra fields allowed). No alert.
- `sensation` — a foot-sensation check result; free-form `detail` ≤ 4 KB. No alert.

`Event`: `{id, kind, at, detail, outcome, authorId, createdAt}` (`authorId`
is set on notes written by a watcher).

## Watchers (family, clinicians)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/circle/accept` | `{code, displayName?}` (case/separators ignored; O→0, I/L→1) | `{link, wearer: {id, displayName}}`; 404 for a wrong, expired or used code; 400 for your own invite; 409 if already in that circle |
| GET | `/people` | | `{people: Person[]}` (below) |
| GET | `/people/:wearerId/summary` | `?asOf` | `Summary`, filtered to the link's scopes, with `link` |
| GET | `/people/:wearerId/days` | `?from&to` | `{days}` (fields outside scope removed) |
| GET | `/people/:wearerId/checks` | | `{checks}` (scope `checks`) |
| GET | `/people/:wearerId/events` | `?from&to` | `{events}` (scope `events`: all kinds; scope `program` without `events`: `practice` + `sensation`, plus `possibleFall`/`help` with `alerts`) |
| GET | `/people/:wearerId/alerts` | `?status` | `{alerts}` (scope `alerts`) |
| POST | `/people/:wearerId/alerts/:alertId/ack` | `{note?}` | `{alert}` (scope `alerts`; the first acknowledgement stands) |
| POST | `/people/:wearerId/notes` | `{text, kind?: "note" \| "medChange"}` | `{event}` (any active link) |
| GET | `/people/:wearerId/time` | `?month=YYYY-MM` (default current UTC month) | `{month, entries, totalMinutes, daysWithData}` (clinician links; the caller's own entries) |
| POST | `/people/:wearerId/time` | `{minutes: 1–120, activity, note?, at?}` | `{entry}` (clinician links) |
| PUT | `/people/:wearerId/plan` | `{checkEveryDays?: 1–365, program?, sensitivity?}` | `{profile}` (clinician links, scope `program`; merged into `profile.program`) |
| DELETE | `/people/:wearerId` | | `204` (leave the circle) |

`Person` (one per active link where you are the watcher):

```json
{"wearerId": "…", "linkId": "…", "displayName": "Ada", "role": "clinician", "scopes": [], "label": "Mum",
 "status": "watch", "lastSeen": "2026-09-30", "openAlerts": 2, "urgent": true,
 "notes": [{"key": "cadence", "level": "watch", "text": "Walking at a slower pace than usual", "detail": "…"}],
 "topChange": {"key": "cadence", "level": "watch", "changePct": -7.9, "ewma": 1.8},
 "today": {"walkMin": 31, "steps": 2810}, "cadenceTrend": [103.5, null, "…35 values, oldest first"],
 "latestCheck": 82, "daysWithData": 18, "minutesLogged": 35, "plan": {"tier": "HOME", "…": "…"},
 "age": 78, "tags": ["post-op"]}
```

`status`, `lastSeen`, `notes`, `topChange` need `status` (`topChange` only
among metrics the link may see; `notes[].detail` is blanked for those it
can't); `openAlerts`/`urgent` need `alerts` (else `0`/`false`); `today` needs
`activity`; `cadenceTrend` needs `gait`; `latestCheck` needs `checks`;
`daysWithData` counts this calendar month's days with `minutes.worn > 0`;
`minutesLogged` is the caller's time-log minutes this month (clinician links,
else 0); `age` and `tags` (`profile.settings.tags`) on clinician links only.

### Scopes on a care link

| Scope | Family default | Clinician default | Grants |
|---|---|---|---|
| `status` | ✓ | ✓ | overall status, last seen, plain-language notes |
| `activity` | ✓ | ✓ | minutes, steps |
| `alerts` | ✓ | ✓ | alerts + acknowledging them |
| `checks` | ✓ | ✓ | Steady Check results |
| `gait` | | ✓ | gait measures |
| `balance` | | ✓ | sway, weight distribution, sit-to-stand |
| `events` | | ✓ | the event log (dizziness, medication changes, notes) |
| `program` | | ✓ | setting check frequency, exercises, alert sensitivity; `practice` and `sensation` events |

What each scope reveals in responses:

- **Days** are allow-listed: always `date`, `algo`; `minutes` + `steps` with
  `activity`; `gait` with `gait`; `balance` + `transitions` with `balance`;
  the day's `events` counts with `events`. Unknown fields are not shown to
  watchers.
- **Evaluation**: `null` without `status`. `metrics[]` keeps only metrics the
  link may see (walkMin/steps → `activity`; gait metrics and unsteady moments
  → `gait`; sway/riseTime → `balance`). Notes stay (plain language) but a
  note's numeric `detail` is blanked for metrics outside scope.
- **Events** in summaries: all with `events`; otherwise `possibleFall`/`help`
  with `alerts` and `practice`/`sensation` with `program`.
- **Status alerts** carry the evaluation's notes in `detail.notes`; those are
  removed for links without `status`.

## Alerts

Created by the server, never by watchers:

| Kind | Severity | When |
|---|---|---|
| `possibleFall` | urgent | event `possibleFall` not answered "I'm OK" (auto-resolves on `ok`) |
| `help` | urgent | event `help`, or a possible fall answered "I need help" |
| `status` | watch / review | the evaluation moves into `watch` or `review` (at most one per 7 days per level) |
| `noData` | info | computed on read: no data for 2+ days |

`possibleFall` / `help` alerts are deduplicated per event: answering
`needHelp` opens a `help` alert and resolves the `possibleFall` one; `ok`
resolves the `possibleFall` alert; a resolved alert reopens (and emails again)
if the outcome later goes back to `pending`/`noResponse`. A `status` alert's
`detail` is `{asOf, status, notes: [{key, level, text}]}`.

Urgent alerts email every active watcher with an `alerts` scope. Emails
contain no health details — just "open Steady": subject
`Steady: <displayName> may need you`, body "Open Steady to see what happened:
https://steady.brilliantwear.com/". An email failure never fails the request.
