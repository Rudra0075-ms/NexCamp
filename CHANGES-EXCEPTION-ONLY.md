# Change log — The Exception-Only Campus

Every change the Exception-Only Campus made to a file that existed before it
(baseline: commit `9361d07`). Each edit in an existing file is marked in the
code with a comment `EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md)`.
Everything else is in new files under `backend/src/{models,services,controllers,routes,seed}/xo/`,
`frontend/src/xo/` and the new tests and scripts listed at the end.

**Nothing was removed.** No existing file was deleted (`git diff --diff-filter=D 9361d07` is
empty). No route, API response field, button, workflow, mode or seed record was
removed or renamed. Every line the diff shows as removed in an existing file is
listed below with what replaced it: each one is a line that was *extended* in place
(an extra field, an extra argument, a comment) or a hard-coded figure that is now
computed, with the old text kept as the fallback.

Model changes are optional fields with safe defaults (or an extra enum value). There
are no migrations: records written before this work read exactly as before.

No existing test was edited or deleted. The suite grew from 297 tests to 369.

## Backend — existing files

| File | What changed | Lines removed and why |
|---|---|---|
| `package.json` | Added scripts `seed:xo`, `smoke:xo`, `budgets`. | The `smoke:ext` line gained a trailing comma. |
| `src/config/constants.js` | `AUDIT_ENTITIES.push(...)` for the new audited entity types (CampusEvent, PolicyRule, ServiceBooking, ChangeEvent, ImportBatch, Asset, PolicySimulation, StaffPhone, SmsOutbox). | — |
| `src/routes/index.js` | Mounts `/api/xo` (public `/xo/ledger/public` before `authenticate`, the rest after all existing routers). | — |
| `src/controllers/complaintController.js` | Emits campus events on create / status change / resolve; links a new complaint to a planned shutdown (`plannedChange`, optional field in the response). | `const attachment = await attachToIncident(complaint);` — same call, now followed by the planned-work check. |
| `src/controllers/gatePassController.js` | Events; after the guardian OTP, the Touchless Lane policy decides in-policy passes (`decidedBy`, `policy` added to the response). | The OTP response line now also returns `policy`; `gatePass` and the message are unchanged. A pass a person decides is marked `decidedBy: HUMAN`. |
| `src/controllers/adminController.js` | Median response time computed from resolved history; `writtenBy` on the briefing. | The briefing sentence used a fixed "3.8-day median"; it now uses the computed median, with 3.8 kept as the labelled fallback. |
| `src/controllers/kioskController.js` | `KIOSK_REQUEST` event. | — |
| `src/controllers/ext/documentController.js` | `applyDocumentPolicy` after `requestDocument`: an in-policy bonafide is issued at once under its cited rule; `policy` added to the response. | The two lines creating and returning the request now pass through the policy step; the response keeps every field of `shapeDocument`. |
| `src/services/investigationService.js` | Median response days computed from resolved complaints (`medianResponseDays`, `medianKind`, `medianSamples`). | The constant `MEDIAN_RESPONSE_DAYS = 3.8` became the fallback when history is too short; `deriveCauses` / `buildBrief` take the computed median as an extra argument. |
| `src/services/gatePassService.js` | `GATEPASS_OVERDUE` event. | — |
| `src/services/incidentClusteringService.js` | Exports the existing `pairScore` so "known issue" deflection reuses the same score. | — |
| `src/services/ext/certificateService.js` | Events on request / review / issue / reject. | — |
| `src/services/ext/noticeService.js` | Events; optional reach target, supersession and `overrideQuietHours` for transactional notices. | `publishDecision(...)` is now `let` so a transactional override can publish during quiet hours; the receipt shape gained fields after `actionDoneAt`. |
| `src/services/ext/requestTrackerService.js` | Fee-receipt copies (`service`) appear in My requests; `decidedBy` on rows. | The `reopen` status list, the reopen rows and `byKind` gained a trailing entry; nothing dropped. |
| `src/services/ext/feeService.js`, `fixService.js`, `messChangeService.js`, `timetableService.js`, `extMonitor.js` | Campus events (and change propagation for class / menu changes). | — |
| `src/services/ext/smsKeywordService.js` | Before its own dispatch, `handleXoSms` handles staff `DONE` / `NEED PART` and student `YES` / `NO`; it returns `null` for every other message, which then runs exactly as before. `SMS_REQUEST` event. | — |
| `src/models/GatePass.js`, `ext/DocumentRequest.js`, `ext/Notice.js`, `ext/NoticeReceipt.js` | Optional fields: `decidedBy`, `policy`, `policyUndo`, reach target, supersession, receipt ladder. | — |
| `src/models/ext/FrictionBaseline.js` | Optional old-path fields (`hops`, `touches`, `officeVisits`, `oldPath`). | `label` line gained a trailing comma. |
| `src/models/ext/SmsMessage.js` | Extra outcome `REFUSED`; optional `staff` field. | The `outcome` enum line gained one value. |
| `src/seed/index.js` | Runs `seedExceptionOnly` after the existing seeds (skip with `--no-xo`), flushes events before disconnecting. | — |

## Frontend — existing files

| File | What changed | Lines removed and why |
|---|---|---|
| `src/NexCamp.jsx` | Imports from `xo/`; `XoSlot` panels on pages 01, 02, 03, 04, 05, 06, 09, 10; `XoMissionControl` (10), `XoWardenPanel` (11), `XoTuesdayButton` beside REPLAY INCIDENT. Page 01/06 headline and figures read the live lead incident, with the original sentences as the fallback. | 24 SVG lines: `stroke-width` / `font-family` / `font-size` → `strokeWidth` / `fontFamily` / `fontSize` (the pre-existing React DOM-property warning on page 09). "Semantic" → "wording" in five labels (the clustering is lexical, so "semantic" overstated it). "AI-GENERATED MORNING BRIEFING" now says who wrote it (`AI-WRITTEN …` or `… FROM LIVE COUNTS`). The fixed date "MONDAY 15 SEPT · 11:42 IST" is now today's date. "Median 3.8 days" is labelled ASSUMPTION or replaced by the computed median. "17" / "Seventeen complaints" come from the live cluster, falling back to the same text. Cost figures on page 09 are labelled ILLUSTRATIVE. The Student dashboard line gained a hook comment. The header row holding REPLAY INCIDENT may now wrap (`flex: 0 1 auto; flex-wrap: wrap`) so TUESDAY TEST is not clipped at 390 px; at desktop widths it lays out as before. |
| `src/lib/i18n.js` | One loop merging `XO_OR` / `XO_HI` for keys not already present (no existing translation changes). | — |
| `src/components/intel/Kiosk.jsx` | Printable list of students with unread critical notices (page 12). | — |
| `src/ext/DocumentsSurface.jsx` | Policy preview before submit, the verdict with citation after, staff UNDO, ETA. | `RequestForm`, `DocRow` and `DocumentsSurface` signatures gained optional props; the success message and list lines gained the verdict. |
| `src/ext/RequestsSurface.jsx` | Fee-receipt copies tab (shown only when there are any), who decided and why, P50/P80 ETAs. | `KIND_LABEL` and the tab list gained one entry. |
| `src/ext/FeesSurface.jsx` | "Copy of a fee receipt" under policy §9.4. | Signature gained an optional prop. |
| `src/ext/FaqSurface.jsx` | Rules citing a section; a section opened from a rule; FAQ drafts from imported chats. | `Ask` / `FaqSurface` signatures and the tab line gained optional props. |
| `src/ext/NoticesSurface.jsx` | Reach target, supersession, quiet-hours override, hygiene checks, reach funnel, class-rep list. | The compose result message and the tab line gained the new options. |
| `src/ext/ClassesSurface.jsx` | Planned shutdowns and the propagation log (staff). | The staff tab block was wrapped in a fragment to add the panel. |
| `src/ext/BoardSurface.jsx` | Before/after-fix impact per recurring issue. | — |
| `src/ext/SmsSurface.jsx` | Two-phone SMS work loop below the existing phone (lazy chunk). | — |
| `src/ext/DeviceSurface.jsx` | Everyday tasks on 2G (lazy chunk). | — |

## New files

Backend: `src/models/xo/*` (CampusEvent, PolicyRule, ServiceRequest, Asset, IncidentFollow,
CohortContact, ChangeEvent, ImportBatch, FaqDraft, StaffPhone, SmsOutbox),
`src/services/xo/*` (event log, backfill, policy engine / rules / facts, touchless lane,
ledger, ETA, closures, assets, deflection, impact, reach, change propagation, WhatsApp
import, replay, SMS work loop, Tuesday Test), `src/controllers/xo/*`, `src/routes/xo/index.js`,
`src/seed/xo/*`, `seed/sample-*` (WhatsApp exports in both formats, complaint diary CSV),
`scripts/xo-smoke.js`, `scripts/workflow-budgets.js`, `scripts/lib/workflowBudgets.js`,
`test/xo-unit.test.js`, `test/xo-integration.test.js`, `test/xo-budget.test.js`.

Frontend: `src/xo/*` (panels, api client, i18n entries, CSS, Tuesday Test),
`scripts/page-check.mjs`, `public/workflow-budgets.json` (written by `npm run budgets`).

Docs: this file, [`REGRESSION-EXCEPTION-ONLY.md`](REGRESSION-EXCEPTION-ONLY.md) (baseline vs final, page by page, and what was not completed), and the README section "The Exception-Only Campus".
