import React, { useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { ExtSection, Kind, Outcome, SourceLine, attempt, dt, hrs, isAdmin, useExt } from "./kit.jsx";

/*
 * Mission Control additions (rendered by one hook after the existing College
 * Adoption & Migration panel). Staff only; every figure carries its label.
 */

function Block({ kicker, title, children }) {
  return (
    <div style={{ marginTop: 44, borderTop: "1px solid var(--color-divider)", paddingTop: 24 }}>
      <div className="ci-kicker">{kicker}</div>
      <h2 style={{ fontSize: "clamp(22px, 3vw, 34px)", letterSpacing: "-.02em", margin: "8px 0 16px" }}>{title}</h2>
      {children}
    </div>
  );
}

// ---- 2A Friction Ledger -------------------------------------------------------------

function BaselineRow({ b, admin, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ hours: b.hours, studentActions: b.studentActions, studentMinutes: b.studentMinutes, source: b.source });
  const [result, setResult] = useState(null);
  const save = async () => {
    const r = await attempt(() => ext.baseline(b.workflow, { hours: Number(form.hours), studentActions: Number(form.studentActions), studentMinutes: Number(form.studentMinutes), source: form.source }), "Baseline updated and audited.");
    setResult(r);
    if (!r.error) {
      setEdit(false);
      onSaved?.();
    }
  };
  return (
    <tr>
      <td><b>{b.task}</b><div className="ci-meta">{b.oldProcess}</div></td>
      {edit ? (
        <>
          <td><input className="ci-input" style={{ width: 80 }} type="number" min="0" step="0.25" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} aria-label="Hours" /></td>
          <td><input className="ci-input" style={{ width: 64 }} type="number" min="0" value={form.studentActions} onChange={(e) => setForm({ ...form, studentActions: e.target.value })} aria-label="Actions" /></td>
          <td><input className="ci-input" style={{ width: 80 }} type="number" min="0" value={form.studentMinutes} onChange={(e) => setForm({ ...form, studentMinutes: e.target.value })} aria-label="Minutes" /></td>
          <td><input className="ci-input" style={{ width: "100%", minWidth: 180 }} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label="Source" /><div className="ext-actions"><button type="button" className="btn btn-primary" onClick={save}>SAVE</button><button type="button" className="btn btn-secondary" onClick={() => setEdit(false)}>CANCEL</button></div><Outcome result={result} /></td>
        </>
      ) : (
        <>
          <td className="ci-num">{hrs(b.hours)}</td>
          <td className="ci-num">{b.studentActions}</td>
          <td className="ci-num">{b.studentMinutes} min</td>
          <td><span className="ci-meta">{b.source}</span>{b.edits > 0 ? <span className="ci-meta"> · edited {b.edits}×</span> : null}{admin ? <div><button type="button" className="ci-link" onClick={() => setEdit(true)}>EDIT</button></div> : null}</td>
        </>
      )}
    </tr>
  );
}

export function FrictionLedger({ user, lowBw }) {
  const [nonce, setNonce] = useState(0);
  const q = useExt(`friction:${nonce}:${lowBw}`, () => ext.friction(false));
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-stack">
          <div className="ci-strip" style={{ marginTop: 0 }}>
            <div><div className="ci-label">Hours saved this week</div><div className="ci-big" style={{ fontSize: 48 }}>{d.totals.hoursSaved}</div><Kind kind="ESTIMATE" /></div>
            <div><div className="ci-label">Per student served</div><div className="ci-big" style={{ fontSize: 48 }}>{d.totals.hoursSavedPerStudent ?? "—"}h</div><span className="ci-meta">{d.totals.students} students · {d.totals.completed} completed items</span></div>
            <div><div className="ci-label">PS07 target</div><div className="ci-big" style={{ fontSize: 48 }}>≥{d.target.reductionPct}%</div><span className="ci-meta">less friction than the old process</span></div>
          </div>
          <div className="ext-table-wrap">
            <table className="ci-table">
              <thead><tr><th>Workflow</th><th>Completed</th><th>Actual median <Kind kind="ACTUAL DATA" /></th><th>Old process <Kind kind="BASELINE ESTIMATE" /></th><th>Saved <Kind kind="ESTIMATE" /></th><th>Reduction</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.workflow}>
                    <td><b>{r.task}</b><div className="ci-meta">{r.workflow}</div></td>
                    <td className="ci-num">{r.completed}</td>
                    <td className="ci-num">{r.actual.medianHours !== undefined ? `${hrs(r.actual.medianHours)} · ${r.actual.medianActions} action${r.actual.medianActions === 1 ? "" : "s"}` : r.actual.note}</td>
                    <td className="ci-num">{r.baseline ? `${hrs(r.baseline.hours)} · ${r.baseline.studentActions} actions` : "—"}</td>
                    <td className="ci-num">{r.saved ? `${r.saved.hours}h (${r.saved.perStudentHours}h / student)` : "—"}</td>
                    <td>{r.saved?.reductionPct !== undefined && r.saved?.reductionPct !== null ? <Tag kind={r.saved.meetsTarget ? "SAFE" : "WATCH"}>{r.saved.reductionPct}%{r.saved.meetsTarget ? " ✓" : ""}</Tag> : <span className="ci-meta">Insufficient data</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ci-meta">{d.totals.basis}</p>
          <details>
            <summary className="ci-label" style={{ cursor: "pointer" }}>Baseline table — {isAdmin(user) ? "editable, every edit audited" : "read-only"}</summary>
            <div className="ext-table-wrap" style={{ marginTop: 10 }}>
              <table className="ci-table">
                <thead><tr><th>Old process</th><th>Turnaround</th><th>Student actions</th><th>Student time</th><th>Source (BASELINE ESTIMATE)</th></tr></thead>
                <tbody>{d.baselines.map((b) => <BaselineRow key={b.workflow} b={b} admin={isAdmin(user)} onSaved={() => setNonce((n) => n + 1)} />)}</tbody>
              </table>
            </div>
          </details>
          <SourceLine method={d.method} source={d.source} note={`window: last ${d.window.days} days`} />
        </div>
      )}
    </ExtSection>
  );
}

// ---- 1E Unified pending queue ------------------------------------------------------------

export function PendingQueue({ lowBw }) {
  const [f, setF] = useState({ department: "", staff: "", kind: "" });
  const q = useExt(`pending:${JSON.stringify(f)}:${lowBw}`, () => ext.pending(f, false));
  const [all, setAll] = useState(false);
  return (
    <ExtSection q={q}>
      {(d) => {
        const maxLoad = Math.max(1, ...d.workload.map((w) => w.total));
        const rows = all ? d.items : d.items.slice(0, lowBw ? 5 : 12);
        return (
          <div className="ext-stack">
            <div className="ext-grid-3">
              <label className="ext-field"><span className="ci-label">Department</span><select className="ci-select" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">All</option>{d.filters.departments.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="ext-field"><span className="ci-label">Staff member</span><select className="ci-select" value={f.staff} onChange={(e) => setF({ ...f, staff: e.target.value })}><option value="">All</option>{d.filters.owners.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="ext-field"><span className="ci-label">Type</span><select className="ci-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">All</option>{d.filters.kinds.map((x) => <option key={x}>{x}</option>)}</select></label>
            </div>
            <div className="ci-strip" style={{ marginTop: 0 }}>
              <div><div className="ci-label">Pending</div><div className="ci-big" style={{ fontSize: 44 }}>{d.total}</div><Kind kind={d.kind} /></div>
              <div><div className="ci-label">Past SLA</div><div className="ci-big" style={{ fontSize: 44, color: d.breached ? "var(--color-accent-700)" : undefined }}>{d.breached}</div></div>
              {d.buckets.map((b) => <div key={b.bucket}><div className="ci-label">Age {b.bucket}</div><div className="ci-big" style={{ fontSize: 44 }}>{b.count}</div></div>)}
            </div>
            <div className="ext-card">
              <div className="ci-label">Workload by owner</div>
              <div className="ext-stack" style={{ marginTop: 10, gap: 8 }}>
                {d.workload.map((w) => (
                  <div key={w.owner}>
                    <div className="ext-row" style={{ justifyContent: "space-between" }}><span className="ci-body">{w.owner}</span><span className="ci-meta">{w.total} open · {w.breached} past SLA · oldest {hrs(w.oldestHours)}</span></div>
                    <div className="ext-meter"><i style={{ width: `${(w.total / maxLoad) * 100}%`, background: w.breached ? "var(--color-accent)" : undefined }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="ext-table-wrap">
              <table className="ci-table">
                <thead><tr><th>Item</th><th>Type</th><th>Owner</th><th>Age</th><th>SLA</th></tr></thead>
                <tbody>{rows.map((i) => <tr key={`${i.kind}${i.id}`}><td><b>{i.reference}</b> {i.title}<div className="ci-meta">{i.department} · {i.status}{i.channel && i.channel !== "APP" ? ` · via ${i.channel}` : ""}</div></td><td>{i.kind}</td><td>{i.owner}<div className="ci-meta">{i.ownerBasis}</div></td><td className="ci-num">{hrs(i.ageHours)} <span className="ci-meta">{i.bucket}</span></td><td><Tag kind={i.sla.state === "BREACHED" ? "CRITICAL" : i.sla.state === "AT_RISK" ? "WATCH" : i.sla.state === "ON_TRACK" ? "SAFE" : "muted"}>{i.sla.state.replace("_", " ")}{i.sla.hours ? ` · ${i.sla.hours}h` : ""}</Tag></td></tr>)}</tbody>
              </table>
            </div>
            {d.items.length > rows.length ? <button type="button" className="ci-link" onClick={() => setAll(true)}>SHOW ALL {d.items.length}</button> : null}
            <SourceLine method={d.method} note="owner = assigned person, else the department queue owner; SLA from each record's own target" />
          </div>
        );
      }}
    </ExtSection>
  );
}

// ---- 2B SMS activity --------------------------------------------------------------------

export function SmsActivity({ lowBw, onOpen }) {
  const q = useExt(`smsact:${lowBw}`, () => ext.smsActivity(lowBw));
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-stack">
          <div className="ext-row"><span className="ext-simulated">INCLUDES SIMULATED INBOUND SMS</span>{d.byCommand.map((c) => <Tag key={c.command} kind="muted">{c.command} {c.count}</Tag>)}{Object.entries(d.byOutcome).map(([k, v]) => <span key={k} className="ci-meta">{k} {v}</span>)}</div>
          <div className="ext-table-wrap">
            <table className="ci-table">
              <thead><tr><th>When</th><th>From</th><th>Message</th><th>Reply</th><th></th></tr></thead>
              <tbody>{d.messages.map((m) => <tr key={m.id}><td className="ci-num">{dt(m.at)}</td><td className="ext-code">{m.phone}{m.student ? <div className="ci-meta">{m.student}</div> : null}</td><td className="ext-code">{m.body}</td><td className="ci-meta">{m.reply}</td><td>{m.simulated ? <Tag kind="SIMULATED">SIMULATED</Tag> : <Tag kind="muted">{m.via}</Tag>}</td></tr>)}</tbody>
            </table>
          </div>
          {d.complaintsFiled.length ? <p className="ci-meta">Complaints filed by SMS: {d.complaintsFiled.map((c) => `${c.reference} (${c.category}, ${c.status})`).join(" · ")}</p> : <p className="ci-meta">No complaints filed by SMS yet.</p>}
          {onOpen ? <button type="button" className="ci-link" onClick={onOpen}>OPEN THE PHONE SIMULATOR</button> : null}
          <SourceLine method={d.method} note={d.note} />
        </div>
      )}
    </ExtSection>
  );
}

// ---- 2C fix metrics ---------------------------------------------------------------------

export function FixMetrics({ lowBw }) {
  const q = useExt(`fixm:${lowBw}`, () => ext.fixMetrics(false));
  return (
    <ExtSection q={q}>
      {(d) => d.departments.length ? (
        <div className="ext-stack">
          <div className="ext-table-wrap">
            <table className="ci-table">
              <thead><tr><th>Department</th><th>Resolved</th><th>Proof-of-fix rate</th><th>Yes / Not fixed / No response / Pending</th><th>Reopen rate</th></tr></thead>
              <tbody>{d.departments.map((r) => <tr key={r.department}><td>{r.department}</td><td className="ci-num">{r.resolved}</td><td className="ci-num">{r.proofRate ?? "—"}% ({r.withProof})</td><td className="ci-num">{r.confirmations.yes} / {r.confirmations.notFixed} / {r.confirmations.noResponse} / {r.confirmations.pending}</td><td>{r.reopenRate === null ? <span className="ci-meta">Insufficient data</span> : <Tag kind={r.reopenRate > 0 ? "WATCH" : "SAFE"}>{r.reopenRate}%</Tag>}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="ci-meta">{d.definitions.proofRate} {d.definitions.reopenRate}</p>
          <div className="ext-row"><Kind kind={d.kind} /><SourceLine method={d.method} /></div>
        </div>
      ) : <StateBox title="Insufficient data">No resolved complaints yet.</StateBox>}
    </ExtSection>
  );
}

// ---- 2D FAQ gaps ------------------------------------------------------------------------

export function FaqGaps() {
  const q = useExt("faqstats-mc", () => ext.faqStats());
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-grid">
          <div className="ext-card"><div className="ci-label">Most asked · {d.totals.asked} questions · {d.totals.answerRate ?? "—"}% answered</div><ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>{d.mostAsked.slice(0, 6).map((m, i) => <li key={i} className="ci-body">{m.question} <span className="ci-meta">× {m.count}</span></li>)}</ol></div>
          <div className="ext-card"><div className="ci-label">Unanswered — add these to the corpus</div>{d.unanswered.length ? <ul className="ext-list" style={{ marginTop: 8 }}>{d.unanswered.slice(0, 6).map((u, i) => <li key={i} className="ci-meta">{u.question}{u.requestReference ? ` → ${u.requestReference}` : ""}</li>)}</ul> : <p className="ci-meta">None.</p>}</div>
        </div>
      )}
    </ExtSection>
  );
}

// ---- 2H adoption extension ----------------------------------------------------------------

export function AdoptionExt() {
  const q = useExt("adoption", () => ext.adoption());
  const [dataset, setDataset] = useState("timetable");
  const [csv, setCsv] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const run = async () => {
    setErr(null);
    try {
      setRes(await ext.adoptionValidate(dataset, csv));
    } catch (e) {
      setRes(null);
      setErr(e.message);
    }
  };
  const template = async () => {
    try {
      const blob = await ext.adoptionTemplate(dataset);
      setCsv(await blob.text());
    } catch (e) {
      setErr(e.message);
    }
  };
  const download = async () => {
    const blob = await ext.adoptionTemplate(dataset);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${dataset}-template.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-stack">
          <p className="ci-body" style={{ margin: 0 }}>Beyond the student list above (whose CSV check is unchanged): the other data a college must bring across, a CSV template for each, and a dry-run validator that writes nothing.</p>
          <div className="ext-table-wrap">
            <table className="ci-table">
              <thead><tr><th>Dataset</th><th>Columns</th><th>Loaded here now</th></tr></thead>
              <tbody>{d.datasets.map((x) => { const r = d.readiness.find((y) => y.dataset === x.key); return <tr key={x.key}><td><b>{x.label}</b>{x.note ? <div className="ci-meta">{x.note}</div> : null}</td><td className="ext-code">{x.columns.join(" | ")}</td><td className="ci-num">{r?.loaded ?? "—"}{r?.of ? ` / ${r.of}` : ""} <span className="ci-meta">{r?.unit}</span></td></tr>; })}</tbody>
            </table>
          </div>
          <div className="ext-card ext-card-strong">
            <div className="ext-row">
              <label className="ext-field" style={{ flex: "1 1 200px" }}><span className="ci-label">Dataset</span><select className="ci-select" value={dataset} onChange={(e) => { setDataset(e.target.value); setRes(null); }}>{d.datasets.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
              <button type="button" className="btn btn-secondary" onClick={download}>DOWNLOAD TEMPLATE</button>
              <button type="button" className="btn btn-secondary" onClick={template}>LOAD TEMPLATE BELOW</button>
            </div>
            <label className="ext-field" style={{ marginTop: 10 }}><span className="ci-label">Paste CSV</span><textarea value={csv} onChange={(e) => setCsv(e.target.value)} style={{ minHeight: 120, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }} /></label>
            <div className="ext-actions"><button type="button" className="btn btn-primary" disabled={!csv.trim()} onClick={run}>DRY RUN</button></div>
            {err ? <div className="ci-result ci-result-err">{err}</div> : null}
            {res ? (
              <div className="ext-stack" style={{ marginTop: 10 }}>
                <div className="ci-result">{res.total} rows · {res.ready} ready · {res.errors} with errors · written {res.written}. {res.note}</div>
                <div className="ext-table-wrap"><table className="ci-table"><thead><tr><th>Line</th><th>Row</th><th>Status</th><th>Issues</th></tr></thead><tbody>{res.results.map((r) => <tr key={r.line}><td>{r.line}</td><td>{r.preview}</td><td><Tag kind={r.status === "ERROR" ? "CRITICAL" : r.status === "READY" ? "SAFE" : "WATCH"}>{r.status}</Tag></td><td className="ci-meta">{[...r.issues, ...r.warnings].join("; ") || "—"}</td></tr>)}</tbody></table></div>
              </div>
            ) : null}
          </div>
          <div className="ext-grid">
            {d.phases.map((p) => (
              <div key={p.phase} className="ext-card">
                <div className="ci-label">Phase {p.phase} · {p.weeks} weeks</div>
                <h3>{p.name}</h3>
                <p className="ci-meta">{p.scope}</p>
                <ul className="ext-list">{p.exit.map((x, i) => <li key={i} className="ci-body">✓ {x}</li>)}</ul>
                <p className="ci-meta" style={{ marginTop: 8 }}>Rollback: {p.rollback}</p>
              </div>
            ))}
          </div>
          <Kind kind="RECOMMENDED ACTION" />
        </div>
      )}
    </ExtSection>
  );
}

/** Everything the extension adds to Mission Control, in one hook. */
export default function ExtMissionControl({ user, staff, admin, live, lowBw, onGo }) {
  if (!live || !user) return null;
  if (!staff) return null;
  return (
    <div className="ci ext" style={{ padding: 0, maxWidth: "none" }}>
      {admin ? <Block kicker="COLLEGE ADOPTION · MORE DATASETS" title="Rooms, timetable, fees, staff and policies — templates and dry runs."><AdoptionExt /></Block> : null}
      <Block kicker="FRICTION LEDGER · PS07 30% CRITERION" title="How much time the new workflows actually save."><FrictionLedger user={user} lowBw={lowBw} /></Block>
      <Block kicker="UNIFIED PENDING QUEUE" title="Every open request, by age, SLA and owner."><PendingQueue lowBw={lowBw} /></Block>
      <Block kicker="PROOF OF FIX · STUDENT CONFIRMATION" title="Resolved is not the same as fixed."><FixMetrics lowBw={lowBw} /></Block>
      <Block kicker="SMS KEYWORD CHANNEL" title="Requests that arrived from basic phones."><SmsActivity lowBw={lowBw} onOpen={onGo ? () => onGo("sms") : undefined} /></Block>
      <Block kicker="OFFICE FAQ" title="What students ask, and what the rules do not answer yet."><FaqGaps /></Block>
    </div>
  );
}
