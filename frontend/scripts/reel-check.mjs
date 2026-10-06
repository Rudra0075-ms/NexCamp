// Acceptance check for the 30-second proof (see CHANGES-REEL.md).
//
// Needs the backend on :5000 with a fresh seed and the built app served
// (npm run build && npm run preview, or npm run dev). Opens /?reel=1 as the
// admin in Chromium through Playwright and:
//   - plays the whole reel in real time: total play time, longest frame, fps;
//   - seeks the master timeline to every scene's output hold and to the middle
//     of its beat B, screenshots both (docs/reel/hold, docs/reel/motion) and
//     checks that every number on screen is one the API returned (or a figure
//     in the fixed text) — nothing partial, nothing invented;
//   - records the full playback as docs/reel/reel.webm;
//   - at 390 × 844 with ?lowend=1: no animation of any kind, static beats;
//   - with prefers-reduced-motion: only opacity animates;
//   - with the API unreachable: the cached copy with its time, or "No data cached".
//
//   node scripts/reel-check.mjs [--url http://127.0.0.1:4173] [--out ../docs/reel] [--no-video]
//
// Playwright is not a project dependency; resolved like page-check.mjs.
import { createRequire } from "node:module";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  const { execSync } = await import("node:child_process");
  ({ chromium } = require(`${execSync("npm root -g").toString().trim()}/playwright`));
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const URL_BASE = arg("--url", "http://127.0.0.1:4173");
const API = arg("--api", "http://localhost:5000");
const OUT = path.resolve(arg("--out", "../docs/reel"));
const VIDEO = !process.argv.includes("--no-video");
for (const d of ["hold", "motion", "lowend"]) mkdirSync(path.join(OUT, d), { recursive: true });

const report = { url: URL_BASE, at: new Date().toISOString(), checks: [] };
const check = (name, ok, detail) => {
  report.checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
};

// Figures that appear in the fixed text (the brief, labels, chips), not from the API.
const FIXED = new Set([0, 2, 7, 9, 15, 20, 26, 30, 50, 57, 75, 80, 90, 2026]);

async function openAsAdmin(context, query = "?reel=1") {
  const page = await context.newPage();
  page.on("pageerror", (e) => report.checks.push({ name: "page error", ok: false, detail: e.message }));
  await page.goto(`${URL_BASE}/${query}`);
  await page.getByRole("button", { name: "SIGN IN AS THE ADMIN" }).click({ timeout: 30000 });
  await page.waitForFunction(() => window.__reel && window.__reel.data && window.__reel.ready, null, { timeout: 30000 });
  return page;
}

/** Every number in the visible text of the scene layer at master time t, against the API's data. */
function visibleNumbers(page, sceneIndex) {
  return page.evaluate((i) => {
    const layer = document.querySelector(`[data-reel-layer="${i}"]`);
    const shown = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.02) return false;
      }
      return true;
    };
    const texts = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim() && shown(n.parentElement)) texts.push(n.nodeValue.trim());
    return texts;
  }, sceneIndex);
}
const numbersIn = (s) => (String(s).match(/(?<![A-Za-z0-9.])-?\d+(?:\.\d+)?/g) || []).map(Number);

function verify(texts, scene) {
  const dataNums = new Set(numbersIn(JSON.stringify(scene?.data || {}) + (scene?.error || "")));
  const bad = [];
  for (const t of texts) for (const v of numbersIn(t)) if (!dataNums.has(v) && !dataNums.has(Math.abs(v)) && !FIXED.has(Math.abs(v))) bad.push(`${v} in “${t}”`);
  return bad;
}

const browser = await chromium.launch();
try {
  // 1 · real-time playback, frames, holds and motion frames, numbers against the API.
  {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await openAsAdmin(context);
    const run = await page.evaluate(async () => {
      const r = window.__reel;
      r.pause();
      r.seek(0);
      const deltas = [];
      const slow = [];
      let last = performance.now();
      const t0 = last;
      r.play();
      await new Promise((resolve) => {
        const f = (now) => {
          deltas.push(now - last);
          if (now - last > 34) slow.push([Math.round(r.t), Math.round(now - last)]);
          last = now;
          if (r.playing) requestAnimationFrame(f);
          else resolve();
        };
        requestAnimationFrame(f);
      });
      const total = performance.now() - t0;
      const body = deltas.slice(1);
      return { totalMs: Math.round(total), frames: body.length, longestFrameMs: Math.round(Math.max(...body) * 10) / 10, avgFps: Math.round((body.length / (total / 1000)) * 10) / 10, over50: body.filter((d) => d > 50).length, slowFrames: slow.slice(0, 20), frameTrace: body.map((d) => Math.round(d * 10) / 10) };
    });
    // The frame trace (every requestAnimationFrame interval, ms) is kept in frame-trace.json; no DevTools tracing
    // runs during the measured playback, because tracing itself stalls frames.
    writeFileSync(path.join(OUT, "frame-trace.json"), `${JSON.stringify(run.frameTrace)}\n`);
    delete run.frameTrace;
    report.playback = run;
    check("total play time 29.5–30.5 s", run.totalMs >= 29500 && run.totalMs <= 30500, `${(run.totalMs / 1000).toFixed(2)} s`);
    check("longest frame < 50 ms", run.longestFrameMs < 50, `${run.longestFrameMs} ms, ${run.avgFps} fps average, ${run.frames} frames; frames over 34 ms [t, ms]: ${JSON.stringify(run.slowFrames)}`);

    const { data, scenes } = await page.evaluate(() => ({ data: window.__reel.data, scenes: window.__reel.scenes }));
    const fresh = await page.evaluate(async (api) => (await (await fetch(`${api}/api/xo/reel?lite=1`, { credentials: "include" })).json()).data, API).catch(() => null);
    report.api = { scenes: data.scenes.length, generatedAt: data.generatedAt };
    check("API returns ten scenes", data.scenes.length === 10);
    if (fresh) {
      const same = data.scenes.filter((s, i) => JSON.stringify(s.data) === JSON.stringify(fresh.scenes[i]?.data)).length;
      report.api.refetchIdenticalScenes = same;
    }
    const byKey = Object.fromEntries(data.scenes.map((s) => [s.key, s]));
    const pad = (i) => String(i).padStart(2, "0");
    const badHold = [];
    const badMotion = [];
    for (const [i, s] of scenes.entries()) {
      await page.evaluate((t) => window.__reel.seek(t), i === scenes.length - 1 ? s.end : s.end - 150);
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(OUT, "hold", `${pad(i)}-${s.key}.png`) });
      badHold.push(...verify(await visibleNumbers(page, i), byKey[s.key]).map((b) => `${s.key}: ${b}`));
      await page.evaluate((t) => window.__reel.seek(t), s.start + s.B + (s.C - s.B) / 2);
      await page.waitForTimeout(60);
      await page.screenshot({ path: path.join(OUT, "motion", `${pad(i)}-${s.key}.png`) });
      badMotion.push(...verify(await visibleNumbers(page, i), byKey[s.key]).map((b) => `${s.key}: ${b}`));
    }
    check("hold frames: every number on screen is the API's", !badHold.length, badHold.slice(0, 8));
    check("motion frames: no partial or placeholder number", !badMotion.length, badMotion.slice(0, 8));
    // The card holds still: two frames 0.9 s apart inside the hold are identical.
    let still = 0;
    const moved = [];
    for (const [i, s] of scenes.entries()) {
      await page.evaluate((t) => window.__reel.seek(t), s.start + s.hold + 20);
      const r = await page.evaluate((i) => document.querySelector(`[data-reel-layer="${i}"] .reel-card`).getBoundingClientRect().toJSON(), i);
      const clip = { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.min(1920, Math.ceil(r.width)), height: Math.min(1080 - Math.max(0, Math.floor(r.y)), Math.ceil(r.height)) };
      if (!(clip.width > 0 && clip.height > 0)) { moved.push(`${s.key} (no card box: ${JSON.stringify(r)})`); continue; }
      const a = await page.screenshot({ clip });
      await page.evaluate((t) => window.__reel.seek(t), s.start + s.hold + 920);
      const b = await page.screenshot({ clip });
      if (Buffer.compare(a, b) === 0) still += 1;
      else moved.push(s.key);
    }
    check("every output card is still for ≥ 0.9 s at the end of its scene", still === scenes.length, `${still}/${scenes.length}${moved.length ? ` (changed: ${moved.join(", ")})` : ""}`);
    await context.close();
  }

  // 2 · the video of a full playback.
  if (VIDEO) {
    const dir = path.join(OUT, ".video");
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir, size: { width: 1920, height: 1080 } } });
    const page = await openAsAdmin(context);
    await page.evaluate(() => { window.__reel.seek(0); window.__reel.play(); });
    await page.waitForFunction(() => !window.__reel.playing, null, { timeout: 40000 });
    await page.waitForTimeout(800);
    const video = page.video();
    await context.close();
    renameSync(await video.path(), path.join(OUT, "reel.webm"));
    rmSync(dir, { recursive: true, force: true });
    check("video recorded", true, "docs/reel/reel.webm");
  }

  // 3 · LOW render at phone width: no animation at all, static beats.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await openAsAdmin(context, "?reel=1&lowend=1");
    const counts = await page.evaluate(async () => {
      const r = window.__reel;
      const seen = [];
      for (let t = 0; t <= r.duration; t += 100) {
        r.seek(t);
        await new Promise((res) => requestAnimationFrame(res));
        seen.push(document.getAnimations().length);
      }
      return { mode: r.mode, max: Math.max(...seen), samples: seen.length };
    });
    check("?lowend=1: no animation while playing", counts.mode === "static" && counts.max === 0, counts);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check("390 px: no sideways scroll", !overflow);
    const scenes = await page.evaluate(() => window.__reel.scenes);
    for (const [i, s] of scenes.entries()) {
      for (const [beat, at] of [["A", s.start + 50], ["B", s.start + s.B + 50], ["C", s.end - 50]]) {
        if (i % 3 && beat !== "C") continue; // every scene's C; A and B for a sample
        await page.evaluate((t) => window.__reel.seek(t), at);
        await page.screenshot({ path: path.join(OUT, "lowend", `${String(i).padStart(2, "0")}-${s.key}-${beat}.png`) });
      }
    }
    await context.close();
  }

  // 4 · prefers-reduced-motion: cross-fades only.
  {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
    const page = await openAsAdmin(context);
    const props = await page.evaluate(() => {
      const keys = new Set();
      for (const a of document.getAnimations()) for (const kf of a.effect.getKeyframes()) for (const k of Object.keys(kf)) if (!["offset", "computedOffset", "easing", "composite"].includes(k)) keys.add(k);
      return { mode: window.__reel.mode, properties: [...keys] };
    });
    check("reduced motion: only opacity animates", props.mode === "reduced" && props.properties.every((p) => p === "opacity"), props);
    await context.close();
  }

  // 5 · API unreachable: cached copy with its time, or "No data cached" — never a made-up number.
  {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await openAsAdmin(context);
    const cached = await page.evaluate(() => window.__reel.data);
    await page.route(`${API}/**`, (r) => r.abort());
    await page.goto(`${URL_BASE}/?reel=1`);
    await page.waitForFunction(() => window.__reel && window.__reel.data, null, { timeout: 30000 });
    const off = await page.evaluate(() => ({ stale: window.__reel.stale, generatedAt: window.__reel.data.generatedAt, banner: document.querySelector(".reel-stale")?.textContent || null }));
    check("offline with a cache: the cached copy, with its time", off.stale && off.banner && off.generatedAt === cached.generatedAt, off.banner);
    await context.close();
    const empty = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const p2 = await empty.newPage();
    await p2.route(`${API}/**`, (r) => r.abort());
    await p2.goto(`${URL_BASE}/?reel=1`);
    await p2.getByText("No data cached").waitFor({ timeout: 30000 });
    const nums = await p2.evaluate(() => (document.querySelector(".reel")?.innerText || "").replace(/00:00\.0 \/ 00:30|30-SECOND/g, "").match(/\d/g));
    check("offline with no cache: “No data cached”, no figures", !nums, nums);
    await empty.close();
  }
} finally {
  await browser.close();
  writeFileSync(path.join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
if (report.checks.some((c) => !c.ok)) process.exitCode = 1;
