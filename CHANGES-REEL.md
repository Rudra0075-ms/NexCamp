# Change log — the 30-second proof

A header button, **30-SECOND PROOF**, beside TUESDAY TEST. It plays a full-screen,
self-running, animated 30.0-second reel: each Tuesday problem is acted out
(PROBLEM), the mechanism visibly acts on it (MECHANISM), and a LIVE OUTPUT card
rises with the figures the database returned, its honesty label and its source
endpoint, then holds still. Every edit in an existing file is marked
`REEL HOOK (see CHANGES-REEL.md)`. Nothing was removed or renamed except the
misleading labels the brief asked to rename (below). No dependency was added.

## 1. Service check (done before any code was written)

Every service named in the brief was read before use. All ten scenes reuse an
existing service; none duplicates its logic.

| Scene | Service used | Read-only? | Notes |
| --- | --- | --- | --- |
| `certificate` | `touchlessService.preview(student, { type: "BONAFIDE_CERTIFICATE" })` | yes — dry run (the Round 3 `ensureDefaultRules` fix keeps it write-free) | 3 conditions under §4.2, one tick per condition |
| `duplicate` | `deflectionService.similarOpenIncident(student, { text: "tap leaking in B-214", buildingCode: "HST-B" })` | yes ("Nothing is written by the check itself") | assigned-to is the department, never a name |
| `safety` | `SAFETY_CRITICAL_PATTERNS` + `escalationService.decideEscalation` on "sparks from the switchboard" | yes — pure functions | 7 groups, ELECTRICAL_ARC, CRITICAL |
| `provenFix` | `closureService.falseClosures()` + `impactProof.interventionImpact(id, { remember: false })` | yes — `remember: false` skips the CampusMemory write (the same call `proofBadges` makes) | Hostel B pump fix INT-0901 |
| `classChange` | latest class `ChangeEvent` + `preflight.previewClassChange` (sample: a morning class moved to Wednesday 13:00, as `ProofDemo` does) | yes — `writes: 0`, tested in Round 3 | |
| `noticeReach` | `reachService.reachFunnel` + receipt counts for acknowledged / done + `HELD_QUIET_HOURS` count | yes | see deviation 2 |
| `gatePass` | `touchlessService.activeRules("GATE_PASS")` + the latest pass's own record and its `GATE_PASS_OVERDUE` notifications | yes — the pass is read directly, **not** through `gatePassService.reconcile()`, which writes | see deviation 3 |
| `noSmartphone` | `SmsMessage` / `SmsOutbox` (the stores behind `smsStaffService.outbox`) + `CampusEvent` count with channel KIOSK | yes | see deviation 4 |
| `adminView` | `touchlessService.exceptionsInbox` + `touchlessRate`, `requestTrackerService.pendingQueue` buckets, `operationsIntelligenceService.slaForecast` (BREACHED, a measured count), `equity.serviceEquity` headline | yes | |
| `ledger` | `ledgerService.frictionLedger` per request type | yes on a seeded database (`baselineMap` only inserts when baselines are missing) | now = ACTUAL DATA (seeded DEMO DATA), old = ASSUMPTION; no single headline |

## 2. Deviations from the brief (please review)

1. **`?lite=1`.** The existing `lite` middleware trims *every* array to three
   entries; on this response it would trim `scenes` itself and drop seven of the
   ten scenes. The reel controller applies the same rule (same limit,
   `LITE_ARRAY_LIMIT`, same `lite` / `liteNote` flags) one level down, inside
   each scene's data. Lists the reel draws (conditions, hazard ids, SMS lines,
   buckets, ledger types) are keyed objects, so the trim never changes a frame —
   the test asserts lite and full scene data are identical.
2. **No seeded mess-menu / exam-form notice has a reach funnel.** The scene uses
   the newest published notice with a reach target (the seeded CRITICAL Hostel B
   notice), falling back to the newest published notice. The fixed PROBLEM text
   stays as written in the brief.
3. **No seeded gate pass is OVERDUE.** The scene shows the latest overdue pass if
   there is one, else the latest pass decided by policy (seed: GP-…-P0007,
   APPROVED under §7.4), and draws alert recipients only from that pass's real
   `GATE_PASS_OVERDUE` notifications. With none it says "No overdue alert on
   record" — the OVERDUE badge is never drawn for a pass that was not overdue.
4. **The seed has no SMS work loop** (no `WATER …` complaint by SMS, no staff
   `DONE`, no `YES`). The scene shows each stored step that exists, in order;
   with none, the latest stored keyword exchange, and says so on the card
   ("No SMS work loop on record yet — latest stored SMS shown"). Running the
   two-phone loop on page 18 (or `npm run smoke:xo`) fills it. A reel-specific
   seed through the real SMS services could be added if you want the full loop
   on a fresh seed.
5. **Durations are shown in hours exactly as the API returned them** ("72 h",
   not "3 days"), so every figure on screen can be checked against the response.
6. **The entry bundle grows by ≈0.6 KB gzip** (303.75 → 304.34 KB): the header
   button, its portal and four translated labels. The reel itself is a separate
   lazy chunk.
7. **While the reel is open the app beneath is hidden** (`html.reel-open #root`)
   and its three.js loop skips drawing (one marked line in `NexCamp.jsx`).
   Without this the hidden campus render held the reel to ~13 fps.

## 3. Files

### New

| File | What |
| --- | --- |
| `backend/src/services/xo/reelService.js` | the ten scene builders, each in its own try/catch (a failing scene is `INSUFFICIENT DATA` with its error) |
| `backend/src/controllers/xo/reelController.js` | `GET /api/xo/reel`, and the per-scene `?lite=1` trim |
| `backend/test/reel.test.js` | seeds a throwaway database with the real seed script; 10 scenes, kind + source on each, 401 / 403 for anonymous / student, **zero documents written** over six plays (every collection counted), lite ≤ 12 KB and identical to full |
| `frontend/src/reel/ReelEntry.jsx` | the header button (entry bundle); opens the reel in a portal; `?reel=1` opens on load |
| `frontend/src/reel/ProofReel.jsx` | the reel: one master clock, Web Animations driven by `currentTime`, eleven SVG stages and cards |
| `frontend/src/reel/reel.css` | 1920 × 1080 frame (scaled to the window) and the 390 × 844 portrait frame |
| `frontend/src/reel/i18n.js`, `labels.js` | Odia and Hindi for every fixed string; `labels.js` holds only the four entry-bundle labels |
| `frontend/scripts/reel-check.mjs` | Playwright acceptance check (below) |
| `docs/reel/` | `hold/` and `motion/` screenshots (11 each), `lowend/`, `reel.webm`, `frame-trace.json`, `report.json` |

### Existing (marked `REEL HOOK`)

| File | Change | Why |
| --- | --- | --- |
| `backend/src/routes/xo/index.js` | import + `router.get("/reel", authorizeStaff, reel.reel)` after every existing route | mounts the endpoint on a new path |
| `backend/scripts/lib/workflowBudgets.js` | `BUDGETS.reel = 12 KB`; `REEL_WORKFLOW`; `measureWorkflows` takes an optional list (default unchanged) | fifth budget workflow; the four student workflows and their test are unchanged. The `notice` budget line gained a trailing comma only |
| `backend/scripts/workflow-budgets.js` | after the four workflows, re-seeds the throwaway database with the real seed and measures the reel as the admin | the reel needs demo data and a staff account |
| `frontend/public/workflow-budgets.json` | regenerated by `npm run budgets` (now five rows) | generated report |
| `frontend/src/NexCamp.jsx` | import; `<ReelButton>` beside the Tuesday Test; the 3D tick skips drawing while the reel is open; **"AI CLASSIFICATION" → "RULE CLASSIFICATION"** (lines ~4177, ~4208, ~5036 and the fallback replay label ~1858), **"AI ACTION QUEUE · PRIORITIZED" → "ACTION QUEUE · RANKED"** (~4766), fallback timeline text "AI classification:" → "Rule classification:" (~3024) | the button; performance; the labels describe deterministic rules, not a model |
| `frontend/src/components/intel/AttendanceIntel.jsx` | visible label "AI classification" → "Rule classification" (the style key `kind` is unchanged) | the attendance pattern is `RULE_BASED_PATTERN` |
| `frontend/src/lib/i18n.js` | merges `REEL_LABELS_OR` / `REEL_LABELS_HI` (keys not already present) | the new keys in EN / OR / HI; existing keys untouched |
| `README.md`, `DEMO.md` | feature row; "0. 30-second proof" section | docs |

## 4. How it moves (and stays honest)

- **One clock.** `requestAnimationFrame` advances a master time; every element's
  entrance, loop and exit is a paused Web Animation whose `currentTime` is set
  from it, so pause, ← / →, replay, recording and test seeks show the same frame
  for the same time code (`window.__reel.seek(ms)`).
- **Beats.** A ≈ 35 %, B ≈ 25 %, C ≈ 40 %; C is stretched where needed so every
  card is fully in place and then still for 1.03 s.
- **Only `transform` and `opacity` animate.** Animated HTML parts are on their own
  compositor layers; an animation whose time has not crossed a boundary is not
  touched, so a still frame costs nothing. Each scene is drawn once under the
  loading cover before the clock starts, so no scene pays for a first paint
  mid-play.
- **No counting.** Numbers fade or rise in at their final value; bars grow to the
  API's exact value and their label appears after they settle. Beat-A vignettes
  are uncounted shapes; everything countable in B / C (ticks, hazard icons,
  follower and student dots, ladder dots, SMS bubbles, exception rows, role
  icons) is drawn from the data, capped sets with the real number in text.
- **prefers-reduced-motion**: every entrance and exit becomes an opacity fade;
  loops are off. **LOW render / `?lowend=1`**: no animation of any kind (the
  app's grain overlay is hidden too); each scene cuts between the end frames of
  its three beats. **Offline**: the last cached copy with its time, or "No data
  cached" — never a figure that was not returned.

## 5. Acceptance results (this environment: 4 CPUs, headless Chromium without a GPU)

| Check | Result |
| --- | --- |
| `npm test` (backend) | 441 tests, 440 pass. The one failure, `every page-21 workflow stays within its 2G byte budget` (gate pass 12.2 KB > 10 KB), fails identically on the commit before this change. A second pre-existing test (`short notice stays with the warden`) depends on the time of day and failed once on the baseline; it passed in this run |
| `npm run smoke:xo` | 47 passed, 0 failed |
| `npm run budgets` | 30-second proof: 1 call, **4.7 KB** (4,764 bytes) under `?lite=1`, budget 12 KB — OK. (Gate pass OVER as before) |
| Reel chunk | `ProofReel` **16.9 KB JS + 2.4 KB CSS gzip** (≤ 40 KB) |
| Entry bundle | 303.75 → 304.34 KB gzip (+0.6 KB, see deviation 6) |
| Play time | **30.01 s** |
| Frames | longest **33.4 ms**, **59.9 fps** average, 1,797 frames, none over 34 ms (`docs/reel/frame-trace.json`) |
| Hold / motion screenshots | 11 + 11 in `docs/reel/hold`, `docs/reel/motion`; every number visible in every frame is one the API returned or a figure in the fixed text; nothing partial |
| Output hold | all 11 cards pixel-identical 0.9 s apart inside their hold |
| `?lowend=1` at 390 × 844 | `document.getAnimations().length === 0` at all 301 sampled times; no sideways scroll; static beat frames in `docs/reel/lowend` |
| Reduced motion | the only animated property is `opacity` |
| Offline | with a cache: "Cached copy from …" and the cached figures; without: "No data cached", no figures |
| Database | 5,201 documents in 45 collections before and after 3 plays — unchanged (and the route test counts every collection) |
| Labels | `grep -ri "ai-powered\|AI CLASSIFICATION\|AI ACTION QUEUE" frontend/src` → only i18n keys and `Tag kind=` style keys, no visible text |
| OR / HI | no row or card overflows at 1920 × 1080 or 390 × 844 |
