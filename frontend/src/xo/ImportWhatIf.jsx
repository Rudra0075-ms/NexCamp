import React, { useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, Outcome, SourceLine, attempt, dt, useExt } from "../ext/kit.jsx";
import { xo } from "./api.js";
import { CalcBox, hoursLabel } from "./kit.jsx";

/*
 * Phase 7 — "Import a WhatsApp group" (page 10, College Adoption & Migration)
 * and the FAQ drafts it produces (page 19).
 * Phase 8 — "Policy what-if" (page 09): replay recent requests under edited rules.
 */

const LABEL_TONE = { NOTICE: "HIGH", COMPLAINT: "CRITICAL", QUESTION: "WATCH", REQUEST: "STABLE", NOISE: "muted" };
const MAX_BYTES = 190000;

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(new Error("Could not read that file"));
  r.readAsText(file);
});

function Evidence({ rows }) {
  if (!rows?.length) return null;
  return <ul className="ext-list" style={{ marginTop: 4 }}>{rows.map((e, i) => <li key={i} className="ci-meta">line {e.line} · {dt(e.at)} · <b>{e.sender}</b>: {e.text}</li>)}</ul>;
}

export function WhatsAppImport({ admin }) {
  const [text, setText] = useState(null);
  const [csv, setCsv] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [converted, setConverted] = useState(null);
  const pick = (setter, label) => async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`${label} is ${Math.round(file.size / 1024)} KB — the limit is about ${Math.round(MAX_BYTES / 1024)} KB (roughly 2,500 messages). Export a shorter date range.`);
      return;
    }
    setError(null);
    setter(await readFile(file));
    if (label === "The chat" && !name) setName(file.name.replace(/\.txt$/i, ""));
  };
  const run = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const r = await xo.importWhatsapp(body);
      if (body.convert) setConverted(r);
      else {
        setReport(r);
        setConverted(null);
      }
    } catch (e) {
      setError(e.status === 0 ? "Offline — the import needs the server." : e.message);
    } finally {
      setBusy(false);
    }
  };
  const payload = (convert) => (text ? { text, csv: csv || undefined, name: name || undefined, convert } : { sample: true, convert });
  const f = report?.findings;
  return (
    <div className="ci ext" style={{ padding: 0, marginTop: 18 }}>
      <div className="ext-card ext-card-strong">
        <div className="ci-label">IMPORT A WHATSAPP GROUP · DRY RUN FIRST</div>
        <p className="ci-meta" style={{ marginTop: 4 }}>Upload a chat export (.txt, Android or iOS) and, optionally, a gate-register or complaint-diary CSV. The dry run writes nothing; it reads every message and shows what the group was really doing.</p>
        <div className="ext-row" style={{ marginTop: 8 }}>
          <label className="ext-field"><span className="ci-label">Chat export (.txt)</span><input type="file" accept=".txt,text/plain" onChange={pick(setText, "The chat")} /></label>
          <label className="ext-field"><span className="ci-label">Optional CSV</span><input type="file" accept=".csv,text/csv" onChange={pick(setCsv, "The CSV")} /></label>
          <label className="ext-field"><span className="ci-label">Group name</span><input className="ci-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Hostel B · CSE 2022" /></label>
        </div>
        <div className="ext-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(payload(false))}>{busy ? "READING…" : text ? "DRY RUN" : "DRY RUN THE SAMPLE EXPORT"}</button>
          {text ? <button type="button" className="btn btn-secondary" onClick={() => { setText(null); setCsv(null); setReport(null); }}>USE THE SAMPLE INSTEAD</button> : null}
        </div>
        {error ? <div className="ci-result ci-result-err" role="alert">{error}</div> : null}
      </div>
      {report ? (
        <div className="ext-card" style={{ marginTop: 12 }} aria-live="polite">
          <div className="ext-row" style={{ justifyContent: "space-between" }}>
            <b>{report.name} · {report.messages} messages · {report.senders} people · {report.format}</b>
            <span className="ext-row"><Tag kind="WATCH">DRY RUN · NOTHING WRITTEN</Tag><Kind kind={report.kind} /></span>
          </div>
          <p className="ci-meta">{dt(report.span.from)} → {dt(report.span.to)}</p>
          <div className="ext-row" style={{ marginTop: 6 }}>{Object.entries(report.counts).map(([k, v]) => <span key={k}><Tag kind={LABEL_TONE[k]}>{k}</Tag> <b>{v}</b></span>)}</div>
          <p className="ci-meta">Labels: {report.classification.method} — {report.classification.ruleLabelled} by keyword rules. {report.classification.note} <Tag kind="muted">{report.classification.source}</Tag></p>
          <div className="xo-grid" style={{ marginTop: 10 }}>
            {[["nightNotices", f.nightNotices.evidence], ["unacknowledged", f.unacknowledged.evidence]].map(([k, ev]) => (
              <div key={k} className="ext-card"><div className="ci-label">{k === "nightNotices" ? "NOTICES POSTED 23:00–06:00" : "COMPLAINTS NEVER ACKNOWLEDGED"}</div><p className="ci-body" style={{ margin: "4px 0" }}>{f[k].text}</p><CalcBox label="VIEW EVIDENCE LINES"><Evidence rows={ev} /></CalcBox></div>
            ))}
            <div className="ext-card"><div className="ci-label">SUPERSEDED NOTICES</div><p className="ci-body" style={{ margin: "4px 0" }}>{f.superseded.text}</p><CalcBox label="VIEW EVIDENCE LINES">{f.superseded.pairs.map((p, i) => <div key={i}><Evidence rows={[p.original]} /><Evidence rows={[p.replacement]} /><p className="ci-meta">{p.overlapPct}% word overlap</p></div>)}</CalcBox></div>
            <div className="ext-card"><div className="ci-label">REPEATED QUESTIONS → FAQ DRAFTS</div><p className="ci-body" style={{ margin: "4px 0" }}>{f.repeatedQuestions.text}</p><ul className="ext-list">{f.repeatedQuestions.clusters.slice(0, 6).map((c, i) => <li key={i} className="ci-meta"><b>{c.times}×</b> {c.question} <span>({c.askers} people)</span></li>)}</ul></div>
          </div>
          {report.csv ? <p className="ci-meta" style={{ marginTop: 8 }}><Tag kind="muted">{report.csv.kind.replace("_", " ")}</Tag> {report.csv.text || `${report.csv.rows} rows — ${report.csv.complaints?.length || 0} complaints to file on convert.`}</p> : null}
          <CalcBox label="VIEW THE FIRST 40 MESSAGES AND THEIR LABELS">
            <table><thead><tr><th>LINE</th><th>FROM</th><th>MESSAGE</th><th>LABEL</th><th>WHY</th></tr></thead><tbody>{report.sample.map((m) => <tr key={m.line}><td>{m.line}</td><td>{m.sender}</td><td>{m.text}</td><td>{m.label}</td><td className="ci-meta">{m.labelSource} · {m.rule}</td></tr>)}</tbody></table>
          </CalcBox>
          {admin ? (
            <div className="ext-actions">
              <button type="button" className="btn btn-primary" disabled={busy || Boolean(converted)} onClick={() => run(payload(true))}>{busy ? "CONVERTING…" : "CONVERT — FILE COMPLAINTS, SAVE NOTICES AND FAQ DRAFTS"}</button>
            </div>
          ) : <p className="ci-meta">Only an administrator can convert an import.</p>}
          {converted ? <div className="ci-result" role="status">{converted.batch}: {converted.created.complaints.length} complaints filed (channel IMPORT), {converted.created.notices.length} notices saved as scheduled (not re-sent), {converted.created.faqDrafts.length} FAQ drafts for page 19, {converted.created.skipped.length} skipped (sender not a registered student). Audited.</div> : null}
          <SourceLine method="PARSE → KEYWORD RULES → EVIDENCE REPORT" source={report.classification.source} />
        </div>
      ) : null}
    </div>
  );
}

/** Page 19 (staff): questions students kept asking, waiting for an office answer. */
export function FaqDrafts() {
  const q = useExt("xo:faqdrafts", () => xo.faqDrafts());
  if (!q.data?.drafts?.length) return null;
  return (
    <div className="ext-card" style={{ marginTop: 18 }}>
      <div className="ci-label">FAQ DRAFTS FROM IMPORTED CHATS · {q.data.drafts.length}</div>
      <ul className="ext-list" style={{ marginTop: 8 }}>{q.data.drafts.map((d) => <li key={d.id} className="ci-body"><b>{d.times}×</b> {d.question} <span className="ci-meta">· {d.askers} people · {d.source} · {d.status}</span></li>)}</ul>
    </div>
  );
}

// ---- Phase 8 ------------------------------------------------------------------------------------

const TYPE_LABEL = { BONAFIDE_CERTIFICATE: "Bonafide certificate", GATE_PASS: "Day outing (gate pass)", FEE_RECEIPT_COPY: "Fee receipt copy" };

export function PolicyWhatIf({ admin }) {
  const [nonce, setNonce] = useState(0);
  const rulesQ = useExt(`xo:rules:whatif:${nonce}`, () => xo.rules({ drafts: admin ? 1 : undefined }));
  const [key, setKey] = useState("BONAFIDE-INSTANT");
  const [edits, setEdits] = useState({});
  const [dropped, setDropped] = useState({});
  const [days, setDays] = useState(30);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const rules = (rulesQ.data?.rules || []).filter((r) => r.active && r.action === "AUTO_APPROVE");
  const drafts = (rulesQ.data?.rules || []).filter((r) => r.status === "DRAFT");
  const rule = rules.find((r) => r.key === key) || rules[0];
  const editedRule = rule ? { key: rule.key, requestType: rule.requestType, title: rule.title, action: rule.action, citation: rule.citation, conditions: rule.conditions.filter((c) => !dropped[`${rule.key}:${c.field}`]).map((c) => ({ ...c, value: edits[`${rule.key}:${c.field}`] ?? c.value })) } : null;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await xo.replay({ days: Number(days), edits: [editedRule] }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setSaved(await attempt(() => xo.draftRule({ ...editedRule, notes: `Drafted from the policy what-if on page 09 (${days}-day replay)` }), (d) => `Saved ${d.key} v${d.version} as a DRAFT — not live until activated.`));
    setNonce((n) => n + 1);
  };
  const activate = async (id) => {
    setSaved(await attempt(() => xo.activateRule(id), (d) => `${d.key} v${d.version} is now the live rule. Audited.`));
    setNonce((n) => n + 1);
  };
  return (
    <div className="ci ext" style={{ padding: 0 }}>
      <ExtSection q={rulesQ} lines={3}>
        {() =>
          rule ? (
            <div className="ext-card ext-card-strong">
              <div className="ext-row" style={{ justifyContent: "space-between" }}>
                <div className="ci-label">POLICY WHAT-IF · REPLAY REAL REQUESTS UNDER EDITED RULES</div>
                <Tag kind="WATCH">LIVE RULES UNCHANGED</Tag>
              </div>
              <div className="ext-row" style={{ marginTop: 8 }}>
                <div className="ext-chips" role="radiogroup" aria-label="Rule to edit">{rules.map((r) => <button key={r.key} type="button" className="ci-chip" aria-pressed={r.key === rule.key} onClick={() => { setKey(r.key); setResult(null); }}>{r.citation?.section} {TYPE_LABEL[r.requestType]}</button>)}</div>
              </div>
              <div className="xo-table-wrap" style={{ marginTop: 8 }}>
                <table className="xo-table">
                  <thead><tr><th>USE</th><th>CONDITION</th><th>LIVE</th><th>EDITED</th></tr></thead>
                  <tbody>{rule.conditions.map((c) => {
                    const k = `${rule.key}:${c.field}`;
                    const numeric = ["lt", "lte", "gt", "gte", "eq"].includes(c.op) && typeof c.value === "number";
                    return (
                      <tr key={k}>
                        <td><input type="checkbox" aria-label={`Keep ${c.label}`} checked={!dropped[k]} onChange={(e) => setDropped((d) => ({ ...d, [k]: !e.target.checked }))} /></td>
                        <td>{c.label}</td>
                        <td className="ci-meta">{c.op} {String(c.value)}</td>
                        <td>{numeric ? <input className="ci-input" type="number" style={{ width: 110 }} value={edits[k] ?? c.value} onChange={(e) => setEdits((x) => ({ ...x, [k]: Number(e.target.value) }))} aria-label={`New value for ${c.label}`} /> : <span className="ci-meta">{String(c.value)}</span>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              <div className="ext-row" style={{ marginTop: 8 }}>
                <label className="ext-row ci-meta">Replay the last <input className="ci-input" type="number" min="1" max="180" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 80 }} /> days</label>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>{busy ? "REPLAYING…" : "RUN WHAT-IF"}</button>
              </div>
              {error ? <div className="ci-result ci-result-err">{error}</div> : null}
              {result ? (
                <div style={{ marginTop: 10 }} aria-live="polite">
                  <div className="ext-row"><Kind kind={result.kind} /><span className="ci-meta">{result.note}</span></div>
                  <div className="xo-table-wrap"><table className="xo-table" style={{ marginTop: 6 }}>
                    <thead><tr><th>TYPE</th><th>REQUESTS</th><th>AUTO-APPROVED</th><th>STAFF DECISIONS</th><th>STAFF TIME</th><th>MEDIAN WAIT</th><th>RULE VIOLATIONS</th></tr></thead>
                    <tbody>{result.byType.map((t) => (
                      <tr key={t.type}><td>{t.label}</td><td>{t.requests}</td><td>{t.autoApprovalPct.before ?? "—"}% → <b>{t.autoApprovalPct.after ?? "—"}%</b></td><td>{t.humanDecisions.before} → <b>{t.humanDecisions.after}</b></td><td>{t.staffMinutes.before} → <b>{t.staffMinutes.after}</b> min</td><td>{hoursLabel(t.medianWaitHours.before)} → <b>{hoursLabel(t.medianWaitHours.after)}</b></td><td>{t.violations.length ? t.violations.map((v) => `${v.reference} (${v.why})`).join(", ") : "none"}</td></tr>
                    ))}</tbody>
                  </table></div>
                  <CalcBox label="VIEW ASSUMPTIONS"><ul className="ext-list">{result.assumptions.map((a, i) => <li key={i}><Tag kind="muted">ASSUMPTION</Tag> {a}</li>)}</ul></CalcBox>
                  {admin ? <div className="ext-actions"><button type="button" className="btn btn-secondary" onClick={save}>SAVE THIS EDIT AS A DRAFT RULE</button></div> : <p className="ci-meta">An administrator can save this edit as a draft and activate it.</p>}
                </div>
              ) : null}
              <Outcome result={saved} />
              {admin && drafts.length ? (
                <div style={{ marginTop: 10 }}>
                  <div className="ci-label">DRAFTS WAITING FOR ACTIVATION</div>
                  {drafts.map((d) => <div key={d.id} className="ext-row" style={{ marginTop: 6 }}><b>{d.key} v{d.version}</b><span className="ci-meta">{d.conditions.map((c) => `${c.field} ${c.op} ${c.value}`).join(" · ")}</span><button type="button" className="btn btn-secondary" onClick={() => activate(d.id)}>ACTIVATE</button></div>)}
                </div>
              ) : null}
              <SourceLine method="POLICY_REPLAY_ON_HISTORY" note="SIMULATED — nothing is written by a replay" />
            </div>
          ) : <StateBox title="No active rules">Seed the policy rules first.</StateBox>
        }
      </ExtSection>
    </div>
  );
}
