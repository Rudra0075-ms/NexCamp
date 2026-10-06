import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import {
  AnimatedNumber, Guard, AskBox, Columns, Confidence, Drawer, Evidence, LineChart, Section, StateBox, Tag,
  fmtPct, signed, title, useApi, useDebounced
} from "./kit.jsx";
import "./intel.css";

/*
 * 03 — Attendance Intelligence Center.
 * "Why is my attendance changing, what is my risk, and what happens if I
 * change my behaviour?" — answered from GET /api/attendance/me/intelligence and
 * POST /api/attendance/simulate. The simulator never writes a record.
 */

const STATUS_CODE = { PRESENT: "P", LATE: "L", ABSENT: "A", LEAVE: "V" };
const STATUS_LABEL = { P: "Present", L: "Late", A: "Absent", V: "Leave" };

function scrollToPanel(panel) {
  const el = document.getElementById(`ci-att-${panel}`);
  if (el) el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

export default function AttendanceIntel({ live, signedIn, focus, onFocusDone, onNavigate }) {
  const [windowDays, setWindowDays] = useState(14);
  const q = useApi(`attendance:intel:${windowDays}`, () => api.attendanceIntelligence(windowDays), { enabled: live && signedIn });

  // Simulator + table state live here so a dashboard link can preset them.
  const [selected, setSelected] = useState(null);
  const [sim, setSim] = useState({ subject: "", miss: 2, attend: 0 });

  useEffect(() => {
    if (!focus || !q.data) return;
    if (focus.subject) setSelected(focus.subject);
    if (focus.panel === "simulator") {
      setSim((prev) => ({
        subject: focus.subject ?? prev.subject,
        miss: focus.miss !== undefined ? focus.miss : prev.miss,
        attend: focus.attend !== undefined ? focus.attend : prev.attend
      }));
    }
    const t = setTimeout(() => {
      scrollToPanel(focus.panel || "overview");
      onFocusDone?.();
    }, 60);
    return () => clearTimeout(t);
  }, [focus, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulateSubject = (subject) => {
    setSim((prev) => ({ ...prev, subject }));
    setTimeout(() => scrollToPanel("simulator"), 30);
  };

  return (
    <div className="ci">
      <header className="ci-head">
        <div>
          <div className="ci-kicker">03 — Attendance intelligence center</div>
          <h1 className="ci-h1">Attendance is a pattern, not a percentage.</h1>
          <div className="ci-meta">
            {q.data?.dataRange ? `Register ${q.data.dataRange.from} → ${q.data.dataRange.to} · ${q.data.dataRange.sessions} classes` : "Your attendance register"}
          </div>
        </div>
        <div className="ci-row" style={{ gap: 12 }}>
          <span className="ci-label">Compare the last</span>
          <div className="ci-seg" role="group" aria-label="Comparison window">
            {[7, 14, 30].map((d) => <button key={d} type="button" aria-pressed={windowDays === d} onClick={() => setWindowDays(d)}>{d} DAYS</button>)}
          </div>
        </div>
      </header>

      <Section q={q} live={live} needsAuth signedIn={signedIn} lines={6} loadingSteps={["Reading your register", "Classifying your pattern", "Comparing subjects", "Building projections"]}>
        {(a) => (a.empty ? (
          <StateBox title="No attendance recorded yet">{a.message}</StateBox>
        ) : (
          <>
            <Guard name="Attendance overview"><Overview a={a} /></Guard>
            <Guard name="Trend"><Trend a={a} /></Guard>
            <Guard name="Subject analysis"><Subjects a={a} selected={selected} onSelect={setSelected} onSimulate={simulateSubject} /></Guard>
            <Guard name="Why-analysis"><Why a={a} /></Guard>
            <Guard name="Attendance simulator"><Simulator a={a} sim={sim} setSim={setSim} live={live} /></Guard>
            <Guard name="Attendance timeline"><Timeline a={a} initialSubject={focus?.panel === "timeline" ? focus.subject : null} /></Guard>
          </>
        ))}
      </Section>

      <section className="ci-section" id="ci-att-ask">
        <Guard name="Ask about attendance"><AskBox
          domain="ATTENDANCE"
          heading="Ask about your attendance"
          placeholder="e.g. What happens if I miss 3 DBMS classes?"
          live={live}
          signedIn={signedIn}
          onNavigate={(page, f) => {
            if (page === "attendance") {
              if (f?.subject) setSelected(f.subject);
              if (f?.panel === "simulator") setSim((prev) => ({ subject: f.subject ?? "", miss: f.miss ?? prev.miss, attend: f.attend ?? prev.attend }));
              scrollToPanel(f?.panel || "overview");
            } else onNavigate?.(page, f);
          }}
          suggestions={["Why did my attendance fall this month?", "What happens if I miss 3 classes?", "Which days did I have the lowest attendance?", "What is causing my attendance risk?"]}
        /></Guard>
      </section>
    </div>
  );
}

// ---- overview ---------------------------------------------------------------------

function Overview({ a }) {
  const [open, setOpen] = useState(false);
  const c = a.classification;
  return (
    <section className="ci-section" id="ci-att-overview">
      <div className="ci-split">
        <div>
          <div className="ci-row" style={{ gap: 8 }}><Tag kind="CURRENT STATUS">Current status</Tag><Tag kind={a.status}>{a.status}</Tag><Tag kind={a.risk}>{`RISK ${a.risk}`}</Tag></div>
          <div className="ci-row" style={{ alignItems: "flex-end", gap: 28, marginTop: 12 }}>
            <div className="ci-big" style={{ fontSize: "clamp(64px, 9vw, 120px)", color: a.eligible ? "var(--color-text)" : "var(--color-accent)" }}>
              <AnimatedNumber value={a.overall} suffix="%" />
            </div>
            <div className="ci-kv" style={{ minWidth: 200, paddingBottom: 10 }}>
              <span>Classes attended</span><span>{a.attendedClasses}</span>
              <span>Classes missed</span><span>{a.missedClasses}</span>
              <span>Late marks</span><span>{a.lateCount}</span>
              <span>Leave (counts as missed)</span><span>{a.leaveCount}</span>
            </div>
          </div>
          <div style={{ marginTop: 16, maxWidth: 560 }}>
            <div className="ci-bar" style={{ height: 14 }} aria-label={`${a.overall}% against a ${a.threshold}% requirement`}>
              <i style={{ width: `${a.overall}%`, background: a.eligible ? "var(--color-text)" : "var(--color-accent)" }} />
              <b style={{ left: `${a.threshold}%` }} />
            </div>
            <div className="ci-row ci-between ci-meta" style={{ marginTop: 6 }}>
              <span>0%</span>
              <span style={{ color: "var(--color-accent-700)", fontWeight: 700 }}>{a.threshold}% required</span>
              <span>100%</span>
            </div>
          </div>
          <p className="ci-body" style={{ marginTop: 12 }}>
            {a.eligible
              ? <>You are <b>{(a.overall - a.threshold).toFixed(1)} points above</b> the bar and can miss <b>{a.classesCanMiss}</b> more class{a.classesCanMiss === 1 ? "" : "es"} before dropping below it.</>
              : <>You are <b>{(a.threshold - a.overall).toFixed(1)} points below</b> the bar. <b>{a.classesToThreshold}</b> consecutive attended classes bring you back to {a.threshold}%.</>}
          </p>
        </div>

        <div className="ci-panel ci-panel-strong">
          <div className="ci-row ci-between">
            <Tag kind="AI CLASSIFICATION">Rule classification</Tag>{/* REEL HOOK (see CHANGES-REEL.md): visible label only; the style key is unchanged */}
            <Confidence value={c.confidence} basis={c.confidenceBasis} />
          </div>
          <div className="ci-label" style={{ marginTop: 14 }}>Attendance pattern</div>
          <div className="ci-big" style={{ fontSize: "clamp(30px, 3.4vw, 44px)", marginTop: 4, color: c.pattern === "DECLINING" ? "var(--color-accent)" : c.pattern === "IMPROVING" ? "var(--ci-ok)" : "var(--color-text)" }}>{c.pattern}</div>
          <div className="ci-label" style={{ marginTop: 14 }}>Why?</div>
          <ul className="ci-points" style={{ marginTop: 8 }}>
            {c.reasons.map((r) => <li key={r}>{r}</li>)}
            {a.why.bySubject[0] ? <li>{title(a.why.bySubject[0].subject)} contributes most to the recent absences ({a.why.bySubject[0].missed}).</li> : null}
          </ul>
          <div className="ci-row" style={{ marginTop: 14, gap: 14 }}>
            <button type="button" className="ci-link" onClick={() => setOpen(true)}>View evidence</button>
            <button type="button" className="ci-link ci-link-ink" onClick={() => scrollToPanel("why")}>Why did it change?</button>
          </div>
        </div>
      </div>

      {a.semester ? (
        <div className="ci-strip" style={{ marginTop: 20 }}>
          <div><div className="ci-label">Classes remaining this semester</div><div className="ci-big" style={{ fontSize: 34, marginTop: 8 }}>{a.semester.remaining}</div><div className="ci-meta">of {a.semester.planned} scheduled</div></div>
          <div><Tag kind="PROJECTED STATUS">Projected · recent rate</Tag><div className="ci-big" style={{ fontSize: 34, marginTop: 8, color: a.semester.projectedAtRecentRate < a.threshold ? "var(--color-accent)" : "var(--color-text)" }}>{fmtPct(a.semester.projectedAtRecentRate)}</div><div className="ci-meta">if you keep attending {fmtPct(a.semester.recentRate)} of classes</div></div>
          <div><Tag kind="PROJECTED STATUS">Projected · attend all</Tag><div className="ci-big" style={{ fontSize: 34, marginTop: 8 }}>{fmtPct(a.semester.projectedIfAttendAll)}</div><div className="ci-meta">the best case from here</div></div>
          <div><div className="ci-label">Needed from here</div><div className="ci-big" style={{ fontSize: 34, marginTop: 8 }}>{a.semester.neededShareOfRemaining === null ? "—" : fmtPct(a.semester.neededShareOfRemaining)}</div><div className="ci-meta">{a.semester.neededShareOfRemaining === null ? `${a.threshold}% is no longer reachable this semester` : `of remaining classes to finish at ${a.threshold}%`}</div></div>
        </div>
      ) : null}

      <Drawer open={open} onClose={() => setOpen(false)} heading={`Pattern: ${c.pattern}`}>
        <Evidence
          dataConsidered={[`Attendance register · ${a.totalClasses} classes, ${a.subjects.length} subjects`, `Last ${a.windowDays} days (${c.recent.held} classes) vs the ${a.windowDays} before (${c.prior.held} classes)`, `Weekly rates across ${c.weekly.length} weeks`]}
          pattern={c.pattern}
          reasons={c.reasons}
          rows={c.weekly.map((w) => ({ label: `Week of ${w.week}`, value: `${w.attended}/${w.held} · ${fmtPct(w.rate)}` }))}
          rule={c.rule}
          confidence={c.confidence}
          basis={c.confidenceBasis}
          method={a.methods.classification}
        />
      </Drawer>
    </section>
  );
}

// ---- trend -------------------------------------------------------------------------

function cumulativeFromSessions(sessions) {
  const byDay = new Map();
  for (const s of sessions) {
    const day = s.date.slice(0, 10);
    const row = byDay.get(day) || { day, held: 0, attended: 0 };
    row.held += 1;
    if (s.status === "PRESENT" || s.status === "LATE") row.attended += 1;
    byDay.set(day, row);
  }
  let h = 0;
  let at = 0;
  return [...byDay.values()].sort((x, y) => x.day.localeCompare(y.day)).map((r) => {
    h += r.held;
    at += r.attended;
    return { label: r.day.slice(5), value: Math.round((at / h) * 1000) / 10 };
  });
}

function Trend({ a }) {
  const [view, setView] = useState("cumulative");
  const [subject, setSubject] = useState("");
  const points = useMemo(() => {
    if (subject) {
      const s = a.subjects.find((row) => row.subject === subject);
      return s ? cumulativeFromSessions(s.sessions) : [];
    }
    if (view === "weekly") return a.weekly.map((w) => ({ label: `wk ${w.week.slice(5)}`, value: w.rate, extra: `${w.attended}/${w.held}` }));
    if (view === "monthly") return a.monthly.map((m) => ({ label: m.month, value: m.rate, extra: `${m.attended}/${m.held}` }));
    return a.trend.map((t) => ({ label: t.date.slice(5), value: t.cumulative }));
  }, [a, view, subject]);
  const windowStart = a.trend.findIndex((t) => new Date(t.date) > new Date(Date.now() - a.windowDays * 864e5));

  return (
    <section className="ci-section" id="ci-att-trend">
      <div className="ci-section-head">
        <h3 className="ci-h3">Trend</h3>
        <div className="ci-row" style={{ gap: 10 }}>
          <label className="ci-sr" htmlFor="ci-trend-subject">Subject</label>
          <select id="ci-trend-subject" className="ci-select" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All subjects</option>
            {a.subjects.map((s) => <option key={s.subject} value={s.subject}>{title(s.subject)}</option>)}
          </select>
          <div className="ci-seg" role="group" aria-label="Trend view">
            {[["cumulative", "CUMULATIVE"], ["weekly", "WEEKLY"], ["monthly", "MONTHLY"]].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={!subject && view === k} disabled={!!subject && k !== "cumulative"} onClick={() => { setView(k); }}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="ci-panel">
        <div className="ci-legend" style={{ marginBottom: 8 }}>
          <span><i style={{ background: "var(--color-text)" }} />{subject ? `${title(subject)} · cumulative` : view === "cumulative" ? "Semester to date (cumulative)" : view === "weekly" ? "Attended share each week" : "Attended share each month"}</span>
          <span><i style={{ background: "var(--color-accent)" }} />{a.threshold}% requirement</span>
          {!subject && view === "cumulative" && windowStart > 0 ? <span><i style={{ background: "var(--color-accent)", opacity: 0.25, height: 10 }} />Last {a.windowDays} days</span> : null}
        </div>
        {view === "monthly" && !subject && points.length < 2 ? (
          <StateBox title="Not enough months yet">Your register covers {points.length} month{points.length === 1 ? "" : "s"} ({a.dataRange.from} → {a.dataRange.to}). A monthly trend needs at least two.</StateBox>
        ) : (
          <LineChart
            labels={points.map((p) => p.label)}
            series={[{ label: subject ? title(subject) : "Attendance", values: points.map((p) => p.value), color: "var(--color-text)", dots: view !== "cumulative" }]}
            yMin={Math.min(40, ...points.map((p) => p.value))}
            yMax={100}
            threshold={a.threshold}
            bands={!subject && view === "cumulative" && windowStart > 0 ? [{ label: "window", from: windowStart, to: a.trend.length - 1 }] : []}
            height={240}
            ariaLabel="Attendance trend"
          />
        )}
      </div>
    </section>
  );
}

// ---- subjects -----------------------------------------------------------------------

function Subjects({ a, selected, onSelect, onSimulate }) {
  return (
    <section className="ci-section" id="ci-att-subjects">
      <div className="ci-section-head"><h3 className="ci-h3">Subject analysis</h3><span className="ci-meta">Sorted by attendance · select a subject for detail</span></div>
      <div className="ci-table-wrap">
        <table className="ci-table">
          <thead>
            <tr><th>Subject</th><th style={{ width: "32%" }}>Attendance</th><th>Trend</th><th>Risk</th><th>Pattern</th><th>Can miss / need</th></tr>
          </thead>
          <tbody>
            {a.subjects.map((s) => {
              const open = selected === s.subject;
              return (
                <React.Fragment key={s.subject}>
                  <tr className={`ci-rowbtn ${open ? "sel" : ""}`} tabIndex={0} aria-expanded={open} onClick={() => onSelect(open ? null : s.subject)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(open ? null : s.subject); } }}>
                    <td><b>{title(s.subject)}</b><div className="ci-meta">{s.subjectCode || ""}</div></td>
                    <td>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(60px, 1fr) 56px", gap: 10, alignItems: "center" }}>
                        <div className="ci-bar"><i style={{ width: `${s.percentage}%`, background: s.percentage < a.threshold ? "var(--color-accent)" : "var(--color-text)" }} /><b style={{ left: `${a.threshold}%` }} /></div>
                        <b>{fmtPct(s.percentage)}</b>
                      </div>
                      <div className="ci-meta">{s.attendedClasses}/{s.totalClasses}</div>
                    </td>
                    <td><span className={s.trend === "DOWN" ? "ci-arrow-down" : s.trend === "UP" ? "ci-arrow-up" : "ci-arrow-flat"} style={{ fontSize: 18 }} aria-label={s.trend}>{s.trend === "DOWN" ? "↓" : s.trend === "UP" ? "↑" : "→"}</span></td>
                    <td><Tag kind={s.risk}>{s.risk}</Tag></td>
                    <td><Tag kind={s.pattern}>{s.pattern}</Tag></td>
                    <td className="ci-meta">{s.percentage >= a.threshold ? `can miss ${s.classesCanMiss}` : `need ${s.classesToThreshold} in a row`}</td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <SubjectDetail s={s} a={a} onSimulate={onSimulate} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubjectDetail({ s, a, onSimulate }) {
  return (
    <div className="ci-ai-block" style={{ margin: "4px 0 14px", animation: "ci-rise .3s var(--ci-ease) both" }}>
      <div className="ci-grid-2">
        <div>
          <Tag kind="AI ANALYSIS">{`${title(s.subject)} · analysis`}</Tag>
          <div className="ci-kv" style={{ marginTop: 12, maxWidth: 360 }}>
            <span>Last {a.windowDays} days</span><span>{fmtPct(s.recentRate)}</span>
            <span>The {a.windowDays} days before</span><span>{fmtPct(s.priorRate)}</span>
            <span>Missed in the last {a.windowDays} days</span><span>{s.missedInWindow}</span>
            <span>Late marks / leave</span><span>{s.late} / {s.leave}</span>
            {s.remaining !== null ? <><span>Classes left this semester</span><span>{s.remaining}</span></> : null}
          </div>
          <ul className="ci-points" style={{ marginTop: 12 }}>{s.patternReasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {s.linkedIncident ? (
            <p className="ci-meta" style={{ marginTop: 10 }}>Linked by the system to incident {s.linkedIncident.reference || ""} {s.linkedIncident.title ? `· ${s.linkedIncident.title}` : ""} — absences that coincide with an open problem in your block.</p>
          ) : null}
        </div>
        <div>
          <div className="ci-label" style={{ marginBottom: 8 }}>Every class, oldest first</div>
          <div className="ci-reg" role="list" aria-label={`${s.subject} register`}>
            {s.sessions.map((x) => {
              const code = STATUS_CODE[x.status] || "P";
              return <span key={x.date} role="listitem" className={code} title={`${x.date.slice(0, 10)} ${x.slot} · ${STATUS_LABEL[code]}`} aria-label={`${x.date.slice(0, 10)} ${STATUS_LABEL[code]}`} />;
            })}
          </div>
          <div className="ci-legend" style={{ marginTop: 8 }}>
            <span><i style={{ background: "var(--color-neutral-500)", height: 8 }} />Present</span>
            <span><i style={{ background: "var(--color-warn)", height: 8 }} />Late</span>
            <span><i style={{ background: "var(--color-accent)", height: 8 }} />Absent</span>
            <span><i style={{ background: "var(--color-accent-300)", height: 8 }} />Leave</span>
          </div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 14, fontSize: 11, letterSpacing: ".1em", padding: "10px 14px" }} onClick={() => onSimulate(s.subject)}>SIMULATE {s.subject} →</button>
        </div>
      </div>
    </div>
  );
}

// ---- why ------------------------------------------------------------------------------

function Why({ a }) {
  const w = a.why;
  const [open, setOpen] = useState(null);
  return (
    <section className="ci-section" id="ci-att-why">
      <div className="ci-section-head"><h3 className="ci-h3">Why did my attendance change?</h3><Tag kind="AI ANALYSIS">AI analysis</Tag></div>
      {w.insufficient ? (
        <StateBox title="Not enough recent classes">Only {w.held} classes in the last {w.windowDays} days — too few to explain a change.</StateBox>
      ) : (
        <div className="ci-split">
          <div className="ci-ai-block">
            <p className="ci-answer-text">
              {w.change === null
                ? `Your register starts on ${a.dataRange.from}, so there is nothing before the last ${w.windowDays} days to compare against.`
                : w.change < 0
                  ? `Over the last ${w.windowDays} days your attendance went from ${fmtPct(w.from)} to ${fmtPct(w.to)} (${signed(w.change)} points). You missed ${w.missed} of ${w.held} classes, mainly in:`
                  : `Over the last ${w.windowDays} days your attendance went from ${fmtPct(w.from)} to ${fmtPct(w.to)} (${signed(w.change)} points).${w.missed ? ` The ${w.missed} classes you missed were in:` : ""}`}
            </p>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {w.bySubject.map((row, i) => (
                <li key={row.subject}>
                  <button type="button" className="ci-tile" style={{ width: "100%", display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto", gap: 10, padding: "8px 4px", borderBottom: "1px solid var(--ci-soft)" }} aria-expanded={open === row.subject} onClick={() => setOpen(open === row.subject ? null : row.subject)}>
                    <span className="ci-big" style={{ fontSize: 20, color: "var(--ci-ai)" }}>{i + 1}</span>
                    <span><b>{title(row.subject)}</b><span className="ci-meta" style={{ display: "block" }}>{row.missed} missed class{row.missed === 1 ? "" : "es"}</span></span>
                    <span className="ci-link" aria-hidden="true">{open === row.subject ? "Hide" : "Evidence"}</span>
                  </button>
                  {open === row.subject ? (
                    <div className="ci-kv" style={{ padding: "8px 4px 8px 38px" }}>
                      {row.sessions.flatMap((s) => [<span key={`${s.date}k`}>{s.date} · {s.slot}</span>, <span key={`${s.date}v`}>{title(s.status)}</span>])}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            {w.bySlot[0] && w.missed && w.bySlot[0].missed / w.missed >= 0.5 ? (
              <div className="ci-rec">{w.bySlot[0].missed} of the {w.missed} missed classes were in the {w.bySlot[0].slot} slot — the time of day is a stronger pattern than any one subject.</div>
            ) : null}
            <button type="button" className="ci-link" style={{ marginTop: 12 }} onClick={() => scrollToPanel("timeline")}>View attendance timeline</button>
          </div>
          <div style={{ display: "grid", gap: 20 }}>
            <div>
              <div className="ci-label" style={{ marginBottom: 10 }}>Attended share by time slot · all / last {a.windowDays} days</div>
              <Columns data={a.slotRates.flatMap((s) => [{ label: `${s.slot}`, value: s.rate }, { label: `${s.slot} recent`, value: s.recentRate, highlight: s.recentRate !== null && s.recentRate < a.threshold }])} unit="%" threshold={a.threshold} height={140} />
            </div>
            <div>
              <div className="ci-label" style={{ marginBottom: 10 }}>Attended share by weekday</div>
              <Columns data={a.weekdayRates.filter((d) => d.held).map((d) => ({ label: d.weekday, value: d.rate, highlight: d.rate < a.threshold }))} unit="%" threshold={a.threshold} height={120} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- simulator ------------------------------------------------------------------------

function Stepper({ label, value, onChange, max = 30 }) {
  return (
    <div>
      <div className="ci-label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="ci-stepper">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} aria-label={`Fewer — ${label}`}>−</button>
        <input type="number" inputMode="numeric" min={0} max={max} value={value} aria-label={label} onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          onChange(Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0);
        }} />
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More — ${label}`}>+</button>
      </div>
    </div>
  );
}

function Simulator({ a, sim, setSim, live }) {
  const input = useDebounced(sim, 220);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    setBusy(true);
    const body = { plannedClasses: input.miss + input.attend, attendPlanned: input.attend };
    if (input.subject) body.subject = input.subject;
    api.simulateAttendance(body)
      .then((r) => { if (alive) { setRes(r); setErr(null); } })
      .catch((e) => { if (alive) setErr(e.message || "Simulation failed"); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [JSON.stringify(input), live]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = input.subject ? a.subjects.find((s) => s.subject === input.subject) : null;
  const current = base ? base.percentage : a.overall;
  const ok = res ? res.eligibleAfterPlan : null;

  return (
    <section className="ci-section" id="ci-att-simulator">
      <div className="ci-section-head"><h3 className="ci-h3">Attendance simulator</h3><span className="ci-meta">What if I… · calculated by the server · your records are never changed</span></div>
      <div className="ci-split-rev">
        <div className="ci-panel" style={{ display: "grid", gap: 16 }}>
          <div>
            <label className="ci-label" htmlFor="ci-sim-subject" style={{ display: "block", marginBottom: 6 }}>Subject</label>
            <select id="ci-sim-subject" className="ci-select" style={{ width: "100%" }} value={sim.subject} onChange={(e) => setSim({ ...sim, subject: e.target.value })}>
              <option value="">All subjects (overall)</option>
              {a.subjects.map((s) => <option key={s.subject} value={s.subject}>{title(s.subject)} · {fmtPct(s.percentage)}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Stepper label="Miss next" value={sim.miss} onChange={(v) => setSim({ ...sim, miss: v })} />
            <Stepper label="Attend next" value={sim.attend} onChange={(v) => setSim({ ...sim, attend: v })} />
          </div>
          <div className="ci-row" style={{ gap: 6 }}>
            <span className="ci-label">Quick</span>
            {[[1, 0], [2, 0], [3, 0], [0, 5], [2, 5]].map(([m, t]) => (
              <button key={`${m}-${t}`} type="button" className="ci-chip" aria-pressed={sim.miss === m && sim.attend === t} onClick={() => setSim({ ...sim, miss: m, attend: t })}>
                {m ? `miss ${m}` : ""}{m && t ? " · " : ""}{t ? `attend ${t}` : ""}
              </button>
            ))}
          </div>
          <p className="ci-meta" style={{ lineHeight: 1.5 }}>Your percentage after the plan doesn't depend on the order you miss and attend in — only the totals matter.</p>
        </div>

        <div aria-live="polite">
          <div className="ci-vs">
            <div>
              <Tag kind="CURRENT DATA">Current data</Tag>
              <div className="ci-big" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 10 }}>{fmtPct(current)}</div>
              <div className="ci-meta">{base ? `${base.attendedClasses}/${base.totalClasses}` : `${a.attendedClasses}/${a.totalClasses}`} · {base ? title(base.subject) : "all subjects"}</div>
            </div>
            <div className="ci-vs-arrow" aria-hidden="true">→</div>
            <div className="ci-sim-block" style={{ opacity: busy ? 0.65 : 1, transition: "opacity .2s" }}>
              <Tag kind="SIMULATED RESULT">Simulated result</Tag>
              <div className="ci-big" style={{ fontSize: "clamp(40px, 5vw, 64px)", marginTop: 10, color: ok === false ? "var(--color-accent)" : "var(--color-text)" }}>
                {res ? <AnimatedNumber value={res.projected} suffix="%" /> : "—"}
              </div>
              <div className="ci-meta">{res ? `${signed(res.delta)} pts · ${res.explanation}` : err || "Calculating…"}</div>
            </div>
          </div>
          {res ? (
            <>
              <div className={ok ? "ci-panel" : "ci-rec"} style={{ marginTop: 14, fontWeight: 700 }}>
                {ok
                  ? `✓ At or above ${res.threshold}% after this plan.`
                  : `⚠ Below the ${res.threshold}% requirement after this plan${(() => {
                    const after = res.input;
                    for (let n = 1; n <= 200; n += 1) if (((after.attendedClasses + after.attendPlanned + n) / (after.totalClasses + after.plannedClasses + n)) * 100 >= res.threshold) return ` — ${n} consecutive attended classes would recover it.`;
                    return ".";
                  })()}`}
              </div>
              {res.endOfSemester ? (
                <div className="ci-panel" style={{ marginTop: 12 }}>
                  <Tag kind="PROJECTED STATUS">Projected · end of semester</Tag>
                  <div className="ci-row" style={{ gap: 26, marginTop: 10 }}>
                    <div><div className="ci-label">Then attend everything</div><div className="ci-big" style={{ fontSize: 28 }}>{fmtPct(res.endOfSemester.ifAttendAll)}</div></div>
                    {res.endOfSemester.atRecentRate !== null ? <div><div className="ci-label">Then keep your recent rate ({fmtPct(res.endOfSemester.recentRate)})</div><div className="ci-big" style={{ fontSize: 28, color: res.endOfSemester.atRecentRate < res.threshold ? "var(--color-accent)" : "var(--color-text)" }}>{fmtPct(res.endOfSemester.atRecentRate)}</div></div> : null}
                  </div>
                  <div className="ci-meta" style={{ marginTop: 6 }}>{res.endOfSemester.remainingAfterPlan} classes left after this plan · arithmetic projection</div>
                </div>
              ) : null}
              <div className="ci-meta" style={{ marginTop: 10 }}>{res.note}</div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ---- timeline ---------------------------------------------------------------------------

function Timeline({ a, initialSubject }) {
  const [subject, setSubject] = useState(initialSubject || "");
  const [status, setStatus] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(20);

  const rows = a.timeline.filter((r) =>
    (!subject || r.subject === subject) &&
    (status === "ALL" || r.status === status) &&
    (!from || r.day >= from) &&
    (!to || r.day <= to)
  );
  const days = [...new Set(a.timeline.filter((r) => (!from || r.day >= from) && (!to || r.day <= to)).map((r) => r.day))].sort();
  const subjects = subject ? [subject] : a.subjects.map((s) => s.subject);
  const cell = new Map(a.timeline.map((r) => [`${r.subject}|${r.day}`, r]));
  const events = a.events.filter((e) => (!from || e.date >= from) && (!to || e.date <= to) && (!subject || e.text.toUpperCase().includes(subject)));

  return (
    <section className="ci-section" id="ci-att-timeline">
      <div className="ci-section-head"><h3 className="ci-h3">Attendance timeline</h3><Tag kind="ACTUAL DATA">From the register</Tag></div>
      <div className="ci-row" style={{ gap: 10, marginBottom: 14 }}>
        <select className="ci-select" aria-label="Filter by subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">All subjects</option>
          {a.subjects.map((s) => <option key={s.subject} value={s.subject}>{title(s.subject)}</option>)}
        </select>
        <div className="ci-seg" role="group" aria-label="Filter by status">
          {["ALL", "PRESENT", "ABSENT", "LATE", "LEAVE"].map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s}</button>)}
        </div>
        <label className="ci-row" style={{ gap: 6 }}><span className="ci-label">From</span><input className="ci-input" type="date" value={from} min={a.dataRange.from} max={a.dataRange.to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="ci-row" style={{ gap: 6 }}><span className="ci-label">To</span><input className="ci-input" type="date" value={to} min={a.dataRange.from} max={a.dataRange.to} onChange={(e) => setTo(e.target.value)} /></label>
        {(subject || status !== "ALL" || from || to) ? <button type="button" className="ci-link ci-link-ink" onClick={() => { setSubject(""); setStatus("ALL"); setFrom(""); setTo(""); }}>Clear filters</button> : null}
      </div>

      <div className="ci-panel ci-table-wrap">
        <div style={{ display: "grid", gridTemplateColumns: `140px repeat(${days.length}, minmax(16px, 1fr))`, gap: 3, minWidth: 140 + days.length * 19, alignItems: "center" }} role="table" aria-label="Register by subject and date">
          <span />
          {days.map((d, i) => <span key={d} className="ci-meta" style={{ fontSize: 9, textAlign: "center", visibility: i % 3 === 0 ? "visible" : "hidden" }}>{d.slice(5)}</span>)}
          {subjects.map((sub) => (
            <React.Fragment key={sub}>
              <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title(sub)}</span>
              {days.map((d) => {
                const r = cell.get(`${sub}|${d}`);
                const code = r ? STATUS_CODE[r.status] : null;
                const dim = r && status !== "ALL" && r.status !== status;
                return <span key={d} className={`ci-reg`} style={{ display: "block" }}><span className={code || ""} title={r ? `${d} ${r.slot} · ${STATUS_LABEL[code]}` : d} style={{ width: "100%", height: 16, opacity: r ? (dim ? 0.2 : 1) : 0.25, background: r ? undefined : "transparent", border: r ? 0 : "1px solid var(--color-neutral-200)" }} /></span>;
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="ci-grid-2" style={{ marginTop: 18 }}>
        <div>
          <div className="ci-label" style={{ marginBottom: 8 }}>Classes · {rows.length} match</div>
          <div className="ci-rule">
            {rows.slice(0, limit).map((r) => (
              <div key={r.date + r.subject} style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr) auto", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--ci-soft)", alignItems: "center", fontSize: 13 }}>
                <span className="ci-meta">{r.day} · {r.slot}</span>
                <span>{title(r.subject)}</span>
                <Tag kind={r.status === "ABSENT" ? "AT RISK" : r.status === "LEAVE" ? "WATCH" : r.status === "LATE" ? "MEDIUM" : "ACTUAL DATA"}>{r.status}</Tag>
              </div>
            ))}
            {!rows.length ? <p className="ci-body" style={{ padding: "10px 0" }}>No classes match these filters.</p> : null}
          </div>
          {rows.length > limit ? <button type="button" className="ci-link ci-link-ink" style={{ marginTop: 10 }} onClick={() => setLimit(limit + 20)}>Show more</button> : null}
        </div>
        <div>
          <div className="ci-label" style={{ marginBottom: 8 }}>Significant changes</div>
          {events.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {events.map((e) => (
                <div key={e.date + e.text} className="ci-panel" style={{ padding: 12, borderLeft: `3px solid ${e.kind === "RECOVERED" ? "var(--ci-ok)" : e.kind === "LEAVE" ? "var(--color-warn)" : "var(--color-accent)"}` }}>
                  <div className="ci-row ci-between"><Tag kind={e.kind === "RECOVERED" ? "IMPROVING" : e.kind === "LEAVE" ? "WATCH" : "DECLINING"}>{e.kind}</Tag><span className="ci-meta">{e.date}</span></div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>{e.text}</div>
                </div>
              ))}
            </div>
          ) : <p className="ci-body">No significant changes in this range.</p>}
        </div>
      </div>
    </section>
  );
}
