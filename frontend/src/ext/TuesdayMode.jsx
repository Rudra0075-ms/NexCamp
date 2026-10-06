import React, { useEffect, useRef, useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { Kind } from "./kit.jsx";

/*
 * 2F — TUESDAY MODE. The PS07 story, run live against the database with a
 * stopwatch: request a bonafide certificate, report a leaking tap, check
 * whether tomorrow's class is cancelled, check the changed mess menu — then
 * the same errands from a basic phone over the SMS channel — ending on the
 * Friction Ledger comparison of measured time against the old-process
 * baseline. Separate from the existing Replay controls, which are untouched.
 */

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
};

const DOC_FALLBACK = ["BONAFIDE", "HOSTEL_RESIDENCE", "CHARACTER", "NO_DUES"];

async function requestCertificate() {
  for (const type of DOC_FALLBACK) {
    try {
      const res = await ext.documentRequest({ type, purpose: "Scholarship verification (Tuesday Mode demo)" });
      if (res.queued) return { text: "Offline — certificate request queued on this device.", reference: null };
      return { text: `${res.data.reference} submitted — ${res.data.typeLabel}, issued within ${res.data.sla.slaHours}h.`, reference: res.data.reference };
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }
  return { text: "Every certificate type already has an open request for this student — nothing new filed.", reference: null };
}

export default function TuesdayMode({ user, onGo, onClose, onDemoStudent }) {
  const [steps, setSteps] = useState([]);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [ended, setEnded] = useState(null);
  const [compare, setCompare] = useState(null);
  const [error, setError] = useState(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const student = user?.role === "STUDENT";

  // The errands, in story order. Each waits for the presenter's tap, so the
  // stopwatch measures a person doing it — not just the server's speed.
  const errands = [
    { label: "Request a bonafide certificate", workflow: "DOCUMENT", channel: "APP", page: "documents", actions: 2, fn: requestCertificate },
    {
      label: "Report a leaking tap", workflow: "COMPLAINT", channel: "APP", page: "requests", actions: 2,
      fn: async () => {
        const res = await ext.createComplaint({ title: "Leaking tap in B-214 washroom", description: "The washroom tap in B-214 has been leaking since last night; water is running continuously.", category: "WATER", location: "HOSTEL B · B-214" });
        if (res.queued) return { text: "Offline — complaint queued on this device." };
        const c = res.data.complaint;
        return { text: `${c.reference} filed — ${c.category} / ${c.priority}, routed to ${c.department}.`, reference: c.reference };
      }
    },
    {
      label: "Is tomorrow's class cancelled?", workflow: "CLASS_CHECK", channel: "APP", page: "classes", actions: 1,
      fn: async () => {
        const a = await ext.day("tomorrow");
        if (a.sessions?.length) return { text: a.answer };
        const n = await ext.day("next");
        return { text: `${a.answer} ${n.answer}` };
      }
    },
    {
      label: "Check the changed mess menu", workflow: "MENU_CHECK", channel: "APP", page: "classes", actions: 1,
      fn: async () => {
        const res = await ext.menus(false);
        const changed = res.data.menus.find((m) => m.changed);
        if (changed) return { text: `${changed.dateLabel} ${changed.meal}: ${changed.items.join(", ")} (changed — ${changed.change.reason}).` };
        return { text: (await ext.nextMeal()).answer };
      }
    },
    { label: "SMS: WATER B-214 washroom tap leaking since night", workflow: "COMPLAINT", channel: "SMS", page: "sms", actions: 1, sms: "WATER B-214 washroom tap leaking since night" },
    { label: "SMS: NOTICE (class changes arrive as notices)", workflow: "CLASS_CHECK", channel: "SMS", page: "sms", actions: 1, sms: "NOTICE" },
    { label: "SMS: MENU", workflow: "MENU_CHECK", channel: "SMS", page: "sms", actions: 1, sms: "MENU" }
  ];

  const [index, setIndex] = useState(-1);
  const [stepStart, setStepStart] = useState(null);
  const [busy, setBusy] = useState(false);
  const results = useRef([]);
  const phone = useRef(null);

  function begin() {
    cancelled.current = false;
    results.current = [];
    setSteps([]);
    setCompare(null);
    setError(null);
    setEnded(null);
    const t = Date.now();
    setStarted(t);
    setNow(t);
    setRunning(true);
    setIndex(0);
    setStepStart(performance.now());
    onGo?.(errands[0].page);
  }

  async function doStep() {
    const e = errands[index];
    setBusy(true);
    let out;
    try {
      if (e.sms) {
        if (!phone.current) phone.current = (await ext.smsPhones()).data.phones[0] || null;
        if (!phone.current) throw new Error("No registered phone for this student");
        out = { text: (await ext.smsSimulate(phone.current.phone, e.sms)).reply };
      } else out = await e.fn();
    } catch (err) {
      out = { text: err.message, failed: true };
    }
    const seconds = Math.round((performance.now() - stepStart) / 100) / 10;
    setSteps((s) => [...s, { label: e.label, channel: e.channel, state: out.failed ? "err" : "done", text: out.text, seconds }]);
    if (!out.failed) results.current.push({ workflow: e.workflow, seconds, channel: e.channel, label: e.label, reference: out.reference, actions: e.actions });
    setBusy(false);
    const next = index + 1;
    if (next < errands.length) {
      setIndex(next);
      setStepStart(performance.now());
      if (errands[next].page !== e.page) onGo?.(errands[next].page);
      return;
    }
    setIndex(-1);
    setSteps((s) => [...s, { label: "Certificate by SMS", state: "skip", text: "No SMS command issues documents — certificates need the app or the help-desk kiosk." }]);
    setEnded(Date.now());
    setRunning(false);
    try {
      setCompare(await ext.compare(results.current));
    } catch (err) {
      setError(err.message);
    }
  }

  const elapsed = started ? (ended || now) - started : 0;
  return (
    <div className="ext-tuesday" role="dialog" aria-label="Tuesday Mode">
      <div className="ext-tuesday-head">
        <b style={{ letterSpacing: ".12em", fontSize: 12 }}>TUESDAY MODE</b>
        <span className="ext-clock" aria-live="off">{fmt(elapsed)}</span>
        <span style={{ flex: "1 1 auto" }} />
        <button type="button" onClick={() => { cancelled.current = true; setRunning(false); onClose(); }} style={{ background: "none", border: "1px solid var(--color-neutral-500)", borderRadius: 999, color: "inherit", font: "inherit", fontSize: 11, fontWeight: 800, letterSpacing: ".12em", padding: "6px 10px", cursor: "pointer" }}>CLOSE</button>
      </div>
      <div style={{ padding: "12px 14px" }}>
        <p className="ci-body" style={{ margin: 0 }}>The PS07 story, live against the database: four errands in the app, the same errands by SMS, then time against the old process. The clock runs while you tap through each step.</p>
        {!student ? (
          <div className="ext-actions"><button type="button" className="btn btn-primary" onClick={onDemoStudent}>SIGN IN AS THE DEMO STUDENT</button></div>
        ) : !started || (!running && ended) ? (
          <div className="ext-actions"><button type="button" className="btn btn-primary" onClick={begin}>{started ? "RUN AGAIN" : "START THE CLOCK"}</button></div>
        ) : null}
        {error ? <div className="ci-result ci-result-err">{error}</div> : null}
      </div>
      {steps.map((s, i) => (
        <div key={i} className={`ext-step ${s.state}`}>
          <i aria-hidden="true" />
          <div><b>{s.label}</b>{s.channel === "SMS" ? <> <Tag kind="SIMULATED">SIMULATED SMS</Tag></> : null}<p>{s.text}</p></div>
          <span className="ci-meta">{s.seconds !== undefined ? `${s.seconds}s` : s.state === "skip" ? "—" : ""}</span>
        </div>
      ))}
      {running && index >= 0 ? (
        <div className="ext-step now">
          <i aria-hidden="true" />
          <div><b>{errands[index].label}</b>{errands[index].channel === "SMS" ? <> <Tag kind="SIMULATED">SIMULATED SMS</Tag></> : null}<p>Step {index + 1} of {errands.length}. {errands[index].channel === "SMS" ? "Sent from the student's registered number on the simulated phone." : "Form pre-filled for the demo; tap when you would press submit."}</p></div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={doStep}>{busy ? "…" : "DO IT →"}</button>
        </div>
      ) : null}
      {compare ? (
        <div style={{ padding: "12px 14px" }}>
          <div className="ci-label">Friction Ledger — this run</div>
          <div className="ext-table-wrap" style={{ marginTop: 8 }}>
            <table className="ci-table" style={{ minWidth: 380 }}>
              <thead><tr><th>Task</th><th>Measured</th><th>Old process</th></tr></thead>
              <tbody>{compare.rows.map((r, i) => <tr key={i}><td>{r.label}<div className="ci-meta">{r.channel}</div></td><td className="ci-num">{r.measured.seconds}s · {r.measured.actions} tap{r.measured.actions === 1 ? "" : "s"}</td><td className="ci-num">{r.baseline ? `${r.baseline.minutes} min · ${r.baseline.actions} action${r.baseline.actions === 1 ? "" : "s"}` : "—"}</td></tr>)}</tbody>
            </table>
          </div>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: 20, margin: "10px 0 4px" }}>{compare.totals.measuredMinutes} min of student time vs {compare.totals.baselineMinutes} min — {compare.totals.reductionPct}% less.</p>
          <div className="ext-row"><Kind kind="MEASURED IN THIS DEMO" /><span className="ci-meta">presenter taps + server time</span><Kind kind="BASELINE ESTIMATE" /><Kind kind="ESTIMATE" /></div>
          <p className="ci-meta">{compare.totals.basis}. Turnaround (hours until the office finishes) is tracked separately in the Friction Ledger on Mission Control.</p>
        </div>
      ) : null}
    </div>
  );
}
