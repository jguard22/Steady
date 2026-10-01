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

### Email code sign-in (no password, no redirect)

The quickest way in for wearers, family and clinicians. No auth on these
routes. Tokens are the same `steady-web` OAuth tokens as above, so refresh
(`/v1/oauth/token`, `grant_type=refresh_token`) and `/v1/oauth/revoke` work
unchanged.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/email/start` | `{email, invite?}` | `200 {sent: true, invite: {wearerName, role} \| null}` |
| POST | `/auth/email/verify` | `{email, code, invite?, displayName?}` | `200 {access_token, refresh_token, token_type: "Bearer", expires_in, scope, user: {id, email, displayName}, isNew, joined: {wearerId, displayName, role} \| null, inviteError?}` |

`start`
- Always `200 {sent: true, …}` for a well-formed email — it never says whether
  an account exists. `invite` is the preview (`wearerName` = first name only,
  `null` if the wearer has none) when `invite` is a pending, unexpired code;
  otherwise `null`.
- Emails a 6-digit code (subject `Your Steady code: 123456`, so phones can
  autofill it) with an **Open Steady** button to
  `https://steady.brilliantwear.com/#/code?e=<email>&c=<code>[&i=<invite>]`
  (fragment: the code never reaches a server log). With an invite the email is
  headed "Join <WearerFirst>'s Steady circle".
- Codes live 15 minutes; asking again invalidates the previous code.
- Limits → `429 {error: "TOO_MANY_REQUESTS", message}` (message is
  person-friendly, show it as is): 30 s between codes for one address, ≤ 5
  codes per address per hour, ≤ 20 per IP per hour.

`verify`
- Wrong code → `400 {error: "invalid_code", message: "That code didn't work. Check it or send a new one."}`.
  After 5 wrong tries the code is burned.
- Expired, burned or already used → `400 {error: "code_expired", message: "That code has expired. Send a new one."}`.
- Accounts with two-step sign-in (MFA) → `403 {error: "use_password", message: "Your account uses two-step sign-in. Use 'Sign in with BrilliantWear' instead."}` — fall back to the OAuth flow above.
- `503` if the `steady-web` client isn't configured on the server.
- No account yet → one is created (verified; `isNew: true`) with no usable
  password — "forgot password" on the portal sets one. An existing unverified
  account is marked verified (the code proves the mailbox).
- `displayName` sets `profile.displayName` only when it is still empty.
- `invite` (or the one given to `start`) is accepted for the person
  (`watcherName` = `displayName`). Invite problems never fail sign-in:
  `joined: null` plus `inviteError` (e.g. "That invite has expired or was
  already used. Ask for a new one.", "That's your own invite — share it with
  someone else.", "You're already in this person's circle.").

### Sign-in options

`GET /auth/options` (no auth, cacheable 5 min) →
`{email: true, sms: boolean, voice: boolean, texts: boolean}`. Offer
"Text me a code" (and "Call me with a code") only when `sms` / `voice` are
true; `texts` says whether alert and invite texts are switched on. Everything
text-related is off until the server's Twilio keys are configured (below).

### Text-message code sign-in (Twilio Verify)

Same tokens and response shape as email codes. No auth on these routes.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/phone/start` | `{phone, invite?, channel?: "sms" \| "call"}` | `200 {sent: true, invite: {wearerName, role} \| null}` |
| POST | `/auth/phone/verify` | `{phone, code, invite?, displayName?}` | `200 {access_token, refresh_token, token_type: "Bearer", expires_in, scope, user: {id, phone, displayName, email?}, isNew, joined, inviteError?}` |

- `phone` as typed: `(555) 234-5678`, `555-234-5678`, `+1 555 234 5678`. US and
  Canada only (`SMS_ALLOWED_PREFIXES`, default `+1`); a number without `+` is
  read as US/Canadian. Anything else → `400 {error: "invalid_phone", message:
  "Enter a US or Canadian mobile number, like (555) 123-4567."}` (no text sent).
- Codes are made, sent and expired by Twilio (6 digits, 10 minutes, 5 tries
  per code). `channel: "call"` reads the code out in a voice call.
- Not configured → `404 {error: "sms_unavailable"}` (fall back to email).
- `start` always answers `200 {sent: true, …}` — it never says whether the
  number has an account. Limits → `429` with a person-friendly `message`:
  30 s between codes to one number, ≤ 3 per number per 10 minutes, ≤ 8 per
  number per day (sign-in and linking together), ≤ 10 per IP per hour, a
  service-wide daily cap (`SMS_DAILY_CAP`, default 300). Twilio refusing the
  number → `400 invalid_phone`; Twilio throttling → `429`; Twilio down →
  `503 {error: "sms_failed"}`.
- `verify`: wrong, expired or used code → `400 {error: "invalid_code",
  message: "That code didn't work. Check it or send a new one."}`. ≤ 15 wrong
  codes per number per day, then `429` (no checks and no new codes) until the
  day passes. MFA accounts → `403 use_password`; accounts pending deletion →
  `409`; `503` if the `steady-web` client is missing.
- A new number creates an account (`isNew: true`) with no email: `user.email`
  is omitted (the server holds an undeliverable placeholder address). A number
  linked to an email account (`/me/phone`) signs in to that account and
  `user.email` is included. `user.phone` is always masked: `+1••••••4567`.
- `invite` / `displayName` behave exactly as for email codes.

### Invite preview

`GET /invites/:code/preview` (no auth; ≤ 30 per IP per hour) →
`200 {wearerName, role, expiresAt}` for a pending, unexpired invite
(`wearerName`: first name only, or `null`); otherwise `404`.

Call the API with `Authorization: Bearer <access_token>`. CORS allows
`https://steady.brilliantwear.com` (credentials on); other origins (e.g. a local dev
server calling production) must be added to the API's `CORS_EXTRA_ORIGINS`.

### Errors

`{error, message}` with 400 (validation), 401 (no/expired token), 403
(missing OAuth scope, missing link scope, wrong link role), 404 (unknown
resource — and every watcher route when there is no active link to that
wearer, so wearer ids can't be probed), 409 (conflict), 429 (rate limited;
`message` is safe to show). Creates answer 201,
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
| GET | `/me` | | `{profile, circle: {members, pending}, openAlerts: Alert[], phone: PhoneSummary \| null}` (creates the profile on first call, `displayName: ""`) |
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
| POST | `/me/circle/invites` | `{role: "family" \| "clinician", label?, name?, email?, phone?, scopes?}` | `{invite: {id, code, expiresAt, role, scopes, label}, emailed, texted}` — code shown once (8 chars, Crockford base32: no I/L/O/U; valid 7 days, single use; ≤ 20 open invites). `name` (≤ 80) is stored as the label when no `label` is given. With `email` the server emails the invite (see below); `emailed` is `false` when no email was given or sending failed. With `phone` (and texts switched on) the server texts it (see below); `texted` is `false` otherwise; an invalid `phone` → `400 invalid_phone` and no invite. ≤ 10 emailed or texted invites per wearer per day together (`429`). |
| PATCH | `/me/circle/:linkId` | `{scopes}` | `{link}` |
| GET | `/me/phone` | | `PhoneSummary` or `{phone: null}` |
| POST | `/me/phone/start` | `{phone, channel?: "sms" \| "call"}` | `{sent: true}` — texts a code to add or replace your mobile number (same limits as `/auth/phone/start`) |
| POST | `/me/phone/verify` | `{phone, code}` | `{phone: PhoneSummary}`; `409 {error: "phone_in_use", message: "That number is already used by another Steady account."}`; `400 invalid_code` |
| PATCH | `/me/phone` | `{smsAlerts?, marketingOptIn?, consentText?}` | `PhoneSummary`. `marketingOptIn: true` requires `consentText` — the exact checkbox wording shown (≤ 500 chars); stored with the time. `false` records the opt-out time. |
| DELETE | `/me/phone` | | `204`; `409 {error: "only_sign_in"}` when the number is the account's only way to sign in (a phone-only account) |
| DELETE | `/me/circle/:linkId` | | `204` (revokes a member or cancels an invite) |

**Emailed invites.** Subject "<WearerFirst> invited you to their Steady
circle" ("Someone you know …" when the wearer has no display name). One line
on what Steady is, what a family member or clinician will see, a **Join
<WearerFirst>'s circle** button to
`https://steady.brilliantwear.com/#/join?code=<CODE>&e=<email>&n=<name>` (`n`
only when a name was given; all URL-encoded), "No password needed — you'll
get a 6-digit code by email.", and the code as a fallback. No health details.
The app's `#/join` screen should call `/auth/email/start` with `{email, invite: code}`.

**Texted invites.** When `phone` is sent and texts are on: "<WearerFirst>
invited you to their Steady circle:
https://steady.brilliantwear.com/#/join?code=<CODE>&n=<name>" then "No password
needed. Reply STOP to stop texts." (`n` only for a plain name; the link never
carries the number). ≤ 3 invite texts per number per day from all wearers,
≤ 30 per IP per day. The app's `#/join` screen without `e` should offer
"Text me a code" (`/auth/phone/start` with `{phone, invite: code}`) when
`/auth/options` says `sms: true`.

`PhoneSummary`: `{phone: "+1••••••4567", smsAlerts: boolean, marketingOptIn:
boolean, textsAvailable: boolean}` — the number is always masked;
`textsAvailable` is whether the server can send alert texts right now. The
full number is only in the person's GDPR export (with the marketing consent
history). No marketing texts are sent; consent is only recorded.

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

When texts are on, urgent alerts also text every such watcher who has a
verified number with `smsAlerts: true`: "Steady: <WearerFirst> may need you.
Open Steady: https://steady.brilliantwear.com/ — Reply STOP to stop texts."
(≤ 10 alert texts per watcher per day; a failed text never fails the request).

## Server configuration (texts)

All optional; each feature stays off until its keys are set:

| Key | Enables |
|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | needed for anything Twilio (API key auth) |
| `TWILIO_VERIFY_SERVICE_SID` | text / voice sign-in codes (`sms`, `voice` in `/auth/options`) |
| `TWILIO_MESSAGING_SERVICE_SID` | alert and invite texts (`texts`); may stay unset until carrier registration completes |
| `SMS_DAILY_CAP` | code sends per rolling day, whole service (default 300) |
| `SMS_ALLOWED_PREFIXES` | comma-separated country prefixes (default `+1`) |
