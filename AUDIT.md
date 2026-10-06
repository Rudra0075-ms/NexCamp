# AUDIT — issues a judge might notice (Phase 0, report only)

Nothing in this file has been fixed. Each entry names the file and line in the
**baseline** commit (tag `baseline`), what a judge would see, and a suggested
fix. Line numbers are from `git show baseline:<file>`.

Live figures quoted below were read from a freshly seeded database
(`npm run seed -- --fresh`) with the baseline code.

## A. Items requested in the brief

| # | Where | What a judge sees | Why | Suggested fix |
| --- | --- | --- | --- | --- |
| A1 | `backend/src/controllers/adminController.js:32-55`, `frontend/src/NexCamp.jsx:3617-3618` | Mission Control KPI **AVG RESOLUTION = "—"** | The KPI averages `Incident.resolution.resolutionTimeHours`; no seeded incident is resolved, so the average is `null`. (Resolved complaints are not considered at all.) | Seed one or two resolved historical incidents, or fall back to resolved complaints (`resolution.resolvedAt − createdAt`) and label the basis; show "Insufficient data" rather than a dash. |
| A2 | `frontend/src/NexCamp.jsx:2338-2340` | Landing hero shows **AVG RESOLUTION 4.2h** | When the API returns `averageResolutionHours: null` the landing substitutes the constant `4.2`. The landing and Mission Control therefore disagree (4.2h vs "—"). | Render "Insufficient data" when null; never substitute a constant. |
| A3 | `frontend/src/NexCamp.jsx:4939` | Mission Control header reads **"MONDAY 15 SEPT · 11:42 IST"** every day | Fixed string. | Format `new Date()` in `Asia/Kolkata` (or use `briefing.generatedAt`). |
| A4 | `frontend/src/NexCamp.jsx:3328` (button label), `:3991`, `:2053`, `:3275`, `:3414`, `:4515` | "RUN SEMANTIC CLUSTERING", "SEMANTIC CLUSTERING", "91% semantic overlap", "Semantic cluster crosses threshold" | The engine is word-overlap Jaccard plus category/time/building rules (`backend/src/services/incidentClusteringService.js:11,125`, `backend/src/utils/text.js:16-17`), and the backend itself says "not semantic embedding". The UI label over-claims. `:3335` already carries the honest caveat, which makes the contradiction visible. | Rename to "RUN WORD-OVERLAP CLUSTERING" / "wording overlap"; keep the percentage but call it Jaccard overlap. |
| A5 | `frontend/src/NexCamp.jsx:4958` | **"AI-GENERATED MORNING BRIEFING"** | `GET /api/admin/briefing` returns `method: "RULE_BASED_SUMMARY"` and the disclaimer "No language model writes this briefing" (`adminController.js:231-236`). The label contradicts the API. | Label it "RULE-BASED MORNING BRIEFING" (or show the API's `method`), and only say AI when `source === "AI_MODEL"`. |
| A6 | `frontend/src/NexCamp.jsx:3540-3544` | Intervention costs **₹ 2.4L** (do nothing) and **₹ 18K** (repair now) | Fixed frontend strings, shown next to live simulator figures, with no inputs or label. | Move cost inputs (labour rate, part cost, per-student disruption) to the backend simulator and label the output ESTIMATE with its inputs, or remove the figure. |
| A7 | `backend/src/services/investigationService.js:12`, `backend/src/services/riskService.js:24`, `backend/src/controllers/adminController.js:195`, `frontend/src/NexCamp.jsx:3416,3459,3624` | "**3.8-day median** from first complaint to inspection" | A constant, not computed from records. It feeds the risk score and is quoted as if measured. | Compute the median from resolved incidents/complaints (first complaint → first INVESTIGATING/RESOLVED event); if there are fewer than N closed cases say "Insufficient data" and label any default as BASELINE ESTIMATE. |
| A8 | `frontend/src/NexCamp.jsx:169-175` (chapters), `:2532` (header fallback), `:159` (page blurb) | Landing narrative: "6,240 students", "12 active incidents and 38 pending complaints", "Risk 87% → 21% in 2.4 hours", "89% confidence", "Hostel C water draw has dropped 23%" | Fixed prose. Live seeded data reads **3,194 students, 5 active incidents, 29 pending complaints, campus health 49%** (`GET /api/campus`). The header uses the live student count while the story beneath it says 6,240. | Template the chapter text from `live.campus` (students, incidents, pending, health) and the leading incident; fall back to the prose only when the API is offline, with an "illustrative" tag. |

## B. Other issues found

| # | Where | Issue | Suggested fix |
| --- | --- | --- | --- |
| B1 | `backend/src/models/Complaint.js:185-190` | Complaint references are `CMP-(2100 + estimatedDocumentCount + 1)`. After any complaint is deleted (`DELETE /api/complaints/:id`, `complaintController.js:422-449`) the next new complaint is given a reference that already exists and the student's submission is refused with **409 "That reference is already in use"** — every later submission fails the same way until the count catches up. (Verified: deleted CMP-2123 as admin, then a student's new complaint was refused.) Two simultaneous submissions can also collide. | Use a counter collection (`findOneAndUpdate({$inc})`) or `max(reference)+1` with a retry on 11000. |
| B2 | `backend/src/models/GatePass.js:120-126` | Same pattern with `countDocuments` for gate-pass references; concurrent applications can collide. | Counter collection, as above. |
| B3 | `backend/src/controllers/kioskController.js:82` | Kiosk lookup still returns Documents `available: false` with the note "This campus system has no document module yet". With the extension pack installed the kiosk tile opens the new document flow (a frontend hook), but the API text is now out of date. Left unchanged because the brief forbids changing an existing endpoint's output. | Set `available: true` and point the note at `/api/documents/kiosk` once the change is allowed. |
| B4 | `frontend/src/NexCamp.jsx:4107-4108`, `README.md:13`, `frontend/README.md` | "THE TEN SURFACES" / "NOT TEN DASHBOARDS" / "ten interactive surfaces" — there were already 12 surfaces (21 with the extension pack). | Derive the count from `pageDefs.length`. |
| B5 | `frontend/src/NexCamp.jsx:190-194`, `frontend/.env.example` | The demo password is compiled into the client bundle for the auto sign-in. Fine for a demo, but a judge reading the bundle will notice. | Gate the auto sign-in behind `VITE_DEMO_AUTOLOGIN=true` and leave it off for production builds. |
| B6 | `backend/.env.example` (`GATE_PASS_REVEAL_OTP=true`) | OTP reveal is on by default in the template. It is correctly refused in production (`config/env.js`), but a staging deploy with `NODE_ENV=development` would expose OTPs. | Default to `false` in the template; enable explicitly for demos. |
| B7 | `backend/src/services/auditChainService.js:73-128` | The chain append reads the tail and writes `sequence+1`; one retry on a unique clash. Under a burst of parallel admin actions a second clash returns `null` and the action is silently not chained (logged only). | Serialise appends (a single-document counter or a queue) and surface a failed append in `/api/ai/audit`. |
| B8 | `frontend/src/NexCamp.jsx:3617-3618` | When the admin overview has not loaded (API offline or signed in as a student) Mission Control shows fixed KPIs ("87%", "12", "4", "38", "4.2h") with no "illustrative" tag. | Show an "offline — illustrative figures" tag, as the intel surfaces already do. |
| B9 | `backend/src/app.js:48-56` | One global limiter (300 req/min per IP). A help desk or a hostel on one NAT address can hit it during a busy period; the kiosk router adds its own 40/min on top. | Key the limiter by user id for authenticated requests; keep the IP limit for anonymous ones. |
| B10 | `frontend/src/NexCamp.jsx:2053`, `:3414` | The judge replay script and the investigation panel print "91% semantic overlap" even when live data is loaded; the live clustering result is not substituted there. | Read the overlap from `clusterRun` / the incident's evidence when present. |

## C. What the extension pack does *not* change

None of the items above are fixed by the extension pack; they are recorded
here for the team to decide on. The new features avoid repeating them: every
new figure is computed from records or labelled BASELINE ESTIMATE / SIMULATED
with its inputs, and the new word-overlap checks (duplicate notices, FAQ
retrieval) are labelled as word overlap, not semantics.
