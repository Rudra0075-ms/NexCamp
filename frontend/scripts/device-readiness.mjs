/**
 * Device readiness report (PS07 extension pack, 2G).
 *
 *   npm run build && npm run readiness
 *
 * Measures the production bundle (raw and gzip, per file) and — when the API
 * is reachable — the size of key responses with and without ?lite=1, signed in
 * as the demo student. Writes public/device-readiness.json (copied into dist/
 * too), which the Device Readiness page (surface 21) displays. Nothing is
 * estimated: every figure is a measurement taken when the script ran.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const API = (process.env.API_URL || process.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");
const EMAIL = process.env.DEMO_EMAIL || "pritish@bput.ac.in";
const PASSWORD = process.env.DEMO_PASSWORD || "Campus@2026";

function bundle() {
  if (!fs.existsSync(dist)) throw new Error("No dist/ — run `npm run build` first.");
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(js|css|html|webmanifest)$/.test(name)) {
        const buf = fs.readFileSync(full);
        files.push({ file: path.relative(dist, full), bytes: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length });
      }
    }
  };
  walk(dist);
  files.sort((a, b) => b.bytes - a.bytes);
  const entry = files.filter((f) => /^assets\/index-.*\.(js|css)$/.test(f.file) || f.file === "index.html");
  return {
    files,
    totalBytes: files.reduce((t, f) => t + f.bytes, 0),
    totalGzip: files.reduce((t, f) => t + f.gzip, 0),
    firstLoadGzip: entry.reduce((t, f) => t + f.gzip, 0),
    firstLoadNote: "index.html + entry JS + CSS; the 3D library, the extension pages and the hero image load later or not at all in LOW modes"
  };
}

async function payloads() {
  try {
    const login = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    const token = (await login.json())?.data?.token;
    if (!token) return { error: "could not sign in" };
    const paths = ["/api/notices/feed", "/api/requests/mine", "/api/timetable/week", "/api/timetable/attendance-adjusted", "/api/fees/me", "/api/board", "/api/faq/sections"];
    const out = [];
    for (const p of paths) {
      const size = async (url) => {
        const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
        return r.ok ? Buffer.byteLength(await r.text()) : null;
      };
      out.push({ path: p, full: await size(API + p), lite: await size(`${API}${p}?lite=1`) });
    }
    return { rows: out };
  } catch (error) {
    return { error: error.message };
  }
}

const b = bundle();
const p = await payloads();
const report = { generatedAt: new Date().toISOString(), bundle: b, apiUrl: API, payloads: p.rows || [], payloadError: p.error || null };
for (const target of [path.join(root, "public", "device-readiness.json"), path.join(dist, "device-readiness.json")]) fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);

const kb = (n) => (n == null ? "—" : `${(n / 1024).toFixed(1)} KB`);
console.log(`Bundle: ${b.files.length} files, ${kb(b.totalBytes)} raw, ${kb(b.totalGzip)} gzip; first load ${kb(b.firstLoadGzip)} gzip`);
for (const f of b.files.slice(0, 8)) console.log(`  ${f.file.padEnd(44)} ${kb(f.bytes).padStart(10)} ${kb(f.gzip).padStart(10)}`);
if (p.rows) for (const r of p.rows) console.log(`  ${r.path.padEnd(28)} full ${kb(r.full).padStart(9)}  lite ${kb(r.lite).padStart(9)}`);
else console.log(`Payloads not measured: ${p.error}`);
console.log("Wrote public/device-readiness.json");
