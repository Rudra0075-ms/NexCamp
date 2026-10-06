# DEMO — step-by-step script (about 12 minutes)

## Before you start

```bash
cd backend && npm run seed -- --fresh && npm run dev     # :5000
cd frontend && npm run dev                                # :5173
```

The app signs in as the demo student automatically. The account chip in the
status bar signs out; click it again to sign in as someone else.

| Role | Email | Password |
| --- | --- | --- |
| Student (Pritish, Hostel B, CSE 3A) | `pritish@bput.ac.in` | `Campus@2026` |
| Admin | `control@bput.ac.in` | `Control@2026` |
| Hostel B warden (kiosk operator) | `warden.hostelb@bput.ac.in` | `Control@2026` |
| Facility manager (proof of fix) | `facility@bput.ac.in` | `Control@2026` |

Tip: to show a phone, use the browser's device toolbar at 390 px wide. Every new
page works there with no sideways scrolling.

---

## 0. 30-second proof — every problem, solved on screen (30 s, as the admin)

1. Press **30-SECOND PROOF** in the header, beside TUESDAY TEST. As the student it
   asks you to sign in as the admin (`control@bput.ac.in`) — every scene reads staff
   views. It shows "Reading the live database…" while it makes **one** request
   (`GET /api/xo/reel`, about 4.7 KB with `?lite=1`), then plays by itself.
2. Eleven scenes in 30.0 s: the PROBLEM is acted out, the MECHANISM acts on it,
   and a LIVE OUTPUT card rises with the figures the API returned, its honesty
   label (ACTUAL DATA / SIMULATED / ASSUMPTION / INSUFFICIENT DATA) and its source
   endpoint, then holds still for over a second. Nothing is written — play it
   as often as you like; the database is unchanged.
3. Controls: **Space** pause, **← →** previous / next scene, REPLAY, **Esc** closes.
   The stopwatch (top right) and the ten dots show where you are.

**Recording tip.** Open `/?reel=1` in a 1920 × 1080 window: the reel opens on load,
hides its controls and starts once the data is in (sign in as the admin when it
asks). `/?reel=1&loop=1` loops it. `cd frontend && node scripts/reel-check.mjs`
records `docs/reel/reel.webm` and the per-scene screenshots for you.

**Low-end phones.** `?lowend=1` (or LOW render mode) plays the same data and timing
with no animation at all: each scene cuts between its problem, mechanism and
solution frames. With *reduce motion* turned on in the OS, movement becomes
cross-fades. With the server unreachable it shows the last copy this device
cached, with its time — or "No data cached".

---

## 1. Tuesday Mode — the PS07 story in one app (3 min, as the student)

1. Click **TUESDAY MODE** in the header, then **START THE CLOCK**.
2. Tap **DO IT →** for each errand. The app changes page as you go:
   - *Request a bonafide certificate* → a `DOC-…` reference with a 24 h target.
   - *Report a leaking tap* → filed through the normal complaint path, classified
     WATER and routed to plumbing.
   - *Is tomorrow's class cancelled?* → answered from the timetable. If tomorrow
     is a weekend it says so, then answers for the next class day
     ("Yes — DBMS 08:00 is cancelled… DATA STRUCTURES moves to SEMINAR HALL 2").
   - *Check the changed mess menu* → the changed lunch, and why.
3. The same errands from a basic phone: *SMS: WATER B-214 …* files a complaint,
   *SMS: NOTICE* reads the class-change notices, *SMS: MENU* gives the next meal.
   Each is marked SIMULATED SMS. It also says plainly that certificates have no
   SMS command.
4. It ends on the **Friction Ledger for this run**: the measured seconds and taps
   (presenter + server) next to the old process (BASELINE ESTIMATE: 120 min in the
   office queue for a bonafide, 45 min chasing a warden-diary complaint…).

## 2. Notice Center — 13 NOTICES (2 min)

**As the student:** the header shows an unread badge. Open **13 NOTICES**:
priority bars, the 07:30 **DIGEST** label on a notice written at 22:40 last night,
"ALSO SENT BY SMS" on an escalated one, and **MARK DONE** on the exam-form notice.

**As the admin:** open **13 NOTICES → COMPOSE**.
1. Tap the hostel chip **HOSTEL B**, then section **A**: the server-computed
   *reaches N* changes live.
2. Type the title "Submit the mid-semester examination form" → a duplicate warning
   appears (word overlap with a notice from yesterday, overlapping recipients).
   Publish → 409 → **PUBLISH ANYWAY** shows the override is deliberate.
3. Point at the **Quiet hours rule** box.
4. **SENT & DELIVERY → DELIVERY** on "Submit the mid-semester examination form":
   delivered/read/acknowledged/done with percentages, by hostel/branch/year, and
   the list of who has not read or acted. **RUN SWEEP NOW** runs the digest,
   SMS escalation and fee reminders on demand (SMS lines appear in the API log).

## 3. Certificates and QR verification — 14 DOCUMENTS (2 min)

1. **As the student:** the issued bonafide → **DOWNLOAD PDF**. Show the QR code
   and the 8-character code on the certificate.
2. Open the QR link (or `/verify/<code>`) in a private window: **VALID**, type,
   issue date, masked name. Choose the downloaded PDF under *Check a copy* →
   **COPY MATCHES**. Tap **SIMULATE TAMPERING** → **COPY ALTERED**.
3. **As the admin:** approve Pritish's *Hostel Residence* request. On the
   *No Dues* request note the fee-ledger EVIDENCE line; **REJECT** stays disabled
   until a reason is typed (the API also refuses a reason-less rejection). Issue the approved one, then
   **REVOKE** with a reason → the verify page now says **REVOKED**.
4. **Kiosk (as the warden):** 12 KIOSK → student `BPUT/CSE/22/0425` → the
   **Documents** tile is now available → request a bonafide: channel KIOSK, the
   operator is recorded.

## 4. Classes, fees, requests (2 min, as the student)

- **15 CLASSES:** ask "Is tomorrow's class cancelled?" (evidence = the change
  reference and its notice). **ADJUSTED ATTENDANCE** shows the official 71.7%
  unchanged beside the adjusted view where a cancelled Friday class is
  "cancelled — not counted". **MESS MENU** shows the changed lunch.
- **16 FEES:** status OVERDUE (a ₹200 library fine), next due ₹18,000 mess
  advance in 5 days — and the reminder notice for it in 13 NOTICES.
- **17 MY REQUESTS:** *Please confirm this fix* for CMP-1901 with the
  technician's photo. Tap **NOT FIXED** → a reopen request `RPN-…` is created and
  the original complaint stays RESOLVED. Below: one timeline for complaints,
  documents, notices with actions and reopen requests.

## 5. Basic phone — 18 SMS PHONE (1 min)

Tap the keys: `ATT` (attendance, classes needed for 75%), `GP`, `MENU`, `NOTICE`,
then type `STATUS CMP-2101`. Every reply shows its length out of 160. As the
admin you can send as any registered demo number; a student only as their own.

## 6. Office FAQ and the board (1 min)

- **19 ASK OFFICE:** "Can I keep an electric kettle in my room?" → the answer with
  its cited section `HOSTEL-APPLIANCES`. Ask "When is the placement drive?" →
  *no section matches* → **CREATE A REQUEST**. Switch the answer language to
  ଓଡ଼ିଆ: without an AI provider it says it is showing the English section.
- **20 YOU SAID, WE DID:** filter HOSTEL B — "14 reports → pump 2 impeller
  replaced… in 5.4h" and the recurring Hostel B water pattern. No names.

## 7. Mission Control additions (1.5 min, as the admin)

Open **10 MISSION CONTROL** and scroll past the existing College Adoption panel:
- **College adoption · more datasets:** load the *Timetable* template, break a
  row (e.g. end before start) → **DRY RUN** → row-level errors, `written 0`; the
  three rollout phases with exit criteria.
- **Friction Ledger:** hours saved this week (ESTIMATE), per workflow ACTUAL DATA
  medians vs BASELINE ESTIMATE, the 30% target ticks; open the baseline table and
  edit a row (it is audited).
- **Unified pending queue:** filter by *MAINTENANCE · PLUMBING*, see ageing
  buckets, SLA breaches and workload per owner.
- **Proof of fix:** proof-of-fix rate and reopen rate per department.
- **SMS keyword channel:** the messages you just sent, marked SIMULATED, and the
  complaint filed by SMS.
- **Office FAQ:** most asked and unanswered questions.

## 8. Low-end device (30 s)

- Open `http://localhost:5173/?lowend=1` → the prompt offers LOW render + LOW
  BANDWIDTH → **SWITCH ON** → the existing low-bandwidth banner appears and new
  pages request `?lite=1`.
- **21 DEVICE:** **MEASURE FROM THIS BROWSER** — full vs `?lite=1` sizes; the
  build table comes from `npm run build && npm run readiness`.
- Offline: in DevTools → Network → Offline, tap READ on a notice → "held on this
  device"; switch back online → it is sent. For the installed app shell, run
  `npm run build && npm run preview` (port 4173) and reload offline.

## If something goes wrong

- *API OFFLINE* in the status bar → the backend is not running; the new pages
  show their last cached copy or say nothing is cached, never invented figures.
- SMS "Too many messages" → the per-number limit (8 per 10 minutes) is working;
  pick another number as the admin, or wait.
- Re-run `npm run seed:ext` to reset just the extension data.
