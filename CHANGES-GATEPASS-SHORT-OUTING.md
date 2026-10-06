# Page 11: short same-day outings approved automatically

## The problem

A student applying for a short outing (for example, leaving in 20 minutes for 2 hours) was
never approved automatically, so no QR was issued. The only automatic rule, §7.3 "day
outing", requires the application to be made **at least 2 hours before leaving**. Every
short-notice pass failed that condition and waited for the warden. The page also ignored
the verification response: it always said "the warden has been notified", even when a pass
had been approved, and only picked up the QR later from a timer.

Reproduced against the seeded API: a 2-hour outing leaving in 20 minutes went to the warden
with "Applied 0.3 hours before leaving — short-notice outings are decided by the warden."

## The change

| File | Change |
|---|---|
| `backend/src/services/xo/policyRules.js` | New cited section **§7.4 Short same-day outing** and rule `GATEPASS-SHORT-SAMEDAY` (AUTO_APPROVE): guardian confirmed by code · leaves and returns the same day · lasts **1 to 3 hours** · no late or overdue return in the last 30 days. No advance-notice condition. §7.3 is unchanged |
| `backend/src/services/xo/policyFacts.js` | New fact `sameDay` (IST calendar day of leaving = day of return) |
| `backend/src/services/xo/touchlessService.js` | `ensureDefaultRules()` installs a default rule that is missing **by key**, once, so an already-seeded campus gets §7.4 without a reseed. Existing rules and edited versions are untouched |
| `backend/src/controllers/gatePassController.js` | The auto-approval response also carries the typed pass code (`qr.code`), as `GET /gatepass/:id/qr` already does |
| `frontend/src/NexCamp.jsx` | `verifyGateOtp()` reads the response: on an automatic approval it shows the QR at once with "Approved automatically under §7.4 — your QR is ready". Otherwise it says the warden was notified and names the conditions that were not met |

What stays the same: the guardian code is never skipped; outings under 1 hour or over 3
hours at short notice, overnight passes, and students with a recent late return still go
to the warden, with the reason shown; the warden can still UNDO an automatic approval.

## Verification

- Unit: 1, 2 and 3 hours are approved under §7.4 at short notice; 0.5 h, 3.5 h, the next day, no guardian code and a recent late return are not; §7.3 still applies to longer outings booked in advance; `sameDay` is correct across midnight IST.
- Integration: a pass leaving in 20 minutes for 2 hours is approved under §7.4 with a QR and code, and the **gate accepts the scan** (status ACTIVE). An existing campus gets the rule once without its other rules changing.
- The existing test "short notice stays with the warden" used a 1-hour outing, which is now approved by design; it now uses a 30-minute outing and still asserts the warden decides.
- `npm test`: 436 tests, 435 pass. The one failure is the pre-existing, time-of-day-dependent 2G budget test. All six smoke suites pass.
- Browser (page 11, demo student, IST): apply → guardian code → "Approved automatically under §7.4 — your QR is ready", with the QR and pass code on screen.

Note: the gate-pass smoke script deliberately records a late return for the demo student.
After running it, that student's short outings go to the warden for 30 days, as the rule
says. `npm run seed -- --fresh` resets this.
