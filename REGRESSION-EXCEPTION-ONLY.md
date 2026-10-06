# Regression report — The Exception-Only Campus

Baseline: commit `9361d07`, before any Exception-Only work. Final: the head of branch
`claude/campus-intelligence-os-setup-jaf86n`. Both measured on the same machine with a
local MongoDB 7, the API on :5000 and Vite on :5173.

## Tests and smokes

| Check | Baseline | Final |
|---|---|---|
| `npm test` (backend) | 297 / 297 pass | **369 / 369 pass** — 297 original (none edited, none deleted) + 72 new |
| `npm run smoke` | 70 passed, 0 failed | 70 passed, 0 failed |
| `npm run smoke:gatepass` | 43 checks passed | 43 checks passed |
| `npm run smoke:ai` | 132 passed | 132 passed |
| `npm run smoke:ops` | 70 passed | 70 passed |
| `npm run smoke:ext` | 50 passed | 50 passed |
| `npm run smoke:xo` (new) | — | 47 passed, 0 failed |
| `npm run budgets` (new) | — | 4 / 4 workflows within budget |
| `npm run seed -- --fresh` | completes | completes (base + extension + Exception-Only), re-run from an empty database |
| `vite build` | builds | builds; every Exception-Only panel is its own lazy chunk |

New tests: `test/xo-unit.test.js` (policy engine, event emission, ledger maths, ETA,
false-closure rule, reach escalation, change propagation, WhatsApp parser in Android and
iOS formats, replay comparison, SMS work-loop parser), `test/xo-integration.test.js`
(end-to-end through the existing controllers against a throwaway database, including the
SMS work loop and the Tuesday Test comparison), `test/xo-budget.test.js` (fails when one
of the four page-21 workflows goes over its byte budget).

## Pages (browser check)

`frontend/scripts/page-check.mjs` visits all 21 pages in Chromium under six
configurations and fails a visit on any console error, uncaught exception, horizontal
overflow, error boundary, or an empty page:

1. HIGH · EN · 1360 px
2. LOW · LOW BANDWIDTH · EN · 390 px
3. MEDIUM · 3D off · Odia · 1360 px
4. HIGH · Hindi · 390 px
5. LOW · LOW BANDWIDTH · signed in as admin · 1360 px
6. Offline (every page visited once online, then the network dropped) · EN · 390 px

| | Baseline | Final |
|---|---|---|
| Clean page visits | 121 / 126 | **126 / 126** |
| Failures | page 09 in configs 1–5: React warning "Invalid DOM property `font-family`" (SVG attributes) | none (no console errors, no initial-load errors, no overflow) |

The baseline failure was pre-existing and was fixed in Phase 0 (`stroke-width`,
`font-family`, `font-size` → their React names in `NexCamp.jsx`).

Per page, final run (columns are the configurations above; ✓ = clean):

| Page | 1 | 2 | 3 | 4 | 5 | 6 | Baseline |
|---|---|---|---|---|---|---|---|
| 01 landing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 02 student | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 03 attendance | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 04 mess | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 05 report | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 06 incident | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 07 investigation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 08 risk | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 09 intervention | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1/6 (✗ in 1, 2, 3, 4, 5) |
| 10 admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 11 gatepass | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 12 kiosk | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 13 notices | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 14 documents | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 15 classes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 16 fees | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 17 requests | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 18 sms | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 19 faq | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 20 board | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |
| 21 device | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 6/6 |


Outside the matrix, checked by hand in the browser: the Tuesday Test end to end (EN at
1360 px, Hindi at 390 px, no console errors, first run on a fresh seed issues the
certificate under §4.2 with 0 staff touches); the two-phone SMS demo on page 18 to
"LOOP CLOSED"; page 21's workflow list at 390 px; the header at 390, 768, 1024, 1360 and
1600 px (the new control wraps instead of being clipped).

## Not completed, or done differently — and why

- **If-time-allows items not built:** the process-mining panel, the read-probability
  model and the Policy Compiler. The knowledge-gap loop exists only in part: repeated
  questions in an imported WhatsApp group become FAQ drafts (page 19); unanswered
  questions from the FAQ assistant itself are not yet fed back.
- **Tuesday Test steps 3 and 4 read the latest real change; they do not create one.**
  Creating a class cancellation or a menu change needs a staff sign-in, and the test runs
  as the demo student. The chain shown (change → notice → attendance / demand → reach) is
  the real one for the latest change on record.
- **2G time is simulated, not throttled.** Bytes are measured against the real API; time is
  computed from them with stated assumptions (50 kbps, 600 ms round trip, 700 B headers
  per call). Bodies are counted uncompressed.
- **Quiet hours:** the existing rule (22:00–07:00, held to a 07:30 digest) was kept rather
  than changed to 23:00–06:00; the spec's window is inside it. Transactional notices to
  one person may override it, and say so.
- **Page 09 intervention costs** are labelled ILLUSTRATIVE rather than computed — there is
  no cost ledger in the data to compute them from.
- **Translations** cover the new headings, buttons and labels (Odia and Hindi). Sentences
  the API writes (policy reasons, SMS replies, change explanations) stay in English, as the
  existing i18n layer only translates dictionary matches.
- **WhatsApp import size:** capped at 200,000 characters per upload (the API's JSON body
  limit of 200 kB was not raised); a larger export is imported in parts.
- **SMS numbers** for staff and students are demo placeholders; real delivery needs
  `SMS_PROVIDER` set, exactly as for the existing gate-pass SMS.
