import React, { useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { ExtSection, Kind, NetLine, Outcome, PageHead, SignInNote, SourceLine, attempt, dt, isAdmin, isStaff, useExt } from "./kit.jsx";
import { PfSlot } from "../proof/ProofEntry.jsx"; // ROUND-3 HOOK (see CHANGES-ROUND3.md)
import { PropagationLog, ShutdownForm } from "../xo/ChangePanels.jsx"; // EXCEPTION-ONLY HOOK

/*
 * 15 — CLASSES & MESS. "Is tomorrow's class cancelled?" answered from the
 * timetable with evidence; class changes announced to exactly the affected
 * section; an adjusted-attendance view beside the unchanged official figure;
 * the next meal and any menu change.
 */

const STATUS_TAG = { CANCELLED: "CRITICAL", MOVED_AWAY: "CRITICAL", ROOM_CHANGED: "WATCH", RESCHEDULED_HERE: "WATCH", AS_SCHEDULED: "SAFE" };
const STATUS_LABEL = { CANCELLED: "CANCELLED", MOVED_AWAY: "MOVED", ROOM_CHANGED: "ROOM CHANGED", RESCHEDULED_HERE: "RESCHEDULED HERE", AS_SCHEDULED: "AS SCHEDULED" };

function Session({ s }) {
  return (
    <li className="ext-row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--ci-soft)", paddingBottom: 6 }}>
      <span><b className="ci-num">{s.startTime}</b> {s.subject} <span className="ci-meta">· {s.room}{s.originalRoom && s.room !== s.originalRoom ? ` (was ${s.originalRoom})` : ""} · {s.faculty || ""}</span></span>
      <Tag kind={STATUS_TAG[s.status]}>{STATUS_LABEL[s.status]}</Tag>
    </li>
  );
}

function Answer() {
  const [question, setQuestion] = useState("Is tomorrow's class cancelled?");
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await fn());
    } catch (e) {
      setError(e.status === 0 ? "Offline — the timetable answer needs the server; the week view below may be a cached copy." : e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ext-card ext-card-strong">
      <form className="ci-ask" onSubmit={(e) => { e.preventDefault(); run(() => ext.ask(question)); }}>
        <input aria-label="Ask about your classes" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} style={{ flex: 1, border: 0, background: "none", font: "inherit", fontSize: 16, padding: "12px 14px", minWidth: 0 }} />
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "…" : "ASK"}</button>
      </form>
      <div className="ext-chips" style={{ marginTop: 10 }}>
        {[["today", "TODAY"], ["tomorrow", "TOMORROW"], ["next", "NEXT CLASS DAY"]].map(([d, l]) => <button key={d} type="button" className="ci-chip" onClick={() => run(() => ext.day(d))}>{l}</button>)}
      </div>
      {error ? <div className="ci-result ci-result-err">{error}</div> : null}
      {answer ? (
        <div aria-live="polite" style={{ marginTop: 14 }}>
          <div className="ci-label">{answer.dateLabel} · CSE {answer.group?.year}{answer.group?.section} {answer.group?.source === "DERIVED" ? "(derived)" : ""}</div>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(18px, 2.2vw, 24px)", margin: "6px 0 10px", lineHeight: 1.25 }}>{answer.answer}</p>
          {answer.sessions?.length ? <ul className="ext-list">{answer.sessions.map((s, i) => <Session key={i} s={s} />)}</ul> : null}
          {answer.evidence?.length ? <ul className="ext-list" style={{ marginTop: 10 }}>{answer.evidence.map((e, i) => <li key={i} className="ext-row"><Kind kind="EVIDENCE" /><span className="ci-meta">{e.label} — {e.value}</span></li>)}</ul> : null}
          <SourceLine method={answer.method} source={answer.source} note={answer.matcher ? `question read by ${answer.matcher}` : undefined} />
        </div>
      ) : null}
    </div>
  );
}

function Week({ lowBw }) {
  const q = useExt(`week:${lowBw}`, () => ext.week(false));
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-grid">
          {d.days.map((dayRow) => (
            <div key={dayRow.date} className="ext-card">
              <div className="ci-label">{dayRow.label}</div>
              {dayRow.sessions.length ? <ul className="ext-list" style={{ marginTop: 8 }}>{dayRow.sessions.map((s, i) => <Session key={i} s={s} />)}</ul> : <p className="ci-meta">No classes.</p>}
            </div>
          ))}
        </div>
      )}
    </ExtSection>
  );
}

function Adjusted({ lowBw }) {
  const q = useExt(`adj:${lowBw}`, () => ext.adjusted(lowBw));
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-stack">
          <div className="ci-strip" style={{ marginTop: 0 }}>
            <div><div className="ci-label">{d.recorded.label}</div><div className="ci-big" style={{ fontSize: 44 }}>{d.recorded.percentage ?? "—"}%</div><span className="ci-meta">{d.recorded.attended}/{d.recorded.total} classes</span></div>
            <div><div className="ci-label">{d.adjusted.label}</div><div className="ci-big" style={{ fontSize: 44 }}>{d.adjusted.percentage ?? "—"}%</div><span className="ci-meta">{d.adjusted.attended}/{d.adjusted.total} classes</span></div>
          </div>
          <div className="ext-table-wrap">
            <table className="ci-table">
              <thead><tr><th>Subject</th><th>Official</th><th>Cancelled — not counted</th><th>Adjusted</th></tr></thead>
              <tbody>
                {d.subjects.map((s) => (
                  <tr key={s.subject}>
                    <td>{s.subject}</td>
                    <td className="ci-num">{s.recorded.percentage}% ({s.recorded.attended}/{s.recorded.total})</td>
                    <td>{s.cancelledInRegister.length ? s.cancelledInRegister.map((c) => `${c.date} ${c.slot || ""} (${c.markedPresent ? "marked present" : "marked absent"})`).join(", ") : "—"}</td>
                    <td className="ci-num">{s.adjusted.percentage ?? "—"}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ci-meta">{d.note}</p>
          <SourceLine method={d.method} source={d.source} />
        </div>
      )}
    </ExtSection>
  );
}

function Menus({ lowBw }) {
  const q = useExt(`menus:${lowBw}`, () => ext.menus(false));
  const next = useExt("nextmeal", () => ext.nextMeal());
  return (
    <div className="ext-stack">
      {next.data ? <div className="ext-card ext-card-accent"><div className="ci-label">Next meal</div><p style={{ fontFamily: "var(--font-heading)", fontSize: 20, margin: "6px 0" }}>{next.data.answer}</p><SourceLine method={next.data.method} source={next.data.source} note={next.data.menu?.planned?.basis} /></div> : null}
      <ExtSection q={q}>
        {(d) => (
          <div className="ext-grid">
            {d.menus.filter((m) => m.items.length).map((m) => (
              <div key={`${m.date}${m.meal}`} className={`ext-card ${m.changed ? "ext-card-accent" : ""}`}>
                <div className="ext-row" style={{ justifyContent: "space-between" }}><span className="ci-label">{m.dateLabel} · {m.meal}</span>{m.changed ? <Tag kind="CRITICAL">CHANGED</Tag> : <Kind kind={m.planned.kind} />}</div>
                <p className="ci-body" style={{ margin: "6px 0 0" }}>{m.items.join(" · ")}</p>
                {m.changed ? <p className="ci-meta">Was: {m.change.replaces.join(" · ") || "—"}. {m.change.reason} ({m.change.reference}, notice {m.change.noticeReference})</p> : null}
              </div>
            ))}
          </div>
        )}
      </ExtSection>
    </div>
  );
}

// ---- staff ------------------------------------------------------------------------

function ChangeForm({ user }) {
  const sq = useExt("schedules", () => ext.schedules());
  const [form, setForm] = useState({ scheduleId: "", sessionDate: "", type: "CANCEL", newRoom: "", newDate: "", newStartTime: "", reason: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v));
    setResult(await attempt(() => ext.classChange(body), (d) => `${d.change.reference} recorded. Notice ${d.notice.reference} ${d.notice.status === "PUBLISHED" ? `sent to ${d.notice.reach} students of ${d.change.branch} ${d.change.year}${d.change.section}` : `is ${d.notice.status}`}.`));
    setBusy(false);
  };
  return (
    <ExtSection q={sq} lines={3}>
      {(d) => (
        <form className="ci-form" onSubmit={submit}>
          <label className="ext-field"><span className="ci-label">Class</span>
            <select className="ci-select" required value={form.scheduleId} onChange={set("scheduleId")}>
              <option value="">Choose a weekly class…</option>
              {d.schedules.map((s) => <option key={s.id} value={s.id}>{s.branch} {s.year}{s.section} · {s.weekdayName} {s.startTime} · {s.subject} · {s.room}</option>)}
            </select>
          </label>
          <div className="ext-grid-3">
            <label className="ext-field"><span className="ci-label">Session date</span><input className="ci-input" type="date" required value={form.sessionDate} onChange={set("sessionDate")} /></label>
            <label className="ext-field"><span className="ci-label">Change</span><select className="ci-select" value={form.type} onChange={set("type")}><option value="CANCEL">CANCEL</option><option value="ROOM">ROOM CHANGE</option><option value="RESCHEDULE">RESCHEDULE</option></select></label>
            {form.type === "ROOM" ? <label className="ext-field"><span className="ci-label">New room</span><input className="ci-input" required value={form.newRoom} onChange={set("newRoom")} /></label> : null}
            {form.type === "RESCHEDULE" ? <label className="ext-field"><span className="ci-label">New date</span><input className="ci-input" type="date" required value={form.newDate} onChange={set("newDate")} /></label> : null}
            {form.type === "RESCHEDULE" ? <label className="ext-field"><span className="ci-label">New start</span><input className="ci-input" type="time" required value={form.newStartTime} onChange={set("newStartTime")} /></label> : null}
          </div>
          <label className="ext-field"><span className="ci-label">Reason</span><input className="ci-input" maxLength={300} value={form.reason} onChange={set("reason")} /></label>
          <p className="ci-meta" style={{ margin: 0 }}>A targeted notice goes to exactly that branch, year and section. Cancelled sessions are recorded separately and never edit the attendance register.</p>
          <div className="ext-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "SAVING…" : "RECORD & NOTIFY"}</button>
            {/* ROUND-3 HOOK: pre-flight — every consequence before commit; COMMIT runs the existing flow above. */}
            <PfSlot name="preflight" live user={user} disabled={busy || !form.scheduleId || !form.sessionDate} body={{ kind: "CLASS", ...Object.fromEntries(Object.entries(form).filter(([k, v]) => v && (k !== "newRoom" || form.type === "ROOM") && (!["newDate", "newStartTime"].includes(k) || form.type === "RESCHEDULE"))) }} onCommit={() => submit()} /></div>
          <Outcome result={result} />
        </form>
      )}
    </ExtSection>
  );
}

function MenuForm({ user }) {
  const [form, setForm] = useState({ date: "", meal: "LUNCH", items: "", reason: "" });
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e?.preventDefault();
    setResult(await attempt(() => ext.menuChange({ date: form.date, meal: form.meal, items: form.items.split(",").map((x) => x.trim()).filter(Boolean), reason: form.reason || undefined }), (d) => `${d.change.reference} recorded; notice ${d.notice.reference} → ${d.notice.reach} students.`));
  };
  return (
    <form className="ci-form" onSubmit={submit}>
      <div className="ext-grid-3">
        <label className="ext-field"><span className="ci-label">Date</span><input className="ci-input" type="date" required value={form.date} onChange={set("date")} /></label>
        <label className="ext-field"><span className="ci-label">Meal</span><select className="ci-select" value={form.meal} onChange={set("meal")}>{["BREAKFAST", "LUNCH", "SNACKS", "DINNER"].map((m) => <option key={m}>{m}</option>)}</select></label>
      </div>
      <label className="ext-field"><span className="ci-label">New items (comma separated)</span><input className="ci-input" required value={form.items} onChange={set("items")} placeholder="RICE · RAJMA, ROTI, CURD" /></label>
      <label className="ext-field"><span className="ci-label">Reason</span><input className="ci-input" value={form.reason} onChange={set("reason")} /></label>
      <div className="ext-actions"><button type="submit" className="btn btn-primary">CHANGE MENU & NOTIFY</button>
        {/* ROUND-3 HOOK: pre-flight for a menu change. */}
        <PfSlot name="preflight" live user={user} disabled={!form.date || !form.items.trim()} body={{ kind: "MENU", date: form.date, meal: form.meal, items: form.items.split(",").map((x) => x.trim()).filter(Boolean) }} onCommit={() => submit()} /></div>
      <Outcome result={result} />
    </form>
  );
}

function ChangeLog() {
  const q = useExt("changes", () => ext.classChanges());
  return (
    <ExtSection q={q} lines={2}>
      {(d) => d.changes.length ? (
        <div className="ext-table-wrap"><table className="ci-table"><thead><tr><th>Ref</th><th>Class</th><th>Session</th><th>Change</th><th>Notice</th></tr></thead>
          <tbody>{d.changes.map((c) => <tr key={c.id}><td>{c.reference}</td><td>{c.subject} · {c.branch} {c.year}{c.section}</td><td>{c.sessionDateLabel}</td><td>{c.type}{c.newRoom ? ` → ${c.newRoom}` : ""}{c.newDate ? ` → ${c.newDate} ${c.newStartTime}` : ""}</td><td>{c.noticeReference}</td></tr>)}</tbody></table></div>
      ) : <StateBox title="No class changes yet" />}
    </ExtSection>
  );
}

export default function ClassesSurface({ user, lowBw }) {
  const staff = isStaff(user);
  const [tab, setTab] = useState("CLASSES");
  return (
    <div className="ci ext">
      <PageHead num="15" kicker="CLASSES & MESS" title="Is tomorrow's class cancelled? Ask the timetable, not the group chat.">
        Answers come from the timetable and the recorded class changes, with the change and its notice as evidence. Cancelled sessions appear in an additional attendance view; the official figure is never changed.
      </PageHead>
      <div style={{ marginTop: 18 }}><NetLine /></div>
      {!user ? <SignInNote what="your timetable" /> : (
        <>
          <div className="ext-tabs" role="group" aria-label="Classes and mess" style={{ marginBottom: 18 }}>
            {[["CLASSES", "CLASSES"], ["ATTENDANCE", "ADJUSTED ATTENDANCE"], ["MESS", "MESS MENU"], ...(staff ? [["STAFF", "RECORD A CHANGE"]] : [])].map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === "CLASSES" ? (staff ? <><StateBox title="Timetable view is per student">Staff record changes under RECORD A CHANGE; the log is below.</StateBox><div className="ext-rule" /><ChangeLog /></> : <div className="ext-stack"><Answer /><h2 className="ext-h2">This week</h2><Week lowBw={lowBw} /></div>) : null}
          {tab === "ATTENDANCE" ? (staff ? <StateBox title="Shown to students">Each student sees their own register with cancellations marked.</StateBox> : <Adjusted lowBw={lowBw} />) : null}
          {tab === "MESS" ? <Menus lowBw={lowBw} /> : null}
          {tab === "STAFF" ? (<>
            <div className="ext-grid">
              {isAdmin(user) ? <div className="ext-card ext-card-strong"><div className="ci-label" style={{ marginBottom: 10 }}>Class change (academic office)</div><ChangeForm user={user} /></div> : <StateBox title="Class changes are recorded by the academic office">This system has no faculty role; administrators record changes.</StateBox>}
              {isAdmin(user) || user.role === "MESS_MANAGER" ? <div className="ext-card"><div className="ci-label" style={{ marginBottom: 10 }}>Mess menu change</div><MenuForm user={user} /></div> : null}
              <div className="ext-card" style={{ gridColumn: "1 / -1" }}><div className="ci-label" style={{ marginBottom: 10 }}>Recorded changes</div><ChangeLog /></div>
            </div>
            {/* EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): planned shutdowns and the propagation log. */}
            {isAdmin(user) || user.role === "FACILITY_MANAGER" ? <ShutdownForm /> : null}
            <PropagationLog />
          </>) : null}
        </>
      )}
    </div>
  );
}
