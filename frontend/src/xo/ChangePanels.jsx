import React, { useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, Outcome, SourceLine, attempt, dt, useExt } from "../ext/kit.jsx";
import { xo } from "./api.js";

/*
 * Phase 6 — one change, every consequence: pages 02 (what changed for you),
 * 03 (attendance projection), 04 (mess demand) and 15 (propagation log and
 * planned shutdowns).
 */

const TYPE_LABEL = { CLASS_CANCEL: "CLASS CANCELLED", CLASS_RESCHEDULE: "CLASS MOVED", CLASS_ROOM: "ROOM CHANGED", MENU_CHANGE: "MENU CHANGED", PLANNED_SHUTDOWN: "PLANNED SHUTDOWN" };

/** Page 02 (all changes) and 03/04 (filtered by type). */
export function WhatChanged({ types, title = "What changed for you" }) {
  const q = useExt("xo:changes:mine", () => xo.myChanges());
  const rows = (q.data?.changes || []).filter((c) => !types || types.includes(c.type));
  if (!q.data || !rows.length) return null;
  return (
    <div className="ci ext" style={{ padding: 0, marginTop: 14 }}>
      <div className="ext-card ext-card-accent">
        <div className="ext-row" style={{ justifyContent: "space-between" }}>
          <div className="ci-label">{title.toUpperCase()} · LAST 14 DAYS</div>
          <span className="ci-meta">{q.data.group.branch} year {q.data.group.year} section {q.data.group.section}{q.data.group.hostel ? ` · ${q.data.group.hostel}` : ""}</span>
        </div>
        <ul className="ext-list" style={{ marginTop: 8 }}>
          {rows.slice(0, 6).map((c) => (
            <li key={c.reference} className="ci-body">
              <Tag kind={c.type === "PLANNED_SHUTDOWN" ? "WATCH" : "muted"}>{TYPE_LABEL[c.type]}</Tag> <b>{c.forYou}</b>
              <div className="ci-meta">{c.reference}{c.notice ? ` · notice ${c.notice.reference}` : ""} · {dt(c.at)} · <Kind kind={c.kind} /></div>
            </li>
          ))}
        </ul>
        <SourceLine method={q.data.method} note="one change recorded once, with its effect on you computed from your own records" />
      </div>
    </div>
  );
}

/** Page 15: the propagation log (staff) — each change with every consequence. */
export function PropagationLog() {
  const q = useExt("xo:changes:all", () => xo.changes());
  return (
    <ExtSection q={q} lines={3}>
      {(d) => (
        <div className="ext-card ext-card-strong" style={{ marginTop: 18 }}>
          <div className="ci-label">ONE CHANGE → EVERY CONSEQUENCE · {d.changes.length}</div>
          {d.changes.slice(0, 10).map((c) => (
            <article key={c.id} style={{ borderTop: "1px solid var(--ci-line)", paddingTop: 8, marginTop: 8 }}>
              <div className="ext-row"><Tag kind={c.type === "PLANNED_SHUTDOWN" ? "WATCH" : "muted"}>{TYPE_LABEL[c.type]}</Tag><b>{c.reference}</b><span>{c.title}</span></div>
              <ul className="ext-list" style={{ marginTop: 4 }}>
                {c.notice ? <li className="ci-meta">→ Notice {c.notice.reference}{c.notice.reach !== undefined && c.notice.reach !== null ? ` to ${c.notice.reach}` : ""}{c.cohort?.sections?.length ? ` · only ${c.cohort.branches.join("/")} year ${c.cohort.years.join("/")} section ${c.cohort.sections.join("/")}` : c.cohort?.hostels?.length ? ` · only ${c.cohort.hostels.join(", ")}` : ""}</li> : null}
                {c.effects?.attendance ? <li className="ci-meta">→ Attendance projection recomputed for {c.effects.attendance.students} student{c.effects.attendance.students === 1 ? "" : "s"}{c.effects.attendance.rows?.[0] ? ` — e.g. ${c.effects.attendance.rows[0].text}` : ""} <Tag kind="muted">SEMESTER END {c.effects.attendance.semesterEnd} · ASSUMPTION</Tag></li> : null}
                {c.effects?.mess ? <li className="ci-meta">→ Mess demand: {c.effects.mess.text} <Kind kind={c.effects.mess.kind} /></li> : null}
                {c.type === "PLANNED_SHUTDOWN" ? <li className="ci-meta">→ {dt(c.window?.from)}–{dt(c.window?.to)} · {c.linkedComplaints.length} complaint{c.linkedComplaints.length === 1 ? "" : "s"} linked to the planned work instead of a new incident{c.linkedComplaints.length ? `: ${c.linkedComplaints.map((l) => l.reference).join(", ")}` : ""}</li> : null}
              </ul>
            </article>
          ))}
          <SourceLine method={d.method} />
        </div>
      )}
    </ExtSection>
  );
}

/** Page 15 (admin / facility): plan a water, power or Wi-Fi shutdown. */
export function ShutdownForm() {
  const [f, setF] = useState({ buildingCode: "HST-B", utility: "WATER", from: "", to: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setResult(await attempt(() => xo.planShutdown({ ...f, from: new Date(f.from).toISOString(), to: new Date(f.to).toISOString() }), (d) => `${d.reference} planned; notice ${d.notice.reference} to ${d.notice.reach}. Complaints in that building and window will be linked to it.`));
    setBusy(false);
  };
  return (
    <form className="ext-card" onSubmit={submit} style={{ marginTop: 18 }}>
      <div className="ci-label">PLAN A SHUTDOWN</div>
      <div className="ext-grid-3" style={{ marginTop: 8 }}>
        <label className="ext-field"><span className="ci-label">Building</span><select className="ci-select" value={f.buildingCode} onChange={set("buildingCode")}>{["HST-A", "HST-B", "HST-C", "ACAD-A", "LIB", "MESS-C", "ADMN"].map((b) => <option key={b}>{b}</option>)}</select></label>
        <label className="ext-field"><span className="ci-label">Utility</span><select className="ci-select" value={f.utility} onChange={set("utility")}>{["WATER", "ELECTRICITY", "WI-FI"].map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="ext-field"><span className="ci-label">Reason</span><input className="ci-input" value={f.reason} onChange={set("reason")} maxLength={300} placeholder="Pump replacement" /></label>
        <label className="ext-field"><span className="ci-label">From</span><input className="ci-input" type="datetime-local" required value={f.from} onChange={set("from")} /></label>
        <label className="ext-field"><span className="ci-label">To</span><input className="ci-input" type="datetime-local" required value={f.to} onChange={set("to")} /></label>
      </div>
      <div className="ext-actions"><button type="submit" className="btn btn-primary" disabled={busy || !f.from || !f.to}>{busy ? "PLANNING…" : "PLAN AND NOTIFY RESIDENTS"}</button></div>
      <Outcome result={result} />
    </form>
  );
}
