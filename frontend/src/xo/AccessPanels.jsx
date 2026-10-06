import React, { useEffect, useRef, useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ext } from "../ext/api.js";
import { ExtSection, Kind, useExt } from "../ext/kit.jsx";
import { xo } from "./api.js";
import { CalcBox } from "./kit.jsx";

/*
 * Phase 9 — accessibility depth.
 *   18  SmsWorkDemo: two basic phones (a student and the plumber) running the
 *       real SMS work loop — report, NEED PART, DONE, "Is it fixed?", YES.
 *   21  WorkflowBudgets: bytes and simulated 2G time for four everyday tasks,
 *       from npm run budgets (measured against the real API).
 * Every message goes through the real simulator endpoint; nothing is scripted
 * on the client except which button is pressed next.
 */

const time = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

function MiniPhone({ title, number, log, busy, onSend, disabled }) {
  const [text, setText] = useState("");
  const screen = useRef(null);
  useEffect(() => {
    if (screen.current) screen.current.scrollTop = screen.current.scrollHeight;
  }, [log]);
  return (
    <div className="ext-phone" aria-label={`Simulated basic phone: ${title}`}>
      <div className="ext-phone-screen" ref={screen} role="log" aria-live="polite">
        <div className="ext-phone-bar"><span>{title} · {number}</span><span>SIMULATED</span></div>
        {!log.length ? <div className="ext-sms ext-sms-in">No messages yet.</div> : null}
        {log.map((m, i) => (
          <div key={i} className={`ext-sms ext-sms-${m.dir}`}>
            {m.text}
            <small>{m.dir === "out" ? "sent" : m.push ? "from CAMPUS" : `reply${m.outcome && m.outcome !== "OK" ? ` · ${m.outcome}` : ""}`} · {time(m.at)}</small>
          </div>
        ))}
        {busy ? <div className="ext-sms ext-sms-in">…</div> : null}
      </div>
      <form className="ext-phone-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(""); } }}>
        <input aria-label={`SMS text from ${title}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={160} placeholder="Type a command" disabled={disabled} />
        <button type="submit" disabled={busy || disabled}>SEND</button>
      </form>
    </div>
  );
}

/** Page 18: the SMS work loop on two phones. Staff only (the simulator lets staff use any demo number). */
export function SmsWorkDemo({ user }) {
  const staff = Boolean(!user || user.role !== "STUDENT");
  const phones = useExt("xo:sms:phones", () => Promise.all([ext.smsPhones(), xo.staffPhones()]).then(([s, f]) => ({ students: s.data?.phones || [], staff: f.data?.phones || [] })), { enabled: staff });
  const [student, setStudent] = useState([]);
  const [plumber, setPlumber] = useState([]);
  const [busy, setBusy] = useState(null);
  const [ref, setRef] = useState(null);
  const [step, setStep] = useState(0);
  const seen = useRef(new Set());
  if (!staff) {
    return (
      <div className="ext-card" style={{ marginTop: 18 }}>
        <div className="ci-label">SMS WORK LOOP</div>
        <p className="ci-body" style={{ margin: "6px 0 0" }}>When the plumber texts <span className="ext-code">DONE CMP-1234</span>, you get an SMS: “Is it fixed? Reply YES CMP-1234 or NO CMP-1234”. <b>NO</b> reopens it at once. The two-phone demo runs under a staff sign-in.</p>
      </div>
    );
  }
  return (
    <ExtSection q={phones} lines={3}>
      {(d) => {
        const s = d.students[0];
        const p = d.staff.find((x) => x.label === "Plumber") || d.staff[0];
        if (!s || !p) return <StateBox title="No demo numbers">Run the seed (npm run seed:xo) to register the plumber's number.</StateBox>;
        const pull = async () => {
          const box = await xo.smsOutbox();
          const fresh = box.messages.filter((m) => m.to === s.masked && !seen.current.has(m.id)).reverse();
          fresh.forEach((m) => seen.current.add(m.id));
          if (fresh.length) setStudent((l) => [...l, ...fresh.map((m) => ({ dir: "in", push: true, text: m.body, at: m.at }))]);
        };
        const send = async (who, text) => {
          const phone = who === "student" ? s.phone : p.phone;
          const set = who === "student" ? setStudent : setPlumber;
          set((l) => [...l, { dir: "out", text, at: new Date() }]);
          setBusy(who);
          try {
            if (!seen.current.size) (await xo.smsOutbox()).messages.forEach((m) => seen.current.add(m.id));
            const r = await ext.smsSimulate(phone, text);
            set((l) => [...l, { dir: "in", text: r.reply, outcome: r.outcome, at: new Date() }]);
            const filed = /Filed (CMP-\d+)/.exec(r.reply);
            if (filed) setRef(filed[1]);
            await pull();
            return r;
          } catch (e) {
            set((l) => [...l, { dir: "in", text: e.status === 0 ? "(no network — message not sent)" : `(${e.message})`, outcome: "ERROR", at: new Date() }]);
            return null;
          } finally {
            setBusy(null);
          }
        };
        const script = [
          { who: "student", label: "1 · Student reports by SMS", text: () => "WATER B-214 tap leaking in washroom since night" },
          { who: "plumber", label: "2 · Plumber: NEED PART", text: () => `NEED PART ${ref} tap washer` },
          { who: "plumber", label: "3 · Plumber: DONE", text: () => `DONE ${ref} washer replaced` },
          { who: "student", label: "4 · Student answers YES", text: () => `YES ${ref}` }
        ];
        const next = script[step];
        const run = async () => {
          if (!next || (step > 0 && !ref)) return;
          const r = await send(next.who, next.text());
          if (r) setStep((n) => n + 1);
        };
        return (
          <div style={{ marginTop: 18 }}>
            <div className="ext-row" style={{ justifyContent: "space-between" }}>
              <h2 className="ext-h2">SMS work loop — student and plumber</h2>
              <div className="ext-row"><span className="ext-simulated">SIMULATED INBOUND SMS</span><Kind kind="ACTUAL DATA" /></div>
            </div>
            <p className="ci-meta">Both phones send through the real simulator: the complaint, its status, the audit chain and the Campus Event log change for real. The student's phone also shows what the campus sent it (the SMS outbox).</p>
            <div className="ext-row" style={{ margin: "8px 0" }}>
              {next ? (
                <button type="button" className="btn btn-primary" onClick={run} disabled={Boolean(busy) || (step > 0 && !ref)}>{busy ? "…" : next.label.toUpperCase()}</button>
              ) : <Tag kind="SAFE">LOOP CLOSED — {ref} confirmed fixed by the student</Tag>}
              {step > 0 && !ref ? <span className="ci-meta">No complaint reference came back — type commands on the phones instead.</span> : null}
            </div>
            <div className="ext-grid">
              <MiniPhone title={`Student · ${s.name}`} number={s.masked} log={student} busy={busy === "student"} onSend={(t) => send("student", t)} />
              <MiniPhone title={`${p.label} · ${p.name}`} number={p.masked} log={plumber} busy={busy === "plumber"} onSend={(t) => send("plumber", t)} />
            </div>
            <div className="ext-card" style={{ marginTop: 12 }}>
              <div className="ci-label">Staff commands (registered staff numbers only)</div>
              <ul className="ext-list" style={{ marginTop: 8 }}>
                <li><b className="ext-code">DONE CMP-1234 [what was done]</b> <span className="ci-meta">marks it RESOLVED through the normal complaint update and asks the student “Is it fixed?”</span></li>
                <li><b className="ext-code">NEED PART CMP-1234 &lt;part&gt;</b> <span className="ci-meta">moves it to INVESTIGATING, notes the part in its audit and tells the student</span></li>
                <li><b className="ext-code">YES CMP-1234</b> / <b className="ext-code">NO CMP-1234</b> <span className="ci-meta">the student's answer; NO opens a reopen request</span></li>
              </ul>
              <p className="ci-meta">A staff number can close only its own department's complaints ({p.label}: {p.departments.join(", ") || "all"}).</p>
            </div>
          </div>
        );
      }}
    </ExtSection>
  );
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** Page 21: per-workflow bytes and simulated 2G time, from npm run budgets. */
export function WorkflowBudgets() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/workflow-budgets.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setReport(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="ext-rule">
      <div className="ext-row" style={{ justifyContent: "space-between" }}>
        <h2 className="ext-h2">Everyday tasks on 2G</h2>
        <div className="ext-row"><Tag kind="muted">BYTES MEASURED</Tag><Kind kind="SIMULATED" /></div>
      </div>
      {!report ? (
        <StateBox title="No workflow report yet">Run <span className="ext-code">npm run budgets</span> in backend/ to measure the four workflows ({error || "loading"}).</StateBox>
      ) : (
        <>
          <ul className="ext-list" style={{ marginTop: 8 }}>
            {report.workflows.map((w) => (
              <li key={w.key} className="ext-row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--ci-line)", padding: "8px 0" }}>
                <span><b>{w.label}</b><span className="ci-meta" style={{ display: "block" }}>{w.requests} calls · {kb(w.bytes)} of {kb(w.budget)} budget</span></span>
                <span className="ext-row"><b className="ci-num">~{w.seconds2g} s on {report.network.name}</b>{w.withinBudget ? <Tag kind="SAFE">WITHIN</Tag> : <Tag kind="CRITICAL">OVER</Tag>}</span>
              </li>
            ))}
          </ul>
          <CalcBox>
            <p className="ci-meta" style={{ margin: 0 }}>time = calls × {report.network.rttMs} ms + (bytes + calls × {report.network.headerBytes} B headers) × 8 ÷ {report.network.kbps} kbps</p>
            <ul className="ext-list" style={{ marginTop: 6 }}>
              {report.workflows.flatMap((w) => w.steps.map((s) => <li key={`${w.key}${s.label}`} className="ci-meta">{w.label} · {s.label}: {s.method} <span className="ext-code">{s.path}</span> ↑{s.up} B ↓{s.down} B</li>))}
            </ul>
            <ul className="ext-list" style={{ marginTop: 6 }}>{report.assumptions.map((a) => <li key={a} className="ci-meta">{a}</li>)}</ul>
          </CalcBox>
          <p className="ci-meta">Measured {new Date(report.generatedAt).toLocaleString("en-IN")} against the real API in a throwaway database. A test (test/xo-budget.test.js) fails if any task goes over its budget.</p>
        </>
      )}
    </div>
  );
}
