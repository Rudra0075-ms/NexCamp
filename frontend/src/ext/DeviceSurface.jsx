import React, { useEffect, useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { api, getToken } from "../lib/api.js";
import { Kind, PageHead, dt } from "./kit.jsx";
import { deviceSignals } from "./lowEnd.js";
import { PfSlot } from "../proof/ProofEntry.jsx"; // ROUND-3 HOOK (see CHANGES-ROUND3.md)
// EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): per-workflow bytes and 2G time, its own lazy chunk.
const WorkflowBudgets = React.lazy(() => import("../xo/AccessPanels.jsx").then((m) => ({ default: m.WorkflowBudgets })));

/*
 * 21 — DEVICE READINESS. Proves the low-end claims with measurements: bundle
 * sizes from the build (scripts/device-readiness.mjs), full vs ?lite=1 payload
 * sizes measured from this browser, the device's own connection signals, and
 * a checklist of what LOW render and LOW BANDWIDTH switch off.
 */

const ENDPOINTS = ["/api/notices/feed", "/api/requests/mine", "/api/timetable/week", "/api/fees/me", "/api/ai/summary", "/api/ai/recurring", "/api/board"];

const kb = (n) => (n === null || n === undefined ? "—" : `${(n / 1024).toFixed(1)} KB`);

async function size(path) {
  const token = getToken();
  const t0 = performance.now();
  const res = await fetch(api.base + path, { credentials: "include", cache: "no-store", headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  return { status: res.status, bytes: new TextEncoder().encode(text).length, ms: Math.round(performance.now() - t0) };
}

export default function DeviceSurface({ user, mode, lowBw, onLowEnd, live = true }) {
  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sw, setSw] = useState(null);
  const signals = deviceSignals();
  useEffect(() => {
    fetch("/device-readiness.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`not found (${r.status})`))))
      .then(setReport)
      .catch((e) => setReportError(e.message));
    (async () => {
      const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
      const names = typeof caches !== "undefined" ? await caches.keys().catch(() => []) : [];
      setSw({ registered: Boolean(reg), controlling: Boolean(navigator.serviceWorker?.controller), caches: names });
    })();
  }, []);
  const measure = async () => {
    setBusy(true);
    const out = [];
    for (const path of ENDPOINTS) {
      try {
        const full = await size(path);
        const lite = await size(`${path}${path.includes("?") ? "&" : "?"}lite=1`);
        out.push({ path, full, lite, saved: full.bytes ? Math.round((1 - lite.bytes / full.bytes) * 100) : null });
      } catch (e) {
        out.push({ path, error: e.message });
      }
    }
    setRows(out);
    setBusy(false);
  };
  return (
    <div className="ci ext">
      <PageHead num="21" kicker="DEVICE READINESS" title="Ready for low-end phones and patchy networks — measured, not claimed.">
        Bundle sizes come from the production build; payload sizes are measured from this browser against the live API; the device signals are what this browser reports.
      </PageHead>
      <div className="ext-grid" style={{ marginTop: 18 }}>
        <div className="ext-card ext-card-strong">
          <div className="ci-label">This device</div>
          <ul className="ext-list" style={{ marginTop: 8 }}>
            <li className="ci-body">Connection: <b>{signals.effectiveType || "not reported"}</b>{signals.downlink ? ` · ${signals.downlink} Mbps` : ""}{signals.saveData ? " · Data Saver ON" : ""}</li>
            <li className="ci-body">Device memory: <b>{signals.deviceMemory ? `${signals.deviceMemory} GB` : "not reported"}</b> · CPU threads: <b>{signals.cores || "not reported"}</b></li>
            <li className="ci-body">Render mode: <b>{mode}</b> · Low bandwidth: <b>{lowBw ? "ON" : "OFF"}</b></li>
            <li className="ci-body">Service worker: <b>{sw ? (sw.controlling ? "controlling this page" : sw.registered ? "registered" : "not registered (dev server, or first visit)") : "…"}</b>{sw?.caches?.length ? ` · caches: ${sw.caches.join(", ")}` : ""}</li>
          </ul>
          {signals.lowEnd ? <p className="ci-result ci-result-warn">This device looks constrained ({signals.reasons.join(", ")}).</p> : null}
          <div className="ext-actions"><button type="button" className="btn btn-primary" onClick={onLowEnd} disabled={lowBw && mode === "LOW"}>{lowBw && mode === "LOW" ? "LOW MODES ARE ON" : "SWITCH ON LOW RENDER + LOW BANDWIDTH"}</button></div>
        </div>
        <div className="ext-card">
          <div className="ci-label">What the low modes switch off</div>
          <ul className="ext-list" style={{ marginTop: 8 }}>
            <li className="ci-body"><b>LOW render</b> — no WebGL campus or 3D stage (2D map instead); no antialiasing, shadows or animated flow lines (those are HIGH-only).</li>
            <li className="ci-body"><b>LOW BANDWIDTH</b> — 3D layer suspended; AI and extension reads requested with <span className="ext-code">?lite=1</span> (arrays trimmed to 3, marked <span className="ext-code">lite: true</span>); cached reads reused; writes queued while offline.</li>
            <li className="ci-body"><b>prefers-reduced-motion</b> — boot sequence, scroll scenes and number tweens skipped.</li>
            <li className="ci-body"><b>Offline</b> — the app shell loads from the service worker (production build); reads fall back to this device's last good copy, flagged CACHED COPY.</li>
          </ul>
        </div>
      </div>
      <div className="ext-rule">
        <div className="ext-row" style={{ justifyContent: "space-between" }}>
          <h2 className="ext-h2">Build sizes</h2>
          {report ? <span className="ci-meta">generated {dt(report.generatedAt)} by scripts/device-readiness.mjs</span> : null}
        </div>
        {report ? (
          <div className="ext-table-wrap">
            <table className="ci-table">
              <thead><tr><th>File</th><th>Raw</th><th>Gzip</th></tr></thead>
              <tbody>
                {report.bundle.files.map((f) => <tr key={f.file}><td className="ext-code">{f.file}</td><td className="ci-num">{kb(f.bytes)}</td><td className="ci-num">{kb(f.gzip)}</td></tr>)}
                <tr><td><b>Total</b></td><td className="ci-num"><b>{kb(report.bundle.totalBytes)}</b></td><td className="ci-num"><b>{kb(report.bundle.totalGzip)}</b></td></tr>
              </tbody>
            </table>
          </div>
        ) : <StateBox title="No build report yet">Run <span className="ext-code">npm run build && npm run readiness</span> in frontend/ to measure the bundle ({reportError}).</StateBox>}
        {report?.payloads?.length ? <p className="ci-meta">The script also measured {report.payloads.length} endpoints against {report.apiUrl}: {report.payloads.map((p) => `${p.path} ${kb(p.full)} → ${kb(p.lite)}`).join("; ")}.</p> : null}
      </div>
      <div className="ext-rule">
        <div className="ext-row" style={{ justifyContent: "space-between" }}><h2 className="ext-h2">Payloads: full vs ?lite=1</h2><div className="ext-row"><Kind kind="ACTUAL DATA" /><button type="button" className="btn btn-secondary" onClick={measure} disabled={busy || !user}>{busy ? "MEASURING…" : "MEASURE FROM THIS BROWSER"}</button></div></div>
        {!user ? <p className="ci-meta">Sign in to measure — most endpoints need an account.</p> : null}
        {rows ? (
          <div className="ext-table-wrap">
            <table className="ci-table">
              <thead><tr><th>Endpoint</th><th>Full</th><th>?lite=1</th><th>Saved</th><th>Time (full)</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.path}><td className="ext-code">{r.path}</td>{r.error ? <td colSpan={4}>{r.error}</td> : <><td className="ci-num">{r.full.status === 200 ? kb(r.full.bytes) : `HTTP ${r.full.status}`}</td><td className="ci-num">{r.lite.status === 200 ? kb(r.lite.bytes) : `HTTP ${r.lite.status}`}</td><td className="ci-num">{r.saved === null ? "—" : `${r.saved}%`}</td><td className="ci-num">{r.full.ms} ms</td></>}</tr>)}</tbody>
            </table>
          </div>
        ) : null}
        <p className="ci-meta">A 403 means the endpoint is not open to this account (e.g. staff-only), not a failure. <Tag kind="muted">MEASURED</Tag></p>
      </div>
      {/* EXCEPTION-ONLY HOOK: four everyday tasks on 2G (npm run budgets in backend/). */}
      <React.Suspense fallback={null}><WorkflowBudgets /></React.Suspense>
      {/* ROUND-3 HOOK: channel parity — are kiosk and SMS users served as well as app users? (staff) */}
      <PfSlot name="equity" live={live} user={user} lowBw={lowBw} />
    </div>
  );
}
