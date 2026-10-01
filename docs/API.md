# Steady cloud API (v1)

Base: `https://api.brilliantwear.com/v1/steady` (local mock: see `src/cloud/mock.js`).

Steady computes everything it can on the wearer's phone. The cloud stores one
summary per day, Steady Check results, events, and the care circle, and works
out alerts so family and clinicians see the same picture without the
wearer's phone being on.

## Auth

- **User session** (BrilliantWear account JWT), or
- **OAuth 2 access token** (authorization code + PKCE, public client
  `steady-web`) with scopes `CARE_READ` (GET) and `CARE_WRITE` (everything
  else). The token must belong to a user.

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
JSON as sent (validated for shape and size) and never edits it.

`Evaluation` (computed by the server with the same rules as
`src/engine/baseline.js`): `{asOf, status, metrics[], coverage, notes[]}`
where `status ∈ learning | steady | watch | review | nodata`.

## Wearer (me)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/me` | | `{profile, circle: {members, pending}, openAlerts}` (creates the profile on first call) |
| PUT | `/me/profile` | `{displayName?, birthYear?, sex?, timezone?, settings?}` | `{profile}` |
| PUT | `/me/days` | `{days: DailySummary[]}` (≤ 31) | `{stored, evaluation}` |
| GET | `/me/days` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 400 days) | `{days}` |
| GET | `/me/summary` | `?asOf=YYYY-MM-DD` | `{evaluation, days (last 35), checks (last 5), openAlerts, plan}` |
| POST | `/me/checks` | `{takenAt, results, summary}` | `{check}` |
| GET | `/me/checks` | `?limit=20` | `{checks}` |
| POST | `/me/events` | `{kind, at, detail?, outcome?}` | `{event, alert?}` |
| PATCH | `/me/events/:id` | `{outcome}` | `{event}` |
| GET | `/me/events` | `?from&to` | `{events}` |
| GET | `/me/alerts` | `?status=open` | `{alerts}` |
| GET | `/me/circle` | | `{members, invites}` |
| POST | `/me/circle/invites` | `{role: "family" \| "clinician", label?, scopes?}` | `{invite: {id, code, expiresAt, role, scopes}}` — code shown once |
| PATCH | `/me/circle/:linkId` | `{scopes}` | `{link}` |
| DELETE | `/me/circle/:linkId` | | `204` (revokes a member or cancels an invite) |

Event `kind`: `possibleFall`, `help`, `dizzy`, `medChange`, `note`,
`unsteady`. `outcome` (possibleFall only): `pending | ok | needHelp | noResponse`.

## Watchers (family, clinicians)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/circle/accept` | `{code, displayName?}` | `{link, wearer: {id, displayName}}` |
| GET | `/people` | | `{people: [{wearerId, displayName, role, scopes, status, lastSeen, openAlerts, today, plan, age?}]}` |
| GET | `/people/:wearerId/summary` | `?asOf` | as `/me/summary`, filtered to the link's scopes |
| GET | `/people/:wearerId/days` | `?from&to` | `{days}` (fields outside scope removed) |
| GET | `/people/:wearerId/checks` | | `{checks}` (scope `checks`) |
| GET | `/people/:wearerId/events` | | `{events}` (scope `events`) |
| GET | `/people/:wearerId/alerts` | `?status` | `{alerts}` (scope `alerts`) |
| POST | `/people/:wearerId/alerts/:alertId/ack` | `{note?}` | `{alert}` |
| POST | `/people/:wearerId/notes` | `{text, kind?: "note" \| "medChange"}` | `{event}` |
| GET | `/people/:wearerId/time` | `?month=YYYY-MM` | `{entries, totalMinutes, daysWithData}` (clinician links) |
| POST | `/people/:wearerId/time` | `{minutes, activity, note?, at?}` | `{entry}` (clinician links) |
| PUT | `/people/:wearerId/plan` | `{checkEveryDays?, program?, sensitivity?}` | `{profile}` (clinician links, scope `program`) |
| DELETE | `/people/:wearerId` | | `204` (leave the circle) |

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
| `program` | | ✓ | setting check frequency, exercises, alert sensitivity |

## Alerts

Created by the server, never by watchers:

| Kind | Severity | When |
|---|---|---|
| `possibleFall` | urgent | event `possibleFall` not answered "I'm OK" (auto-resolves on `ok`) |
| `help` | urgent | event `help`, or a possible fall answered "I need help" |
| `status` | watch / review | the evaluation moves into `watch` or `review` (at most one per 7 days per level) |
| `noData` | info | computed on read: no data for 2+ days |

Urgent alerts email every active watcher with an `alerts` scope. Emails
contain no health details — just "open Steady".
