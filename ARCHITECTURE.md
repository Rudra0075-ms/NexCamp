# Architecture

The backend brief asked for the analysis below **before** implementation. The
implementation exists, so this is that analysis written against what was built —
it is the design record, and section E lists what is still genuinely open.

---

## A. Frontend analysis

`frontend/src/NexCamp.jsx` is a single React component owning ten surfaces, the
campus dataset and all interface state. Reading it first is what determined every
model and endpoint in `backend/`.

### Pages

| # | Surface | What it shows |
| --- | --- | --- |
| 01 | Landing / NeX Camp | Scroll-driven campus story over a WebGL + SVG campus, with a per-building intelligence panel |
| 02 | Student Dashboard | One student's attendance, eligibility, hostel and mess signals, and their open reports |
| 03 | Attendance Intelligence | Trend, per-subject breakdown, absence heatmap, eligibility what-if |
| 04 | Mess Intelligence | Demand curve, crowd density, predicted peak, expected waste |
| 05 | Report & Track Problem | A complaint as a tracked object, with AI classification and an audit timeline |
| 06 | Incident Intelligence | Complaints clustering into one recurring incident, with time travel and memory match |
| 07 | Problem Investigation | Problem graph, evidence drawer, confidence breakdown |
| 08 | Predictive & Risk Center | Campus risk map, risk by domain, anomaly signals, silent problem detection |
| 09 | Intervention Center | Decision simulator, AI ↔ human decision layer, resolution quality, campus memory |
| 10 | Admin Command Center | KPIs, AI briefing, action queue, cross-domain chains, live feed |

Plus: a boot sequence, a ⌘K command bar, a judge replay mode, an EN/ଓଡ଼ିଆ/हिन्दी
switch, render-quality and low-bandwidth modes, and two WebGL stages.

### Components and controls that need data

Campus map (nine blocks with geometry, risk, leading incident, affected count,
confidence, cause, recommended action) · building intelligence panel · hero
counters · attendance ring and threshold bar · alert cards with provenance chips ·
open-report rows with progress · status tiles · attendance trend polyline ·
subject rows · 14-column absence heatmap · eligibility slider · mess demand bars ·
crowd dot grid · menu rows · complaint form · lifecycle track · classification
grid · audit timeline · complaint cloud that collapses on clustering · day-by-day
time-travel slider · incident table · historical recurrence table with scanning
line · problem graph nodes and edges · evidence drawer · confidence breakdown
bars · risk domain bars · escalation ladder · silent-signal panel · anomaly table ·
two decision cards · risk curves · recommendation grid · ACCEPT/MODIFY/REJECT with
a modify slider and rejection reasons · campus memory signatures · KPI strip ·
briefing · action queue · signal feed · cross-domain chains · command bar.

### User actions that require an API

Sign in and out · submit a complaint · track its lifecycle · read own attendance ·
simulate eligibility · read mess demand · open a building · open an incident · run
clustering · scan campus memory · select a graph node · select a risk building ·
compare intervention scenarios · accept, modify or reject a recommendation · ask a
natural-language question · run the judge replay.

### Authentication and authorization requirements

The uploaded frontend had no sign-in of its own, so authentication was added the
way the interface already handles secondary controls: one chip in the existing
status-bar chip row, opening a modal built from the command palette's own markup.
No surface was redesigned. The seeded demo student is signed in automatically on
load so a judge sees real data without typing anything, and the chip switches
accounts.

What the interface implies about roles: a student sees only their own attendance
and complaints; surfaces 06–09 are campus-wide analysis; surface 10 is explicitly
an administration console; the ACCEPT/MODIFY/REJECT control is an act of
authority. So: `STUDENT` and `ADMIN` at minimum, with `WARDEN`,
`FACILITY_MANAGER` and `MESS_MANAGER` where a real campus would route work by
department.

### Data requirements

Students, buildings, complaints, incidents, attendance, mess records, risk
snapshots, anomalies, interventions, campus memory, cross-domain relationships.

### Provenance requirement

The interface labels figures `ACTUAL DATA`, `AI PREDICTION`, `AI RECOMMENDATION`
and `EVIDENCE`. That is a backend responsibility, not a styling one, so those tags
are returned by the API rather than assigned in the component.

---

## B. Database architecture

Eleven collections. `→` is a Mongoose `ref`.

### User
`name, email (unique), password (bcrypt, select:false), role, studentId, department, course, semester, hostel → Building, hostelName, room, phone, attendancePercentage, managedDepartment`
Indexes: `email` unique · `role` · `studentId` sparse · `{ role, hostel }`

### Building
`code (unique), mapId (unique), name, type, domain, location, capacity, occupancy, currentRisk, riskLevel, activeProblems, historicalProblems, affectedStudents, departments[], geometry { x, y, w, d, h }`
Indexes: `code` unique · `mapId` unique · `currentRisk` desc
`geometry` holds the map coordinates the frontend already draws, so the campus can
grow without a frontend change.

### Complaint
`reference (CMP-xxxx, unique), student → User, title, description, category, subCategory, location, building → Building, priority, severity, status, department, assignedTo → User, relatedIncident → Incident, aiClassification { … }, duplicateProbability, duplicateOf → Complaint, evidence[], audit[], resolution { … }`
Indexes: `reference` unique · `student` · `building` · `status` · `relatedIncident` · `{ building, category, createdAt }` · `{ status, createdAt }`
`aiClassification` is a sub-document, not loose fields, so what the system inferred
is always distinguishable from what a person stated.

### Incident
`reference (INC-xxxx, unique), title, description, category, building → Building, complaints[] → Complaint, status, risk, riskLevel, severity, confidence, possibleCauses[], evidence[], historicalMatches[] → CampusMemory, affectedStudents, predictedImpact, detectedAt, firstComplaintAt, clusteredAt, resolution { … }`
Indexes: `reference` unique · `category` · `building` · `status` · `{ risk, status }` · `{ building, category }`

### Attendance
`student → User, subject, subjectCode, semester, totalClasses, attendedClasses, attendancePercentage, sessions[{ date, slot, present }], linkedIncident → Incident`
Indexes: `{ student, subject }` unique · `student`
Per-class marks live in `sessions`, so the trend line and the heatmap both derive
from one read. `linkedIncident` is how a hostel failure becomes visible as an
academic signal.

### MessRecord
`date, time, meal, crowd, capacity, demand, waste, queueMinutes, menu[], building → Building`
Indexes: `{ date, time }` unique · `date`

### Risk
`building → Building, scope, domainLabel, category, riskScore, riskLevel, prediction, confidence, affectedStudents, incident → Incident, timestamp`
Indexes: `{ building, timestamp }` · `{ scope, timestamp }` · `timestamp`
Snapshots rather than a mutable field, because the interface animates risk changing
over time.

### Anomaly
`building → Building, metric, signal, baseline, current, changePercentage, direction, historicalPattern, matchedMemory → CampusMemory, predictedRisk, confidence, complaintsSoFar, recommendedAction, daysObserved, method, status, detectedAt`
Indexes: `building` · `{ predictedRisk, status }`

### Intervention
`reference (INT-xxxx, unique), incident → Incident, building → Building, recommendedAction, priority, expectedImpact, estimatedResolutionHours, confidence, owner, affectedStudents, status, decision { value, by → User, byName, at, reason, modifiedAction, modifiedWindowHours }, projection { … }, outcome { … }`
Indexes: `reference` unique · `incident` · `{ status, priority, createdAt }`
The AI's recommendation and the human's answer are separate sub-documents on
purpose — one never overwrites the other.

### CampusMemory
`incident → Incident, incidentReference, occurredOn, incidentType, category, building → Building, buildingName, cause, resolution, resolutionTimeHours, outcome, riskBefore, riskAfter, studentSatisfaction, recurrence, recurrenceCount, signatures[], keywords[]`
Indexes: `occurredOn` · `category` · `building` · `{ building, category, occurredOn }`

### Relationship
`chain, fromLabel, toLabel, order, fromType, toType, entityType, entityId, relation, confidence, basis, kind`
Indexes: `{ chain, order }` · `{ entityType, entityId }`
A flat edge list, so the frontend can render any graph shape without the backend
knowing about the visualisation.

### GatePass
`reference, student, hostel, hostelName, room, date, reason, destination, leaveAt,
expectedReturnAt, status, parent{name, phoneMasked, verified, verifiedAt},
approval{decision, decidedBy, decidedByName, decidedAt, note},
pass{tokenHash (select:false), issuedAt, exitScanAt, returnScanAt, scanCount},
exitAt, returnAt, actualDurationMinutes, overdueMinutes, warningSentAt,
overdueMarkedAt, overdueNotifiedAt, events[]`
Indexes: `{ student, createdAt }` · `{ status, expectedReturnAt }` · `{ hostel, status }`
`leaveAt` / `expectedReturnAt` / `exitAt` / `returnAt` are the only clock anyone
trusts; the browser's countdown is derived from them. `events[]` mirrors the
complaint audit trail, so both render with the same component.

### OtpVerification
`gatePass, purpose, codeHash (select:false), phoneMasked, expiresAt, attempts,
maxAttempts, sendCount, lastSentAt, consumedAt, deliveryMode, delivered, deliveryError`
TTL index on `expiresAt`, so spent challenges clear themselves. The code is never
stored — only its bcrypt digest, the same treatment the password gets.

### Notification
`kind, audience, channel, user, gatePass, title, body, tone, readAt, deliveredAt,
deliveryMode, deliveryError`
Indexes: `{ user, readAt, createdAt }`
Raised by the server's own sweep, not by a page being open. `PARENT` rows have no
`user` — they only ever leave over SMS.

### Relationships at a glance

```
User ──< Complaint >── Building
            │              │
            ▼              ▼
        Incident ──── Risk / Anomaly
            │
   ┌────────┼────────┐
   ▼        ▼        ▼
Investigation  Intervention  CampusMemory
(derived)          │
                   ▼
              Resolution ──> CampusMemory

User ──< Attendance ──> Incident   (cross-domain link)

User ──< GatePass ──> Building (hostel)
            │
   ┌────────┴────────┐
   ▼                 ▼
OtpVerification   Notification ──> User (student / warden / admin)
(guardian code)                └──> SMS  (guardian, no User row)
```

Investigation is **derived**, not stored: it is assembled on read from complaints,
memory and the maintenance pattern, so it cannot drift out of date.

---

## C. API architecture

69 routes under `/api`. The full table, with request and response shapes, is in
[`backend/README.md`](backend/README.md#api). In summary:

| Group | Endpoints | Auth |
| --- | --- | --- |
| `/api/auth` | register, login, logout, me | public except `me` |
| `/api/students` | `me/dashboard` | student |
| `/api/complaints` | CRUD | authenticated; writes staff-only |
| `/api/incidents` | list, read, complaints, investigation, memory-match, cluster, create, update | public reads, staff writes |
| `/api/attendance` | me, by student, create, update, simulate | authenticated |
| `/api/mess` | current, demand, analytics, create | public reads |
| `/api/campus`, `/api/buildings` | campus payload, list, read | public |
| `/api/risk` | all, campus, by building, anomalies | public |
| `/api/interventions` | list, read, quality, simulate, create, update, decision | public reads, staff writes |
| `/api/memory` | list, matches | public |
| `/api/intelligence` | relationships, questions, query, by entity | public |
| `/api/admin` | overview, action-queue, briefing, cross-domain | staff only |
| `/api/demo` | incident-story, state | public |

Reads that feed the public campus surfaces are open so the landing page, map and
intelligence views work before anyone signs in. Everything personal, and every
write, requires a token. Everything campus-wide and administrative requires a
staff role.

---

## D. End-to-end architecture

```
Frontend (React · GSAP · three.js)
        │  fetch, credentials: include
        ▼
CORS allow-list → helmet → JSON body limit → cookie parser
        │
        ▼
Mongo-operator sanitizer → rate limiter
        │
        ▼
Route  →  authenticate  →  authorize  →  validate  →  Controller
                                                          │
                                                          ▼
                                                      Service
                                        (classification, clustering, memory,
                                         investigation, risk, anomaly,
                                         intervention, attendance, mess, query)
                                                          │
                                                          ▼
                                                      Mongoose
                                                          │
                                                          ▼
                                                       MongoDB

Any thrown error ──> central error middleware ──> { success: false, message }
```

A complaint end to end:

```
POST /api/complaints
   → classificationService.classify()      category, priority, severity, duplicates
   → incidentClusteringService.attach()    folds into an open incident if one fits
   → riskService.scoreIncident()           recomputes the incident's risk
   → audit trail written at each step
   ← { complaint, classification, duplicates, incident }
```

An incident end to end:

```
complaints → clustering → Incident
                             │
      ┌──────────────────────┼───────────────────────┐
      ▼                      ▼                       ▼
investigationService   memoryService.findMatches  riskService
 (evidence, weights,    (similar past incidents)  (score + factors)
  confidence)
      └──────────────────────┴───────────────────────┘
                             ▼
                  interventionService
        (recommendation + DO_NOTHING / REPAIR_NOW / DELAY_24H)
                             ▼
                   human ACCEPT / MODIFY / REJECT
                             ▼
                   outcome → memoryService.remember()
                             ▼
                        CampusMemory
             (so the next matching signature is caught earlier)
```

Frontend responsibilities: UI, animation, visualisation, interaction.
Backend responsibilities: data, business logic, authentication, authorization,
persistence, API.

---

## E. What is genuinely open

Things the frontend did not settle, resolved with a stated assumption rather than
invented silently.

1. **No sign-in existed in the uploaded frontend.** Assumed: cookie + bearer, a
   chip in the existing status bar, and automatic demo sign-in so nothing has to
   be typed during a demo. Not assumed: any change to the ten surfaces.
2. **Where metric series come from.** Anomaly detection needs water draw, Wi-Fi
   session success, mess load, medical walk-ins and 08:00 attendance over time.
   No campus sensor feed exists, so the seed supplies readings and
   `anomalyDetectionService.sweep()` takes them as input. Wiring a real feed means
   calling `sweep()` on a schedule — no model change.
3. **Cross-domain edge confidences** (water → sleep → attendance, 76% / 84% / 79%)
   are stored analyst estimates, not measured correlations. They are labelled
   `AI PREDICTION` and their `basis` is stored alongside them. Deriving them from
   real data needs attendance and Wi-Fi session history the demo does not have.
4. **The rupee costs** on the intervention cards (`₹ 2.4L` / `₹ 18K`) are the
   frontend's own figures. No costing data exists to derive them, so they were
   left in the frontend rather than given a fake backend source.
5. **Student satisfaction** has no collection mechanism — there is no survey
   endpoint because the interface has no survey. It is accepted on resolution and
   stored when supplied.
6. **Resolution time medians.** The 3.8-day maintenance median is currently a
   constant in `investigationService`. With enough resolved incidents it should be
   computed per building and per category.
7. **Live updates.** The signal feed reads as though it streams. It is polled.
   Socket.IO was deliberately not added; see the backend README.
8. **Two pre-existing SVG markup issues.** `stroke-width`, `stroke-dasharray`,
   `font-family`, `font-size`, `font-weight` and `letter-spacing` appear as
   hyphenated attributes in the original JSX, where React ignores them. Fixing
   them would change how the campus renders, so they were left alone — but they
   are worth a look if the visual result was not what the author intended.
