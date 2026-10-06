# HOOKS — every existing file the extension pack touched

Compared with the tag `baseline` (commit `76b33d7`, byte-identical to the
supplied ZIP). Reproduce with:

```bash
git diff baseline --stat --diff-filter=M      # 13 files, 74 lines added, 6 changed, 0 removed
git diff baseline --name-status --diff-filter=DR   # empty: nothing deleted or renamed
```

Everything else in the pack (89 files) is new: `backend/src/**/ext/**`,
`backend/test/ext-*.test.js`, `backend/scripts/ext-smoke.js`,
`frontend/src/ext/**`, `frontend/public/**`, `frontend/scripts/**`, and the
documents at the repository root. **No existing test file was modified.**

Every added line in an existing file carries the comment `EXTENSION HOOK`.
"Changed" below means a line was edited in place; in all six cases the old
behaviour is a strict subset of the new one.

## Backend

### `backend/src/routes/index.js` — 4 lines added
```js
// EXTENSION HOOK (see HOOKS.md): routes added by the PS07 extension pack.
import extRoutes from "./ext/index.js";
...
// EXTENSION HOOK (see HOOKS.md): mounted after every existing router, on new paths only.
router.use(extRoutes);
```
Why: mounts the new routers (`/notices`, `/documents`, `/verify`, `/timetable`,
`/mess-menu`, `/fees`, `/requests`, `/friction`, `/sms`, `/fix`, `/faq`,
`/board`, `/adoption`). Mounted last; none of those prefixes overlaps an
existing router (`/mess-menu` does not match Express's `/mess` mount).

### `backend/src/server.js` — 4 lines added
```js
import { startExtensionMonitor, stopExtensionMonitor } from "./services/ext/extMonitor.js";
startExtensionMonitor(); // EXTENSION HOOK        (after startGatePassMonitor())
stopExtensionMonitor(); // EXTENSION HOOK         (in shutdown, after stopGatePassMonitor())
```
Why: one timer (default 60 s, `EXT_MONITOR_SECONDS`) for scheduled notices,
the 07:30 quiet-hours digest, SMS escalation, fee reminders and the 48-hour
NO RESPONSE rule. It writes only to extension collections and the audit chain.

### `backend/src/config/constants.js` — 2 lines added
```js
// EXTENSION HOOK (see HOOKS.md): entity types written by the PS07 extension pack.
AUDIT_ENTITIES.push("Notice", "DocumentRequest", "ClassChange", "MenuChange", "FeeAccount", "FrictionBaseline", "SmsMessage", "FixProof", "ReopenRequest", "PolicySection");
```
Why: the hash-chained `AuditEntry.entityType` is an enum built from this array;
new entity types must be allowed for the extension to write to the same chain.
The original six values are unchanged and still first.

### `backend/src/models/Complaint.js` — 1 line changed
```diff
-    channel: { type: String, enum: ["APP", "KIOSK"] },
+    channel: { type: String, enum: ["APP", "KIOSK", /* EXTENSION HOOK: SMS keyword channel */ "SMS"] },
```
Why: a complaint filed through the SMS keyword channel is marked `channel: "SMS"`.
Optional field, no default, existing values unchanged. The existing
`createComplaint` controller is called unchanged (it sets `APP`); the SMS
service then updates the channel and appends one audit line on the new record.

### `backend/src/seed/index.js` — 5 lines added
```js
import { seedExtensions } from "./ext/index.js";
...
  // EXTENSION HOOK (see HOOKS.md): runs after every original step; skip with --no-ext.
  if (!process.argv.includes("--no-ext")) await seedExtensions();
```
Why: `npm run seed -- --fresh` gives judges every new panel populated. Runs
after all original steps; `--no-ext` reproduces the original seed exactly.
`npm run seed:ext` runs only the extension seed on an existing database.

### `backend/package.json` — 1 line changed, 2 added
```diff
-    "smoke:ops": "node scripts/ops-smoke.js"
+    "smoke:ops": "node scripts/ops-smoke.js",
+    "seed:ext": "node src/seed/ext/run.js",
+    "smoke:ext": "node scripts/ext-smoke.js"
```
Why: new commands. The changed line only gains a trailing comma.
No dependency was added, removed or upgraded (backend or frontend).

### `backend/.env.example` — 13 lines added (end of file)
`SMS_WEBHOOK_SECRET`, `SMS_REPLY_VIA_PROVIDER`, `VERIFY_BASE_URL`,
`EXT_MONITOR_SECONDS` — all optional, documented in place. Nothing in
`config/env.js` was changed; the new code reads these directly.

## Frontend

### `frontend/src/NexCamp.jsx` — 15 lines added, 1 changed
| Where | Lines | Why |
| --- | --- | --- |
| imports (after `Kiosk`) | `import ExtSurfaces, { EXT_PAGES, EXT_PAGE_IDS, ExtHeader, ExtMissionControl } from "./ext/ExtSurfaces.jsx";` | the one entry module |
| after `pageDefs = [...]` | `extPagesHook = this.pageDefs.push(...EXT_PAGES);` | nav entries and landing cards 13–21, appended after the twelve existing ones |
| `choreograph()` | `const dataDriven = ["student", "attendance", "mess", "kiosk", /* EXTENSION HOOK */ ...EXT_PAGE_IDS].includes(...)` (**changed**) | the new pages are data-driven like the kiosk: no scroll-linked scenes that would measure stale heights |
| header, after the Replay button group | `<ExtHeader … />` | TUESDAY MODE button, unread-notices chip, low-end prompt. `onLowEnd` sets the **existing** `lowBw` and `mode` state exactly as the existing toggles do (and re-reads AI panels, as `onLowBw` does); the switches themselves are unchanged |
| Mission Control, after the College Adoption section | `<IntelGuard name="Extension panels"><ExtMissionControl … /></IntelGuard>` | adoption datasets, Friction Ledger, pending queue, fix metrics, SMS activity, FAQ gaps — staff only, inside an error boundary |
| `<main>`, after the Kiosk surface | `{EXT_PAGE_IDS.includes(this.state.page) ? <ExtSurfaces … /> : null}` | renders surfaces 13–21 |

Visible side effects on existing screens, by design: the nav, the landing
"surfaces" cards and the header gain the new entries/buttons. At narrow widths
the new header controls wrap onto their own row (they sit beside, not inside,
the existing button group so they never clip). No existing element, label,
style or handler was changed.

### `frontend/src/components/intel/Kiosk.jsx` — 3 lines added, 2 changed
```js
const KioskDocuments = React.lazy(() => import("../../ext/DocumentsSurface.jsx").then((m) => ({ default: m.KioskDocuments })));
  if (service.key === "documents") return <React.Suspense fallback={null}><KioskDocuments student={student} /></React.Suspense>; // EXTENSION HOOK
```
```diff
- disabled={!sv.available && sv.key !== "gatepass"}
+ disabled={!sv.available && sv.key !== "gatepass" && sv.key !== "documents" /* EXTENSION HOOK */}
- {sv.available ? "Available" : "Not available"}
+ {sv.available || sv.key === "documents" /* EXTENSION HOOK */ ? "Available" : "Not available"}
```
Why: the brief's minimal hook — the Documents tile opens the new request flow
as the looked-up student, channel KIOSK, operator recorded. The other five
tiles are untouched.

### `frontend/src/lib/i18n.js` — 5 lines added
```js
import { EXT_HI, EXT_OR } from "../ext/i18n.js";
...
for (const [lang, extra] of [["ଓଡ଼ିଆ", EXT_OR], ["हिन्दी", EXT_HI]]) for (const [k, v] of Object.entries(extra)) if (!(k in DICTS[lang])) DICTS[lang][k] = v;
```
Why: Odia/Hindi labels for the new surfaces. Only keys that are **not already
present** are added, and eight words that already appear as text on existing
screens (APPROVE, REJECT, ASK, TODAY, CLOSE, INSUFFICIENT DATA, CANCELLED,
Priority) were deliberately left out of the new dictionaries, so every existing
screen translates exactly as before.

### `frontend/src/main.jsx` — 11 lines added
- lazy `VerifyPage`, `OfflineBanner`, `registerServiceWorker` imports;
- if the path is `/verify/:code`, render the public verifier; **otherwise the
  original `createRoot(...).render(<AppBoundary><NexCamp /></AppBoundary>)` line
  runs unchanged** (it is now the `else` branch);
- the offline banner mounts in its own root, outside the app tree;
- the service worker registers only in production builds (or with `?sw=1`).

### `frontend/index.html` — 4 lines added
Manifest link, theme colour and SVG icon for the installable app shell.

### `frontend/package.json` — 1 line changed, 1 added
`"readiness": "node scripts/device-readiness.mjs"` (the changed line only gains
a trailing comma).

## Data-level side effects of the extension seed

The extension seed writes to new collections, with two deliberate exceptions,
because proof-of-fix and the Friction Ledger have nothing to show when no
complaint has ever been resolved (the base seed resolves none):

| Collection | Records added | Identified by | Skip with |
| --- | --- | --- | --- |
| `complaints` | 6 RESOLVED historical complaints (Hostel A/C electricity, library Wi-Fi, Hostel A tap, Hostel C cleanliness, mess cooler) | references `CMP-1901` … `CMP-1906` | `--no-history` |
| `gatepasses` | 3 RETURNED passes from the last few days | references `GP-YYYY-H0001` … `H0003` | `--no-history` |

They are inserted directly: not clustered into any incident, not counted on any
building, and none is a Hostel B water complaint, so the headline incident is
untouched. **No existing seed record is modified.** Existing panels that count
all complaints (e.g. complaint totals, recurrence over 14 days) include these
six resolved rows when the extension seed is loaded. The original smoke suites
(`smoke`, `smoke:gatepass`, `smoke:ai`, `smoke:ops`) pass with and without them.

The extension also appends entries to the existing hash-chained audit log
(that is the brief's requirement), which the existing `/api/ai/audit` view
lists; the chain verifies intact.

## Proof that existing behaviour is unchanged

1. **Tests:** the 184 original tests pass unmodified (`npm test` now runs 297:
   184 original + 113 new).
2. **Smoke suites:** all four original suites pass on a fresh seed with the
   extension data loaded.
3. **API comparison:** the baseline commit's server (port 5001) and the new
   server (port 5000) were run against the same freshly seeded database
   (`--no-ext`), and 46 existing endpoints — public, student and admin, GET and
   POST, including the 404 and 401 paths — were compared after removing
   timestamps and elapsed-time fields: **46/46 identical** (44 successful
   responses, 2 identical errors).

## Conflicts — what was not built as specified, and why

| Item | Conflict | What was done instead |
| --- | --- | --- |
| 1C "faculty or admin can change a class" | There is no faculty role. Adding one to `ROLES` would also add it to `STAFF_ROLES`, handing faculty every existing staff permission (a behaviour change). | Class changes are recorded by `ADMIN` (the academic office). Documented in the UI and the route. |
| 1B Kiosk "Documents" | `GET /api/kiosk/lookup` still returns `documents.available: false` with the note "no document module yet". Changing that response is forbidden. | The frontend hook opens the tile regardless; the stale API text is listed in AUDIT.md (B3). |
| 2B "marked channel SMS" | The existing `createComplaint` controller always writes `channel: "APP"` and its own `COMPLAINT_FILED` chain entry. | Called unchanged; the SMS service then sets `channel: "SMS"`, appends an audit line on the complaint, and writes a separate `COMPLAINT_FILED_BY_SMS` chain entry. |
| 2C "notifies the department" | The existing `Notification` model's `kind` enum has no reopen kind; widening it would change an existing model's validation surface. | The department is notified through the new Notice Center (audience = that department's staff + administrators). The existing inbox is untouched. |
| 2G offline cold start | The existing app keeps its session token in memory and signs in over the network. After a reload *while offline* the shell loads (service worker) but no one is signed in, so personal data cannot be shown. | Pages opened while signed in keep working offline (cached copy, queued writes). A cold offline start says so plainly instead of showing another user's cached data. Changing the auth model was out of scope. |
