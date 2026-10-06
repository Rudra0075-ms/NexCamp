# PLAN — PS07 extension pack (add-only)

Baseline: git tag `baseline` = commit `76b33d7` (byte-identical to the supplied ZIP).
Baseline checks recorded before any change:

| Check | Result |
| --- | --- |
| `npm test` (backend) | **184 / 184 pass** |
| `npm run smoke` | 70 passed, 0 failed |
| `npm run smoke:gatepass` | 43 passed, 0 failed |
| `npm run smoke:ai` | 132 passed, 0 failed |
| `npm run smoke:ops` | 70 passed, 0 failed |
| `npm run build` (frontend) | builds |

Environment note: MongoDB 8.0.23 was run locally from the conda-forge binary
(the official download host is blocked in this sandbox). Nothing about that is
part of the project.

## Ground rules applied

* Every new feature lives in **new files**. Existing files receive only the hook
  lines listed in `HOOKS.md`.
* New backend code is namespaced so it is easy to diff:
  `backend/src/{models,services,controllers,routes}/ext*/…` and
  `backend/src/seed/ext/…`, tests in `backend/test/ext-*.test.js`.
* New frontend code lives under `frontend/src/ext/…` and `frontend/public/…`.
* No new npm dependency. The PDF writer is ~150 lines of new code; QR uses the
  already-installed `qrcode` package.
* Every result carries `method`, `source` and claim-kind labels. No language
  model produces a number. The only model call (FAQ rephrasing) goes through
  `providerClient.completeJson` and `jsonGuard.guard`.
* Every administrative write appends to its own record's `history` array **and**
  to the existing hash chain via `auditChainService.record()`.

## Shared foundations (new)

| File | Purpose |
| --- | --- |
| `models/ext/StudentProfile.js` | branch / year / batch / section / registered phone per student. A separate collection so no existing `User` row is edited. Missing profiles are derived read-only from `User` (department → branch, semester → year, student-ID → batch). |
| `services/ext/extAudit.js` | one helper: push to a record's `history` + `auditChainService.record()` |
| `services/ext/istTime.js` | Asia/Kolkata clock helpers (quiet hours, "tomorrow", date keys) |
| `services/ext/extMonitor.js` | one timer: scheduled notices, quiet-hours release, SMS escalation, fee reminders, 48 h fix-confirmation expiry |
| `routes/ext/index.js` | mounts every new router |

## Phase 0 — AUDIT.md (report only, nothing fixed)

## Phase 1

### 1A Notice Center
* Models: `Notice`, `NoticeReceipt`.
* Service `noticeService.js`: audience resolution (branches, years, hostels,
  batches, sections, roles, departments), live reach count with breakdown,
  quiet hours (22:00–07:00 IST → 07:30 digest; CRITICAL bypasses), duplicate
  warning (word-overlap Jaccard ≥ 0.35 + overlapping recipients, last 7 days),
  delivery dashboard (targeted / delivered / read / acknowledged / action done,
  by hostel, branch, year; not-read and not-acted lists), SMS escalation using
  `smsService.sendSms`.
* Routes `/api/notices/*` (staff compose/preview/dashboard/sweep; student feed,
  read, ack, done).
* UI surface **13 NOTICES** (student feed with unread badge; staff composer +
  dashboard).

### 1B Documents with verifiable QR
* Model `DocumentRequest` (history, SLA, certificate {code, digest, revoked…}).
* `certificateService.js` (canonical content, SHA-256, masked name, verify),
  `pdfWriter.js` (minimal PDF 1.4 + QR drawn from `qrcode.create()` modules).
* Routes `/api/documents/*`, public `/api/verify/:code` (+ POST copy check),
  kiosk route `/api/documents/kiosk` reusing the exported `actAsStudent`.
* UI surface **14 DOCUMENTS**, public Verify page at `/verify/:code`, kiosk tile hook.

### 1C Timetable & class changes
* Models `ClassSchedule`, `ClassChange`, `MenuChange` (mess menu change for the
  PS07 story, notified the same way).
* `timetableService.js`: change → targeted notice to exactly that
  branch/year/section; adjusted-attendance view ("cancelled — not counted") that
  reads `Attendance` without writing it; "Is tomorrow's class cancelled?" answer
  with evidence.
* Routes `/api/timetable/*`, `/api/mess-changes/*`. UI surface **15 CLASSES**.

### 1D Fees
* Model `FeeAccount`; `feeService.js` (status, next due, outstanding by
  hostel/branch/year, reminder notices through 1A). Read-only, no gateway.
* Routes `/api/fees/*`. UI surface **16 FEES**.

### 1E Unified request tracker
* `requestTrackerService.js` reuses `timelineService` projections (read-only)
  and adds document, notice and reopen timelines in the same shape.
* Routes `/api/requests/mine`, `/api/requests/pending`.
* UI surface **17 MY REQUESTS**; Mission Control panel "Unified pending queue".

## Phase 2

| Id | New models | New service / routes | UI |
| --- | --- | --- | --- |
| 2A Friction Ledger | `FrictionBaseline` | `frictionService.js`, `/api/friction/*` | Mission Control panel |
| 2B SMS keyword channel | `SmsMessage` | `smsKeywordService.js` (calls the existing `createComplaint` controller unchanged), `/api/sms/inbound` (secret-authenticated webhook), `/api/sms/simulate`, `/api/sms/activity` | surface **18 SMS PHONE** (labelled SIMULATED) + Mission Control panel |
| 2C Proof of fix | `FixProof`, `FixConfirmation`, `ReopenRequest` | `fixService.js`, `/api/fix/*` | staff attach + student confirm in surface 17; Mission Control metric |
| 2D FAQ with citations | `PolicySection`, `FaqQuery` | `faqService.js`, `/api/faq/*` | surface **19 ASK OFFICE** + admin panel |
| 2E You Said, We Did | — | `boardService.js`, `/api/board` | surface **20 YOU SAID WE DID** |
| 2F Tuesday Mode | — | `/api/friction/compare` | header control (separate from Replay) |
| 2G Device readiness | — | `frontend/public/{manifest.webmanifest,sw.js,icon.svg}`, `frontend/scripts/device-readiness.mjs` | surface **21 DEVICE**, offline banner, low-end prompt |
| 2H Adoption extension | — | `adoptionExtService.js`, `/api/adoption/*` | section beside the existing adoption panel |

## Hooks expected (details and exact lines in HOOKS.md)

* `backend/src/routes/index.js` — mount the extension router.
* `backend/src/server.js` — start/stop the extension monitor.
* `backend/src/config/constants.js` — append new entity names to `AUDIT_ENTITIES`.
* `backend/src/models/Complaint.js` — append `"SMS"` to the `channel` enum.
* `backend/src/seed/index.js` — call the extension seed at the end of `run()`.
* `backend/package.json` — `seed:ext`, `smoke:ext` scripts.
* `frontend/src/NexCamp.jsx` — nav entries 13–21, one render slot for the new
  surfaces, one header slot, one Mission Control slot.
* `frontend/src/components/intel/Kiosk.jsx` — Documents tile opens the new flow.
* `frontend/src/lib/i18n.js` — merge new dictionary entries (missing keys only).
* `frontend/src/main.jsx` — `/verify/:code` route, PWA registration, offline banner.
* `frontend/index.html` — manifest link.

## Tests (new files only)

`backend/test/ext-units.test.js` (pure services: audience matching, quiet hours,
duplicate detection, canonical digest/tamper, PDF, masking, timetable answer,
adjusted attendance, fees, friction arithmetic, SMS parsing and 160-char replies,
FAQ retrieval threshold, CSV validators), `backend/test/ext-routes.test.js`
(every new route mounted and guarded; validation errors), and
`backend/test/ext-integration.test.js` (end-to-end against a real MongoDB when
one is reachable; skipped otherwise), plus `scripts/ext-smoke.js`.
