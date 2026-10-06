# NeX Camp

An interactive campus problem-intelligence interface: ten connected surfaces that
turn student complaints into incidents, investigations, risk predictions and
interventions for a single campus.

## Requirements

- Node.js 18 or newer (Windows, macOS or Linux)
- The API in `../backend`, for live data (optional — see below)

## Getting started

```bash
cd frontend
npm install
cp .env.example .env.local   # optional; defaults to http://localhost:5000
npm run dev
```

Vite prints a local URL (http://localhost:5173 by default) and opens it.

## Backend integration

Every surface reads from the API in `../backend` (`src/lib/api.js`). The status
bar shows `API LIVE` once they are talking, and the account chip beside it signs
in — the seeded demo student is signed in automatically on load, so there is
nothing to type before a demo.

**Each surface keeps its original built-in dataset as a fallback.** If the API is
unreachable the status bar shows `API OFFLINE`, every page renders exactly as it
did before, and every control still does something. Nothing about the layout,
the components or the animations changed to accommodate the backend.

What is live rather than staged once the API is up:

| Control | What actually happens |
| --- | --- |
| The complaint form (05) | Your text is submitted, classified, matched against duplicates and folded into an incident; the audit timeline is what the system did |
| The eligibility slider (03) | `POST /api/attendance/simulate`, debounced — the projection is calculated server-side from your real record |
| RUN SEMANTIC CLUSTERING (06) | Clustering runs over the real complaint window, then scans campus memory for a match |
| The time-travel slider (06) | The incident's real day-by-day complaint and risk growth |
| The problem graph (07) | Node labels, evidence and the confidence breakdown come from the assembled case |
| The decision cards (09) | `POST /api/interventions/simulate` — three scenarios compared on live figures |
| ACCEPT / MODIFY / REJECT (09) | Recorded against the intervention, attributed to the signed-in person. A rejection without a reason is refused |
| ⌘K command bar | `POST /api/intelligence/query` |
| REPLAY INCIDENT | Driven by `GET /api/demo/incident-story` — the pipeline read back out of the database |

Mission Control (10) and the decision controls need a staff account; sign in as
`control@bput.ac.in` / `Control@2026`.

The API labels every figure `ACTUAL DATA`, `AI PREDICTION`, `AI RECOMMENDATION` or
`EVIDENCE`, and names the technique behind each inference — those labels are
rendered as-is rather than assigned here.

```bash
npm run build     # production bundle in dist/
npm run preview   # serve the production bundle
```

## Project structure

```
frontend/
├── index.html                 # Vite entry document, loads the Archivo webfont
├── package.json
├── vite.config.js
├── .env.example               # VITE_API_URL and the demo credentials
└── src/
    ├── main.jsx               # React root
    ├── NexCamp.jsx           # the application: all eleven surfaces, data and choreography
    ├── lib/
    │   ├── style.js           # CSS-string -> React style helpers (s, hov)
    │   ├── i18n.js            # EN / ଓଡ଼ିଆ / हिन्दी runtime interface translation
    │   ├── qrScanner.js       # camera QR scanning: getUserMedia + jsQR, decoded in-page
    │   └── api.js             # the API client, plus the bulk loaders
    └── styles/
        ├── modernist.css      # design system: tokens, components, grid rules
        └── theme.css          # dark theme token overrides, keyframes, accent motion
```

## The eleven surfaces

| # | Surface | What it does |
| --- | --- | --- |
| 01 | Landing / NeX Camp | Scroll-driven campus story over an interactive WebGL campus, with a building intelligence panel |
| 02 | Student Dashboard | Attendance, eligibility, hostel and mess signals for one student, plus their open reports |
| 03 | Attendance Intelligence | Trend, per-subject breakdown, absence heatmap and an eligibility what-if simulator |
| 04 | Mess Intelligence | Demand curve, crowd density, predicted peak and expected waste |
| 05 | Report & Track Problem | A complaint as a tracked object with AI classification and an audit timeline |
| 06 | Incident Intelligence | Semantic clustering of complaints into recurring incidents, with time travel |
| 07 | Problem Investigation | Problem graph, evidence drawer and a confidence breakdown |
| 08 | Predictive & Risk Center | Campus risk map, risk by domain, anomaly signals and silent problem detection |
| 09 | Intervention Center | Decision simulator comparing inaction against repair, and resolution quality |
| 10 | Admin Command Center | Campus mission control: KPIs, AI briefing, action queue, cross-domain chains |
| 11 | Hostel Gate Pass | Apply, guardian OTP, warden approval, QR at the gate, a server-owned countdown, and the warden console |

## Intelligence enhancements (animation layer)

Added on top of the existing ten surfaces — no new pages, no layout changes:

- **AI ↔ Human decision layer** (09 Intervention Center) — ACCEPT / MODIFY / REJECT
  on the existing recommendation, with an animated AI → HUMAN DECISION → ACTION →
  OUTCOME chain, a modify window slider and recorded rejection reasons.
- **Campus Memory** (09, after ACCEPT) — the resolved incident compresses into a
  persistent signal: signatures stagger in, the outcome risk counts 87% → 21%, and
  an accent pulse marks the pattern being stored.
- **Memory Match** (06 Incident Intelligence) — running semantic clustering sends a
  scanning line through the historical incidents, highlights the matching
  2025-11-04 pump failure and counts similarity up to 82%.
- **Judge Replay Mode** (header · REPLAY INCIDENT) — a timestamped replay that
  drives the existing pages and their states through the whole pipeline, from the
  first student report to the memory update, with a fixed replay ticker.

The status bar's EN / ଓଡ଼ିଆ / हिन्दी switch re-expresses the rendered interface
in place (`src/lib/i18n.js`), so every surface changes language with no layout,
component or data change; EN restores the originals exactly.

All four honour `prefers-reduced-motion` (animations resolve to their end state)
and reuse the existing components, tokens and layout.

## 3D layers

Two WebGL stages share one lifecycle:

- **Campus stage** (Landing, Risk Center) — extruded blocks on a shadowed ground
  plane, raycaster hover and selection, and a scroll-driven orthographic camera.
- **Per-page stage** (the other eight surfaces) — one bounded, drag-to-orbit scene
  built from that page's own state: eligibility arcs, a subject bar field, an
  instanced hall-occupancy volume, a complaint packet in transit, a complaint
  cloud that collapses on clustering, an evidence lattice, diverging decision
  ribbons, and a risk skyline.

## Technology

- **React 18** — one component owning the campus dataset and all interface state
- **three.js** — both WebGL stages, including InstancedMesh crowds and raycasting
- **GSAP + ScrollTrigger** — scrubbed scroll storytelling, staggered reveals,
  magnetic buttons and panel entrances
- **Inline-styled markup** on the design system's tokens, so a token change
  re-themes every surface at once

## Graceful degradation

The WebGL layers are optional. They are disposed automatically when the render
mode is set to LOW, when low-bandwidth mode is enabled, when
`prefers-reduced-motion` is set, or when the 3D toggle in the status bar is
switched off — the SVG campus underneath keeps the same hover, selection and
intelligence-panel behaviour, and every data view stands on its own. Scroll
storytelling falls back to a native scroll listener when GSAP is unavailable.

## Gate pass (surface 11)

The student panel, the guardian OTP step, the QR, the countdown and the warden
console all live on one surface, role-switched: the console section renders only
for an account the backend says may approve.

Nothing on this surface decides anything. The countdown is drawn from the
`expectedReturnAt` and `serverTime` the API returns together, re-read every
fifteen seconds and on every page load, so refreshing mid-pass resumes correctly
and a wrong device clock changes the display and nothing else. Whether a scan
means "leaving" or "coming back" is the backend's decision, derived from the
pass's stored status.

Scanning uses `getUserMedia` plus `jsqr`. Frames are drawn to an off-screen
canvas, decoded in the page and dropped — nothing is uploaded or retained, and
the camera is released the moment a code is read or the panel is closed. A denied
permission, a missing camera and a camera already in use each get their own
explanation, and the panel always offers typing the pass code instead.
