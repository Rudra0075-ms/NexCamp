# NeX Camp — Automated Demo Video Pipeline

This folder contains the complete automated recording pipeline to produce the official 40–55 second demonstration video for **NeX Camp (Team CodexFlow, BH26PS07T057, PS07 Campus Life)**.

## How to Re-Run (One Command)

```bash
node demo-video/record.js
```

## What it Does:
1. Resets and seeds the real MongoDB database to a pristine known state via `npm run seed:fresh`.
2. Launches headless Chromium via Playwright.
3. Injects live telemetry overlays (custom cursor, click ripple, scene captions, demo data badge, and real-time backend API response panel).
4. Executes all 6 real workflows across mobile (390px) and desktop (1280px) contexts.
5. Pads/centers mobile scenes with blurred backdrops and concats all clips with FFmpeg into `nexcamp-demo.mp4` (1280x720, 30fps, 40-55s).
6. Generates `proof.md` with all captured HTTP requests and responses.
