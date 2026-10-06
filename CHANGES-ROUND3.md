# Round 3 — Prove, Optimise, Audit, Prevent

This file records the Round 3 work: the gap check that was done first, what was
built, where, and how honest each result is. The style follows
`CHANGES-EXCEPTION-ONLY.md`: every hook into existing code is one marked line
(`ROUND-3 HOOK`), and every new route is additive.

## 1. Gap check (done before any code was written)

Every feature was grepped for in `backend/src` and `frontend/src` first. Where
something equivalent already existed, it is extended, not duplicated.

| # | Feature | What already existed (file) | What Round 3 adds | Files |
|---|---|---|---|---|
| F1 | Process mining & bottlenecks | The Campus Event log (`models/xo/CampusEvent.js`) already records `COMPLAINT_CREATED / CLASSIFIED / ASSIGNED / STATUS_CHANGED / RESOLVED / REOPENED`, gate-pass and certificate events, live and backfilled (`services/xo/backfillService.js`). Its header even names "process mining" as a consumer, but **nothing mined it**: no directly-follows graph, conformance check, bottleneck or Gini anywhere | Directly-follows graph per workflow, conformance against the designed lifecycle, bottleneck (median wait × cases), rework rate, per-department hand-off delay, Gini of assignments | `services/proof/processMining.js`, `controllers/proof/proofController.js`, `GET /api/admin/process-mining`; page 10 panel `frontend/src/proof/ProcessFlow.jsx` |
| F2 | Intervention impact proof (DiD) | `services/xo/impactService.js` — **before/after** only (8 weeks either side of the latest fix, no control group). `Intervention.outcome` exists but nothing fills `complaintsAfterFix` from data. No bootstrap or parallel-trend check anywhere | Difference-in-differences against same-type buildings with no intervention, parallel-trend refusal, seeded bootstrap 90 % interval, verdict, "complaints avoided"; measured effect written to CampusMemory (`measuredEffect`, optional field) | `services/proof/impactProof.js`, `GET /api/interventions/:id/impact`; page 09 "Did it work?" and page 20 proof badge |
| F3 | Pre-flight change preview | `services/xo/changeService.js` propagates **after** commit (`attendanceEffect`, `demandEstimate`); `timetableService.createChange` writes immediately. No dry run | `POST /api/changes/preview` — same arithmetic, before commit, plus slot conflicts, gate-pass absentees, mess-window shift, drafted notice with reach from past receipts. Writes nothing (tested) | `services/proof/preflight.js`; page 15 drawer |
| F4 | Notice linter, collision guard, attention budget | `services/xo/reachService.js hygiene()` — quiet hours, duplicate / supersession, audience breadth. No content lint, no timetable collision, no read-rate vs load relation, no reach prediction | Essentials (date / time / venue / deadline / action / contact), relative dates → absolute, readability, notices-today count, timetable overlap, contradiction with an active notice, attention budget (read-rate by weekly load, with minimum data), predicted reach from receipts. Calls the existing `hygiene()` and returns it alongside | `services/proof/noticeLint.js`, `POST /api/notices/lint`; page 13 compose form |
| F5 | Presence-aware mess forecast + best slot | `messIntelligenceService.predictMeal` (same-weekday weighted average). Gate passes store `leaveAt / expectedReturnAt`. Nothing joins them | Adjustment line (students on approved passes × participation), backtest with/without on past days, personal best 15-min slot from queue history and the student's class end time | `services/proof/presenceForecast.js`; pages 04 and 02 |
| F6 | Point of no return; systemic vs individual | `attendanceService.simulate` (classes to threshold), `attendanceIntelligenceService` (per-student pattern). No "last date recovery is possible", no section-level decomposition | Per-subject point of no return from the timetable and `semesterPlanned`; staff view splitting a drop into SYSTEMIC (section-wide, same slot, with linked incidents / anomalies) vs INDIVIDUAL | `services/proof/attendanceProof.js`; page 03 |
| F7 | Repair portfolio optimiser | Nothing (`knapsack`, `portfolio`: no hits) | 0/1 knapsack (DP) over open incidents and complaints, mandatory SLA-critical items, marginal value of +4 h | `services/proof/portfolio.js`, `POST /api/interventions/portfolio`; page 09 |
| F8 | Service equity monitor | Channel is recorded on complaints (`Complaint.channel`), events (`CampusEvent.channel`) and receipts. The ledger splits by channel for touches only. No parity test | Median resolution / completion by channel, hostel, year with bootstrap intervals; gap flagged only when intervals do not overlap and n ≥ minimum; field-completeness as a possible cause | `services/proof/equity.js`; pages 21 and 10 |
| F9 | Unblock path | Policy Engine + facts (`services/xo/policyEngine.js`, `policyFacts.js`) evaluate one request at a time | Dependency graph request → failed conditions; the single action that unblocks the most | `services/proof/unblock.js`; page 17 |
| F10 | Asset MTBF | `services/xo/assetService.js` + `models/xo/Asset.js` already exist: failures from records naming the asset, repair-or-replace. **No MTBF / next-failure** | Mean and median time between failures, days since last, next expected failure (≥ 3 failures only), inspection recommendation. The `Asset` model is reused; no new model | `services/proof/reliability.js`; page 08 |
| F11 | Technician day planner | `operationsIntelligenceService.workloadAnalysis`; building `geometry {x, y}` in the database | Not built this round (Tier 3) | — |
| F12 | FAQ question-gap mining | `FaqQuery` logs every question with `answered`; `faqStats` counts them; `FaqDraft` exists for WhatsApp drafts | Not built this round (Tier 3) | — |

### Constraints discovered during the gap check

- **There is no FACULTY role** (`config/constants.js`; `timetableRoutes.js` says so). F3's "admin/faculty" and F6's "faculty see only their sections" are mapped to the roles that exist: the academic office (`ADMIN`) sees every section; a `WARDEN` sees only residents of their own hostel; other staff roles and students are refused the staff view. This is stated in the API response (`scope`).
- The seeded student body is **18 students**, while mess records describe a ~850-cover dining hall. Presence-aware adjustment therefore moves the forecast by a handful of covers, and the backtest honestly reports whether that helps.
- No intervention in the base seed is ever completed. F2 needs a finished one, so the Round 3 seed adds one completed historical intervention and the complaint series around it (reserved references, labelled DEMO DATA).

## 2. What was built, and how honest it is

Status labels follow the existing documentation: **IMPLEMENTED** (computes from
whatever is in the database), **IMPLEMENTED · DEMO DATA** (works on any data, and
the seed adds records so the demo has something to show), **PARTIAL**, **NOT BUILT**.

| # | Feature | Status | Where | Claim kinds shown | Minimum-data rule |
|---|---|---|---|---|---|
| F1 | Process mining & bottleneck discovery | IMPLEMENTED · DEMO DATA | 10 | ACTUAL DATA; slow-wait line (18 h) is ASSUMPTION; RECOMMENDED ACTION | < 10 completed cases → "Insufficient data to mine this workflow" |
| F2 | Intervention impact proof (DiD) | IMPLEMENTED · DEMO DATA | 09, 20 | ACTUAL DATA; trend-gap limit is ASSUMPTION | not completed / window open ("Measurable on …") / no control block / < 5 pre-period complaints / pre-trends differ → no verdict |
| F3 | Pre-flight change preview | IMPLEMENTED | 15 | SIMULATED, ACTUAL DATA, AI PREDICTION (reach) | reach needs 20+ past receipts; menu demand needs 3+ servings of old and new items |
| F4 | Notice linter, collision guard, attention budget | IMPLEMENTED · DEMO DATA | 13 | ACTUAL DATA, AI DETECTED PATTERN, AI PREDICTION, RECOMMENDED ACTION; readability limits ASSUMPTION | the load/read relation needs 2 bands with 20+ receipts over 3+ weeks each |
| F5 | Presence-aware forecast + best slot | IMPLEMENTED · DEMO DATA | 04, 02 | AI PREDICTION, ACTUAL DATA | forecast needs 2 same-weekday samples; backtest needs 5 days with students away and a 5% error cut to be called "better"; nudge effect shown from 30 acceptances |
| F6 | Point of no return; systemic vs individual | IMPLEMENTED | 03 | AI PREDICTION, AI DETECTED PATTERN, AI HYPOTHESIS (co-occurring incidents), ACTUAL DATA; semester end ASSUMPTION | 5 students with 3+ classes either side of the 14-day line |
| F7 | Repair portfolio optimiser | IMPLEMENTED | 09 | SIMULATED; hours per item ACTUAL DATA (3+ past repairs), AI PREDICTION (intervention estimate) or ASSUMPTION (category default); risk from priority ASSUMPTION | — |
| F8 | Service equity monitor | IMPLEMENTED | 21, 10 | ACTUAL DATA, AI DETECTED PATTERN, AI HYPOTHESIS (field completeness as a cause) | 5 resolved complaints per side; flagged only when the 90% interval excludes 1 |
| F9 | Unblock path | IMPLEMENTED | 17 | RECOMMENDED ACTION, ACTUAL DATA | — |
| F10 | Asset reliability (MTBF) | IMPLEMENTED | 08 | AI PREDICTION, RECOMMENDED ACTION | next-failure estimate from 3+ failures |
| F11 | Technician day planner | NOT BUILT | — | — | Tier 3, not attempted |
| F12 | FAQ question-gap mining | NOT BUILT | — | — | Tier 3, not attempted |

Methods, all deterministic and with no model involved:

- **F1**: event types map to activities; one trace per case; directly-follows edges with median / P90 waits; conformance checks for skipped mandatory steps, reassignment loops, rework and backwards steps; bottleneck = forward edge with the largest median wait × cases, broken down by department; Gini `G = Σᵢ Σⱼ |xᵢ − xⱼ| ÷ (2 n² μ)` over human-touch steps. 60-second cache.
- **F2**: controls are buildings of the same type with no intervention completed in either window; `DiD = (treated_post − treated_pre) − (control_post − control_pre)` per day; pre-period least-squares slopes compared (limit 0.08 complaints/day²); percentile bootstrap over days, 1,000 resamples, seed 20260927; complaints avoided ≈ −DiD × 14.
- **F3**: `attendanceEffect` and `demandEstimate` are the functions Change Propagation already uses after commit; conflicts come from the timetable (with its recorded changes), room bookings, gate passes covering the slot, and the mess register's peak half hour on that weekday.
- **F5**: participation = the busiest half hour's median headcount ÷ hostel occupancy. This is a lower bound, because the register counts people per half hour, not unique diners. Backtest: each past day is predicted only from the days before it.
- **F6**: `spare = ⌊attended + remaining − 0.75 × (held + remaining)⌋`; the point of no return is the first upcoming class where `i × missRate > spare`.
- **F7**: 0/1 knapsack by dynamic programming over half-hour units; mandatory items (safety rule, CRITICAL priority, incident risk ≥ 90) are taken first.

## 3. Existing files touched (one marked line or block each: `ROUND-3 HOOK`)

| File | Change | Why |
|---|---|---|
| `backend/src/routes/index.js` | import + `router.use(proofRoutes)` after every existing router | mounts Round 3; its paths match no existing route (two-segment paths under `/attendance` so `/:studentId` never captures them) |
| `backend/src/models/CampusMemory.js` | optional `measuredEffect` (Mixed) | F2 writes the measured effect beside the outcome |
| `backend/src/services/xo/backfillService.js` | "Reassigned to …" and "Investigation started …" audit entries also become events | process mining needs loops and waits; previously only the first assignment was derived. The existing unit test's expected events are unchanged |
| `backend/src/services/xo/touchlessService.js` | `ensureDefaultRules()` skips its upserts when every cited section exists | **bug fix**: Mongoose timestamps turned each upsert into an `updatedAt` write, so every read-only policy preview (including the existing `/xo/policy/preview`) wrote to `policysections`. The new no-write test found it |
| `backend/src/seed/index.js` | runs `seedProof()` after the exception-only seed (`--no-proof` skips it) | demo data |
| `backend/package.json` | `seed:proof` script | re-seed only Round 3 data |
| `frontend/src/NexCamp.jsx` | import + one `<PfSlot>` on pages 02, 03, 04, 08, 09, 10 | panels inside existing pages |
| `frontend/src/ext/{Notices,Classes,Requests,Board,Device}Surface.jsx` | import + one `<PfSlot>` each; Composer / ChangeForm / MenuForm receive `user`; `submit(e)` accepts no event so COMMIT in the drawer runs the same flow | pages 13, 15, 17, 20, 21 |
| `frontend/src/xo/TuesdayTest.jsx` | a PROOF DEMO mode switch; the Tuesday Test itself is unchanged | judge demo |
| `frontend/src/lib/i18n.js` | merges `PF_OR` / `PF_HI` (only keys not already present) | Odia and Hindi labels |

No field, route or component was renamed or removed.

New files: `backend/src/services/proof/*` (stats, processMining, impactProof, preflight,
noticeHistory, noticeLint, presenceForecast, attendanceProof, portfolio, equity, unblock,
reliability), `controllers/proof/proofController.js`, `routes/proof/index.js`,
`models/proof/SlotNudge.js`, `seed/proof/{index,run}.js`,
`test/proof-{unit,routes,integration}.test.js`, and `frontend/src/proof/*`.

## 4. Endpoints

| Method & path | Who | Writes |
|---|---|---|
| `GET /api/admin/process-mining?workflow=complaint\|gatepass\|certificate&days=7–365` | staff | nothing |
| `GET /api/admin/equity?days=` (`?lite=1`) | staff | nothing |
| `GET /api/interventions/:id/impact?window=7–42` | staff | `CampusMemory.measuredEffect` only |
| `GET /api/board/proof` (`?lite=1`) | any signed-in user (no names) | nothing |
| `POST /api/interventions/portfolio` `{ hours, trade? }` | staff | nothing |
| `POST /api/changes/preview` `{ kind: CLASS, scheduleId, sessionDate, type, newDate?, newStartTime?, newRoom? }` or `{ kind: MENU, date, meal, items, hostels? }` | ADMIN (class); ADMIN or MESS_MANAGER (menu) | nothing |
| `POST /api/notices/lint` `{ title, body, audience, priority, scheduledFor? }` | staff | nothing |
| `GET /api/mess/presence-forecast?meal=&date=` | signed in | nothing |
| `GET /api/mess/best-slot?meal=&date=` · `POST /api/mess/best-slot/accept` | students | accept writes one `SlotNudge` |
| `GET /api/attendance/me/point-of-no-return` | students (own records only) | nothing |
| `GET /api/attendance/sections/analysis` | ADMIN (every section), WARDEN (own hostel's residents only) | nothing |
| `GET /api/requests/unblock` | students (own requests only) | nothing |
| `GET /api/risk/reliability?building=` (`?lite=1`) | signed in | nothing |

There is no faculty role in this system. Where the brief says "faculty", the academic
office (ADMIN) stands in, and the API response says so (`scope`, `noFacultyRole`).

## 5. Demo data (`npm run seed:proof`, reserved references, cleared on every run)

- 22 complaints from the last month (CMP-1601 onwards) with real hand-offs. Plumbing waits long between ASSIGNED and INVESTIGATING, three tickets bounce between trades, and kiosk / SMS tickets are less complete.
- One completed Hostel B water intervention 40 days ago (INT-0901 / INC-0901) with 14 days of complaints either side in Hostels A, B and C; one with no comparable block (INT-0902, library); one whose window is still open (INT-0903).
- Weekend day outings over the last four weeks and six approved outings over tomorrow's lunch (GP-YYYY-R…).
- Eight weeks of notices to CSE year 3 (NTC-R3-…) at 2–10 per week. Read rates in this demo data fall with weekly load; the feature measures whatever relation the receipts hold.
- The demo student (students[0]) is given none of it, so the Tuesday Test and the smoke suites start where they did.
- The first draft of this seed reused CMP-19xx, which the extension seed already reserves (CMP-1901…1906). It was moved to CMP-16xx before commit.

## 6. Limitations (read before presenting)

- **F5** moves a ~2,900-cover forecast by about 5 covers, because only 18 students are registered while the mess register describes the whole campus. The backtest honestly reports **no meaningful difference**. With a full student roll, the same code scales.
- **F3 / demo**: the pre-flight reports **8** students (not 3) at the 75% edge in DBMS. That is what the seeded register holds.
- **F8**: at the 90% level there is **no measurable gap between channels** in the seed (kiosk 1.18×, SMS 1.95× on n = 8, both intervals include 1). The flagged gap is **Hostel B residents' complaints resolving 1.8× slower** (interval 1.36–2.18×), which is driven by the long open water incident.
- **F4**: the existing seeds publish many notices at seed time, so a lint run on a freshly seeded database reports most recipients as having had 3+ notices today. That is true of the data.
- **F2** is a GET that writes one derived field (`CampusMemory.measuredEffect`) so later recommendations can cite the measured effect. `GET /api/board/proof` computes the same numbers without writing.
- **Policy dry runs**: `ensureDefaultRules()` still installs the default rules the first time it is called on an empty database (existing behaviour). On a seeded database it no longer writes anything.
- **Not built:** F11 technician day planner, F12 FAQ question-gap mining.

## 7. Verification

| Check | Result |
|---|---|
| `npm test` (MongoDB running) | **432 tests: 431 pass, 1 fail**. The failure is the pre-existing, time-of-day-dependent `xo-budget` gate-pass 2G test documented in `docs/DIFFERENTIATION-AUDIT.md` §0; it failed the same way before any Round 3 change. The baseline was 377 tests (376 pass). Round 3 adds 55: 29 unit, 16 route, 10 integration |
| No-write test | every document in every collection is hashed before and after 14 preview / lint / optimiser / analysis calls, and the hashes are identical |
| Access control tests | students get 403 on every staff endpoint; a mess manager may preview a menu change but not a class change; staff get 403 on student-only endpoints; a warden's section analysis contains only Hostel B residents |
| `npm run seed -- --fresh`, then `smoke`, `smoke:gatepass`, `smoke:ai`, `smoke:ops`, `smoke:ext`, `smoke:xo` | all pass |
| `frontend/scripts/page-check.mjs` (21 pages × HIGH·EN·1360, LOW·LOW-BW·EN·390, MEDIUM·3D-off·Odia·1360, HIGH·Hindi·390, LOW-BW·ADMIN·1360, OFFLINE·EN·390) | **126/126 page visits clean**: no console errors, no horizontal overflow, no error boundary |
| `vite build` | builds. Round 3 panels are separate lazy chunks (2.7–3.7 KB gzip each); the entry chunk grew by about 4 KB raw |
| PROOF DEMO in Chromium (admin) | all five steps complete against live data with no console errors |

Found and fixed while verifying: the reliability panel crashed because the MTBF
`failures` count overwrote the failures list (renamed to `failureCount`); a gating bug
hid the reliability panel from students even though its API is open to them;
"lab records" was accepted as a venue; weekday words were flagged as relative dates
even when an absolute date was present; the backtest called a 1-cover difference "better".
