# Differentiation Audit — NeX Camp (Stage A)

This is Stage A: analysis only. **No product code was changed.** Everything below
comes from reading the code at commit `82b2509` (byte-identical to the supplied
ZIP), running the suite, seeding a fresh database and calling the live API. Where
the code and the docs disagree, the code wins, and the disagreement is listed in §A2.3.

## 0. What I ran, and what came back

MongoDB 8.3.7 was run locally from the conda-forge binary, because the official
download host is blocked in this sandbox. That is the same workaround `PLAN.md`
records, and nothing about it is part of the project.

| Check | Result |
|---|---|
| `npm test` without MongoDB | 369 tests: 334 pass, **35 skipped** (the integration tests skip themselves) |
| `npm test` with MongoDB | 369 tests: **368 pass, 1 fail**: `xo-budget.test.js` "every page-21 workflow stays within its 2G byte budget" |
| Why it fails | *Apply for a gate pass* measured **12,220 B against a 10,240 B budget**. When the Touchless Lane auto-approves (§7.3 day outing), `POST /gatepass/:id/verify-otp` returns a QR PNG as a data URL (`gatePassController.js:375`), about 7 KB. Whether the fixture's pass (`leaveAt = now + 20 h`) is in policy depends on the time of day the test runs. So the test is **time-dependent**: it was green when `REGRESSION-EXCEPTION-ONLY.md` was written and it is red today. This is a real 2G regression, not a flaky test. |
| `npm run seed -- --fresh` | completes: 9 buildings, 21 users, 75 complaints, 5 incidents, 108 attendance, 448 mess, 474 feedback, plus ext and xo data |
| `smoke` / `smoke:gatepass` / `smoke:ai` / `smoke:ops` / `smoke:ext` / `smoke:xo` | 70/70 · 43/43 · 132/132 · 70/70 · 50/50 · 47/47 |
| `npm run budgets` | **3 / 4 within budget.** Gate pass is 11.9 KB against 10 KB, **OVER** (same cause as the failing test). The script rewrote `frontend/public/workflow-budgets.json`; I restored it, because Stage A must not change files. |
| `vite build` | builds. Entry chunk `index-*.js` is **967 KB raw / 299 KB gzip**. `three` is lazy (176 KB gzip). At the budgets script's own 50 kbps assumption, the first cold load of the entry chunk alone takes about **48 s**. |

Live figures from the seeded API (admin, 30-day window), quoted later in this document:

| Endpoint | Figure |
|---|---|
| `/xo/ledger` | 90 requests, 45 closed. **Median time to outcome 0 h** vs baseline 72 h. Touches per request 0.93 now vs 2.96 old. 110 office visits avoided (ESTIMATE) |
| `/xo/policy/touchless-rate` | 60 % (15 of 25 closed with zero human touches) |
| `/ai/sla` | 35 open complaints examined, **25 already BREACHED**, 0 at HIGH risk |
| `/xo/closures` | 10 of 42 resolutions flagged as false closures (23.8 %) |
| `/faq/stats` | 14 asked, 11 answered, 3 unanswered, **0 turned into requests**. `/xo/faq/drafts` is empty until a WhatsApp import runs |

---

## A1. Problem deep analysis

**The core problem behind the wording.** Most routine campus tasks do not need a person to *decide* anything. A person is needed only to *find out*: which office handles it, what the rule is, whether it is done yet, whether something changed. The friction is not a missing feature. It is **routing and status that live in people's heads**: the warden's diary, the clerk's memory, "the senior who usually knows".

**Root causes**
1. **No single intake.** The student has to pick the channel and the office before anything happens (four apps, six boards, two WhatsApp groups, one register).
2. **Implicit rules.** Eligibility rules for a bonafide certificate or an outing exist on paper, but a human re-applies them every time.
3. **No promise, no accountability.** Nobody states *when* something will be done, so nobody can be held to it. That is why the tap leaks for nine days.
4. **Broadcast without confirmation.** A notice is posted, but whether the right cohort read it is unknown. This is why the student "heard" the mess menu changed.
5. **Knowledge is not retained.** The same question is answered again every semester, by whoever happens to be asked.
6. **Admins see volume, not cost.** Ticket counts hide which problem is costing students the most hours.

**Stakeholders the statement actually supports:** students (day scholars and hostel residents), wardens, office / academic staff, facility and mess managers, HoDs / faculty (for class changes), accounts, gate security, guardians (for gate-pass consent), help-desk / kiosk operators, and college management (dashboard, adoption).

**Current ecosystem:** paper registers, WhatsApp groups (unsearchable, mixed notice / complaint / question), physical notice boards, office queues with no ETA, and "the senior who knows".

| Pain point | Class |
|---|---|
| Certificate needs an office visit and a queue; tap unfixed for 9 days; no way to know if tomorrow's class is cancelled; mess-menu change learned by rumour | **Explicit** (the Tuesday story) |
| No status visibility; duplicate complaints; nobody knows who owns what; notices not read; students without smartphones or data left out | **Strongly implied** |
| Staff overload from routine approvals; repeated questions; no proof a fix happened; guardians unaware of outings | **Secondary** |
| Institutional memory walks out every year; no measurement of whether things improve; no accountability for promised timelines; rules never revisited | **Long-term systemic** |

---

## A2. 21-page audit

### A2.1 Page by page

Legend: FE = frontend file, BE = backend.

| # | Page | Purpose | Features, verified in code | Role | Backend endpoints & logic | Strength | Weakness / overclaim | Innovation opportunity |
|---|---|---|---|---|---|---|---|---|
| 01 | Landing | Story of the campus from live data | 3D block map (`NexCamp.jsx`, `lib/campusModel.js`, lazy `three`); 7 chapters rebuilt from live data by `xo/liveNarrative.js:narrateChapter`, with the original prose as the offline fallback; `XoSlot frictionMeasured` (measured Friction Map) | public | `GET /api/campus`, `/api/xo/ledger/public` (`ledgerService.publicFrictionMap`) | Live, honest narrative; a friction map with ASSUMPTION vs ACTUAL | 3D is the most expensive thing to build and says nothing about friction. The offline fallback prose still says "6,240 students… 89 % confidence…". "THE TEN SURFACES / NOT TEN DASHBOARDS" at `NexCamp.jsx:4140-4141` (there are 21) | Open with the **one-sentence errand box** instead of the story (see S1) |
| 02 | Student Dashboard | One student's campus | `components/intel/StudentIntel.jsx`; `XoSlot timeSaved` (`ledgerService.mySavings`), `whatChanged` (`changeService.changesFor`) | student | `/students/me/dashboard`, `/students/me/intelligence`, `/students/me/query` (`studentIntelligenceService.detectIntent`, single intent) | "Time you saved this month" is ESTIMATE-labelled and computed from the event log | The assistant answers only one attendance or mess question at a time | Host the errand box; a "promises made to you" strip (S2) |
| 03 | Attendance Intelligence | Trend, heatmap, what-if | `AttendanceIntel.jsx`; server-side simulator; `whatChanged` for class changes | student | `/attendance/me`, `/attendance/simulate`, `/attendance/me/intelligence` | Arithmetic done on the server; class-change projection | Common feature (every team has an attendance % bar) | Link to incident-caused absences (S4, experimental) |
| 04 | Mess Intelligence | Demand, peak, waste | `MessIntel.jsx`; `whatChanged` for menu changes | student / staff | `/mess/demand`, `/mess/intelligence`, `/mess/simulate`, `/mess/feedback` | Menu change → demand estimate (`changeService.demandEstimate`) | Crowd density and star ratings are common | — |
| 05 | Report & Track | File a complaint | Inline in `NexCamp.jsx`; `knownIssue` (+1 & Follow), `reportEta` (P50/P80) | student | `POST /complaints` (classify, escalate, cluster), `/xo/report/similar` (`deflectionService.similarOpenIncident`), `/xo/eta` | Deflection **while typing**, honest P50/P80 ETA, planned work shown first | The ETA is shown, but whether it was met is never checked | Turn the ETA into a **tracked promise** (S2) |
| 06 | Incident Intelligence | Clusters → incident | Cluster run, memory match, `incidentSignals`, `assets` | staff | `/incidents/cluster`, `/incidents/:id/memory-match`, `/xo/incidents/signals`, `/xo/assets` | Real clustering; wording relabelled honestly ("wording overlap") | Blurb in `pageDefs` (`NexCamp.jsx:166`) says "17 complaints converge" whatever the data | Show "students affected but silent" (A6 #13) |
| 07 | Problem Investigation | Evidence and causes | Graph, evidence drawer | staff | `/incidents/:id/investigation` (`investigationService`, computed median) | Confidence is the sum of the factors shown | Cross-domain edges (water → sleep → attendance) come from **seeded `Relationship` rows**. No service writes them (`intelligenceService.js:11`, `queryService.js:104`), yet they read as findings | Replace with a measured before/after cohort effect (S4) or label them SEEDED |
| 08 | Predictive & Risk | Risk map, silent problems | Anomaly list, building risk | staff | `/risk`, `/risk/anomalies`, `/ai/predictive` (median / MAD, seasonal naive) | Statistical baseline, "Insufficient data" refusals | Anomalies are seeded (5); "silent problem" depends on seeded metric series | — |
| 09 | Intervention Center | Do nothing vs repair | Simulator; `assets` (repair or replace); `policyWhatIf` (replay) | admin | `/interventions/simulate`, `/:id/decision`, `/:id/quality`, `/xo/policy/replay` | Decision recorded against a named person; policy replay | Offline fallback shows "STUDENT SATISFACTION 92 %", "RESOLUTION TIME 2.4 hours" (`NexCamp.jsx:3598-3601`) as plain rows. Costs are labelled ILLUSTRATIVE | Rubber-stamp detector feeding the replay (S5) |
| 10 | Mission Control | Admin command | `CampusCommand.jsx`, `ext/MissionPanels.jsx` (unified pending queue, friction, proof of fix, SMS, FAQ, adoption), `xo/MissionXo.jsx` (exceptions inbox, touchless rate, ledger, event log, WhatsApp import, replay) | admin | `/admin/overview`, `/action-queue`, `/briefing`, `/ai/sla`, `/workload`, `/digital-twin`, `/correlations`, `/requests/pending`, `/xo/*` | Very broad and honest; exceptions-only inbox with UNDO | **Too much.** A judge cannot find the one number that matters. The pending queue is ranked by age / SLA / count, not by cost to students | **Friction-weighted queue** (S4); **promise kept-rate per office** (S2) |
| 11 | Hostel Gate Pass | Outing lifecycle | Inline in `NexCamp.jsx`; `XoWardenPanel`; QR scan (`lib/qrScanner.js`, jsQR) | student / warden / gate | `/gatepass/*` (guardian OTP, approve, scan, server-owned clock, overdue sweep), Touchless §7.3 | Complete lifecycle; server-owned clock; policy auto-approval after the guardian code | QR gate passes are what judges will see most often. The 2G budget is broken by the QR data URL (see §0) | Fix the payload; otherwise leave it |
| 12 | Service Kiosk | No-smartphone access | `components/intel/Kiosk.jsx`; unread-critical print list | warden / operator | `/kiosk/*`, `/documents/kiosk`, `/xo/reach/kiosk-list` | Real assisted channel with the operator recorded | API still says documents are unavailable ("no document module yet", `kioskController.js:85`, AUDIT B3 open) while the UI offers them | The errand box at the kiosk: the operator types what the student says once (S1) |
| 13 | Notice Center | Targeted notices + tracking | `ext/NoticesSurface.jsx`, `xo/ReachPanels.jsx` | all | `/notices/*` (audience, quiet hours, duplicate warning, dashboard), `/xo/notices` (reach target, ladder, hygiene, supersession) | Delivery / read / act funnel and escalation ladder: stronger than typical | Does not check whether a notice was *understood* | Notice-confusion detector (A6 #9) |
| 14 | Certificates | Request → verified PDF | `ext/DocumentsSurface.jsx`, `ext/VerifyPage.jsx` | student / office | `/documents/*`, `/verify/:code`, `applyDocumentPolicy` (§4.2) | Instant issue under a cited rule; tamper check | QR-verifiable PDFs are becoming common | `dueAt` exists on every request but is never scored kept / broken (S2) |
| 15 | Classes & Mess | Class and menu changes | `ext/ClassesSurface.jsx`, `xo/ChangePanels.jsx` | student / staff | `/timetable/*`, `/mess-menu/*`, `/xo/changes/*` (`changeService.propagate*`, shutdowns) | Change → notice → attendance projection chain | — | Change-collision check (A6 #10) |
| 16 | Fees & Dues | Read-only dues | `ext/FeesSurface.jsx`; fee-receipt copy §9.4 | student / accounts | `/fees/*`, `/xo/services` | Receipt copy decided by policy | Read-only; common | — |
| 17 | My Requests | One timeline | `ext/RequestsSurface.jsx` (tabs, decided-by, P50/P80) | student | `/requests/mine`, `/fix/*` | Cross-type timeline, "Is it fixed?" with reopen | Each request stands alone; no grouping by what the student actually asked | Errand bundles (S1); promise status per row (S2) |
| 18 | SMS Keyword Channel | Basic-phone access | `ext/SmsSurface.jsx`, two-phone work loop | student / staff | `/sms/simulate`, `/sms/inbound`; `smsKeywordService.parseCommand` (fixed keywords); `smsStaffService` (DONE / NEED PART / YES / NO) | Staff work loop by SMS is unusual | Free text returns UNKNOWN. **No certificate by SMS** (the Tuesday Mode demo says so) | Free-text errand SMS with a YES confirm (S1); `CERT` via the policy engine |
| 19 | Office FAQ | Cited answers | `ext/FaqSurface.jsx` (citations, rules citing sections, WhatsApp drafts) | all | `/faq/ask` (`faqService.rank`, keyword scoring, threshold 0.3), `/faq/request`, `/xo/faq/drafts` | Cites the exact section; a model may only rephrase, and number preservation is checked | **The loop is open.** An unanswered question becomes a complaint (`faqService.createRequest`, category OTHER), and the office's answer is never fed back. REGRESSION doc: "unanswered questions … are not yet fed back" | **Answer Memory** (S3) |
| 20 | You Said, We Did | Public accountability | `ext/BoardSurface.jsx`, before/after impact | public | `/board`, `/xo/board/impact` | No names; before/after | Shows only fixes. Does not show promises broken | Public **promise kept-rate** per office (S2) |
| 21 | Device Readiness | Low-end proof | `ext/DeviceSurface.jsx`, 2G workflow list | all | `workflow-budgets.json`, `device-readiness.json` (build-time) | Measured, not claimed | Currently shows a pass the code no longer achieves (gate pass is over budget). Entry chunk is 299 KB gzip | SMS fallback for a failed write (A6 #14) |

Header controls: **Replay incident** (`/demo/incident-story`), **Tuesday Mode** (`ext/TuesdayMode.jsx`), **Tuesday Test** (`xo/TuesdayTest.jsx`, four **scripted** errands run from the browser, then `/xo/tuesday/compare`).

### A2.2 Feature classification

| Feature | Class | Reason |
|---|---|---|
| Complaint form + status + categories | Common | Every team has one |
| Rule / "AI" classification & routing | Common | Most claim it; ours is honest about being keyword rules |
| Attendance %, what-if slider | Common | Standard |
| Mess menu, ratings, crowd | Common | Standard |
| QR gate pass | Common | The most repeated feature in this problem statement |
| Notices with targeting | Common → Moderate | Targeting is common; the **read / act funnel + escalation ladder** is moderate |
| PWA / offline banner / low-bandwidth mode | Moderate | Many claim it; few measure it |
| QR-verifiable certificate PDF | Moderate | Some strong teams will have it |
| Kiosk (assisted, operator recorded) | Moderate | Uncommon to build end to end |
| SMS keyword channel | Moderate | Some teams will mock it |
| Clustering into incidents + memory match | Moderate | Competitors will say "AI detects duplicates" |
| Deflection while typing (+1 & Follow) | Highly differentiated | Removes duplicate work at the source |
| Touchless Lane (cited policy decides, UNDO) | Highly differentiated | Few teams will encode policy as rules with citations |
| Friction Ledger from an event log | Highly differentiated | Measured, not claimed |
| P50/P80 ETAs with "Insufficient history" | Highly differentiated | Honest uncertainty is rare |
| False-closure detection + proof of fix | Highly differentiated | Rare |
| Change propagation (class → notice → attendance) | Highly differentiated | Rare as a chain |
| WhatsApp chaos import | Highly differentiated | Speaks directly to "two WhatsApp groups" |
| Policy replay what-if | Highly differentiated | Rare |
| SMS staff work loop | Highly differentiated | Rare |
| Tuesday Test (stopwatch, old vs new) | Potential signature, **already built** | Baseline now: do not re-propose; extend it |
| 3D campus, hash-chain audit, digital twin, Campus Pulse | Impressive but not differentiating for scoring | See A4 |

### A2.3 Code vs docs disagreements, and overclaims

| # | Where | Disagreement |
|---|---|---|
| D1 | `REGRESSION-EXCEPTION-ONLY.md` ("369/369", "4/4 budgets") | Today: 368/369 and 3/4, a time-of-day dependency (see §0) |
| D2 | Documentation PDF: 12 pages, 184 tests | 21 pages, 369 tests (I did not have the PDF; noted per the brief) |
| D3 | `NexCamp.jsx:4140-4141` "THE TEN SURFACES" | 21 surfaces (AUDIT B4, still open) |
| D4 | `kioskController.js:85` documents `available:false` | The kiosk UI issues documents (AUDIT B3, still open) |
| D5 | `Complaint.js:189` reference = `estimatedDocumentCount` | A reference collides after a delete (AUDIT B1, still open). `GatePass.js:103` the same (B2) |
| D6 | `Relationship` chains on 07 / ⌘K | Seeded, never computed. Default `kind` is "AI PREDICTION", which reads stronger than "seeded example" |
| D7 | Ledger median 0 h (`/xo/ledger`) | Correct arithmetic: policy decisions dominate the closed set. But a judge will read "0 h vs 72 h" as fake. It needs a per-type split in the headline |
| D8 | `NexCamp.jsx:3598-3601` offline fallback | "STUDENT SATISFACTION 92 %" with no ILLUSTRATIVE tag (this is the offline path only) |
| D9 | Demo password in the client bundle (`NexCamp.jsx:202`) | AUDIT B5, still open |

---

## A3. Competitor simulation (800–900 teams)

| Tier | What they will show |
|---|---|
| **Average (~60 %)** | Login; student dashboard with an attendance bar; complaint form with a status dropdown; mess menu with stars; a notice list; admin table + pie charts; maybe a chatbot answering FAQs with an LLM; "AI" = an LLM call classifying the complaint |
| **Strong (~30 %)** | Plus: QR gate pass with warden approval; push / WhatsApp-style notifications; certificate request with status; PWA; an Odia/Hindi toggle; SLA timers; a heatmap; a chatbot that "files complaints"; a Figma-polished UI |
| **Advanced (top ~5 %)** | Plus: duplicate detection with embeddings; predictive maintenance charts; SMS / IVR mock; kiosk mode; role-based dashboards; audit logs; a scripted demo story |

| Feature judges will see repeatedly | Ours |
|---|---|
| Dashboards | Present (not different on its own) |
| Chatbot | Ours is **not** a chatbot (the ⌘K intent matcher + FAQ with citations). Different in honesty, not in appearance |
| QR gate pass | Present; the guardian OTP + policy auto-approval + server clock are deeper, but judges will see "another QR pass" |
| Complaint form + status | **Meaningfully different**: deflection while typing, P50/P80 ETA, proof of fix, false-closure detection |
| Basic notifications | **Meaningfully different**: reach target, ladder, funnel, quiet hours |
| Attendance % bars | Present |
| Mess menu + stars | Present; change propagation is different |
| "AI classification" | Present, honestly labelled as rules |
| WhatsApp-style notice feed | Different: we *import* WhatsApp chaos instead of imitating it |
| PWA offline | Present + **measured** (page 21), but the entry bundle is heavy |

**Implication:** our depth sits in places a judge sees only if the demo points at it. The Tuesday Test does that, but it is still **scripted**: four buttons, not the student's own words. A strong competitor with an LLM chatbot can *look* equivalent in the first 30 seconds.

---

## A4. Features that look innovative but are not (for scoring)

| Feature | Why it doesn't score | What to do |
|---|---|---|
| 3D campus / landing scroll story | 0 % of the rubric; costs 176 KB gzip + GPU; hurts the 15 % low-end criterion if it loads first | **Demote**: keep it, but never open the demo on it; LOW mode already disables it |
| SHA-256 hash-chained audit | Invisible in 5 minutes; "tamper-evident" invites blockchain comparisons | **Keep quiet**: mention it only if asked "who changed this?" |
| Campus digital twin / Campus Pulse 0–100 | A composite index with seeded inputs; judges have seen many | **Demote** |
| Cross-domain relationship graph (07) | Seeded edges (D6) presented next to live evidence | **Reframe**: label as SEEDED EXAMPLE, or replace with a measured cohort effect (S4) |
| Raw count "21 pages" | Breadth is 20 %, but a page count reads as sprawl | **Reframe** as "3 channels × 4 workflows × 1 event log" |
| ⌘K copilot | Looks like every chatbot | **Keep**, but never lead with it |
| Anomaly / prediction (08) | Data is seeded; "predictive" is a claim everyone makes | **Keep quiet** unless asked |
| Morning briefing | Common | Keep |
| Mission Control with ~20 panels | Density hides the insight | **Reframe**: one ranked "cost to students" list at the top (S4) |

---

## A5. Innovation gap analysis

| Problem exists | Current systems don't solve it | Competitors unlikely to go deep | Our data / services already support it |
|---|---|---|---|
| The student has to decide *which office* for *each* task | Every portal has one form per office | They build more forms, or one chatbot that handles one intent | `policyEngine`, `classificationService`, `deflectionService`, `timetableService.answer`, `messChangeService`, `faqService.rank`, `feeService`: every router target exists. **Missing: a splitter and a dispatcher** |
| Nobody is accountable for timelines | Registers have no due dates | They show "status: pending" | `Complaint.aiClassification.slaHours`, `DocumentRequest.dueAt`, `etaService` P80, `Notice` action deadlines, shutdown `window.to`, the 48 h fix-confirmation expiry, the event log. **Missing: a Promise record and settlement** |
| Answers are not remembered | WhatsApp scrolls away | An LLM chatbot invents answers | `FaqQuery` (unanswered log), `FaqDraft` (from imports), `PolicySection` (citable), `faqService.createRequest` (office query as a complaint with a `resolution`). **Missing: resolution → draft → approved answer → measured deflection** |
| Admins prioritise by count or age | Every dashboard counts tickets | They add charts | Incident followers, building occupancy, `Attendance.sessions` (date + slot), event-log cohorts, the ledger. **Missing: a cost-to-students score** |
| Rules are never revisited | Policy is a PDF | Nobody encodes policy | `policy/exceptions` + staff decisions + `replayService`. **Missing: detect exceptions that humans always approve** |
| A bad network loses writes | "Try again" | PWA cache only | `lib/net.js` offline queue, `smsKeywordService` commands. **Missing: offer the same action as an SMS when a write can't reach the server** |

---

## A6. Innovation opportunities (18)

Criterion codes: **F** friction 30 %, **B** breadth 20 %, **V** admin visibility 20 %, **A** accessibility 15 %, **U** usability / demo 15 %.

| # | Name | Friction removed | Crit. | Why different | Stakeholder | Pages | Reused | New data | AI / stats role | Visual | Diff. | Demo | Wow | Why overlooked | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Errand Router: one sentence, many offices** | The whole Tuesday: 4 offices → 1 message | F, B, U | Splits one message into several routed workflows; chatbots handle one intent | student, kiosk operator | 02, 12, 17, 18, header | policyEngine/touchless, classify, deflection, timetable ask, mess changes, faq rank, fees, eventService, ledger | `ErrandBundle` (message, clauses, routed refs, channel) | Rules first (clause split on conjunctions and punctuation in EN / HI / OR + per-target keyword scores); optional model proposes a split, validated by jsonGuard and **never auto-executed** | Clause chips → cards per office → "4 errands, 0 staff" | M | High | High | Teams build "a chatbot" (one intent) | **EXTEND Tuesday Test** + NEW service |
| 2 | **Promise Ledger** | "Leaking for nine days": now every commitment has a date and a public kept-rate | V, F | Holds the institution to its own ETAs; no competitor scores themselves | students, admin, management | 05, 14, 17, 20, 10 | etaService, operationsIntelligence SLA, dueAt, notices, shutdowns, event log | `Promise` (subject, owner office, madeAt, dueAt, basis, settledAt, KEPT / BROKEN / OPEN) | Statistics only (kept rate, Wilson interval, "Insufficient data" < 5) | Row badge "due Thu 17:00 · on track"; board: "Plumbing kept 14 / 20" | M | High | High | Nobody volunteers to measure their own failures | NEW, backfilled from existing fields |
| 3 | **Answer Memory: the senior who knows** | Same question answered by a person every time | F, V | Office answers become cited, reusable answers; repeats are measured | students, office | 19, 10, 17 | faqService, FaqQuery, FaqDraft, PolicySection, complaint resolution, whatsappService | `OfficeAnswer` (or PolicySection `origin: OFFICE_ANSWER`), links to the query and request | Rules: word-overlap retrieval (existing). Optional model condenses the resolution into a draft; staff must approve | "Answered from CMP-2150 by Academic office, 3 Oct" + "repeat questions answered: n" | S–M | High | Med-High | An LLM chatbot "knows everything", so teams never build memory | **EXTEND faqService + FaqDraft** |
| 4 | **Friction-weighted queue (student-hours lost)** | Admins fix the loudest issue, not the costliest | V | Ranks by measured cost, not by count | admin, warden | 10, 06 | requests/pending, incidents, followers, Building occupancy, Attendance.sessions, ledger | none (computed) | Arithmetic: affected × hours open × weight (ASSUMPTION, editable) + classes missed (ACTUAL, when attendance links exist) | Top-5 with "≈ 212 student-hours lost so far", VIEW CALCULATION | M | High | Med | Needs an event log + cohorts, which competitors lack | **EXTEND unified pending queue** |
| 5 | **Rubber-stamp detector** | Staff approve the same exceptions every time | F, V | The system proposes its own rule change from human behaviour, then replays it | admin | 10, 09 | policy/exceptions, touchless decisions, replayService | none | Rate of human approval per failed condition (≥ 90 %, n ≥ 10) → draft rule → replay SIMULATED | "Wardens approved 18/19 outings that failed only 'return by 20:00' → try 21:00?" | S | High | High | Requires encoded policy + decision history | **EXTEND replayService** |
| 6 | Certificate by SMS | "Certificates have no SMS command" (Tuesday Mode) | A, B | Basic phone gets an instant, policy-decided certificate | student | 18, 14 | smsKeywordService, touchless applyDocumentPolicy | none | Rules | SMS: `CERT BONAFIDE scholarship` → "DOC-… issued under §4.2, collect PDF / verify code …" | S | High | Med | They mock SMS | **EXTEND smsKeywordService** |
| 7 | SMS fallback for failed writes | Poor network loses a complaint | A | When the offline queue can't send, offer a prefilled `sms:` link with the keyword form | student | 05, 21 | lib/net.js queue, smsKeywordService syntax | none | none | "No network? Send as SMS" button | S | High | Med | Low-bandwidth is usually "a PWA" | **EXTEND** net.js / OfflineBanner |
| 8 | Gate-pass 2G fix | 2G budget broken (§0) | A | Keeps a measured claim true | student | 11, 21 | gatePassController, `/gatepass/:id/qr` | none | none | Page 21 back to 4/4 | XS | — | Low | — | **Fix** (hygiene) |
| 9 | Notice-confusion detector | A notice that raises questions creates office traffic | V | Measures comprehension, not reads | admin | 13, 19 | FaqQuery, Complaint text, notices, word overlap | none | Word overlap between notice and questions / complaints within 48 h from the targeted cohort | "NTC-0012 produced 9 questions: rewrite?" | S | Med | Med | Nobody links FAQ logs to notices | NEW |
| 10 | Change-collision check | Class moved into a building under a water or power shutdown | F | Cross-checks changes before publishing | HoD, facility | 15, 13 | ChangeEvent, shutdown windows, timetable rooms | none | Rules (time / room overlap) | Warning on publish | S | Med | Med | Needs both change types | **EXTEND changeService** |
| 11 | Promise what-if | "If plumbing had one more technician…" | V | Capacity arithmetic from history | admin | 09, 10 | resolution history, promises | none | M/M/c-style arithmetic, labelled SIMULATED + ASSUMPTION | Kept-rate before/after slider | M | Med | Med | — | NEW (after #2) |
| 12 | Kiosk "my day" slip | Non-smartphone student leaves with nothing | A | One printed slip: pending requests, promises, unread critical notices | student, operator | 12 | kiosk lookup, requests/mine, promises, reach kiosk list | none | none | Print view | S | Med | Low | — | **EXTEND Kiosk** |
| 13 | Silent-affected broadcast | 132 residents, 17 complain, the rest wonder | F | Proactively tells the affected cohort "known, ETA X", which cuts duplicates | residents, warden | 06, 13 | reachService, incidents, deflection, ETA | none | none; duplicates-after measured | "Send status to 115 not-yet-reporting residents" | S | High | Med | — | **EXTEND reachService** |
| 14 | Errand-level ledger | Ledger is per request; the Tuesday is per *person* | V, U | "Your Tuesday: 4 errands, 18 s, 0 visits" | student | 02, 17 | ledgerService | via #1 | Arithmetic | Card | S | High | Med | — | via #1 |
| 15 | Rule citations in rejections | "Rejected" with no reason | F | Every human rejection must cite a section or name one | office | 14, 11 | PolicySection, reject reasons | optional `citedSection` | none | "Rejected under §4.2(b)" | S | Med | Low | — | **EXTEND** reject paths |
| 16 | Exceptions heatmap by condition | Which rule causes the most human work | V | Directly actionable | admin | 10 | policy/exceptions | none | Counts | Bar list | XS | Med | Low | — | **EXTEND** (feeds #5) |
| 17 | Duplicate-effort detector for staff | Two departments working the same room | V | Rare | staff | 10 | complaints, departments, rooms (`closureService.roomOf`) | none | Rules | Flag | S | Low | Low | — | NEW, low priority |
| 18 | Warden shift handover by SMS | Night warden has no context | A, V | Uses the existing SMS work loop | warden | 18 | smsStaffService, exceptions inbox | none | none | SMS digest | S | Low | Low | Common idea | EXTEND, low priority |

**The "would a strong team already think of this?" test**

- #1: they think of "chatbot", not "one message → N routed workflows with policy decisions and a ledger". **Kept.**
- #2: they think of "SLA timer". A *public kept-rate per office* is one level deeper. **Kept.**
- #3: they think of "FAQ bot". A *closed loop with measured repeat deflection* is deeper. **Kept.**
- #4: they think of "priority". *Cost in student-hours* is deeper, but the data is thin (see A11). **Kept, as Should-have.**
- #5: they are unlikely to have encoded policy at all. **Kept.**
- #17 and #18: a strong team might do these, and their value is low. **Dropped from the roadmap.**

---

## A7. Cross-page intelligence

Existing links in code:

| Link | Where | Status |
|---|---|---|
| Complaint → Incident (cluster) | `incidentClusteringService`, `Complaint.incident` | exists |
| Incident → CampusMemory match | `memoryService.findMatches` | exists |
| Complaint → planned shutdown | `changeService.linkComplaint`, `plannedChange` | exists |
| Class change → notice → attendance projection | `changeService.propagateClassChange` | exists |
| Menu change → demand estimate | `changeService.propagateMenuChange` | exists |
| Attendance session → incident | `Attendance.sessions[].linkedIncident` | field exists, **seeded only** |
| Cross-domain chains | `Relationship` | **seeded only** (D6) |
| Hostel co-occurrence | `operationsIntelligenceService.correlate` | exists (same window, not temporal) |
| Everything → CampusEvent (cohort, channel, touch) | `eventService.emitEvent` | exists: **this is the spine** |

New chains proposed. Each is marked by which links already exist and which are new.

1. **Errand → promise → board** (S1 + S2): one message (02 / 12 / 18) → N events → each routed workflow makes a Promise → settled from events → per-office kept rate (20) → management sees which office breaks promises (10). *Existing: events, ETA, SLA. New: bundle, promise.*
2. **Question → request → answer → deflection** (S3): FAQ miss (19) → office request (17) → resolution → approved answer → the next identical question is answered (19) → "repeat questions answered" (10). *Existing: FaqQuery, createRequest, resolution. New: the feedback edge.*
3. **Incident → cohort attendance → cost** (S4): open incident (06) → residents of the building (Building / User) → their 8:00 sessions before vs after onset (03) → student-hours lost → queue rank (10) → fix → the after window shows recovery (20). *Existing: sessions, cohorts. New: the measured delta, replacing the seeded `Relationship` chain.*
4. **Exceptions → rule proposal → replay → activation** (S5): 10 → 09 → 10. *Existing: all parts. New: the detector.*
5. **Notice → confusion → rewrite** (#9): 13 → 19 / 05 → 13.

**Lightest architecture:** keep the Campus Event log as the spine. Add two small collections (`ErrandBundle`, `Promise`) and one optional field on `PolicySection` (or a sibling `OfficeAnswer`). Settlement is a pure function over events, run on read and in the existing `extMonitor` timer. No page is redesigned; each new view is an `XoSlot`-style lazy panel under a new `signature/` namespace.

---

## A8. What-if / simulation

**Existing:** attendance (`/attendance/simulate`), mess (`/mess/simulate`), intervention (`/interventions/simulate`), load / backlog (`/ai/simulate`, `operationsIntelligenceService.simulateLoad`), policy replay (`/xo/policy/replay`).

**New, and only where it is relevant:**

| What-if | Input | Reasoning | Simulation | Output | Recommended action | Measurable result |
|---|---|---|---|---|---|---|
| **Promise capacity** (#11) | Office, +k staff or a changed promised hours | Historical service times per office (event log) | Replay the last 30 days' arrivals through c + k servers (deterministic queue arithmetic) | Kept rate now vs simulated; SIMULATED + ASSUMPTION badges | "Promise 72 h instead of 48 h, or add 1 technician on Tue / Wed" | Kept rate in the next 30 days vs the simulation |
| **Rubber-stamp rule** (#5) | Condition + proposed value | Human approval rate on exceptions failing only that condition | Existing replay with the edited rule | Requests that would have been touchless; staff minutes saved (ASSUMPTION 6 min) | Activate the draft | Touchless rate after activation (ACTUAL) |
| **Notice timing** (optional) | Publish hour | Read latency by hour from receipts | Empirical distribution | Expected % read in 2 h | Schedule | Funnel after publish |

---

## A9. Signature innovation candidates

Summary: **S1** is a new way to *use* the whole system, **S2** measures the institution's own accountability, and **S3** closes a knowledge loop the problem statement names explicitly ("the senior who usually knows"). Together they answer the Tuesday story end to end.

### S1. "One sentence, many offices" — the Errand Router
- **Why unusual:** chatbots resolve one intent into an answer. This resolves one message into **several real workflows in several offices**, each decided by policy or routed with a reason, then **tracked and measured as one bundle**.
- **Problem solved:** the Tuesday itself. The student no longer needs to know which office, form or channel.
- **How it works:**
  1. A deterministic clause splitter: sentence punctuation plus connectors in EN (and, also, plus, then), HI (aur, bhi, phir) and OR (ଓ, ଆଉ), romanised forms included.
  2. Each clause is scored against targets: CERTIFICATE (bonafide, certificate, scholarship…), COMPLAINT (existing `classify()`), CLASS_CHECK (cancel, class, tomorrow…), MENU_CHECK, FEES, GATE_PASS, FAQ (`faqService.rank` ≥ 0.3), else OFFICE_QUERY.
  3. The **plan** is returned without writing anything. The student confirms (web button, kiosk operator, or SMS `YES`).
  4. Execute through the existing services: `requestDocument` + `applyDocumentPolicy`, `similarOpenIncident` → follow or `createComplaint`, `timetableService` answer, `messChangeService`, fee status, `faqService.ask`.
  5. Save an `ErrandBundle` with refs, and emit events with `payload.bundleId`.
- **Data needed:** everything already exists except the bundle.
- **AI / statistics:** none required. An optional model can propose a split for messy text, but its output only fills the plan, goes through jsonGuard, cannot invent a target, is labelled `AI_MODEL`, and still needs the confirm. The rules are better here: they are predictable and demo-safe.
- **Where it appears:** a box on 02 (student), 12 (kiosk operator types for the student), 18 (free-text SMS instead of UNKNOWN), and the **Tuesday Test** gains "TYPE IT INSTEAD" with the PS07 sentence prefilled. 17 groups the bundle.
- **60-second demo:** paste *"I need a bonafide certificate for my scholarship, the tap in B-214 has been leaking for nine days, is tomorrow's DBMS class cancelled and did the mess menu change?"* → four chips → CONFIRM → certificate issued under §4.2, +1 on the open Hostel B incident (no duplicate), the class answer, the menu change. The ledger card reads *"1 message · 4 offices · 0 staff touches · 11 s"*, from the event log. Then the same message by SMS from the basic phone (page 18), with the reply under 160 characters.
- **Hard to replicate casually:** it needs policy-encoded decisions, deflection, a timetable, menu changes and an event log to *do* the errands. A chatbot can only talk about them.
- **Risks:** mis-splitting. Mitigated by plan-then-confirm and "I didn't understand this part → ask the office". Over-promising NLP. Mitigated by labelling it `RULE_BASED_CLAUSE_SPLIT`. Odia connectors need a native check.

### S2. The Promise Ledger
- **Why unusual:** systems track the *student's* compliance (attendance, dues). This tracks the **institution's** compliance with what it told the student.
- **Problem solved:** "leaking for nine days" is a broken promise that nobody recorded.
- **How it works:** a Promise is created when a system *shows* a commitment: the complaint SLA hours, `DocumentRequest.dueAt`, the ETA P80 shown on 05 (when it is ACTUAL DATA), a notice's action deadline (the office's promise to process), a shutdown's `window.to` (settled by any complaint in that building and category after the end), and the 48 h fix-confirmation window. Settlement is a pure function over events: KEPT if the outcome event lands ≤ `dueAt`, BROKEN if `dueAt` passes first, OPEN otherwise. There is a backfill for existing records.
- **AI / statistics:** kept rate with a Wilson 90 % interval, and "Insufficient data" under 5 settled promises. No model.
- **Where it appears:** 17 (per row: "promised by Thu 17:00 · on track / kept / broken by 2 d"), 20 (public, per office, no names), 10 (per office and trend; the promise what-if later), 05 (the ETA now says "we'll hold ourselves to this").
- **60-second demo:** on 20, "Maintenance · Plumbing kept 9 of 21 promises (43 %, 90 % CI 27–60 %)". Click → the broken ones → CMP-… "promised 48 h, took 9 days". Back on 10: the same number for management.
- **Hard to replicate:** it needs an honest event log and SLAs per request type, and the willingness to show your own failures.
- **Risks:** seeded history makes the numbers look staged. They are labelled ACTUAL DATA for records in the database, and the README says the seed is demo data. Offices may dislike public shaming, so the public page shows offices, never people.

### S3. Answer Memory — "the senior who knows", kept
- **Why unusual:** it turns resolved office queries into **cited, approved answers**, and measures how many repeat questions they absorb.
- **How it works:** the FAQ miss → `createRequest` (exists) → the office resolves the complaint with a written answer (the existing `resolution` flow) → a hook creates an `AnswerDraft` (reusing the `FaqDraft` shape, `origin: OFFICE_REQUEST`) → staff approve (edit allowed) → it becomes a `PolicySection` with `origin: OFFICE_ANSWER`, `source: "Academic office, CMP-2150, 3 Oct"` → `faqService.rank` retrieves it. WhatsApp-import drafts use the same approval queue. The metric: questions answered by office answers, and the share of `FaqQuery` misses before vs after, from `FaqQuery.answered`.
- **AI:** optional. It condenses the resolution into an answer, runs the number-preservation check that already exists, and still needs human approval.
- **60-second demo:** ask "When will the scholarship verification letter be ready?" → no section → SEND TO OFFICE → as the admin, answer it → APPROVE AS ANSWER → as a second student, ask the same question in other words → answered, citing the office's reply. The counter reads "1 repeat answered · 0 staff minutes".
- **Risks:** answers go stale, so each carries a `reviewBy` date and expires to a draft. The seed data is small.

### S4 (supporting). Friction-weighted queue
Covered in A6 #4. It is not a headline signature because the student-level attendance data is thin (a few seeded students). It *can* be defended if the affected count uses Building occupancy, labelled ESTIMATE, and the attendance effect says "Insufficient data" unless ≥ 20 sessions exist on both sides.

### Hypotheses from the brief, verified

| Hypothesis | Verdict |
|---|---|
| One sentence, many offices | **Holds.** There is no multi-intent splitter anywhere: `copilotService.detectIntent`, `queryService.detectIntent` and `studentIntelligenceService.detectIntent` each return one intent, and the Tuesday Test is scripted (`TuesdayTest.jsx:107-110`) |
| Institutional memory | **Holds.** `faqService.createRequest` files a complaint and nothing reads its resolution back. REGRESSION doc confirms the loop is open |
| Promise ledger | **Holds.** ETAs, SLA breaches and `dueAt` exist, but nothing records kept vs broken per office, and nothing is student-facing |
| Friction-weighted prioritisation | **Partly holds.** The data for student-hours is thin; the build must be conservative and labelled |

---

## A10. Comparison matrix

| Innovation | Problem relevance | Differentiation | Technical depth | Demo impact | Feasibility | Cross-page | AI depth | Criterion moved |
|---|---|---|---|---|---|---|---|---|
| S1 Errand Router | High | High | Medium | High | High | High | Low (optional) | F, B, U |
| S2 Promise Ledger | High | High | Medium | High | High | High | Low (stats) | V, F |
| S3 Answer Memory | High | Medium-High | Low-Med | Medium | High | Medium | Low-Med (optional) | F, V |
| S4 Friction-weighted queue | Medium-High | Medium-High | Medium | Medium | Medium | High | Low (stats) | V |
| #5 Rubber-stamp detector | Medium | High | Medium | High (for admins) | High | Medium | Low | F, V |
| #6 CERT by SMS | High | Medium | Low | Medium | High | Low | None | A, B |
| #7 SMS fallback for writes | Medium | Medium-High | Low | Medium | High | Low | None | A |
| #9 Notice confusion | Medium | High | Low-Med | Medium | Medium | Medium | Low | V |
| #10 Change collision | Medium | Medium | Low | Low-Med | High | Medium | None | F |
| #11 Promise what-if | Medium | High | Medium | Medium | Medium | Medium | Low | V |
| #13 Silent-affected broadcast | Medium-High | Medium | Low | Medium | High | Medium | None | F |

- **Foundational (3):** S1 Errand Router, S2 Promise Ledger, #8 gate-pass 2G fix. The first two carry the demo; the third makes an existing claim true again.
- **Advanced (3):** S3 Answer Memory, #5 Rubber-stamp detector, #6 + #7 SMS parity (certificate by SMS, SMS fallback for failed writes).
- **Experimental (3):** S4 friction-weighted queue (thin data), #11 promise what-if (queue assumptions), #9 notice confusion (word overlap can mislead).

**Trade-offs.** S1 has the highest demo impact but the highest misparse risk. Plan-then-confirm is non-negotiable. S2 is the most defensible and the most uncomfortable: it shows real broken promises in our own seed (25 SLA breaches). S3 is cheap and on-message, but it looks modest unless the demo shows the second student being answered. The experimental items add visibility (20 %), but they are where an honest "Insufficient data" is most likely to appear on screen.

---

## A11. Implementation reality check (top 6)

| | S1 Errand Router | S2 Promise Ledger | S3 Answer Memory | #5 Rubber-stamp | #6 + #7 SMS parity | #8 Gate-pass 2G |
|---|---|---|---|---|---|---|
| Additive without breaking? | Yes: new service and route; calls existing services; no existing response changes | Yes: new collection, settlement on read, backfill script | Yes: one optional field or new collection; one hook after a complaint resolves | Yes: a read-only analysis + existing draft / replay | Yes: a new SMS keyword before UNKNOWN; UNKNOWN still returns HELP when the splitter finds nothing | Needs care: shrinking `qr.dataUrl` (smaller scale / margin, or SVG) keeps the field. **Dropping** it would remove an API field. Decision needed (A14) |
| Pages that change | 02, 12, 17, 18 (+ Tuesday Test panel) | 05, 17, 20, 10 | 19, 10 | 10 (09 replay prefilled) | 18, 21 | none visibly; 21 shows 4/4 |
| Must not change | Tuesday Test's scripted run (kept; "TYPE IT" is an alternative) | existing ETA / SLA outputs | existing FAQ answer shape | live rules until an admin activates | existing keywords and replies | QR must still scan |
| Backend | `services/signature/errandService.js` (split, plan, execute), `models/signature/ErrandBundle.js`, `controllers/signature`, `routes/signature` mounted at `/api/sig`; hooks: `routes/index.js`, `smsKeywordService` (free-text branch) | `models/signature/Promise.js`, `services/signature/promiseService.js` (make, settle, stats, backfill); hooks in complaint create, document request, notice publish, shutdown, fix proof: one `makePromise()` line each (or backfill-only first) | `services/signature/answerMemoryService.js`; `PolicySection.origin`, `reviewBy` (optional); hook in the complaint resolve path for `Office query:` complaints | `services/signature/rubberStampService.js` | `smsKeywordService` `CERT` command → `requestDocument` + policy | `gatePassController` render size |
| Reused | policyEngine, touchless, classificationService, deflectionService, timetableService, messChangeService, feeService, faqService, eventService, ledgerService | etaService, operationsIntelligence SLA, eventService, extMonitor | faqService, FaqDraft, PolicySection, whatsappService drafts | touchlessService.exceptionsInbox, replayService | smsKeywordService, certificateService, touchless | qrcode |
| Algorithm | Rules: clause split + keyword scoring; optional model split behind jsonGuard | Pure settlement; Wilson interval | Word-overlap retrieval (existing); optional model condense + number check | Approval ratio per failed condition, n ≥ 10, ≥ 90 % | Rules | — |
| Open source | none new | none new | none new | none new | none new | none new |
| Demo seed | `seed/signature`: 2 prior bundles; the PS07 sentence as a sample | Backfill from existing complaints / documents / shutdowns (already 25 breached SLAs) | 3 office queries resolved with answers, 1 approved, 1 pending | ~15 exception decisions where wardens approved late returns | a registered demo number | — |
| Hours vs days | 1.5 days (EN), +0.5 day HI / OR connectors + tests | 1 day | 0.75 day | 0.5 day | 0.5 day | 1–2 h |
| Prototype label | `RULE_BASED_CLAUSE_SPLIT`; any model split labelled AI_MODEL + "confirm before anything is filed" | ACTUAL DATA for kept / broken; the backfill marks `origin: BACKFILL` | Approved answers = EVIDENCE; drafts = DRAFT | RECOMMENDED ACTION; replay = SIMULATED | SIMULATED SMS unless a provider is set | — |

---

## A12. Judge demo strategy

| Time | What the judge sees |
|---|---|
| **10 s** | The header **TUESDAY TEST → TYPE IT**, with the PS07 sentence prefilled. One message box, no page tour |
| **30 s** | Four chips split out (certificate · complaint · class · menu), each naming its office and whether policy or a person decides. CONFIRM |
| **1 min** | Four outcomes as the pages move (existing Tuesday Test navigation): DOC issued under §4.2; +1 on the Hostel B incident (no duplicate); the class answer; the menu change with its reach funnel. Result card: **"1 message · 4 offices · N staff touches · T s"**. Touches and seconds come from `/xo/tuesday/compare` over events **created in this run**; nothing is hard-coded |
| **3 min** | Page 18: the same sentence by SMS from the basic phone → the plan in 160 characters → reply YES → the same four outcomes. Page 17: the bundle, each row with its **promise** ("due Thu 17:00"). Page 20: **Plumbing kept 9 / 21 promises** (live), then click into a broken one |
| **5 min** | Page 19: Answer Memory (an office answer is reused for the second student). Page 10: the rubber-stamp suggestion → replay SIMULATED → "would have made 18 more outings touchless". Close on the ledger. **Replay incident** stays available for the incident-intelligence story if a judge asks "where's the AI?" |

The before / after number is the Tuesday Test's own comparison (the ledger's old path is ASSUMPTION; this run is MEASURED IN THIS DEMO / ACTUAL DATA), now per *bundle*.

---

## A13. Final blueprint

- **A. Existing system:** 21 pages; an event-log spine; policy-decided touchless lane; honest labels; three channels (app, kiosk, SMS); measured ledger; Tuesday Test. 369 tests (368 pass today).
- **B. Major gaps:** no multi-errand intake; no accountability for promises; an open knowledge loop; queue ranked by count; a 2G claim that has regressed; a heavy entry bundle (299 KB gzip); seeded relationship chains read as findings.
- **C. Competitor baseline:** dashboards, complaint forms, QR gate passes, notice feeds, an LLM chatbot, PWA.
- **D. Opportunities:** A6 (18 items; 16 kept).
- **E. Signature concept:** **"Tell us your Tuesday once."** One message, routed to every office, decided by written policy where possible, tracked as promises the college is publicly held to, and remembered so the next student doesn't have to ask. (S1 + S2 + S3.)
- **F. Supporting innovations:** rubber-stamp detector, SMS parity (certificates, fallback for failed writes), gate-pass 2G fix, friction-weighted queue.
- **G. Cross-page intelligence:** A7 chains 1–4 on the Campus Event log.
- **H. AI architecture:** rules decide everything. An optional model sits in exactly three places: (1) proposing a clause split for messy text, (2) condensing an office resolution into a draft answer, (3) rephrasing (exists). All three go through jsonGuard, carry `source` provenance, and need a human or student confirm. No model sets a promise, a verdict, a priority floor or a number.
- **I. Data flow:** message → `ErrandBundle` (plan) → confirm → existing services write their records → `emitEvent` (with `bundleId`) → `Promise` created → settlement from later events → ledger / board / queue read them.
- **J. User flow:** *user*: types once, confirms once, later answers "Is it fixed?". *Automatic*: split, route, policy decisions, deflection, promise creation, settlement, reach ladder, answer reuse.
- **K. Demo flow:** A12.
- **L. Roadmap:**

| Priority | Item | Effort |
|---|---|---|
| **Must have** | #8 gate-pass 2G fix (restores a green suite and a true page-21 claim) | 1–2 h |
| **Must have** | S1 Errand Router: web (02 + Tuesday Test "TYPE IT"), kiosk (12), SMS free text (18), bundle in 17; EN + HI / OR connectors; tests | 2 days |
| **Must have** | S2 Promise Ledger: model, settlement, backfill, 17 / 20 / 10 panels; tests | 1 day |
| **Should have** | S3 Answer Memory | 0.75 day |
| **Should have** | #6 CERT by SMS + #7 SMS fallback for failed writes | 0.5 day |
| **Should have** | #5 Rubber-stamp detector → replay | 0.5 day |
| **If time allows** | S4 friction-weighted queue; #13 silent-affected broadcast; #11 promise what-if; #9 notice confusion; hygiene D3 / D4 / D6 / D8 labels | 0.5–1 day each |

Every item follows the brief's constraints: `SIGNATURE HOOK (see CHANGES-SIGNATURE.md)` comments, a `CHANGES-SIGNATURE.md` log with "lines removed and why", i18n keys (EN / OR / HI), lazy chunks, `?lite=1`, and the offline queue for writes.

---

## A14. Questions / missing information

1. **Time left before judging, and team size?** This decides whether Should-haves fit. The Must-haves are about 3.5 days of focused work for one engineer.
2. **Gate-pass fix approach:** may I *shrink* `qr.dataUrl` (keeps the field, smaller PNG or SVG), or would you rather omit it under `?lite=1` only (the budget test would then need a lite path, which is a new test, not an edit)? I recommend shrinking.
3. **Public promise kept-rate per office on page 20:** acceptable for your college's optics? The alternative is admin-only (page 10), with the students seeing only their own promises.
4. **Odia / Hindi connectors for the splitter:** can a team member check the Odia list (ଓ, ଆଉ, ଏବଂ) and common romanised Hindi ("aur", "bhi")?
5. **Hosting for judging:** a local laptop or a deployed URL? A real SMS gateway (MSG91 / Fast2SMS credentials) or the console simulator?
6. **Real college data:** is any real policy text (bonafide / outing rules) available to replace the seeded §4.2 / §7.3?
7. **Existing open AUDIT items (B1 reference collision, B3 kiosk text, B4 "ten surfaces", B5 demo password):** fix them in this pass as hygiene (each one is a small hooked edit), or leave them as they are?
8. The documentation PDF was not in the ZIP. I relied on the brief's description of it (12 pages, 184 tests).

---

**Stage A ends here. No feature code has been written. Waiting for your approval of which items to build.**
