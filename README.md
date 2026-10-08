# NeX Camp
.
**NeX Camp — "Attendance, Mess, Hostel, Repeat: Campus Life, Debugged."** · Team CodexFlow

NeX Camp is a smart-campus system: student complaints become classified reports,
reports cluster into incidents, incidents are investigated against campus memory,
risk is predicted before anyone complains, and a human accepts, modifies or
rejects what the system recommends.

```
nex-camp/
├── frontend/       React 18 · Vite · GSAP · three.js — ten interactive surfaces
├── backend/        Node · Express · MongoDB · Mongoose · JWT — the API behind them
└── ARCHITECTURE.md the design record: data model, API, end-to-end flow, open questions
```

## Running it

You need Node 18+ and a MongoDB (local `mongod`, or a free Atlas cluster).

**1 — API**

```bash
cd backend
npm install
cp .env.example .env        # set MONGO_URI and JWT_SECRET
npm run seed                # loads the demo campus
npm run dev                 # http://localhost:5000
```

**2 — Interface**

```bash
cd frontend
npm install
cp .env.example .env.local  # optional; defaults to http://localhost:5000
npm run dev                 # http://localhost:5173
```

The status bar shows `API LIVE` once the two are talking. **If the backend is not
running it shows `API OFFLINE` and every surface falls back to its built-in
dataset** — the interface never breaks, which matters when you are demoing on
someone else's network.

**3 — Check it works**

```bash
cd backend && npm run smoke
npm test                    # unit + route tests, no database needed
npm run smoke:ai            # every AI surface
npm run smoke:ops           # SLA, workload, simulation, twin, data quality, feedback loop
```

Signs in, reads the campus, submits a complaint, watches it get classified and
clustered, pulls the investigation and the memory match, runs both simulators,
records a human decision, confirms a student is refused one, and reads mission
control. Exits non-zero on the first broken expectation.

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| STUDENT | `pritish@bput.ac.in` | `Campus@2026` |
| ADMIN | `control@bput.ac.in` | `Control@2026` |
| COUNSELLOR (student support team) | `care@bput.ac.in` | `Care@2026` |

The student account is signed in automatically on load, so a judge sees real data
without typing. The account chip in the status bar switches to the admin — which
is what unlocks Mission Control and the ACCEPT / MODIFY / REJECT controls.

## What the system does

| Surface | Backed by |
| --- | --- |
| 01 Landing | `GET /api/campus` — nine blocks, live risk, leading incident, open anomalies |
| 02 Student | `GET /api/students/me/dashboard` — one read: attendance, alerts, reports, tiles |
| 03 Attendance | `GET /api/attendance/me` + `POST /api/attendance/simulate` — the slider is real arithmetic, calculated server-side |
| 04 Mess | `GET /api/mess/demand` — demand curve, predicted peak, and what staggering the peak would do |
| 05 Report | `POST /api/complaints` — type a real complaint; the API classifies it, finds its duplicates and folds it into an incident, and the audit timeline is what actually happened |
| 06 Incident | `POST /api/incidents/cluster` + `GET /api/incidents/:id/memory-match` — clustering runs for real, then scans campus memory |
| 07 Investigation | `GET /api/incidents/:id/investigation` — evidence, causes, and a confidence figure that is the sum of the factors shown beneath it |
| 08 Risk | `GET /api/risk` + `/anomalies` — silent problems, before anyone reports them |
| 09 Intervention | `POST /api/interventions/simulate` + `/:id/decision` — scenario comparison, then a decision recorded against a named person |
| 10 Mission Control | `GET /api/admin/overview`, `/action-queue`, `/briefing` — staff only |
| 11 Gate Pass | `POST /api/gatepass` … `/scan` — apply, guardian OTP over SMS, warden approval, a real QR at the gate, and a countdown the server owns |
| 10 Mission Control · operations | `GET /api/ai/sla`, `/workload`, `/digital-twin`, `/correlations`, `/feedback`, `/data-quality`, `POST /api/ai/simulate` — SLA breach prediction, workload, the what-if simulator, the campus digital twin, cross-module correlation, feedback intelligence and the data quality guardian |
| 10 Mission Control · triage | `PATCH /api/complaints/:id` + `GET /:id/resolution-suggestions` — move a complaint to resolved with a written fix, view and link a suspected duplicate, and see how similar complaints were fixed before |
| 02 Student · rate | `POST /api/complaints/:id/feedback` — a student rates their own resolved report; the resolution notice arrives in their graded inbox |
| ⌘K command bar | `POST /api/intelligence/query` |
| Judge replay | `GET /api/demo/incident-story` — the pipeline read back out of the database |

## One thing worth being clear about

The system can use a real language model, and it tells you when it did.

`backend/src/services/aiService.js` is the whole AI layer:
`classifyComplaint`, `detectDuplicate`, `analyzeRootCause`, `summarizeCampus`,
`detectAnomaly`, `predictDemand`, `generateAdminAnswer`,
`assessGatePassRisk`, `predictSlaBreach`, `analyzeWorkload`,
`explainSimulation`, `narrateDataQuality`, `analyzeFeedback`,
`explainCorrelations` and `suggestResolution`. Point `AI_PROVIDER`,
`AI_API_KEY` and `AI_MODEL` at Anthropic or any OpenAI-compatible endpoint and
those functions call it.
Leave them empty and every one of them falls back to the deterministic services
that were here before — the keyword classifier, the Jaccard similarity, the
threshold anomaly rules, the intent matcher.

**Either way, the result says which happened.** Every AI response carries a
`source`:

- `AI_MODEL` — a provider answered and its output passed validation
- `DETERMINISTIC_FALLBACK` — a provider is configured but failed or timed out
- `AI_NOT_CONFIGURED` — no provider is set up

`provider` and `model` are `null` unless `source` is `AI_MODEL`, so the
interface cannot print a model name for work a model did not do. A confidence
figure is either the model's own or a count of the rule signals that matched,
and it says which; a result with no confidence shows "not reported" rather than
a plausible number. Surfaces that are not AI at all say so too — recurrence
detection is `DATABASE_AGGREGATION`, anomalies and forecasts are
`STATISTICAL_BASELINE`, the audit chain is `SHA256_HASH_CHAIN`.

Some decisions are deliberately kept away from the model. A complaint
mentioning fire, electrical arcing, a gas leak or a medical emergency is forced
to `CRITICAL` by a rule in `escalationService.js`, and a model may raise a
priority but never lower one. The statistics decide what counts as an anomaly
and what a forecast says; a model only phrases them. The copilot's model never
touches the database — it is handed a fact sheet the backend queried, and the
rows travel back to the screen beside the answer so every claim can be checked.
Anything a model does return is validated against the real category, priority
and department vocabularies before it can be stored.

Separately, every figure is tagged with what kind of claim it is — `ACTUAL DATA`,
`AI PREDICTION`, `AI RECOMMENDATION`, `EVIDENCE` — and the tag comes from the API,
not from the component that draws the chip.

### Adapting to a bad connection

The brief mentions patchy campus networks. The application cannot improve a
network, so it reacts to one instead: reads are cached and re-served (flagged
stale, with the time they were taken) when a request fails, failed requests get
one bounded retry, writes attempted while offline are queued and replayed when
the connection returns with critical operations jumping the queue, slow-moving
reads carry `Cache-Control` so a repeat costs nothing, and `?lite=1` trims the
evidence arrays out of an analysis response — declaring in the body that it did,
so a trimmed list is never rendered as a complete one.

## Hostel gate pass

Surface 11 runs the whole outing: the student applies, a one-time code goes to
their guardian's phone, the warden approves, a QR is issued, the student scans
it at the gate, a countdown starts, a five-minute warning fires, and the return
scan closes the pass — or it goes `OVERDUE` and the student, the warden, the
administration and the guardian are all told.

Two things are worth stating plainly:

- **The clock belongs to the server.** Status, start, end and overdue are decided
  against server time and stored timestamps. The browser's countdown is drawn
  from them and re-read on every refresh; it decides nothing.
- **SMS is a real integration, not a mock.** `SMS_PROVIDER=console` is the
  development default: the message goes to the server log, no account and no
  credentials needed, and the entire flow is demonstrable that way. Setting
  `SMS_PROVIDER=http` (any JSON gateway — MSG91, Fast2SMS, TextLocal) or
  `twilio` plus the credentials in `backend/.env` sends the same message for
  real, with no code change. See `backend/.env.example`.

QR generation is `qrcode`, scanning is `jsqr` and `getUserMedia` — both free and
open source, both running in-process. Frames are decoded in the browser and never
uploaded; only the pass token is sent, and the backend decides what it means.

## The Exception-Only Campus

Routine requests should not need a person. The Exception-Only Campus lets written
policy decide the routine ones, measures every request from a single event log, and
sends staff only the exceptions — with the reason, the rule and an UNDO. It is built
on top of everything above: no existing page, route, response field or workflow was
removed (see [`CHANGES-EXCEPTION-ONLY.md`](CHANGES-EXCEPTION-ONLY.md)).

**What it adds, and where**

| Feature | Pages | Data source |
|---|---|---|
| **Campus Event log** — one shape for everything that happens (request, decision, touch, channel); older records backfilled | feeds all below | `CampusEvent`, emitted by the existing controllers |
| **Touchless Lane** — versioned rules with a cited policy section decide bonafide certificates (§4.2), day outings after the guardian's OTP (§7.3), short same-day outings of 1–3 hours at any notice with the QR issued at once (§7.4), and fee-receipt copies (§9.4); anything outside a rule goes to a person with the failed condition named; staff can UNDO with a reason | 10, 11, 14, 16, 17, 19 | `PolicyRule`; deterministic engine, 0 AI |
| **Friction Ledger, measured** — time to outcome, staff touches, hand-offs and office visits per request vs the old path; "time you saved this month" | 01, 02, 10 | event log (ACTUAL DATA) vs baselines (ASSUMPTION, editable, audited) |
| **Report smarter** — while typing, a known open incident offers "+1 & Follow" instead of a duplicate; honest P50/P80 ETAs; planned work shown first | 05, 17 | existing cluster score; finished requests |
| **False closures and assets** — "Not fixed" answers and same-room recurrences within 7 days; repair-or-replace arithmetic per asset | 06, 09, 20 | complaints, fix confirmations, campus memory |
| **Guaranteed reach** — reach target per notice, escalation ladder (in-app → SMS → class rep → kiosk list), funnel, supersession, notice hygiene | 12, 13 | notice receipts |
| **Change propagation** — one class / menu / shutdown change → notice → attendance projection or mess demand → linked complaints | 02, 03, 04, 05, 15 | `ChangeEvent` |
| **Chaos import** — a WhatsApp group export (Android and iOS formats) or a CSV diary → complaints, notices, FAQ drafts; dry run first | 10, 19 | `ImportBatch` |
| **Policy what-if** — replay the last N days of real requests under edited rules; live rules untouched until an admin activates a draft | 09, 10 | real requests (SIMULATED result) |
| **SMS work loop** — staff text `DONE CMP-1234` or `NEED PART CMP-1234 tap washer` from a registered number; the student gets "Is it fixed? Reply YES / NO" | 18 | `StaffPhone`, `SmsOutbox` |
| **Everyday tasks on 2G** — bytes and simulated 2G time for four workflows; a test fails if one goes over budget | 21 | `npm run budgets` |
| **Tuesday Test** — four real errands with a stopwatch, then old vs new | header | all of the above |
| **30-second proof** — a self-running animated reel: each Tuesday problem acted out, the mechanism acting on it, then a LIVE OUTPUT card from the database with its honesty label and source; `?reel=1` for screen recording, `?lowend=1` static (see `CHANGES-REEL.md`) | header (staff) | `GET /api/xo/reel` — one read-only request, ten scenes |

**Honesty labels.** Every figure says what it is: `ACTUAL DATA` (a record or a count
of records), `AI PREDICTION` / `AI HYPOTHESIS` (a model's output), `RECOMMENDED ACTION`,
`SIMULATED` (a replay or a what-if), `ASSUMPTION` / `ESTIMATE` (a stated figure, with its
source), and `INSUFFICIENT DATA` instead of a guess. Each panel names its `method`, and
"VIEW CALCULATION" opens the arithmetic. The LLM stays optional: a classification or
briefing says whether it came from `AI_MODEL`, `DETERMINISTIC_FALLBACK` or
`AI_NOT_CONFIGURED`. Every write goes through the existing hash-chained audit.

**Running it**

```bash
cd backend
npm run seed -- --fresh     # base + extension + Exception-Only data (add --no-xo to skip the last)
npm run seed:xo             # re-seed only the Exception-Only data
npm run smoke:xo            # end-to-end checks against a running API
npm run budgets             # measure the four 2G workflows (writes frontend/public/workflow-budgets.json)
npm test                    # unit + integration tests (integration tests use throwaway databases)
```

Endpoints live under `/api/xo/*` (events, policy, services, ledger, report/similar,
incidents, eta, closures, assets, notices/reach, changes, import, faq/drafts, sms,
tuesday) — see `backend/src/routes/xo/index.js` for roles.

**The Tuesday Test.** Press **TUESDAY TEST** beside REPLAY INCIDENT (Replay incident,
Replay boot and Tuesday Mode are unchanged). Sign in as the demo student when asked,
then **RUN THE TUESDAY TEST**. The stopwatch runs while it does four real errands,
moving to each page:

1. **Bonafide certificate** (page 14) — decided by rule §4.2 and issued at once, 0 staff touches.
   The rule allows fewer than 5 bonafide requests in 30 days; from the 5th, the request goes
   to the office with that condition named, and the test shows that instead.
2. **Leaking tap in Hostel B** (page 05) — matches the open Hostel B water incident: +1 and
   follow, no duplicate filed.
3. **Is tomorrow's class cancelled?** (page 15) — the timetable's answer, and the latest class
   change for you: change → notice → your attendance projection.
4. **Did the mess menu change?** (pages 04, 13) — the change, what it does to mess demand, and
   the notice's reach funnel.

It ends with the Friction Ledger's old path against this run: minutes of student time, staff
touches (counted from the event log) and turnaround. Old figures are ASSUMPTION (the ledger's
baselines, editable on page 10); new ones are ACTUAL DATA or MEASURED IN THIS DEMO. Nothing is
pre-recorded: every answer is whatever the API returns at that moment.

**Two-phone SMS demo** (page 18, staff sign-in): press the four buttons in order — the student
reports a leak by SMS, the plumber sends `NEED PART`, then `DONE`, and the student's phone
receives "Is it fixed?" and answers `YES`. Every message goes through the real simulator, and
the per-number rate limit (8 messages in 10 minutes) applies.

## Round 3: prove, optimise, audit, prevent

Round 3 answers four questions most systems skip: *did the fix actually work?*,
*where do limited hours do the most good?*, *is the service fair to students
without a smartphone?*, and *what will this change break before we commit it?*
Everything is deterministic arithmetic over data the system already stores, lives
inside existing pages, and works with no LLM configured. See
[`CHANGES-ROUND3.md`](CHANGES-ROUND3.md) for the gap check, every hook, and
limitations.

| Feature | Page | Status |
|---|---|---|
| **Process mining**: directly-follows graph from the event log, conformance against the designed lifecycle, bottleneck, rework rate, Gini of staff load | 10 | IMPLEMENTED · DEMO DATA |
| **Did it work?**: difference-in-differences against comparable blocks, parallel-trend refusal, seeded bootstrap 90% interval; the effect is stored in campus memory | 09, 20 | IMPLEMENTED · DEMO DATA |
| **Pre-flight**: a class or menu change's consequences (eligibility, clashes, rooms, gate passes, lunch peak, the notice and its reach) before COMMIT; writes nothing | 15 | IMPLEMENTED |
| **Notice linter**: missing date/time/venue/action/deadline/contact, relative dates, readability, night sending, timetable overlap, contradictions, attention budget, predicted reach | 13 | IMPLEMENTED · DEMO DATA |
| **Presence-aware mess forecast**: minus students on approved gate passes, backtested; a personal best time to eat | 04, 02 | IMPLEMENTED · DEMO DATA |
| **Point of no return**: the last date recovery to 75% is possible; systemic vs individual absence (academic office, wardens for their hostel) | 03 | IMPLEMENTED |
| **Repair portfolio**: 0/1 knapsack over open problems, safety-critical items mandatory, value of 4 more hours | 09 | IMPLEMENTED |
| **Service equity**: resolution time and completion by channel, hostel and year; a gap is flagged only when the bootstrap interval excludes 1 | 21, 10 | IMPLEMENTED |
| **Unblock path**: the one action that unblocks the most of a student's requests (Policy Engine dry run) | 17 | IMPLEMENTED |
| **Asset MTBF**: time between failures and next expected failure (3+ failures only) | 08 | IMPLEMENTED |

```bash
cd backend
npm run seed -- --fresh     # now also seeds the Round 3 demo data (add --no-proof to skip it)
npm run seed:proof          # re-seed only the Round 3 data
```

**Judge demo (about 5 minutes).** Sign in as the admin, press **TUESDAY TEST → PROOF DEMO →
RUN THE PROOF DEMO**. It moves through pages 15, 13, 04, 09 and 10 with live calls: a
reschedule's pre-flight (students at the 75% edge, the lunch-peak collision), the notice
linter on the draft and then the fixed draft with its predicted reach, tomorrow's lunch
forecast adjusted for approved gate passes and its backtest, the Hostel B pump fix's verdict
against Hostels A and C followed by the maintenance-hours optimiser, and the process-mining
bottleneck plus the equity headline. Nothing is written; COMMIT on page 15 is left to the presenter.

## Silent Support System

A private, optional pathway to support for students who may be struggling but do not
ask. **No new page** — it lives inside page 02 (Student Dashboard) and page 10 (Mission
Control). See [`CHANGES-SILENT-SUPPORT.md`](CHANGES-SILENT-SUPPORT.md).

- **02** — a four-question wellbeing check-in (emoji scale, every question skippable),
  a supportive response in non-clinical language, **"I don't know how to ask for help"**
  (counsellor, mentor, private conversation, anonymous, check on me later, emergency
  resources), and the request's progress: Request created → Assigned → Contacted → Follow-up → Resolved.
- **10** — Student Support Overview (aggregate only for admins, small counts hidden) and,
  for the `COUNSELLOR` role only, the support queue with a recommended action per case.
- Rules decide the support level; an optional AI may only re-word the message, and its
  wording is rejected if it sounds clinical. It works fully with no AI configured.
- Emergency contacts come from `SUPPORT_EMERGENCY_CONTACTS` — no number is hard-coded.
- These are support-routing levels, not diagnoses. The system hands students to people.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — frontend analysis, data model, API design, end-to-end flow, and the questions still open
- [`backend/README.md`](backend/README.md) — setup, every endpoint with its auth, role, body and response, security and performance notes
- [`frontend/README.md`](frontend/README.md) — the ten surfaces, the 3D layers, graceful degradation
- [`CHANGES-EXCEPTION-ONLY.md`](CHANGES-EXCEPTION-ONLY.md) — every existing file the Exception-Only Campus touched, and why
- [`CHANGES-GATEPASS-SHORT-OUTING.md`](CHANGES-GATEPASS-SHORT-OUTING.md) — page 11: short same-day outings approved automatically, QR shown at once
- [`CHANGES-ROUND3.md`](CHANGES-ROUND3.md) — Round 3: the gap check, every hook, endpoints, labels and limitations
