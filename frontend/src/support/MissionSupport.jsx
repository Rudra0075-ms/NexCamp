import React, { useCallback, useEffect, useState } from "react";
import { BarList, Columns, Skeleton, StateBox, Tag } from "../components/intel/kit.jsx";
import { support } from "./api.js";
import "../components/intel/intel.css";
import "../ext/ext.css";
import "./support.css";

/*
 * 10 Mission Control — Student Support Overview and the support queue.
 *
 *   ADMIN       aggregate counts only, with small counts hidden by the API
 *   COUNSELLOR  the same overview with exact counts, plus the case queue:
 *               Received → Assigned → Contacted → Follow-up → Resolved
 *
 * No other role renders this panel (see SupportEntry.jsx), and the API refuses
 * them anyway. Nothing is cached in the browser.
 */

const STATUS_LABEL = { REQUESTED: "Received", ASSIGNED: "Assigned", CONTACTED: "Contacted", FOLLOW_UP: "Follow-up" };
const NEXT_LABEL = { ASSIGNED: "Assign to me", CONTACTED: "Mark contacted", FOLLOW_UP: "Schedule follow-up", RESOLVED: "Resolve" };
const OUTCOME_LABEL = {
  SUPPORT_COMPLETED: "Support completed",
  REFERRED_TO_PROFESSIONAL: "Referred to a qualified professional",
  STUDENT_DECLINED: "Student declined",
  NO_RESPONSE: "No response"
};
const TIME_LABEL = { ANY: "any time", MORNING: "mornings", AFTERNOON: "afternoons", EVENING: "evenings" };

function useLoad(fn, deps) {
  const [q, setQ] = useState({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setQ((s) => ({ ...s, loading: true }));
    fn().then((data) => alive && setQ({ data, error: null, loading: false })).catch((error) => alive && setQ((s) => ({ data: s.data, error, loading: false })));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...q, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export default function MissionSupport({ user, live }) {
  const team = user.role === "COUNSELLOR";
  const overview = useLoad(() => (live ? support.overview(30) : Promise.reject(Object.assign(new Error("Backend offline"), { status: 0 }))), [live]);

  return (
    <div className="ci sp-mission" style={{ maxWidth: "none", margin: "44px 0 0", padding: "24px 0 0", borderTop: "1px solid var(--color-divider)" }}>
      <div className="ci-row ci-between" style={{ alignItems: "baseline" }}>
        <div style={{ fontSize: 11, letterSpacing: ".2em", color: "var(--color-muted)", fontWeight: 700 }}>STUDENT SUPPORT OVERVIEW · SILENT SUPPORT SYSTEM</div>
        <span className="ci-meta">{team ? "Student support team view" : "Aggregate only · individual requests are visible to the support team"}</span>
      </div>
      <h2 style={{ fontSize: "clamp(22px, 3vw, 34px)", letterSpacing: "-.02em", margin: "8px 0 16px" }}>Early support, handed to people — and followed up.</h2>
      <Overview q={overview} />
      {team ? <Queue onChange={overview.reload} /> : null}
    </div>
  );
}

function Overview({ q }) {
  if (q.error && !q.data) {
    return <StateBox kind="error" title={q.error.status === 0 ? "Support overview unavailable offline" : "Could not load the support overview"} onRetry={q.reload}>{q.error.status === 0 ? "Nothing is shown rather than invented numbers." : q.error.message}</StateBox>;
  }
  if (!q.data) return <Skeleton lines={4} />;
  const d = q.data;
  const k = d.suppressedBelow;
  const show = (v) => (v === null ? `<${k}` : v === undefined ? "—" : String(v));
  const kpis = [
    ["Support requests", d.kpis.requests, `last ${d.windowDays} days`],
    ["Open now", d.kpis.open, "awaiting a person or in progress"],
    ["Pending follow-ups", d.kpis.pendingFollowUps, "scheduled or due"],
    ["Completed", d.kpis.completed, `resolved in ${d.windowDays} days`],
    ["Students requesting", d.kpis.studentsRequesting, "distinct students"],
    ["Median time to first contact", d.kpis.medianHoursToContact === null ? null : `${d.kpis.medianHoursToContact} h`, "request → contacted"]
  ];
  // A hidden (suppressed) count is null: drawn as an empty bar and labelled "<k".
  const statusData = Object.entries(d.byStatus).map(([key, value]) => ({ label: STATUS_LABEL[key] || key, value }));
  const bandData = Object.entries(d.checkInBands).map(([key, value]) => ({ label: d.bandLabels[key], value, highlight: key === "IMMEDIATE_ATTENTION" && value > 0 }));

  return (
    <div style={{ opacity: q.loading ? 0.65 : 1, transition: "opacity .25s" }}>
      <div className="ci-strip" style={{ marginTop: 0 }}>
        {kpis.map(([label, value, sub]) => (
          <div key={label}>
            <div className="ci-label">{label}</div>
            <div className="ci-big" style={{ fontSize: "clamp(30px, 3.4vw, 44px)", marginTop: 8 }}>{value === null && label.startsWith("Median") ? "—" : show(value)}</div>
            <div className="ci-meta" style={{ marginTop: 6 }}>{sub}</div>
          </div>
        ))}
      </div>
      <div className="ci-row" style={{ gap: 8, marginTop: 10 }}>
        <Tag kind="ACTUAL DATA">{d.kind}</Tag>
        <span className="ci-meta">{d.method} · {d.privacy}</span>
      </div>

      <div className="ext-grid" style={{ marginTop: 18 }}>
        <div className="ext-card">
          <div className="ci-label">FOLLOW-UP STATUS · OPEN REQUESTS</div>
          <div style={{ marginTop: 12 }}>
            <BarList data={statusData} format={show} />
          </div>
          <div className="ci-label" style={{ marginTop: 16 }}>OUTCOMES · {d.windowDays} DAYS</div>
          <ul className="ext-list" style={{ marginTop: 8 }}>
            {Object.entries(d.outcomes).map(([key, value]) => (
              <li key={key} className="ci-row ci-between"><span className="ci-body" style={{ fontSize: 13 }}>{OUTCOME_LABEL[key]}</span><b className="ci-num">{show(value)}</b></li>
            ))}
          </ul>
        </div>
        <div className="ext-card">
          <div className="ci-label">REQUESTS PER WEEK</div>
          <div style={{ marginTop: 12 }}>
            <Columns data={d.weekly.map((w) => ({ label: new Date(w.week).toLocaleDateString("en-IN", { day: "numeric", month: "short" }), value: w.requests }))} height={130} format={(v) => (v === null ? `<${k}` : String(v))} />
          </div>
          <div className="ci-label" style={{ marginTop: 16 }}>CHECK-IN SUPPORT LEVELS · {d.windowDays} DAYS</div>
          <div style={{ marginTop: 10 }}>
            <BarList data={bandData} format={show} />
          </div>
          <p className="ci-meta" style={{ marginTop: 8 }}>Support-routing levels, not diagnoses. No individual is shown.</p>
        </div>
        <div className="ext-card ext-card-accent">
          <div className="ci-row" style={{ gap: 8 }}><Tag kind="RECOMMENDED ACTION">SUPPORT INSIGHT</Tag></div>
          <ul className="sp-reasons" style={{ marginTop: 10 }}>
            {d.insights.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="ci-meta" style={{ marginTop: 8 }}>Recommendations for the support team. The system assists people; it does not replace qualified professionals.</p>
        </div>
      </div>
    </div>
  );
}

function Queue({ onChange }) {
  const [closed, setClosed] = useState(false);
  const q = useLoad(() => support.queue(closed), [closed]);
  const refresh = () => { q.reload(); onChange?.(); };

  return (
    <div style={{ marginTop: 28 }}>
      <div className="ci-row ci-between">
        <h3 className="ci-h3">Support queue</h3>
        <div className="ci-seg" role="group" aria-label="Which requests">
          <button type="button" aria-pressed={!closed} onClick={() => setClosed(false)}>Open</button>
          <button type="button" aria-pressed={closed} onClick={() => setClosed(true)}>All</button>
        </div>
      </div>
      <p className="ci-meta" style={{ margin: "6px 0 12px" }}>Visible only to the student support team. Keep notes short and non-clinical.</p>
      {q.error && !q.data ? <StateBox kind="error" title="Could not load the support queue" onRetry={q.reload}>{q.error.message}</StateBox> : null}
      {!q.data && !q.error ? <Skeleton lines={4} /> : null}
      {q.data && !q.data.cases.length ? <StateBox title="No open support requests">New requests and due follow-ups appear here, and in your notifications.</StateBox> : null}
      {q.data?.cases.length ? (
        <div className="ext-grid">
          {q.data.cases.map((row) => <CaseCard key={row.id} row={row} onMoved={refresh} />)}
        </div>
      ) : null}
    </div>
  );
}

function CaseCard({ row, onMoved }) {
  const [action, setAction] = useState(null);
  const [note, setNote] = useState(row.teamNote || "");
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState("SUPPORT_COMPLETED");
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function go(status) {
    setBusy(true);
    setError(null);
    try {
      const body = { status, note };
      if (status === "CONTACTED" && message.trim()) body.message = message.trim();
      if (status === "FOLLOW_UP") body.followUpDays = days;
      if (status === "RESOLVED") body.outcome = outcome;
      await support.move(row.id, body);
      setAction(null);
      onMoved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const who = row.student ? `${row.student.name} · ${row.student.studentId}` : "Anonymous student";
  return (
    <article className={`ext-card ${row.urgent ? "sp-urgent" : ""}`}>
      <div className="ci-row ci-between">
        <span className="ci-label">{row.reference}</span>
        <div className="ci-row" style={{ gap: 6 }}>
          {row.urgent ? <Tag kind="CRITICAL">URGENT</Tag> : null}
          {row.followUpDue ? <Tag kind="WATCH">FOLLOW-UP DUE</Tag> : null}
          <Tag kind="muted">{row.statusLabel}</Tag>
        </div>
      </div>
      <h3>{who}</h3>
      <div className="ci-meta">
        {row.preferenceLabel} · prefers {TIME_LABEL[row.preferredTime] || "any time"}
        {row.student?.hostelName ? ` · ${row.student.hostelName}` : ""} · {new Date(row.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        {row.assignedName ? ` · with ${row.assignedToMe ? "you" : row.assignedName}` : ""}
      </div>
      <div className="ci-meta" style={{ marginTop: 4 }}>
        Check-in level: <b>{row.bandLabel}</b>{row.repeatedDifficulty ? " · reported difficulty more than once" : ""}
        {row.followUpAt ? ` · follow-up ${new Date(row.followUpAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
      </div>

      <ol className="sp-steps sp-steps-sm" aria-label="Progress">
        {row.steps.map((step) => (
          <li key={step.key} className={`${step.done ? "done" : ""} ${step.current ? "now" : ""}`}><i aria-hidden="true" /><span>{step.label}</span></li>
        ))}
      </ol>

      <div className="sp-insight">
        <Tag kind="RECOMMENDED ACTION">RECOMMENDED ACTION</Tag>
        <p className="ci-body" style={{ margin: "6px 0 0", fontSize: 13 }}>{row.insight.text}</p>
      </div>

      {row.outcome ? <p className="ci-meta" style={{ marginTop: 8 }}>Outcome: <b>{OUTCOME_LABEL[row.outcome]}</b></p> : null}

      {row.next.length ? (
        <div className="ext-actions">
          {row.next.map((status) => (
            <button key={status} type="button" className={status === row.next[0] ? "btn btn-primary" : "btn btn-secondary"} disabled={busy} onClick={() => (status === "ASSIGNED" ? go(status) : setAction(action === status ? null : status))}>
              {NEXT_LABEL[status]}
            </button>
          ))}
        </div>
      ) : null}

      {action ? (
        <div className="sp-confirm">
          {action === "CONTACTED" ? (
            <label className="ext-field">
              <span className="ci-label">MESSAGE TO THE STUDENT'S INBOX (OPTIONAL)</span>
              <input className="ci-input" maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Free tomorrow at 4 pm, Counselling Room 2?" />
            </label>
          ) : null}
          {action === "FOLLOW_UP" ? (
            <div className="ext-chips">
              {[[1, "1 day"], [3, "3 days"], [7, "1 week"], [14, "2 weeks"]].map(([n, label]) => <button key={n} type="button" className="ci-chip" aria-pressed={days === n} onClick={() => setDays(n)}>{label}</button>)}
            </div>
          ) : null}
          {action === "RESOLVED" ? (
            <label className="ext-field">
              <span className="ci-label">OUTCOME</span>
              <select className="ci-select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {Object.entries(OUTCOME_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="ext-field" style={{ marginTop: 8 }}>
            <span className="ci-label">TEAM NOTE (SUPPORT TEAM ONLY · NO CLINICAL DETAIL)</span>
            <input className="ci-input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="ext-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => go(action)}>{busy ? "Saving…" : `Confirm · ${NEXT_LABEL[action]}`}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setAction(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {error ? <div className="ci-result ci-result-err" role="alert">{error}</div> : null}
    </article>
  );
}
