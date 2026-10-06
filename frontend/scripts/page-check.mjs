// Page-by-page regression check for all 21 surfaces.
//
// Opens the running app (npm run dev, backend on :5000) in Chromium through
// Playwright and visits every page under a matrix of modes: render mode,
// LOW BANDWIDTH, 3D off, language, width and offline. For each visit it
// records console errors, uncaught exceptions, horizontal overflow and
// whether the page rendered any content.
//
//   node scripts/page-check.mjs [--url http://127.0.0.1:5173] [--quick] [--out report.json] [--shots dir]
//
// Playwright is not a project dependency; the script resolves it from the
// global install (npm i -g playwright) or NODE_PATH.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  const { execSync } = await import("node:child_process");
  const root = execSync("npm root -g").toString().trim();
  ({ chromium } = require(`${root}/playwright`));
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const URL_BASE = arg("--url", "http://127.0.0.1:5173");
const QUICK = process.argv.includes("--quick");
const OUT = arg("--out", null);
const SHOTS = arg("--shots", null);
const ONLY = arg("--pages", null);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const PAGES = ["landing", "student", "attendance", "mess", "report", "incident", "investigation", "risk", "intervention", "admin", "gatepass", "kiosk", "notices", "documents", "classes", "fees", "requests", "sms", "faq", "board", "device"].filter((p) => !ONLY || ONLY.split(",").includes(p));
const STAFF_PAGES = new Set(["admin"]);

const CONFIGS = [
  { name: "HIGH·EN·1360", mode: "HIGH", lowBw: false, lang: "EN", width: 1360 },
  { name: "LOW·LOWBW·EN·390", mode: "LOW", lowBw: true, lang: "EN", width: 390 },
  { name: "MEDIUM·3DOFF·ODIA·1360", mode: "MEDIUM", lowBw: false, gl: false, lang: "ଓଡ଼ିଆ", width: 1360 },
  { name: "HIGH·HINDI·390", mode: "HIGH", lowBw: false, lang: "हिन्दी", width: 390 },
  { name: "LOWBW·ADMIN·1360", mode: "LOW", lowBw: true, lang: "EN", width: 1360, admin: true },
  { name: "OFFLINE·EN·390", mode: "HIGH", lowBw: false, lang: "EN", width: 390, offline: true }
];
const configs = QUICK ? CONFIGS.slice(0, 2) : CONFIGS;

// Console noise that is not an application error.
const IGNORE = [/Download the React DevTools/, /\[vite\]/, /ERR_INTERNET_DISCONNECTED/, /net::ERR_/, /Failed to load resource/, /WebGL/i, /GPU stall/i, /THREE\.WebGLRenderer/];

async function withInstance(page, fn, arg) {
  return page.evaluate(
    ([source, a]) => {
      const rootEl = document.getElementById("root");
      const key = Object.keys(rootEl).find((k) => k.startsWith("__reactContainer"));
      let fiber = rootEl[key];
      const stack = [fiber];
      let app = null;
      while (stack.length && !app) {
        const f = stack.pop();
        if (!f) continue;
        if (f.stateNode && typeof f.stateNode.go === "function" && f.stateNode.pageDefs) app = f.stateNode;
        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
      if (!app) return { error: "NexCamp instance not found" };
      // eslint-disable-next-line no-new-func
      return new Function("app", "a", source)(app, a);
    },
    [fn, arg]
  );
}

const results = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const cfg of configs) {
  const context = await browser.newContext({ viewport: { width: cfg.width, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  let errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!IGNORE.some((re) => re.test(text))) errors.push(`console: ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err.message).slice(0, 300)}`));
  await page.addInitScript(() => sessionStorage.setItem("nex-boot-done", "1"));
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });
  // wait for sign-in to settle
  await page.waitForFunction(() => document.body.innerText.includes("API LIVE") || document.body.innerText.includes("API OFFLINE"), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (cfg.admin) {
    await withInstance(page, "return app.signIn('control@bput.ac.in','Control@2026')");
    await page.waitForTimeout(2500);
  }
  // Anything logged while the app booted is reported against a pseudo-page, not dropped.
  if (errors.length) {
    results.push({ config: cfg.name, page: "(initial load)", errors: [...errors], ok: false });
    process.stdout.write(`FAIL ${cfg.name.padEnd(24)} (initial load) ${JSON.stringify(errors)}\n`);
  }
  await withInstance(page, "app.setState({ mode: a.mode, lowBw: a.lowBw, lang: a.lang, gl: a.gl !== false }); return true;", cfg);
  if (cfg.offline) {
    // visit every page once online so caches are warm, then drop the network
    for (const id of PAGES) {
      await withInstance(page, "app.setState({ page: a, wipe: false }); return true;", id);
      await page.waitForTimeout(700);
    }
    await context.setOffline(true);
    await page.waitForTimeout(500);
  }
  for (const id of PAGES) {
    errors = [];
    await withInstance(page, "app.setState({ page: a, wipe: false }); window.scrollTo(0,0); return true;", id);
    await page.waitForTimeout(cfg.offline ? 900 : 1600);
    const info = await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        textLength: main.innerText.length,
        errorBoundary: /SOMETHING WENT WRONG|failed to render|could not render/i.test(document.body.innerText)
      };
    });
    const row = { config: cfg.name, page: id, errors: [...errors], overflowPx: info.overflow, textLength: info.textLength, errorBoundary: info.errorBoundary };
    row.ok = !row.errors.length && info.overflow <= 2 && info.textLength > 40 && !info.errorBoundary;
    if (STAFF_PAGES.has(id) && !cfg.admin) row.note = "student view";
    results.push(row);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${cfg.name.replace(/[^A-Z0-9]+/gi, "_")}_${id}.png`, fullPage: false });
    process.stdout.write(`${row.ok ? "ok  " : "FAIL"} ${cfg.name.padEnd(24)} ${id.padEnd(14)} ${row.ok ? "" : JSON.stringify({ e: row.errors, o: row.overflowPx, t: row.textLength, b: row.errorBoundary })}\n`);
  }
  await context.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} page visits clean`);
if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(failed.length ? 1 : 0);
