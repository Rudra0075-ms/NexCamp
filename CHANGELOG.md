# CHANGELOG — PS07 extension pack

Added on top of the tag `baseline` (the supplied project, unchanged). Everything
below is additive; the only edits to existing files are the hook lines listed in
[HOOKS.md](HOOKS.md). Judge-visible issues found in the existing code are in
[AUDIT.md](AUDIT.md) (reported, not fixed). A step-by-step demo is in
[DEMO.md](DEMO.md).

## Running it

Same commands as before, plus two optional ones:

```bash
cd backend && npm install && npm run seed -- --fresh   # base seed + extension seed
npm run dev                                            # API on :5000
cd frontend && npm install && npm run dev              # app on :5173

# optional
cd backend  && npm run seed:ext     # extension seed only, on an existing database (re-runnable)
cd backend  && npm run smoke:ext    # 50-check end-to-end smoke of every new workflow
cd frontend && npm run build && npm run readiness      # measured bundle + ?lite=1 payload report
```

`npm run seed -- --fresh --no-ext` reproduces the original seed exactly;
`--no-history` skips the six historical resolved complaints and three closed gate
passes (see HOOKS.md). **No new npm dependency** (the PDF writer is new code; QR
codes use the already-installed `qrcode`).

Verification results (all run in this environment):

| Check | Result |
| --- | --- |
| `npm test` | **297 / 297** — the 184 original tests unmodified + 113 new |
| `npm run smoke` / `smoke:gatepass` / `smoke:ai` / `smoke:ops` | 70/70, 43/43, 132/132, 70/70 (with the extension seed loaded) |
| `npm run smoke:ext` | 50/50 |
| Existing endpoints, baseline server vs new server, same database | 46/46 identical |
| `npm run build` (frontend) | builds; entry chunk +7 KB gzip over baseline (new pages are lazy chunks) |
| Browser (Chromium, 390 px, reduced motion) | all 9 new pages: no horizontal scroll, no new console errors |

## Conventions every new feature follows

- Every computed result carries `method`, `source` and a claim-kind label
  (ACTUAL DATA, BASELINE ESTIMATE, ESTIMATE, SIMULATED, EVIDENCE, MEASURED IN THIS
  DEMO, RECOMMENDED ACTION, INSUFFICIENT DATA). "Insufficient data" replaces any
  figure that has nothing behind it.
- Everything works with no language model. The one model use (FAQ rephrasing)
  goes through `providerClient.completeJson` + `jsonGuard.guard`, and a
  rephrasing that introduces a number the cited section does not contain is
  discarded.
- Every administrative write lands in the record's own `history` array **and** in
  the existing SHA-256 hash chain (`auditChainService.record`).
- Writes go through the existing offline queue (`lib/net.js`); reads fall back to
  the device's last good copy, labelled CACHED COPY.
- Every new read route honours `?lite=1`; the pages request it in LOW BANDWIDTH.
- EN / ଓଡ଼ିଆ / हिन्दी, 390 px, `prefers-reduced-motion`, keyboard focus styles.
- New sequential references (`NTC-`, `DOC-`, `CLS-`, `MNU-`, `RPN-`) come from an
  atomic counter, so they cannot collide after a delete (unlike AUDIT.md B1).

## Phase 0 — AUDIT.md

Eight requested items plus ten more, with file/line references and suggested
fixes. B1 (complaint reference collision after a delete → 409 for the next
student) was reproduced against the running baseline.

## Phase 1 — required deliverables

### 1A Notice Center — surface 13
Targeted notices by hostel, branch, year, batch, section, role or department,
with delivery, read and action tracking. Runs beside the existing notification
inbox, which is unchanged.
- **Composer:** audience chips built from live data, server-computed "reaches N"
  with per-hostel/section breakdown, preview, priority, optional action with
  deadline, schedule-for-later, SMS-escalation window.
- **Quiet hours:** non-CRITICAL notices published 22:00–07:00 IST are held and
  released together in the 07:30 digest (labelled `DIGEST YYYY-MM-DD 07:30`);
  CRITICAL bypasses. The rule is shown in the composer.
- **Duplicate warning:** word-overlap (Jaccard, not semantic) ≥ 35% with a
  notice from the last 7 days whose recipients overlap → HTTP 409 with the
  match; "Publish anyway" sends `confirmDuplicate`.
- **Escalation:** a CRITICAL or action-required notice still unread after its
  window is sent through the existing `smsService.sendSms`; the receipt records
  channel SMS and the delivery mode (console in development).
- **Delivery dashboard:** targeted / delivered / read / acknowledged / action
  done, counts and %, by hostel, branch and year, plus who has not read / acted.
  "Delivered" means the device fetched it or an SMS was handed over — never
  assumed at creation.
- **Student feed:** unread badge (also in the header), Read / Acknowledge / Mark
  done, all offline-capable.
- Models `Notice`, `NoticeReceipt` (+ `StudentProfile` for section/batch/phone,
  kept separate so no `User` row is edited).

### 1B Certificates with verifiable QR — surface 14 + `/verify/:code`
- `DocumentRequest`: BONAFIDE, NO_DUES, HOSTEL_RESIDENCE, CHARACTER; SUBMITTED →
  UNDER_REVIEW → APPROVED / REJECTED (reason required) → ISSUED, per-type SLA
  (24/72/48/72 h) with ON_TRACK / AT_RISK / BREACHED / MET / MET_LATE.
  NO_DUES shows the fee ledger's outstanding amount as EVIDENCE to the reviewer.
- On issue: a server-generated PDF (new minimal PDF writer) with a QR code and an
  8-character code (`XXXX-XXXX`, no ambiguous characters). Only the SHA-256 of
  the certificate's canonical content is stored; verification rebuilds it from
  the record.
- Public verifier (rate-limited, no account): VALID / REVOKED / TAMPERED /
  NOT FOUND, type, issue date, partially masked name ("PR***** RA**** SA***").
  "Check a copy" reads the PDF's embedded content block in the browser; a
  one-tap "simulate tampering" shows the check failing.
- Admin revocation with a required reason, audited.
- Kiosk hook: the Documents tile files the request as the student, channel
  KIOSK, operator recorded.

### 1C Timetable & class changes — surface 15
- `ClassSchedule` (seeded from the existing `subjectSchedule`, two sections),
  `ClassChange` (CANCEL / RESCHEDULE / ROOM; weekday checked; one change per
  session). A change sends a notice to exactly that branch/year/section.
- "Is tomorrow's class cancelled?" — `GET /api/timetable/day?day=tomorrow|today|next|YYYY-MM-DD`
  and `POST /api/timetable/ask` (a new deterministic matcher; the existing ⌘K
  intent matcher is untouched), answered with the change and its notice as
  EVIDENCE.
- Adjusted attendance: an **additional view** that shows register sessions on a
  cancelled date as "cancelled — not counted". The attendance records and the
  existing calculation are not written to (an integration test asserts the
  record is byte-identical before and after).
- `MenuChange` + next-meal answer read from the mess register's weekly rotation
  (for the PS07 "changed mess menu" step and the SMS `MENU` command).

### 1D Fees & dues — surface 16
`FeeAccount` (tuition, hostel, mess, fines; due dates; payments with receipt
numbers). Student: status, outstanding, next due date. Admin: outstanding and
overdue by hostel, branch and year, and the students with dues. Reminder notices
7 days before each due date (idempotent per head and date). Read-only; no gateway.

### 1E Unified request tracker — surface 17 + Mission Control
- Student: one timeline across complaints and gate passes (the existing
  `timelineService`, read-only), documents, action-required notices and reopen
  requests, all in the same shape.
- Admin "Unified pending queue": every open item with age, SLA state, owner
  (assigned person, else the department queue owner), ageing buckets
  (<24h, 1–3d, 3–7d, >7d), filters by department, staff member and type, and
  workload per owner.

## Phase 2 — standout features

### 2A Friction Ledger — Mission Control
Time from request to completion and student actions per workflow, read from
timestamps the workflows already store (complaints, gate passes, documents,
notices). An editable, audited baseline table (six old processes, each labelled
BASELINE ESTIMATE with its source — stated as a team estimate, not a measurement).
Hours saved this week, per workflow and per student served, and the reduction
against the PS07 30% criterion; hours saved is labelled ESTIMATE because it
inherits the baseline.

### 2B SMS keyword channel — surface 18 + Mission Control
Provider-agnostic webhook `POST /api/sms/inbound` (shared-secret header;
accepts `{from,text}`, Twilio `{From,Body}`, `{sender,message}`), and a basic-phone
simulator labelled SIMULATED throughout. Registered numbers only; 8 messages per
10 minutes per number; every reply ≤ 160 characters. Commands: `ATT`,
`STATUS CMP-xxxx`, `GP`, `MENU`, `NOTICE` (marks read, channel SMS),
`<CATEGORY> <place> <text>` (files through the existing `createComplaint`
controller, unchanged), `HELP`. Numbers are stored hashed and masked. Mission
Control lists the traffic and the complaints filed by SMS.

### 2C Proof of fix & student confirmation — surface 17 + Mission Control
Optional step after the unchanged resolve flow: staff attach a photo (compressed
on the device to ≤ ~100 KB JPEG; the server checks type, magic bytes and size)
and a note. The author is asked "Is it fixed?": YES, or NOT FIXED → a new linked
`ReopenRequest` (the original complaint stays RESOLVED) and a notice to the
department; no answer in 48 h → NO RESPONSE. Mission Control: proof-of-fix rate
and reopen rate per department.

### 2D Office FAQ with citations — surface 19
Seeded, admin-editable policy corpus (14 sections: hostel, leave & gate pass,
fees, certificates, mess, attendance — labelled as demo text to be replaced).
Deterministic keyword scoring with a threshold; every answer shows the section
key, title, version and source. Below the threshold it says so and offers
"Create a request" (filed to the office through the existing complaint path).
Model rephrasing into Odia/Hindi only when configured, guarded. Admin view: most
asked and unanswered questions. Separate from the ⌘K bar and the copilot.

### 2E You Said, We Did — surface 20
Per-hostel board of resolved issues from campus memory and resolved incidents
(read-only): reports, the fix, time to fix, and recurring building+category
pairs. No names, IDs or rooms.

### 2F Tuesday Mode — header control
Separate from the Replay controls. A stopwatch walks the PS07 story live against
the database, one presenter tap per errand: request a bonafide, report a leaking
tap, "is tomorrow's class cancelled?" (falls through to the next class day on a
weekend), the changed mess menu — then the same errands by SMS (and says plainly
that certificates have no SMS command). Ends on a Friction Ledger comparison:
measured time (presenter taps + server time) and taps against the old-process
BASELINE ESTIMATE.

### 2G Low-end readiness — surface 21
- PWA: `manifest.webmanifest`, icons, `sw.js` (app shell cache-first; the new read
  endpoints network-first with a per-user cache, served offline with
  `__cachedAt` so the page labels them CACHED COPY; writes never touched).
  Verified: controls the page and loads the shell offline in a production build.
- Offline banner; page chunks prefetched when idle (skipped under Data Saver).
- Low-end prompt: when `navigator.connection` reports 2G/3G or Data Saver, or
  `deviceMemory ≤ 2` (or `?lowend=1` for the demo), a one-tap banner switches on
  the **existing** LOW render and LOW BANDWIDTH modes.
- Device Readiness page + `npm run readiness`: measured bundle sizes (raw/gzip),
  full vs `?lite=1` payload sizes (script and in-browser), device signals,
  service-worker status, and what each low mode switches off.

### 2H Adoption note extension — Mission Control
Beside the unchanged College Adoption panel: six more datasets (student
grouping, rooms, timetable, fee heads, staff, policy corpus), downloadable CSV
templates, dry-run validators for each (live lookups, duplicate detection,
`written: 0`), live "loaded here now" counts, and a three-phase rollout (one
hostel pilot → one department → whole campus) with exit criteria and rollback.

## New API routes

All require a signed-in account unless stated; staff = ADMIN, WARDEN,
FACILITY_MANAGER, MESS_MANAGER.

| Route | Who |
| --- | --- |
| `GET /api/notices/feed`, `GET /api/notices/rules`, `POST /api/notices/:id/{read,ack,done}` | any |
| `GET /api/notices`, `POST /api/notices/preview`, `POST /api/notices`, `GET /api/notices/:id/dashboard`, `POST /api/notices/:id/cancel` | staff |
| `POST /api/notices/sweep` | admin |
| `GET /api/documents`, `GET /api/documents/:id/pdf` | owner or staff |
| `POST /api/documents` | student |
| `POST /api/documents/kiosk` | staff (acts as the looked-up student) |
| `POST /api/documents/:id/review`, `POST /api/documents/:id/issue` | staff |
| `POST /api/documents/:id/revoke` | admin |
| `GET /api/verify/:code`, `POST /api/verify/:code` | **public**, rate-limited |
| `GET /api/timetable/{week,day,attendance-adjusted}`, `POST /api/timetable/ask` | any |
| `GET /api/timetable/{schedules,changes}` | staff |
| `POST /api/timetable/changes` | admin |
| `GET /api/mess-menu`, `GET /api/mess-menu/next` | any |
| `POST /api/mess-menu/changes` | admin, mess manager |
| `GET /api/fees/me` | any |
| `GET /api/fees/summary`, `POST /api/fees/reminders` | admin |
| `GET /api/requests/mine` | any |
| `GET /api/requests/pending` | staff |
| `GET /api/friction` | staff |
| `PATCH /api/friction/baselines/:workflow` | admin |
| `POST /api/friction/compare` | any |
| `POST /api/sms/inbound` | **webhook** — `x-sms-webhook-secret` |
| `POST /api/sms/simulate`, `GET /api/sms/phones` | any (students: own number only) |
| `GET /api/sms/activity` | staff |
| `GET /api/fix/mine`, `GET /api/fix/:id/proof` | author or staff |
| `POST /api/fix/:id/confirm` | student (author) |
| `GET /api/fix/{metrics,resolved}`, `POST /api/fix/:id/proof`, `POST /api/fix/reopen/:id` | staff |
| `POST /api/faq/ask`, `POST /api/faq/request`, `GET /api/faq/sections` | any |
| `GET /api/faq/stats` | staff |
| `PUT /api/faq/sections/:key` | admin |
| `GET /api/board` | any |
| `GET /api/adoption/datasets`, `GET /api/adoption/templates/:dataset`, `POST /api/adoption/validate/:dataset` | admin |

## New models (MongoDB collections)

`StudentProfile`, `Notice`, `NoticeReceipt`, `DocumentRequest`, `ClassSchedule`,
`ClassChange`, `MenuChange`, `FeeAccount`, `FrictionBaseline`, `SmsMessage`,
`FixProof`, `FixConfirmation`, `ReopenRequest`, `PolicySection`, `FaqQuery`,
`ExtCounter` — all in `backend/src/models/ext/`.

## New files

- **Backend** — `src/models/ext/*` (17), `src/services/ext/*` (17: notices,
  certificates + PDF writer, timetable, mess changes, fees, request tracker,
  friction, SMS keywords, fix, FAQ, board, adoption, profiles, IST clock, audit
  helper, monitor), `src/controllers/ext/*` (6), `src/routes/ext/*` (8),
  `src/seed/ext/*` (4), `test/ext-phase1.test.js`, `test/ext-phase2.test.js`,
  `test/ext-routes.test.js`, `test/ext-integration.test.js`,
  `scripts/ext-smoke.js`.
- **Frontend** — `src/ext/*` (surfaces 13–21, Mission Control panels, Tuesday
  Mode, Verify page, kit, API client, i18n, PWA registration, offline banner,
  low-end signals, CSS), `public/{manifest.webmanifest,sw.js,icon.svg,icon-maskable.svg,device-readiness.json}`,
  `scripts/device-readiness.mjs`.
- **Docs** — `PLAN.md`, `AUDIT.md`, `HOOKS.md`, `CHANGELOG.md`, `DEMO.md`.

## Tests added (113)

| File | What it covers |
| --- | --- |
| `ext-phase1.test.js` (23) | IST clock and quiet hours, publish decisions, audience matching, delivery maths, 160-char SMS, derived profiles, canonical digest + tamper, codes, masking, SLA states, the PDF (structure, xref, embedded block), word wrap, timetable changes and answers, the question parser, adjusted attendance (record unchanged), next meal, fee status, ageing buckets, timelines |
| `ext-phase2.test.js` (17) | ledger arithmetic and labels, Insufficient data, SMS parsing/aliases/length/hashing, photo validation (type, magic bytes, size), FAQ ranking, threshold, number guard, stemming, board privacy, every CSV template vs its validator, row validators, CSV quoting |
| `ext-routes.test.js` (61) | every new route mounted and refusing anonymous callers (401), forged tokens, verifier input validation, webhook 503/401/400, existing routes unchanged (spot check) |
| `ext-integration.test.js` (12, real MongoDB; skipped if none) | notice targeting and delivery, quiet-hours digest, one-time SMS escalation, duplicates, full certificate lifecycle incl. tampering and revocation, section-exact class-change notices, attendance register untouched, SMS filing through the existing controller + rate limit, proof/NOT FIXED/NO RESPONSE, FAQ citations and gaps, tracker + ledger, hash chain intact with every new entity type |

## Known limitations

- Class changes are made by ADMIN (no faculty role exists — see HOOKS.md).
- The certificate PDF uses the standard Helvetica font, so certificate text is
  Latin script only; the web pages themselves are translated.
- Without an AI provider, FAQ answers in Odia/Hindi show the English section,
  and say so.
- A cold start while offline loads the app shell but cannot sign in (existing
  auth model); pages opened while signed in keep working offline.
- SMS replies in development go to the server log (`SMS_PROVIDER=console`), as
  the existing gate-pass OTP does.
- The service worker registers in production builds (`npm run build && npm run
  preview`) or with `?sw=1`, not under the Vite dev server.
