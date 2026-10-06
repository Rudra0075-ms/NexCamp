import React, { useRef, useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { ext } from "../ext/api.js";
import { Kind } from "../ext/kit.jsx";
import { pf } from "./api.js";

/*
 * Round 3 judge demo (≤ 6 minutes), opened from the Tuesday Test panel.
 * Five steps, each on its own page, each a real call against the database —
 * nothing is scripted except the order, and nothing is written: the pre-flight
 * and the linter are dry runs, and COMMIT is left to the presenter.
 */

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const istKey = (offsetDays) => new Date(Date.now() + 5.5 * 36e5 + offsetDays * 864e5).toISOString().slice(0, 10);
const weekdayOf = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
const nextOn = (weekday, from = 1) => {
  for (let i = from; i < from + 14; i += 1) if (weekdayOf(istKey(i)) === weekday) return istKey(i);
  return istKey(from);
};
const prettyDay = (key) => new Date(`${key}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" });

async function preflightStep() {
  const [{ data: s }, { data: c }] = await Promise.all([ext.schedules(), ext.classChanges()]);
  const taken = new Set((c.changes || []).map((x) => `${x.schedule}|${x.sessionDate}`));
  // A morning class whose next session has no change yet, moved into Wednesday's lunch hour.
  const candidates = (s.schedules || []).filter((x) => x.startTime < "12:00" && x.weekday !== 3);
  for (const sc of candidates) {
    for (let from = 1; from < 22; from += 7) {
      const sessionDate = nextOn(sc.weekday, from);
      if (taken.has(`${sc.id}|${sessionDate}`)) continue;
      const newDate = nextOn(3, from);
      const r = await pf.preflight({ kind: "CLASS", scheduleId: sc.id, sessionDate, type: "RESCHEDULE", newDate, newStartTime: "13:00" });
      const att = r.lines.find((l) => l.section === "ATTENDANCE");
      const mess = r.lines.find((l) => l.section === "MESS");
      return { text: `${sc.subject} ${sc.branch}-${sc.year}${sc.section} ${r.change.originalSlot} → ${r.change.newSlot}. ${att?.text || ""} ${mess?.text || ""} Nothing was written — press PREVIEW IMPACT, EDIT, then COMMIT on page 15 to record it.`, kind: "SIMULATED", detail: { subject: sc.subject, date: newDate } };
    }
  }
  return { text: "No morning class without an existing change was found in the next three weeks.", kind: "INSUFFICIENT DATA" };
}

async function lintStep(prev) {
  const subject = prev?.detail?.subject || "DBMS";
  const audience = { branches: ["CSE"], years: [3] };
  const rough = await pf.lint({ title: `${subject} class moved`, body: `${subject} class is moved to tomorrow at 1 pm. Bring your lab records.`, audience });
  const fixedBody = `${subject} class on ${prettyDay(prev?.detail?.date || istKey(1))} at 13:00 in Room LH-102. Bring your lab records by 12:55. Questions: academic office, ext 214.`;
  const fixed = await pf.lint({ title: `${subject} class moved`, body: fixedBody, audience });
  const flagged = rough.findings.map((f) => f.rule.replace(/_/g, " ").toLowerCase()).join(", ");
  return { text: `First draft flagged: ${flagged || "nothing"} (usability ${rough.score}/100). Fixed draft: ${fixed.findings.length ? fixed.findings.map((f) => f.rule).join(", ") : "clean"} (${fixed.score}/100). ${fixed.reach.text}`, kind: fixed.reach.kind };
}

async function presenceStep() {
  const d = (await pf.presence("LUNCH", istKey(1))).data;
  if (d.base.insufficient) return { text: d.base.reason, kind: "INSUFFICIENT DATA" };
  return { text: `Tomorrow's lunch: ${d.base.predicted} covers by the same-weekday forecast; ${d.adjustment?.text || "no adjustment"} → ${d.adjusted?.predicted ?? "—"}. Backtest: ${d.backtest.text}`, kind: "AI PREDICTION" };
}

async function interventionStep() {
  const b = (await pf.badges()).data.badges;
  const measured = b.find((x) => x.status === "MEASURED") || b[0];
  const p = await pf.portfolio(12);
  const impact = measured ? `${measured.reference} (${measured.building} ${measured.category}): ${measured.text} Controls: ${measured.controls.join(", ") || "none"}.` : "No completed intervention to measure.";
  return { text: `${impact} Portfolio at 12 h: ${p.text || ""} ${p.marginal?.text || ""}`, kind: measured?.kind || "INSUFFICIENT DATA" };
}

async function missionStep() {
  const [m, e] = await Promise.all([pf.processMining("complaint", 30), pf.equity()]);
  const mining = m.data.insufficient ? m.data.text : `${m.data.bottleneck?.text || "No bottleneck."} ${m.data.conformance.reassignedTwicePlus.length ? `Reassigned 2+ times: ${m.data.conformance.reassignedTwicePlus.join(", ")}.` : ""}`;
  return { text: `${mining} Equity: ${e.data.headline}`, kind: "ACTUAL DATA" };
}

const STEPS = [
  { key: "preflight", page: "classes", num: "15", label: "Draft a class reschedule → pre-flight", run: preflightStep },
  { key: "lint", page: "notices", num: "13", label: "Compose its notice → linter → predicted reach", run: lintStep },
  { key: "presence", page: "mess", num: "04", label: "Lunch forecast adjusted for approved gate passes", run: presenceStep },
  { key: "intervention", page: "intervention", num: "09", label: "Did the Hostel B fix work? → maintenance hours", run: interventionStep },
  { key: "mission", page: "admin", num: "10", label: "Process-mining bottleneck and channel equity", run: missionStep }
];

export default function ProofDemo({ user, onGo }) {
  const [rows, setRows] = useState([]);
  const [current, setCurrent] = useState(null);
  const alive = useRef(true);
  const admin = user?.role === "ADMIN";
  const run = async () => {
    alive.current = true;
    setRows([]);
    const done = [];
    let prev = null;
    for (const s of STEPS) {
      if (!alive.current) return;
      setCurrent(s.key);
      onGo?.(s.page);
      let out;
      try {
        out = await s.run(prev);
      } catch (err) {
        out = { text: err.status === 0 ? "No network — this step needs the server." : err.message, failed: true };
      }
      prev = out;
      done.push({ ...s, ...out });
      setRows([...done]);
      await pause(1400);
    }
    setCurrent(null);
  };
  return (
    <div>
      <div style={{ padding: "12px 14px" }}>
        <p className="ci-body" style={{ margin: 0 }}>Round 3 in five steps: prevent a bad change, fix a notice before it goes out, forecast with presence, prove a fix worked, and see where work waits. Every step is a live call; nothing is written.</p>
        {!admin ? <p className="ci-meta">Sign in as the ADMIN account (status-bar chip) to run it — every step is a staff view.</p> : <div className="ext-actions"><button type="button" className="btn btn-primary" disabled={Boolean(current)} onClick={run}>{rows.length ? "RUN AGAIN" : "RUN THE PROOF DEMO"}</button></div>}
      </div>
      {STEPS.map((s, i) => {
        const r = rows.find((x) => x.key === s.key);
        return (
          <div key={s.key} className={`ext-step ${r ? (r.failed ? "err" : "done") : current === s.key ? "now" : ""}`}>
            <i aria-hidden="true" />
            <div>
              <b>{i + 1} · {s.label}</b> <Tag kind="muted">PAGE {s.num}</Tag>
              {r ? <p>{r.text} {r.kind && !r.failed ? <Kind kind={r.kind} /> : null}</p> : current === s.key ? <p>Running…</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
