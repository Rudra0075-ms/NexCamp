# Silent Support System — what was added, and every existing file it touched

> A student does not always know how to say "I need help." This gives them a
> private, optional pathway to a person — with follow-up — without diagnosing anyone.

**No page, route or nav item was added.** The site still has exactly 21 pages
(`pageDefs` 01–12 + `EXT_PAGES` 13–21). The feature lives inside two existing pages:

| Page | What appears | Who sees it |
|---|---|---|
| **02 Student Dashboard** | Wellbeing check-in card ("How are you feeling today?"), supportive result, **"I don't know how to ask for help"**, private / anonymous request, **"Check on me later"**, request progress tracker, emergency & help resources | Students only (their own data) |
| **10 Mission Control** | **Student Support Overview** (KPIs, follow-up status, weekly requests, check-in levels, outcomes, Support Insight) | `ADMIN` (aggregate only, small counts hidden) and `COUNSELLOR` |
| **10 Mission Control** | **Support queue**: Received → Assigned → Contacted → Follow-up → Resolved, with a recommended action per case | `COUNSELLOR` only |

Notifications go to the **existing** graded inbox (`GET /api/ai/notifications`, shown on page 02).

## Flow

```
Student check-in (optional, every question skippable)
  → support-signal rules decide a routing level      (services/support/supportRules.js)
  → optional AI re-words the message, language-checked (services/support/supportAi.js)
  → "I don't know how to ask for help" → private request (or "check on me later")
  → support team notified → Assigned → Contacted (optional inbox message) → Follow-up → Resolved + outcome
```

Routing levels (not diagnoses): **Stable · Could benefit from support · Support recommended · Immediate human attention required**.
Scoring is in `supportRules.js` — four 1–5 answers give points of concern; the same difficulty in an earlier check-in within 21 days raises the level; an explicit **"I don't feel safe right now"** is always *Immediate human attention required*.

## AI, and its limits

- Reuses the existing provider client (`services/ai/providerClient.js`) and the same `AI_PROVIDER / AI_API_KEY / AI_MODEL`. No new key, no new dependency.
- **Rules decide the level; a model can only re-word the student-facing message.** The model receives the level and plain reason lines only — never a name, ID or raw answers.
- Model output must pass the JSON guard **and** a non-clinical language filter (`isSafeLanguage`: depression, disorder, diagnosis, clinical, …); otherwise the rule-based text is used. A 6 s cap keeps the check-in fast.
- Never called for the immediate-attention level: that safety message is fixed.
- No provider configured / provider down → rule-based text, labelled `AI_NOT_CONFIGURED` / `DETERMINISTIC_FALLBACK`. If the support API itself is unreachable the card says *"Support check-in is temporarily unavailable. You can still request human support."*

## Emergency safety

An explicit "not safe" signal shows a calm "Please reach a person right now" panel with the **institution-configured** contacts (`SUPPORT_EMERGENCY_CONTACTS`). No number is hard-coded; when none is configured the student gets generic guidance (local emergency services, nearest hospital, warden/staff). By default (`SUPPORT_AUTO_ESCALATE_IMMEDIATE=true`) the support team is alerted with an urgent case, and the student is told so.

## Privacy and security

- **Narrow role.** New `COUNSELLOR` role, deliberately **not** in `STAFF_ROLES` — it gets no campus-wide staff access, and no existing staff role (admin included) can open an individual case.
- **Minimum data.** No free text from students. Check-ins store four optional integers, a flag and the level, and **expire automatically** (TTL, `SUPPORT_CHECKIN_RETENTION_DAYS`, default 90). Cases store the level only if the student ticks "share my latest check-in level"; answers are never shared.
- **Anonymous requests** never carry the student's identity to the team; replies reach the student through their inbox.
- **Admin overview is aggregate only**, and any count from 1 to `SUPPORT_MIN_CELL_SIZE − 1` (default 2) is returned as `null` and shown as `<3`.
- **Generic notification text** — no answers, levels or names in titles/bodies.
- **Kiosk fix:** the kiosk lookup (page 12) shows a student's recent notifications to the operator; it now excludes support notifications.
- **No browser persistence.** The frontend uses plain `request()` — not the last-good-copy cache or offline queue (both use localStorage). Every `/api/support` response is `Cache-Control: no-store`. Only a "skipped" flag is kept, in sessionStorage.
- Nothing sensitive in URLs (bodies only; paths carry an opaque id). Answers are never logged. Writes are rate-limited (30 / 10 min) and check-ins capped at 8 per day.
- Excluded from the shared audit chain on purpose — that chain is readable by staff. The case's own `history` is its record.

## API (all under `/api/support`, all authenticated)

| Method & path | Role | Purpose |
|---|---|---|
| `GET /me` | STUDENT | latest level, own requests, resources (one read) |
| `POST /check-in` | STUDENT | `{ feeling?, study?, connection?, helpComfort?, unsafe? }` (1–5) |
| `POST /requests` | STUDENT | `{ preference: COUNSELLOR\|MENTOR\|PRIVATE_CONVERSATION\|ANONYMOUS, preferredTime?, shareCheckIn?, anonymous? }` — one open request at a time |
| `POST /check-later` | STUDENT | `{ days: 1\|3\|7 }` |
| `POST /requests/:id/withdraw` | STUDENT (owner) | withdraw own request |
| `GET /resources` | any signed-in | configured help & emergency contacts |
| `GET /queue?closed=` | COUNSELLOR | cases, minimum-necessary fields |
| `POST /cases/:id/status` | COUNSELLOR | `{ status, outcome?, note?, message?, followUpDays? }` |
| `GET /overview?days=` | COUNSELLOR, ADMIN | aggregate counts + insights |

New collections: `supportcases`, `wellbeingcheckins` (`backend/src/models/support/`). No existing collection's schema changed; the `Notification` enums gained four kinds and one audience.

## Every existing file touched (each line marked `SUPPORT HOOK`)

| File | Change |
|---|---|
| `backend/src/config/constants.js` | appended: `COUNSELLOR` role (not a staff role), support vocabularies, 4 notification kinds + `SUPPORT_TEAM` audience |
| `backend/src/services/notificationPriority.js` | priority grading for the 4 new kinds |
| `backend/src/controllers/kioskController.js` | kiosk lookup excludes support notifications |
| `backend/src/routes/index.js` | mounts `/support` after every existing router |
| `backend/src/services/ext/extMonitor.js` | "check on me later" follow-ups ride the existing 60 s timer (errors contained) |
| `backend/src/seed/index.js` | runs the support seed last; `--no-support` skips it |
| `backend/package.json` | `seed:support` script |
| `backend/.env.example` | `SUPPORT_*` settings, demo support account |
| `frontend/src/NexCamp.jsx` | 1 import, 1 slot on page 02, 1 slot on page 10, support account added to the sign-in hint |

No existing route, response field, page, nav entry, test or dependency was removed or changed.

## Demo (about 2 minutes)

```bash
cd backend && npm run seed -- --fresh   # or: npm run seed:support on an existing database
```

1. **Student** (`pritish@bput.ac.in / Campus@2026`, signed in automatically) → page **02**. Answer "How are you feeling today?" low on feeling and studying → *Could benefit from support*. Check in the same way again → *Support recommended: "Your recent check-ins suggest that additional support may be helpful."*
2. **I don't know how to ask for help** → *Talk to a mentor* → Evening → **Request private support**. The tracker shows *Request created*; the inbox shows *"Your private support request has been received."*
3. Sign in as **support team** (`care@bput.ac.in / Care@2026`) → page **10** → Support queue: the request with its recommended action → **Assign to me → Mark contacted** (optional message) **→ Schedule follow-up → Resolve** with an outcome. The student's tracker and inbox follow each step.
4. Sign in as **admin** → page **10**: the Student Support Overview shows counts only, with small numbers hidden.

## Tests

- `backend/test/support.test.js` (24, no database): levels, repetition, unsafe override, option order, non-clinical language for every rule message, AI used only when safe and labelled, clinical AI output rejected, provider failure fallback, no AI call on the safety path, configured contacts only, view privacy (student view has no team note; team view has no answers/contacts; anonymous hides identity), role guards, every route mounted and refusing anonymous callers.
- `backend/test/support-integration.test.js` (6, needs MongoDB, skipped otherwise like the other integration tests): full check-in → request → assigned → contacted → follow-up → resolved flow, notification text privacy, anonymous + withdraw, follow-up sweep fires once, unsafe escalation, admin suppression, check-later upgrade.

## Limitations / configuration

- Set `SUPPORT_EMERGENCY_CONTACTS` and `SUPPORT_HELP_RESOURCES` before real use; until then students see generic guidance.
- One support-team role covers counsellors and mentors; the student's preference (counsellor / mentor / conversation) is recorded and shown for the team to route. A separate faculty-mentor role could be added later.
- Signals are the student's own voluntary check-ins only — attendance and other records are deliberately not used.
- The thresholds in `supportRules.js` are sensible defaults, not clinically validated; the institution's counselling service should review them.
