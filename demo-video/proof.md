# NeX Camp — Live Product Demonstration Proof (v2 - Full Features)

**Team:** CodexFlow (BH26PS07T057)  
**Track:** PS07 Campus Life  
**Generated Video:** `nexcamp-demo-v2.mp4`  
**Resolution:** 1280 × 720 @ 30fps  
**Duration:** 57.53 seconds (Strictly within <= 59s requirement)  
**Methodology:** 100% Real Browser Execution against Real MongoDB Backend. Zero mocked endpoints.

---

## Automated Verification Checks (All Passed)

1. **Duration & Resolution:** 57.53s (Target: <= 59s), 1280x720, 30fps H.264 MP4.
2. **No Near-White Frames:** Sampled at 2 fps across all scenes with `signalstats` (max brightness < 240, zero white flashes).
3. **Midpoint Viewport Verification:** All target elements verified inside viewport with midpoint screenshots in `demo-video/screenshots/`.
4. **Hero Title Shielding:** Navigated directly to feature routes (`?page=report`, `?page=requests`, `?page=admin`, `?page=sms`, `?page=kiosk`, `?page=attendance`, `?page=mess`, `?page=student`). Hero banner never visible during feature demonstration.
5. **Real False Closures Count:** Read live numbers from server (`10 of 110 flagged`). Caption matches exact live UI. View held for >3.5 seconds.
6. **Zero 4xx/5xx Errors:** Pre-authenticated sessions across all scenes. Zero failed calls.
7. **End Card:** 2-second closing title card injected with 0.3s fade-in on app's dark background.

---

## Real Telemetry Captured During Recording

| Scene | HTTP Method | Endpoint | Status | Real Server Returned Key Fields |
| :--- | :--- | :--- | :--- | :--- |
| **Scene 1** | `POST` | `/api/students/me/room-change` | `200` | `Errand 1: Room change requested` |
| **Scene 1** | `POST` | `/api/xo/incidents/:id/follow` | `200` | `Errand 2: INC-0051 followed (0 touch)` |
| **Scene 1** | `POST` | `/api/complaints/:id/reopen` | `200` | `Errand 3: CMP-1901 reopen evaluated` |
| **Scene 1** | `POST` | `/api/documents/request` | `201` | `Errand 4: Rule §4.2 auto-issued bonafide` |
| **Scene 2** | `POST` | `/api/xo/similar` | `200` | `Matched INC-0051 (17 reports)` |
| **Scene 2** | `POST` | `/api/xo/incidents/:id/follow` | `200` | `Followed INC-0051 without duplicate` |
| **Scene 2** | `POST` | `/api/complaints` | `201` | `ELECTRICAL_ARC safety floor -> Priority: CRITICAL` |
| **Scene 3** | `POST` | `/api/fix/:id/confirm` | `200` | `response: NOT_FIXED -> Reopen RPN-2026-0001 created` |
| **Scene 3** | `GET` | `/api/xo/closures?days=180` | `200` | `10 of 110 flagged false closures revealed` |
| **Scene 4** | `POST` | `/api/sms/simulate` | `200` | `reply: "[NE-X] Filed CMP-2245 (WATER)..."` |
| **Scene 4b** | `POST` | `/api/kiosk/lookup` | `200` | `Assisted lookup: BPUT/CSE/22/0425 -> 6 services available` |
| **Scene 4b** | `GET` | `/api/kiosk/activity` | `200` | `Kiosk activity recorded with operator attribution` |
| **Scene 4c** | `POST` | `/api/attendance/simulate` | `200` | `Simulation: attend 5 classes -> projected attendance computed` |
| **Scene 4d** | `POST` | `/api/mess/feedback` | `201` | `Feedback classified: sentiment POSITIVE, theme QUALITY` |
| **Scene 4d** | `GET` | `/api/mess/intelligence` | `200` | `Mess analytics updated: responses, ratings & AI patterns` |
| **Scene 5** | `GET` | `/api/xo/ledger?days=30` | `200` | `Friction Ledger: hours returned, touches 0.8 vs 3.4, visits avoided` |
| **Scene 5** | `GET` | `/api/xo/events` | `200` | `Campus Event Log: operator named, Rule §4.2 / §7.4 cited` |
| **Scene 6** | `POST` | `/api/support/requests` | `201` | `preference: ANONYMOUS, status: REQUESTED` |
| **Scene 6** | `GET` | `/api/support/queue` | `200` | `Support Queue: Received case, non-clinical wording` |
| **Scene 6** | `GET` | `/api/support/overview` | `200` | `Admin view: aggregate only, small counts hidden (<3)` |
| **Scene 6** | `GET` | `/api/admin/equity` | `200` | `Equity Panel: Channel parity evaluated` |

---

## Scene Verification Summary

1. **Scene 1 (Tuesday Test):** Real 4-errand test executed against API with live stopwatch. Rule §4.2 auto-issued bonafide with 0 human touches.
2. **Scene 2 (Student Complaint & Hazard Floor):** Real-time duplicate detection matched INC-0051 (17 reports). `+1 & Follow` incremented followers without creating a duplicate. Hazard phrase "sparks from socket" evaluated `ELECTRICAL_ARC` rule, forcing priority to CRITICAL.
3. **Scene 3 ("Is it fixed?" + False Closures):** Student marked resolved complaint "NOT FIXED", generating real reopen request `RPN-2026-0001`. Admin view displayed `10 of 110` flagged false closures with audited failure reasons.
4. **Scene 4 (No Smartphone / Basic Phone SMS):** Basic phone simulator sent `WATER B-214 no water`. Server responded with 160-char SMS confirmation. Complaint appeared in admin queue tagged with `VIA SMS`.
5. **Scene 4b (Campus Service Kiosk):** Full assisted access for students without smartphones. Help-desk operator looked up student by ID `BPUT/CSE/22/0425`, verified 6 live services, and accessed assisted mess feedback.
6. **Scene 4c (Attendance Simulator):** Server-side what-if projection computed in real-time. Simulated attending 5 upcoming classes with projected attendance percentage delta.
7. **Scene 4d (Mess Rating with AI Response):** Student rated meal 4★ with comment. Backend classified feedback sentiment as `POSITIVE` and theme as `QUALITY`, immediately updating mess analytics and AI patterns.
8. **Scene 5 (Event Log & Friction Ledger):** Real metrics displayed: student-hours returned, office visits avoided, touches reduced from 3.4 to 0.8. Channel breakdown and audited old paths inspected.
9. **Scene 6 (Silent Support + Closing):** Anonymous support request submitted on Student Dashboard. Counsellor view received case in state `Received` with recommended action and non-clinical wording. Admin view showed aggregate statistics with small count privacy suppression (`<3`). 2-second title card closed the presentation.
