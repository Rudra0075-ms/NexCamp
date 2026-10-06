# NeX Camp API

Backend for **NeX Camp** —
*"Attendance, Mess, Hostel, Repeat: Campus Life, Debugged."*

The frontend in `../frontend` is the source of truth for what this API serves. Its
ten surfaces were read first; every model, endpoint and service here exists because
some part of that interface needs it. Nothing about the interface was redesigned.

## What this is, honestly

This backend can use a real language model, and it says so when it did.
`services/aiService.js` is the AI layer; set `AI_PROVIDER`, `AI_API_KEY` and
`AI_MODEL` and it calls Anthropic or any OpenAI-compatible endpoint. Leave them
empty and every AI surface falls back to the deterministic services below, and
reports `source: "AI_NOT_CONFIGURED"` rather than pretending otherwise. See
**AI layer** in the API section for the full contract.

Everything in the table that follows is **not** a model and never was. These are
deterministic rules over the database, they are what the AI layer falls back to,
and several of them — safety escalation, anomaly thresholds, the audit chain —
are deliberately kept away from a model even when one is configured. Every
response that carries an inference carries a `method` field naming the
technique, and most carry a `disclaimer`:

| Field value | What actually runs |
| --- | --- |
| `RULE_BASED_KEYWORD_MATCH` | Keyword lists per category, plus Jaccard overlap on content words |
| `DETERMINISTIC_KEYWORD_AND_LOCATION_MATCH` | Single-link clustering on building + category + time + wording |
| `WEIGHTED_DETERMINISTIC_SIMILARITY` | Weighted sum of same-building, same-category, keyword overlap, recency |
| `RULE_BASED_THRESHOLD` | Fixed thresholds over a metric series, plus a campus-memory lookup |
| `WEIGHTED_RULE_SUM` | Named risk terms summed, each returned with its own weight |
| `ARITHMETIC_PROJECTION` | Ordinary arithmetic over risk, population and delay |
| `RULE_BASED_INTENT_MATCH` | Question matched against known shapes, then a database query |
| `RULE_BASED_SUMMARY` | Database aggregates assembled into sentences |
| `DATABASE_READ` / `DATABASE_JOIN` | No inference at all |
| `DATABASE_AGGREGATION` | Recurrence and workload figures counted directly from records |
| `STATISTICAL_BASELINE` | Median / MAD anomaly scoring and seasonal-naive forecasting |
| `DETERMINISTIC_SAFETY_RULES` | Complaint wording matched against fixed hazard patterns |
| `DETERMINISTIC_NOTIFICATION_RULES` | Notification priority by event kind, raised only by safety wording |
| `SHA256_HASH_CHAIN` | Audit records chained by digest. Tamper-evident, not a blockchain |
| `LLM_*` | A configured provider answered; the exact label names which call |

Each of these lives behind a single service function: `classify()`,
`pairScore()`, `scoreMatch()`, `evaluate()` and `detectIntent()`. The AI layer
wraps them rather than replacing them — `aiService.classifyComplaint()` runs
`classify()` first in every case, so the rule-based answer is always available
as the fallback and as the floor a model is not allowed to argue below.

Separately, the API labels **what kind of claim** each figure is, using the four
tags the frontend renders as chips: `ACTUAL DATA`, `AI PREDICTION`,
`AI RECOMMENDATION`, `EVIDENCE`.

## Stack

Node.js · Express · MongoDB · Mongoose · JWT · bcrypt · dotenv · REST.

`bcryptjs` is used instead of `bcrypt`: identical algorithm, pure JavaScript, no
native build step — which matters when a team is on mixed machines.

## Setup

```bash
cd backend
npm install
cp .env.example .env     # then edit it
npm run seed             # load the demo campus
npm run dev              # http://localhost:5000
```

You need a MongoDB — either `mongod` locally or a free MongoDB Atlas cluster.
Put its connection string in `MONGO_URI`.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (5000) | Port to listen on |
| `NODE_ENV` | no | `production` enables secure cookies |
| `MONGO_URI` | **yes** | MongoDB connection string |
| `JWT_SECRET` | **yes** | Token signing secret, minimum 24 characters |
| `JWT_EXPIRES_IN` | no (7d) | Token lifetime |
| `COOKIE_NAME` | no | Auth cookie name |
| `CLIENT_URL` | no | Comma-separated allowed origins for CORS |
| `DEMO_STUDENT_EMAIL` / `DEMO_STUDENT_PASSWORD` | no | Seeded demo student |
| `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` | no | Seeded demo admin |

The server refuses to start if `MONGO_URI` or `JWT_SECRET` is missing, rather than
booting into a state where nothing can authenticate.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with `--watch` |
| `npm start` | Start for production |
| `npm run seed` | Seed the demo campus (refuses if data already exists) |
| `npm run seed:fresh` | Wipe and reseed |
| `npm run smoke` | Walk the whole pipeline against a running, seeded API |
| `npm run smoke:gatepass` | Walk the whole gate-pass lifecycle, plus every refusal it should make |
| `npm test` | Unit tests for the AI layer's logic, the schema changes and the route guards. Needs no database and no provider |
| `npm run smoke:ai` | Walk every AI surface against a running, seeded API |
| `npm run smoke:ops` | Walk SLA, workload, simulation, digital twin, correlations, data quality, and the resolve → notify → rate → learn loop against a running, seeded API. Files and resolves one complaint of its own |

`npm run smoke` is the fastest way to know the system works: it signs in, reads
the campus, submits a complaint, watches it get classified and clustered, pulls
the investigation and the memory match, runs both simulators, records a human
decision, checks that a student is refused one, and reads mission control.

`npm run smoke:gatepass` covers the gate pass on its own: apply, guardian OTP,
warden approval, QR issue, exit scan, the live countdown, the return scan, and
then the refusals — wrong OTP, a consumed OTP, a replayed QR, a forged QR, a
student trying to approve their own pass, and the overdue transition. It needs
`GATE_PASS_REVEAL_OTP=true` in `.env` so the code can be read back without a
live SMS gateway, and takes about 70 seconds because it waits out a real
approved window.

### Demo accounts

Created by the seed script, overridable in `.env`:

| Role | Email | Password |
| --- | --- | --- |
| STUDENT | `pritish@bput.ac.in` | `Campus@2026` |
| ADMIN | `control@bput.ac.in` | `Control@2026` |
| WARDEN | `warden.hostelb@bput.ac.in` | `Control@2026` |
| FACILITY_MANAGER | `facility@bput.ac.in` | `Control@2026` |

Every other seeded student uses `Campus@2026`.

## Folder structure

```
backend/
├── src/
│   ├── config/          env loading, DB connection, shared enums
│   ├── controllers/     one per resource; HTTP in, HTTP out
│   ├── middleware/      authenticate, authorize, validate, sanitize, errors
│   ├── models/          Mongoose schemas and their indexes
│   ├── routes/          route tables, mounted under /api
│   ├── services/        all the intelligence; no Express in here
│   ├── utils/           errors, responses, tokens, text similarity, paging
│   ├── validations/     request schemas built from small rule functions
│   ├── seed/            demo campus + the seed runner
│   ├── app.js           Express app assembly
│   └── server.js        boot, connect, listen, shut down cleanly
├── scripts/smoke.js
└── .env.example
```

Controllers never contain intelligence and services never touch `req`/`res`, so
the rules can be tested and replaced on their own.

## Response format

Every response uses one envelope.

```jsonc
// success
{ "success": true, "data": { }, "message": "..." }

// failure
{ "success": false, "message": "Something went wrong", "details": { } }
```

Status codes: `200` read/update, `201` created, `400` validation, `401`
unauthenticated, `403` wrong role, `404` missing, `409` conflict, `413` body too
large, `429` rate limited, `500` unexpected.

## Authentication

`POST /api/auth/login` returns a JWT **and** sets it as an `httpOnly` cookie. Both
are accepted on later requests — `Authorization: Bearer <token>` or the cookie —
so browsers and `curl` both work. Passwords are bcrypt-hashed and the field is
`select: false`, so no query returns one by accident.

Roles: `STUDENT`, `ADMIN`, `WARDEN`, `FACILITY_MANAGER`, `MESS_MANAGER`.
`authorizeStaff` covers everything except `STUDENT`. Self-service registration
only ever creates a `STUDENT`; an existing admin is required to create staff.

## API

`AUTH` — ✓ token required, ✗ public, `STAFF` = any non-student role.

### Auth

| Method | Endpoint | Auth | Body | Returns |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | ✗ | `name, email, password, studentId?, department?, course?, semester?, hostelCode?, room?` | `{ user, token }` |
| POST | `/api/auth/login` | ✗ | `email, password` | `{ user, token }` |
| POST | `/api/auth/logout` | ✗ | — | clears the cookie |
| GET | `/api/auth/me` | ✓ | — | `{ user }` |

Both credential endpoints are rate limited to 30 attempts per 15 minutes.

### Student

| Method | Endpoint | Auth | Returns |
| --- | --- | --- | --- |
| GET | `/api/students/me/dashboard` | ✓ | attendance, provenance-labelled alerts, open reports, tiles, hostel, mess — one read for surface 02 |

### Complaints

| Method | Endpoint | Auth | Role | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/complaints` | ✓ | any | Creates, classifies, and folds into an incident. Returns `{ complaint, classification, duplicates, incident }` |
| GET | `/api/complaints` | ✓ | any | Students see their own; staff see all. `?status=&category=&incident=&buildingCode=&mine=true&page=&limit=` |
| GET | `/api/complaints/:id` | ✓ | owner or STAFF | |
| PATCH | `/api/complaints/:id` | ✓ | STAFF | Workflow moves; `status: RESOLVED` records resolution detail and notifies the author. Status, priority, severity and department changes enter the audit chain |
| DELETE | `/api/complaints/:id` | ✓ | owner or STAFF | An owner may only withdraw before investigation starts |
| GET | `/api/complaints/:id/duplicates` | ✓ | owner or STAFF | Suspected duplicates, with the source of the verdict. Merges nothing |
| PATCH | `/api/complaints/:id/routing` | ✓ | STAFF | Accept or override the recommended department. Keeps both values |
| POST | `/api/complaints/:id/duplicate-review` | ✓ | STAFF | `{ decision: "LINKED"\|"SEPARATE", relatedId?, note? }`. Deletes nothing either way |
| POST | `/api/complaints/:id/reclassify` | ✓ | STAFF | Re-runs the AI layer over a stored complaint. Leaves a human override intact |
| GET | `/api/complaints/:id/resolution-suggestions` | ✓ | STAFF | Resolutions that worked on similar resolved complaints, and a suggestion built only from them |
| POST | `/api/complaints/:id/feedback` | ✓ | author only | `{ rating: 1–5, comment? }`. Only once, only after `RESOLVED`. 409 on a second rating |

Lifecycle: `PENDING → CLASSIFIED → ASSIGNED → INVESTIGATING → RESOLVED`.

`POST /api/complaints` now returns `{ complaint, ai, escalation, classification,
duplicates, incident }`. `classification` is unchanged from before, so anything
already reading it keeps working; `ai` carries the provenance block and
`escalation` carries the priority decision. The complaint is stored, classified
and routed whether or not an AI provider is configured — see **AI layer** below.

### Incidents

| Method | Endpoint | Auth | Role | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/incidents` | ✗ | — | `?open=true&status=&category=&buildingCode=&page=&limit=` |
| GET | `/api/incidents/:id` | ✗ | — | Incident plus its complaints |
| GET | `/api/incidents/:id/complaints` | ✓ | any | Full complaint records |
| GET | `/api/incidents/:id/investigation` | ✗ | — | `{ confidence, confidenceBreakdown, evidence, possibleCauses, relatedComplaints, historicalIncidents, maintenancePattern, brief }` |
| GET | `/api/incidents/:id/memory-match` | ✗ | — | `{ matchedIncident, similarity, matchingFactors, evidence }` |
| POST | `/api/incidents/cluster` | ✗ | — | Dry run by default; `commit: true` writes the clusters out as incidents |
| POST | `/api/incidents` | ✓ | STAFF | |
| PATCH | `/api/incidents/:id` | ✓ | STAFF | `status: RESOLVED` writes the incident into campus memory |

Lifecycle: `DETECTED → CLUSTERED → INVESTIGATING → PREDICTED → INTERVENTION → RESOLVED`.

The confidence figure is the sum of `confidenceBreakdown[].weight` — the breakdown
is the calculation, not a restatement of it.

### Attendance

| Method | Endpoint | Auth | Role | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/attendance/me` | ✓ | any | Overall, per subject, trend, heatmap |
| GET | `/api/attendance/:studentId` | ✓ | self or STAFF | Accepts an id, a studentId, or `me` |
| POST | `/api/attendance` | ✓ | STAFF | Record a subject's totals |
| PATCH | `/api/attendance/:id` | ✓ | STAFF | Correct totals, or mark one session with `present` |
| POST | `/api/attendance/simulate` | ✓ | any | Real arithmetic — see below |

`POST /api/attendance/simulate` takes `{ attendedClasses?, totalClasses?, plannedClasses, attendPlanned?, threshold? }`
and returns `{ current, projected, delta, eligibleNow, eligibleAfterPlan, classesToThreshold, classesCanMiss, explanation }`.
Omit the totals and it runs against the signed-in student's real record. The
`explanation` field spells out the division, e.g. `(33 + 6) / (46 + 6) = 75%`.

### Mess

| Method | Endpoint | Auth | Role |
| --- | --- | --- | --- |
| GET | `/api/mess` | ✗ | — |
| GET | `/api/mess/demand` | ✗ | — |
| GET | `/api/mess/analytics` | ✗ | — |
| POST | `/api/mess` | ✓ | ADMIN, MESS_MANAGER |

`/demand` adds the staggering recommendation: how many covers to move, and what
that does to the peak and to expected waste.

### Campus and buildings

| Method | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/campus` | ✗ | Everything the map draws: blocks, risk, leading incident, campus totals, open anomalies |
| GET | `/api/buildings` | ✗ | |
| GET | `/api/buildings/:id` | ✗ | Accepts an ObjectId, a `code` (`HST-B`), or a `mapId` (`hostb`) |

### Risk

| Method | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/risk` | ✗ | Per-building and per-domain rollups |
| GET | `/api/risk/campus` | ✗ | Campus figure, plus history |
| GET | `/api/risk/building/:id` | ✗ | Leading incident, escalation ladder, anomalies |
| GET | `/api/risk/anomalies` | ✗ | Silent problems, ranked; `silent` holds those with zero complaints |

Levels: `LOW → EMERGING → ELEVATED → HIGH → CRITICAL`, plus `MITIGATED`.

### Interventions

| Method | Endpoint | Auth | Role | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/interventions` | ✗ | — | `?pending=true&status=&incident=` |
| GET | `/api/interventions/:id` | ✗ | — | Recommendation, scenario comparison, risk curves |
| GET | `/api/interventions/:id/quality` | ✗ | — | Resolution quality, not just a status |
| POST | `/api/interventions/simulate` | ✗ | — | What-if — see below |
| POST | `/api/interventions` | ✓ | STAFF | Derives a recommendation for an incident |
| PATCH | `/api/interventions/:id` | ✓ | STAFF | `status: COMPLETED` resolves the incident and updates campus memory |
| POST | `/api/interventions/:id/decision` | ✓ | STAFF | ACCEPT / MODIFY / REJECT |

`POST /api/interventions/simulate` takes `{ incident }` or `{ currentRisk, affectedStudents }`
and returns `DO_NOTHING`, `REPAIR_NOW` and `DELAY_24H` side by side, each with
projected risk, affected students and predicted complaints, plus the two risk
curves the before/after chart draws.

`POST /api/interventions/:id/decision` takes
`{ decision: "ACCEPT" | "MODIFY" | "REJECT", reason?, modifiedAction?, modifiedWindowHours? }`.
A rejection **without a reason is refused** — the campus is meant to learn from
refusals. A recommendation can only be decided once; deciding it again returns
`409`. The human's answer is stored beside the AI's recommendation, never over it.

### Campus memory

| Method | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/memory` | ✗ | `?category=&buildingCode=&page=&limit=` |
| GET | `/api/memory/matches` | ✗ | `?incident=<id>` or `?category=&buildingCode=&title=` |

An incident is written into memory when it resolves — with its cause, its
resolution time, its risk movement and its recurrence — so the next matching
signature is recognised earlier.

### Cross-domain intelligence

| Method | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/intelligence/relationships` | ✗ | Nodes and edges, ready for any graph rendering |
| GET | `/api/intelligence/questions` | ✗ | The question shapes the matcher recognises |
| POST | `/api/intelligence/query` | ✗ | `{ question }` → `{ intent, chain, nodes, edges, answer, supporting }` |
| GET | `/api/intelligence/:entityType/:entityId` | ✗ | `Building`, `Incident`, `Complaint` or `Student` |

The query endpoint is rate limited to 40 requests per minute.

### Mission control — all `STAFF` only

| Method | Endpoint | Notes |
| --- | --- | --- |
| GET | `/api/admin/overview` | KPI strip and the live signal feed |
| GET | `/api/admin/action-queue` | Ranked by risk × affected students, incidents and silent anomalies together |
| GET | `/api/admin/briefing` | Every line tagged `ACTUAL DATA` / `AI PREDICTION` / `AI RECOMMENDATION` |
| GET | `/api/admin/cross-domain` | The chain strip |
| POST | `/api/admin/import-preview` | ADMIN. College adoption: a dry-run CSV import (`Student ID, Name, Branch, Year, Hostel`). Checks every row against live records and writes nothing |

### Assisted-access kiosk — all `STAFF` only

A help-desk operator looks a student up by ID and files requests for them
through the app's own controllers, so they land in the same queues. Every
request records the operator, and complaints and gate passes carry `channel: KIOSK`.

| Method | Endpoint | Notes |
| --- | --- | --- |
| POST | `/api/kiosk/lookup` | `{ studentId }` → profile, attendance, recent requests, notices and which services are available |
| POST | `/api/kiosk/complaint` | Same body as `POST /api/complaints`, plus `studentId` |
| POST | `/api/kiosk/gatepass` | Same body as `POST /api/gatepass`, plus `studentId`; the guardian OTP flow is unchanged |
| POST | `/api/kiosk/gatepass/:id/send-otp` · `/verify-otp` | The guardian code, entered at the desk |
| POST | `/api/kiosk/mess-feedback` | Same body as `POST /api/mess/feedback`, plus `studentId` |
| GET | `/api/kiosk/activity` | Recent kiosk requests, for Mission Control |

### Gate pass — all require an account

| Method | Endpoint | Role | Notes |
| --- | --- | --- | --- |
| GET | `/api/gatepass/config` | any | SMS mode, policy limits, whether this account may approve. No credentials |
| POST | `/api/gatepass` | `STUDENT` | Apply. Creates the pass and sends the guardian OTP in the same request |
| GET | `/api/gatepass` | any | A student sees their own; staff see the queue. `?status=`, `?open=true`, `?mine=true`, `?all=true` |
| GET | `/api/gatepass/summary` | `STAFF` | Counts for the warden console header |
| GET | `/api/gatepass/:id` | owner or `STAFF` | Full pass with its timeline and the OTP state |
| GET | `/api/gatepass/:id/status` | owner or `STAFF` | Lightweight poll: status, timer, server time |
| GET | `/api/gatepass/:id/qr` | owner or `STAFF` | Mints a fresh token and returns a PNG data URL. The previous token stops working |
| POST | `/api/gatepass/:id/send-otp` | owner | Resend the guardian code, subject to a cooldown and a send cap |
| POST | `/api/gatepass/:id/verify-otp` | owner | `{ code }`. On success the pass lands in the warden's queue |
| POST | `/api/gatepass/:id/approve` | `WARDEN`, `ADMIN` | `{ note?, expectedReturnAt? }`. Issues the QR. Never the applicant |
| POST | `/api/gatepass/:id/reject` | `WARDEN`, `ADMIN` | `{ note? }` |
| POST | `/api/gatepass/:id/cancel` | owner | Only before the pass goes active |
| POST | `/api/gatepass/scan` | owner or `STAFF` | `{ token }` — the QR payload. Exit or return is decided from the stored status |
| GET | `/api/gatepass/notifications` | any | The five-minute warning and the overdue alarm, raised by the server |
| POST | `/api/gatepass/notifications/:id/read` | owner | Mark one read |

One scan endpoint rather than the two the brief sketched: the transition is
derived from the pass's own status, so a scanner cannot ask for the one it
prefers. It also means a spent token opens nothing — the digest is cleared on
return.

**Lifecycle.** `PENDING_PARENT_VERIFICATION` → `PARENT_VERIFIED` →
`PENDING_WARDEN_APPROVAL` → `APPROVED` → `ACTIVE` → `RETURNED`, with
`RETURNED_LATE` when the return scan lands after the approved time, `OVERDUE`
while a pass is past that time and still out, and `REJECTED` / `CANCELLED` as
the two early exits.

**The clock is the server's.** `leaveAt`, `expectedReturnAt`, `exitAt` and
`returnAt` are stored, and every status decision compares them against server
time. The countdown in the browser is drawn from those timestamps plus the
`serverTime` the API reports with them, so a refresh, a sleeping tab or a wrong
device clock changes the display and nothing else. The approved *duration* is
what is honoured: exiting late shortens nothing and lengthens nothing, because
the window is re-anchored to the real exit scan.

**Warning and overdue do not need a browser.** `startGatePassMonitor()` sweeps
every 30 seconds from `server.js`, raising the five-minute warning and the
overdue alarm, and each read reconciles the pass it touched, so a status is
never stale because the sweep has not ticked.

### AI layer — all require an account

| Method | Endpoint | Auth | Role | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/ai/status` | ✓ | any | Whether a provider is configured, and which. Never the key |
| GET | `/api/ai/notifications` | ✓ | any | The caller's own inbox, graded by priority |
| GET | `/api/ai/timeline/:kind/:id` | ✓ | owner or STAFF | `kind` is `complaint` or `gatepass`. One shape for both |
| GET | `/api/ai/recurring` | ✓ | STAFF | Recurring problems counted from complaint records. `?days=&limit=&lite=1` |
| GET | `/api/ai/root-cause/:buildingCode/:category` | ✓ | STAFF | Root-cause hypothesis for one detected pattern. 404 if the pattern does not exist |
| GET | `/api/ai/summary` | ✓ | STAFF | The daily campus summary, with the counts it was built from. `?lite=1` |
| GET | `/api/ai/anomalies` | ✓ | STAFF | Volume anomalies against each series' own baseline. `?days=&lite=1` |
| GET | `/api/ai/predictions` | ✓ | STAFF | Complaint-volume forecast, or why there is not enough history. `?days=&lite=1` |
| GET | `/api/ai/copilot/questions` | ✓ | STAFF | The questions the grounding layer can actually run |
| POST | `/api/ai/copilot` | ✓ | STAFF | `{ question }`. Returns the answer, the facts and the records behind it |
| GET | `/api/ai/gatepass-risk` | ✓ | WARDEN, ADMIN | Per-student gate-pass signals for review. Takes no action against anyone |
| GET | `/api/ai/gatepass-risk/:studentId` | ✓ | WARDEN, ADMIN | One student's history and the passes behind each signal |
| GET | `/api/ai/audit` | ✓ | ADMIN | The hash-chained audit history, with a verification verdict |
| GET | `/api/ai/sla` | ✓ | STAFF | SLA breach prediction per open complaint. `BREACHED` is measured; `HIGH/MEDIUM/LOW` are predictions with reasons. `?lite=1` |
| GET | `/api/ai/workload` | ✓ | STAFF | Pending work per department, measured throughput, days to clear (null when unmeasurable). `?days=&lite=1` |
| POST | `/api/ai/simulate` | ✓ | ADMIN | `{ increasePct: -90–500, windowDays?, horizonDays? }`. Measured baseline and estimate side by side, labelled `SIMULATION / ESTIMATE` |
| GET | `/api/ai/digital-twin` | ✓ | STAFF | Campus → groups → blocks, each with its open complaints, incidents, gate passes and recurring patterns |
| GET | `/api/ai/digital-twin/:code` | ✓ | STAFF | One block's actual records and maintenance status |
| GET | `/api/ai/correlations` | ✓ | STAFF | Hostels where several modules are elevated at once. Labelled `POSSIBLE CORRELATION`, never a cause |
| GET | `/api/ai/feedback` | ✓ | STAFF | Ratings, lexicon sentiment, repeated issues and suggestions from feedback students actually left |
| GET | `/api/ai/data-quality` | ✓ | ADMIN | Sixteen read-only integrity checks, each finding naming its actual records. Modifies nothing |
| GET | `/api/ai/early-warning` | ✓ | STAFF | Tiered alerts (CRITICAL / WARNING / WATCH / NORMAL) from recurring issues, week-on-week trends across seven signals and SLA breaches; recurring-issue intelligence with rooms, floors, previous incidents, a possible cause and a recommendation. Rules only |
| POST | `/api/ai/early-warning/act` | ✓ | STAFF | `{ key, action: ACKNOWLEDGE\|INVESTIGATE\|ASSIGN\|ESCALATE\|RESOLVE, department?, complaintIds? }`. Updates linked complaints through the normal workflow with audit entries; RESOLVE closes the alert only |
| GET | `/api/ai/predictive` | ✓ | STAFF | Predictions, each with the data used, horizon, confidence and action, or "Insufficient data for a reliable prediction." |
| GET | `/api/ai/pulse` | ✓ | STAFF | Campus Pulse: a prototype 0–100 indicator with every component, weight and formula returned |
| GET | `/api/ai/why?metric=` | ✓ | STAFF | The evidence behind one graph: facts, a hypothesis where the data supports one, otherwise "Insufficient data to determine the cause." |

Model-backed endpoints carry their own rate limit of 30 requests a minute per
account, well under the app-wide 300, so one signed-in account cannot spend the
provider quota. With no provider configured there is no quota to protect and
that budget is skipped.

The operational endpoints (`sla`, `workload`, `simulate`, `correlations`,
`feedback`, `data-quality`, `resolution-suggestions`) all follow one rule: the
figures are computed from the database first, a model — when configured — only
phrases them in a `narrated` block, and the computed figures always ship
beside the prose. `narrated.source` says who wrote the prose, exactly as it
does everywhere else.

#### What "AI" means here, precisely

Every AI response carries a `source` field, and it is always one of three
values:

| `source` | What happened |
| --- | --- |
| `AI_MODEL` | A configured provider answered and the output passed validation |
| `DETERMINISTIC_FALLBACK` | A provider is configured but failed, timed out, or returned something invalid. The rule-based services answered |
| `AI_NOT_CONFIGURED` | No provider is set up. The rule-based services answered |

`provider` and `model` are `null` unless `source` is `AI_MODEL`, so the
interface can never print a model name for work a model did not do. A
confidence figure is either the model's own (`confidenceBasis:
"MODEL_REPORTED"`) or a count of the rule signals that matched
(`"RULE_BASED_SIGNAL_COUNT"`) — it is never invented, and a result with no
confidence reports `null` rather than a plausible number.

Several surfaces are not AI at all and say so: recurring detection is
`DATABASE_AGGREGATION`, anomalies and forecasts are `STATISTICAL_BASELINE`,
notification priority is `DETERMINISTIC_NOTIFICATION_RULES`, and the audit
chain is `SHA256_HASH_CHAIN`.

#### What a model is never allowed to do

- **Set a safety priority downwards.** `services/escalationService.js` scans
  complaint wording for fire, electrical arcing, gas, structural failure,
  medical emergency, violence and flooding. A match forces `CRITICAL` and
  immediate escalation. A model may raise a priority it thinks is understated;
  it can never lower one a rule set.
- **Create or suppress an anomaly.** `services/volumeAnomalyService.js` decides
  what counts as one. A model that is asked about a finding can only describe it.
- **Produce a forecast figure.** `services/predictionService.js` computes the
  numbers; a model only phrases them, and only when there is enough history.
- **Reach the database.** The copilot's model is handed a fixed fact sheet
  assembled by `services/copilotService.js` and has no query access.
- **Write anything unvalidated.** Everything a model returns goes through
  `services/ai/jsonGuard.js` first. An invented category, a confidence of 400 or
  six paragraphs where a sentence was asked for are dropped, the rejected field
  names are reported, and the deterministic value is kept.

#### Configuration

```
AI_PROVIDER=anthropic     # or "openai" for any OpenAI-compatible endpoint
AI_API_KEY=...            # backend only; never sent to the browser or logged
AI_MODEL=claude-sonnet-5
AI_BASE_URL=              # optional; for a self-hosted or proxied gateway
AI_TIMEOUT_MS=12000
```

Leave `AI_API_KEY` empty and everything still works. Students file complaints,
they are classified and routed by the keyword classifier, safety escalation
runs, recurrence and anomaly detection and the audit chain are unaffected
(none of them needed a model in the first place), and every AI panel says "AI
service not configured" rather than pretending.

### Demo

| Method | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/demo/incident-story` | ✗ | Ten steps, each naming the page that renders it |
| GET | `/api/demo/state` | ✗ | Whether the database has been seeded |
| GET | `/health` | ✗ | Uptime and database connection state |

`/api/demo/incident-story` returns every value read back out of the same records
the rest of the API serves — the report, the classification, the cluster, the
incident, the historical match, the investigation, the risk, the prediction, the
intervention and the memory update. No animation logic is in the backend.

## Security

- bcrypt hashing; the password field is never selected
- JWT with a required minimum secret length, checked at boot
- `httpOnly` cookies, `secure` + `SameSite=None` in production only
- CORS restricted to an explicit allow-list — never `origin: "*"`, because the
  frontend sends credentials. An unlisted origin gets a `403`
- `helmet`, `x-powered-by` disabled, 200 KB body limit
- Every `$`-prefixed and dotted key stripped from bodies, params and query, so a
  JSON body cannot become a Mongo query
- Every write endpoint validated server-side; frontend validation is never trusted
- Rate limits: 300/min global, 40/min on query, 30 per 15 min on credentials
- No secret is hard-coded; the server refuses to start without them

Gate pass specifically:

- The OTP is `crypto.randomInt`, stored only as a bcrypt digest, expiring on its
  own, capped at 5 guesses and 5 sends with a 60-second resend cooldown, and
  consumable once. OTP routes carry their own 12-per-10-minutes limiter
- The QR carries a 24-byte `crypto.randomBytes` token and the pass reference —
  no name, room, phone or credential. Only the token's SHA-256 digest is
  stored, compared with `timingSafeEqual`, re-minted on every QR read, and
  cleared once the pass closes
- A student cannot approve or reject any pass, their own included; the role gate
  sits in the router and the ownership check again in the controller
- The guardian's number lives on the user record with `select: false` and only
  ever leaves the backend masked (`+91XXXXXX5678`)
- SMS credentials are read from the environment inside the backend only, and no
  response — `config` included — carries them

## Performance

Indexes on every field the API filters or sorts by, including the compound
`{ building, category, createdAt }` on complaints and `{ student, subject }` on
attendance. Lists are paginated (default 20, max 100). Read paths use `.lean()`.
Campus and admin rollups use aggregation rather than fetching every document.

## Real-time

There is none, deliberately. REST is enough for every surface the frontend has,
and reliability during a demo is worth more than a WebSocket. If live push is
genuinely needed later, Socket.IO can sit on top of these same services.
