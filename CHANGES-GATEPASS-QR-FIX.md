# Change log — gate-pass QR fix (page 11)

## The bug

On page 11 the QR was generated, but scanning it or typing the code was refused
("That QR code is not a campus gate pass" / "That gate pass code is not valid").
Regenerating did not help. There were two causes:

1. **Typing the code could never work.** The scanner accepted only the full QR
   text `NEX-GP:<pass ID>:<32-character secret>`. The page shows only the pass
   ID (`GP-2026-…`), and it shows the full text only in a development build.
   Typing what the page shows was therefore always refused as "not a campus gate pass".
2. **The QR on the student's phone was silently retired.**
   - `GET /api/gatepass/:id/qr` minted a new token on every call, and page 11
     calls it automatically whenever it shows an approved pass.
   - So any second screen that opened the same pass retired the QR already on
     the phone: the laptop used to scan it, another tab, or a warden.
   - REGENERATE QR rotated it again.

## The fix

- **Same QR on every screen.** The token is now derived with an HMAC (keyed by
  the server secret) from a random nonce stored on the pass (`pass.nonce`,
  `select: false`).
  - `GET /qr` shows the current QR again. It mints a new token only on
    `?rotate=1` (the REGENERATE QR button), or when no current QR can be
    re-rendered (older passes).
  - A database read alone still cannot forge a pass: the server secret is needed too.
- **A typeable pass code.** Under the QR the page now shows
  `GP-2026-000014 · 7KQ4-M29X` (8 characters, Crockford base32).
  - Typing the pass ID and code, in any case or spacing, works for both exit and return.
  - O/0 and I/1 mix-ups are forgiven.
  - The code dies with the QR: when it is regenerated, used at the return scan, or undone.
- **More tolerant QR reading.** Stray whitespace, invisible characters, a prefix
  some scanner apps add, and a lower-case prefix are accepted.
  - Anything else is still "not a campus gate pass".
  - A tampered token is still refused.
- **Clearer refusals.**
  - A pass ID typed without its code says what is missing.
  - An outdated QR says it was replaced by a newer one.
  - A wrong code says to check the 8 characters.

## Files

Every edit in an existing file is marked `GATE-PASS QR FIX (see CHANGES-GATEPASS-QR-FIX.md)`.

| File | What changed | Lines removed and why |
|---|---|---|
| `backend/src/services/gatePassService.js` | `issueToken` derives the token from a stored nonce. New: `deriveToken`, `currentPayload`, `passCode`, `codeMatches`, `normaliseCode`. `parsePayload` is tolerant and also reads a typed pass ID + code | `issueToken`'s random-token line became the nonce + derivation. `parsePayload`'s anchored regex became the tolerant search (its null-on-garbage behaviour is kept) |
| `backend/src/models/GatePass.js` | Optional `pass.nonce` (`select: false`) | — |
| `backend/src/controllers/gatePassController.js` | `GET /qr` re-shows the current QR, rotates only on `?rotate=1`, and returns additive fields `code` and `rotated`. `POST /scan` accepts the typed code and gives clearer messages. The nonce is cleared when a pass is spent | The `/qr` doc comment ("re-issued on each call"). The token check and its message were extended to cover the typed code. The `.select("+pass.tokenHash")` lines gained `+pass.nonce` |
| `backend/src/services/xo/touchlessService.js` | Policy UNDO also clears the nonce | — |
| `frontend/src/lib/api.js` | `gatePassQr(id, rotate)` | The one-line `gatePassQr` gained the `rotate` argument |
| `frontend/src/NexCamp.jsx` | Auto-display no longer rotates, and only REGENERATE QR does. The pass code is shown under the QR. The manual box asks for the pass ID and code | The QR caption sentence was updated. The manual-entry label and placeholder (`NEX-GP:…`) were replaced with the pass ID + code form. `onGateQr` passes `rotate` |
| `frontend/src/xo/i18n.js` | Odia / Hindi for the two new labels | — |
| `backend/test/gatepass-qr-fix.test.js` (new) | 8 tests: parser, derivation, re-display, rotation, typed code for exit and return, spent pass. The HTTP tests need MongoDB and skip without it | — |

No route, response field, button or workflow was removed. Passes issued before
this fix keep working: their QR scans as before, and the first view of such a
pass mints a derivable token once.

## Verified

- `npm test`: 377 tests, **376 pass**.
  - The one failure is the pre-existing, time-of-day-dependent 2G budget test
    (`xo-budget.test.js`, gate pass over its 10 KB budget).
  - That failure comes from the QR image in the `verify-otp` response, which this fix does not touch.
  - It is recorded in `docs/DIFFERENTIATION-AUDIT.md` §0.
- Smokes on a fresh seed: gatepass 43/43, smoke 70/70, ai 132/132, ops 70/70, ext 50/50, xo 47/47.
- In Chromium, on two screens (390 px "phone", 1360 px "laptop"), both signed in as the student on page 11:
  1. both show the same QR;
  2. the phone's QR image, decoded with jsQR (the camera path), gives EXIT on the laptop;
  3. typing the code shown on the phone gives RETURN;
  4. no horizontal overflow at 390 px.
- `vite build`: builds; the entry chunk grew by about 0.4 KB gzip.
