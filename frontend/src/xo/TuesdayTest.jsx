import React, { useEffect, useRef, useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { ext } from "../ext/api.js";
import { Kind } from "../ext/kit.jsx";
import { xo } from "./api.js";
import { CalcBox, hoursLabel } from "./kit.jsx";
// ROUND-3 HOOK (see CHANGES-ROUND3.md): the Round 3 judge demo, a second mode of this panel (its own chunk).
const ProofDemo = React.lazy(() => import("../proof/ProofDemo.jsx"));

/*
 * Phase 10 — THE TUESDAY TEST. Four ordinary errands, run for real against
 * the API with a stopwatch, each on its own page:
 *   1  bonafide certificate (14)       — decided by written policy, no one touches it
 *   2  leaking tap, Hostel B (05)      — the open incident gets a +1, no duplicate is filed
 *   3  "Is tomorrow's class cancelled?" (15) — change event → notice → attendance update
 *   4  "Did the mess menu change?" (04, 13)  — the change and its reach funnel
 * then the Friction Ledger's old path against this run. Nothing is scripted
 * except the order: every answer is whatever the API returns now. Separate
 * from Replay incident, Replay boot and Tuesday Mode, which are unchanged.
 */

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const DATE = /\d{4}-\d{2}-\d{2}/;
const ist = (offsetDays) => new Date(Date.now() + 5.5 * 3600000 + offsetDays * 864e5).toISOString().slice(0, 10);

async function certificate() {
  try {
    const res = await ext.documentRequest({ type: "BONAFIDE", purpose: "Scholarship verification (Tuesday Test)" });
    if (res.queued) return { text: "Offline — the request is queued on this device and will be decided when it syncs.", queued: true };
    const d = res.data;
    const auto = d.policy?.decision === "AUTO_APPROVE";
    return {
      text: auto ? `${d.reference} issued at once under ${d.policy.citation?.section || "the written policy"} — no one had to touch it.` : `${d.reference} sent to the academic office: ${d.policy?.reason || "outside the written policy"}.`,
      kind: "ACTUAL DATA",
      step: { reference: d.reference, subjectType: "DocumentRequest", subjectId: d.id }
    };
  } catch (error) {
    if (error.status !== 409) throw error;
    const open = (await ext.documents(true, { type: "BONAFIDE" })).data.documents.find((x) => ["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(x.status));
    return { text: `A bonafide request is already open (${open?.reference || "—"}, ${open?.status || "waiting"}) — nothing new filed. The policy asks a person to look at repeat requests.`, kind: "ACTUAL DATA", step: open ? { reference: open.reference, subjectType: "DocumentRequest", subjectId: open.id } : {} };
  }
}

async function leakingTap() {
  const text = "The washroom tap in B-214 is leaking since night and water keeps running";
  const r = await xo.similar({ text, category: "WATER", location: "HOSTEL B · B-214" });
  const m = r.match;
  if (r.planned) return { text: `Planned work already covers this: ${r.planned.text}`, kind: "ACTUAL DATA", step: { noStaffWork: true } };
  if (!m) return { text: "No open incident matches — in the app this would be filed as a new complaint (not filed by the test).", kind: "ACTUAL DATA", step: {} };
  const f = await xo.follow(m.incidentId, { room: "B-214" });
  const followers = f.data?.followers ?? m.followers;
  const eta = m.eta?.p50Hours !== undefined && m.eta?.p50Hours !== null ? ` Typical fix ${hoursLabel(m.eta.p50Hours)}.` : "";
  return {
    text: `${m.reference} (${m.reports} reports) is already open with ${m.assignedTo}. ${f.queued ? "+1 queued offline" : f.data?.already ? "Your +1 was already counted" : "+1 added"} — ${followers} following; no duplicate filed.${eta}`,
    kind: "ACTUAL DATA",
    step: { reference: m.reference, noStaffWork: true }
  };
}

function pickChange(changes, types) {
  const list = changes.filter((c) => types.includes(c.type));
  const tomorrow = ist(1);
  const today = ist(0);
  return list.find((c) => (DATE.exec(c.title) || [])[0] === tomorrow) || list.find((c) => ((DATE.exec(c.title) || [])[0] || "") >= today) || list[0] || null;
}

async function classCancelled(mine) {
  const day = await ext.day("tomorrow");
  const c = pickChange(mine, ["CLASS_CANCEL", "CLASS_RESCHEDULE"]);
  const chain = c ? ` Latest change for you: ${c.title} (${c.reference}) → notice ${c.notice?.reference || "—"}${c.attendance?.text ? ` → ${c.attendance.text.replace(/\.$/, "")}` : ""}.` : " No class change affects you.";
  return { text: `${day.answer}${chain}`, kind: "ACTUAL DATA", step: { reference: c?.reference } };
}

async function menuChanged(mine, onGo) {
  const c = pickChange(mine, ["MENU_CHANGE"]);
  if (!c) return { text: "No menu change on record — the menu is as planned.", kind: "ACTUAL DATA", step: {} };
  onGo?.("notices");
  const r = c.notice?.id ? await xo.tuesdayReach(c.notice.id) : null;
  const f = r?.funnel;
  const reach = f ? ` Reach of ${r.notice.reference}: ${f.targeted} targeted · ${f.delivered} delivered · ${f.read} read (${f.pct.read ?? 0}%).` : "";
  return { text: `${c.forYou || c.title} (${c.reference}).${reach}`, kind: "ACTUAL DATA", step: { reference: c.reference } };
}

export default function TuesdayTest({ user, onGo, onClose, onDemoStudent }) {
  const [steps, setSteps] = useState([]);
  const [current, setCurrent] = useState(null);
  const [started, setStarted] = useState(null);
  const [ended, setEnded] = useState(null);
  const [tick, setTick] = useState(Date.now());
  const [compare, setCompare] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("TUESDAY"); // ROUND-3 HOOK
  const alive = useRef(true);
  const running = Boolean(started && !ended);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setTick(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => () => {
    alive.current = false;
  }, []);
  const student = user?.role === "STUDENT";

  const errands = [
    { key: "certificate", page: "documents", num: "14", label: "Get a bonafide certificate", workflow: "DOCUMENT", actions: 1, run: () => certificate() },
    { key: "tap", page: "report", num: "05", label: "Report a leaking tap in Hostel B", workflow: "COMPLAINT", actions: 1, run: () => leakingTap() },
    { key: "class", page: "classes", num: "15", label: "Is tomorrow's class cancelled?", workflow: "CLASS_CHECK", actions: 1, run: (ctx) => classCancelled(ctx.mine) },
    { key: "menu", page: "mess", num: "04 · 13", label: "Did the mess menu change?", workflow: "MENU_CHECK", actions: 1, run: (ctx) => menuChanged(ctx.mine, onGo) }
  ];

  async function run() {
    setSteps([]);
    setCompare(null);
    setError(null);
    setEnded(null);
    const t0 = Date.now();
    setStarted(t0);
    setTick(t0);
    const done = [];
    const ctx = {};
    for (const e of errands) {
      if (!alive.current) return;
      setCurrent(e.key);
      onGo?.(e.page);
      const s0 = performance.now();
      let out;
      try {
        if (!ctx.mine && (e.key === "class" || e.key === "menu")) ctx.mine = (await xo.myChanges()).data.changes || [];
        out = await e.run(ctx);
      } catch (err) {
        out = { text: err.status === 0 ? "No network — this errand needs the server." : err.message, failed: true };
      }
      const seconds = Math.round(performance.now() - s0) / 1000;
      const row = { ...e, ...out, seconds };
      done.push(row);
      if (alive.current) setSteps([...done]);
      await pause(1100); // let the page it landed on render before the next errand
    }
    if (!alive.current) return;
    setCurrent(null);
    setEnded(Date.now());
    try {
      const ok = done.filter((r) => !r.failed && !r.queued);
      if (ok.length) setCompare(await xo.tuesdayCompare(ok.map((r) => ({ key: r.key, workflow: r.workflow, seconds: r.seconds, actions: r.actions, label: r.label, reference: r.step?.reference, subjectType: r.step?.subjectType, subjectId: r.step?.subjectId, noStaffWork: r.step?.noStaffWork === true }))));
    } catch (err) {
      setError(err.status === 0 ? "No network — the comparison needs the server." : err.message);
    }
  }

  const elapsed = started ? (ended || tick) - started : 0;
  return (
    <div className="ext-tuesday xo-tuesday" role="dialog" aria-label="Tuesday Test">
      <div className="ext-tuesday-head">
        <b style={{ letterSpacing: ".12em", fontSize: 12 }}>{mode === "PROOF" ? "PROOF DEMO" : "TUESDAY TEST"}</b>
        {/* ROUND-3 HOOK: switch between the Tuesday Test and the Round 3 proof demo. */}
        <button type="button" className="xo-tuesday-close" aria-pressed={mode === "PROOF"} onClick={() => setMode((m) => (m === "PROOF" ? "TUESDAY" : "PROOF"))}>{mode === "PROOF" ? "TUESDAY TEST" : "PROOF DEMO"}</button>
        <span className="ext-clock" aria-live="off">{fmt(elapsed)}</span>
        <span style={{ flex: "1 1 auto" }} />
        <button type="button" onClick={() => { alive.current = false; onClose(); }} className="xo-tuesday-close">CLOSE</button>
      </div>
      {mode === "PROOF" ? <React.Suspense fallback={<p className="ci-meta" style={{ padding: "12px 14px" }}>Loading…</p>}><ProofDemo user={user} onGo={onGo} /></React.Suspense> : <>
      <div style={{ padding: "12px 14px" }}>
        <p className="ci-body" style={{ margin: 0 }}>Four ordinary Tuesday errands, run for real against the campus database, each on its own page. Then the Friction Ledger's old path against this run — time and staff touches.</p>
        {!student ? (
          <div className="ext-actions"><button type="button" className="btn btn-primary" onClick={onDemoStudent}>SIGN IN AS THE DEMO STUDENT</button></div>
        ) : !running ? (
          <div className="ext-actions"><button type="button" className="btn btn-primary" onClick={run}>{started ? "RUN AGAIN" : "RUN THE TUESDAY TEST"}</button></div>
        ) : null}
        {error ? <div className="ci-result ci-result-err">{error}</div> : null}
      </div>
      {errands.map((e, i) => {
        const r = steps.find((x) => x.key === e.key);
        const state = r ? (r.failed ? "err" : "done") : current === e.key ? "now" : "";
        return (
          <div key={e.key} className={`ext-step ${state}`}>
            <i aria-hidden="true" />
            <div>
              <b>{i + 1} · {e.label}</b> <Tag kind="muted">PAGE {e.num}</Tag>
              {r ? <p>{r.text} {r.kind && !r.failed ? <Kind kind={r.kind} /> : null}</p> : current === e.key ? <p>Running…</p> : null}
            </div>
            <span className="ci-meta">{r ? `${r.seconds.toFixed(2)}s` : ""}</span>
          </div>
        );
      })}
      {compare ? (
        <div style={{ padding: "12px 14px" }}>
          <div className="ci-label">OLD PATH VS THIS RUN · FRICTION LEDGER</div>
          <ul className="ext-list" style={{ marginTop: 8 }}>
            {compare.rows.map((r) => (
              <li key={r.key || r.workflow} style={{ borderBottom: "1px solid var(--color-neutral-300)", padding: "6px 0" }}>
                <b>{r.label}</b>
                <div className="ci-meta">Old: {r.baseline ? `${r.baseline.minutes} min of your time, ${r.baseline.actions} step${r.baseline.actions === 1 ? "" : "s"}` : "—"}{r.touches.old !== null ? `, ${r.touches.old} staff touches` : ""}{r.turnaround.oldHours !== null ? `, ${hoursLabel(r.turnaround.oldHours)} to an outcome` : ""} <Kind kind="ASSUMPTION" /></div>
                <div className="ci-meta">Now: {Number(r.measured.seconds).toFixed(2)}s{r.touches.new !== null ? `, ${r.touches.new} staff touch${r.touches.new === 1 ? "" : "es"}` : ""}{r.turnaround.newHours !== null ? (r.turnaround.newHours < 1 / 60 ? ", outcome at once" : `, outcome in ${hoursLabel(r.turnaround.newHours)}`) : r.turnaround.note ? ` (${r.turnaround.note})` : ""} <Kind kind="ACTUAL DATA" /></div>
              </li>
            ))}
          </ul>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: 20, margin: "10px 0 4px" }}>{compare.totals.measuredMinutes} min vs {compare.totals.baselineMinutes} min of student time{compare.totals.reductionPct !== null ? ` — ${compare.totals.reductionPct}% less` : ""}. Staff touches {compare.totals.touchesOld} → {compare.totals.touchesNew}.</p>
          <CalcBox>
            <ul className="ext-list">
              {compare.rows.map((r) => <li key={`c${r.key}`} className="ci-meta">{r.label}: {r.touches.basis}{r.turnaround.note ? ` Turnaround: ${r.turnaround.note}.` : ""}</li>)}
              <li className="ci-meta">Time now: the browser stopwatch around the real API calls for each errand (MEASURED IN THIS DEMO). The clock also includes a 1.1 s pause per page so each page renders.</li>
              <li className="ci-meta">Old path: {compare.rows[0]?.baseline?.source || "the Friction Ledger baselines"} (editable on page 10, every edit audited).</li>
            </ul>
          </CalcBox>
        </div>
      ) : null}
      </>}
    </div>
  );
}
