import React, { useEffect, useState } from "react";
import { ext } from "../ext/api.js";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, Outcome, SourceLine, attempt, dt, inr, isStaff, useExt } from "../ext/kit.jsx";
import { xo } from "./api.js";
import { CalcBox, PolicyVerdict, UndoPolicy, focusFaqSection, hoursLabel, readFaqFocus } from "./kit.jsx";

/*
 * Phase 2 — the Touchless Lane, on the pages it belongs to:
 *   page 10  Touchless Rate KPI and the Exceptions-only inbox
 *   page 11  the warden's FYI list with UNDO, and the reasons a pass waits
 *   page 16  a copy of a fee receipt, decided by §9.4
 *   page 19  FAQ section ↔ the rules that cite it
 */

const KIND_LABEL = { document: "CERTIFICATE", gatepass: "GATE PASS", service: "RECEIPT COPY" };

/** Touchless Rate: requests closed with 0 human touches ÷ all closed. */
export function TouchlessKpi({ nonce = 0 }) {
  const q = useExt(`xo:touchless:${nonce}`, () => xo.touchlessRate(30));
  return (
    <ExtSection q={q} lines={3}>
      {(d) => (
        <div className="ext-card ext-card-strong">
          <div className="ext-row" style={{ justifyContent: "space-between" }}>
            <div className="ci-label">TOUCHLESS RATE · LAST {d.window.days} DAYS</div>
            <Kind kind={d.kind} />
          </div>
          <div className="xo-kpi" style={{ marginTop: 8 }}>
            <b>{d.ratePct === null ? "—" : `${d.ratePct}%`}</b>
            <span className="ci-meta">{d.zeroTouch} of {d.closed} routine requests closed with zero human touches</span>
          </div>
          {d.insufficient ? <p className="ci-meta">{d.insufficient}</p> : null}
          <div className="xo-table-wrap" style={{ marginTop: 10 }}>
            <table className="xo-table">
              <thead><tr><th>TYPE</th><th>CLOSED</th><th>0 TOUCHES</th><th>BY POLICY</th><th>RATE</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.type}><td>{r.type}</td><td>{r.closed}</td><td>{r.zeroTouch}</td><td>{r.byPolicy}</td><td>{r.ratePct === null ? "Insufficient data" : `${r.ratePct}%`}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <CalcBox>
            <p style={{ margin: "0 0 6px" }}><b>{d.calculation.formula}</b></p>
            <p style={{ margin: "0 0 6px" }}>= {d.calculation.numerator} ÷ {d.calculation.denominator}{d.ratePct !== null ? ` = ${d.ratePct}%` : ""}</p>
            <p className="ci-meta" style={{ margin: "0 0 4px" }}><b>Human touch:</b> {d.calculation.humanTouch}</p>
            <p className="ci-meta" style={{ margin: "0 0 4px" }}><b>Closed:</b> {d.calculation.closed}</p>
            <p className="ci-meta" style={{ margin: 0 }}><b>Source:</b> {d.calculation.source}</p>
          </CalcBox>
          <SourceLine method={d.method} note="counted from the Campus Event log" />
        </div>
      )}
    </ExtSection>
  );
}

function ExceptionRow({ e, onGo }) {
  return (
    <article className="ext-card">
      <div className="ext-row" style={{ justifyContent: "space-between" }}>
        <div className="ext-row"><Tag kind="muted">{KIND_LABEL[e.kind]}</Tag><b>{e.reference}</b><Tag kind="WATCH">{e.status.replace(/_/g, " ")}</Tag></div>
        <span className="ci-meta">waiting {hoursLabel(e.ageHours)}</span>
      </div>
      <h3>{e.title}</h3>
      <p className="ci-meta" style={{ margin: 0 }}>{e.student ? `${e.student.name} · ${e.student.studentId}` : ""} · owner <b>{e.owner}</b></p>
      <ul className="xo-checks" aria-label="Why a person is needed">
        {e.why.map((w, i) => (
          <li key={i} className="bad"><span aria-hidden="true">✗</span> {w.label}{w.explanation && w.explanation !== w.label ? <div className="ci-meta">{w.explanation}</div> : null}</li>
        ))}
      </ul>
      <div className="ext-row" style={{ marginTop: 8 }}>
        {e.citation?.section ? <button type="button" className="ci-link xo-linkbtn" onClick={() => { focusFaqSection(e.citation.key); onGo?.("faq"); }}>{e.citation.section} ↗</button> : null}
        <button type="button" className="ci-link xo-linkbtn" onClick={() => onGo?.(e.ownerPage)}>OPEN IN {e.ownerPage === "gatepass" ? "GATE PASS" : e.ownerPage === "fees" ? "FEES" : "DOCUMENTS"} →</button>
      </div>
    </article>
  );
}

function FyiRow({ f, onDone }) {
  return (
    <article className={`ext-card ${f.undone ? "xo-mute" : ""}`}>
      <div className="ext-row" style={{ justifyContent: "space-between" }}>
        <div className="ext-row"><Tag kind="SAFE">⚡ {f.citation?.section || "POLICY"}</Tag><Tag kind="muted">{KIND_LABEL[f.kind]}</Tag><b>{f.reference}</b>{f.undone ? <Tag kind="CRITICAL">UNDONE</Tag> : null}</div>
        <span className="ci-meta">{dt(f.decidedAt)}</span>
      </div>
      <p className="ci-body" style={{ margin: "4px 0" }}>{f.title}{f.student ? ` — ${f.student.name}` : ""}</p>
      {f.undone ? <p className="ci-result" role="status" style={{ marginTop: 6 }}>Undone — the student has been told, and the request is back with {f.kind === "gatepass" ? "the warden" : f.kind === "service" ? "the accounts office" : "the academic office"}.</p> : f.canUndo ? <UndoPolicy kind={f.kind} id={f.id} onDone={onDone} /> : f.undoBlocked ? <p className="ci-meta" style={{ margin: 0 }}>{f.undoBlocked}</p> : null}
    </article>
  );
}

/** Page 10 — only the items that need a person, each with the conditions it failed. */
export function ExceptionsInbox({ onGo, kinds, title = "Exceptions only", nonce: outer = 0 }) {
  const [nonce, setNonce] = useState(0);
  const [all, setAll] = useState(false);
  const q = useExt(`xo:exceptions:${nonce}:${outer}`, () => xo.exceptions());
  return (
    <ExtSection q={q} lines={5}>
      {(d) => {
        const exceptions = kinds ? d.exceptions.filter((e) => kinds.includes(e.kind)) : d.exceptions;
        const fyi = kinds ? d.fyi.filter((f) => kinds.includes(f.kind)) : d.fyi;
        return (
          <div className="ext-stack">
            <div className="ext-row" style={{ justifyContent: "space-between" }}>
              <h2 className="ext-h2" style={{ margin: 0 }}>{title} · {exceptions.length}</h2>
              <span className="ext-row"><Kind kind={d.kind} />{d.counts.byOwner.map((o) => (!kinds || exceptions.some((e) => e.owner === o.owner) ? <span key={o.owner} className="ci-meta">{o.owner} {o.n}</span> : null))}</span>
            </div>
            <p className="ci-meta" style={{ margin: 0 }}>{d.note}</p>
            {exceptions.length ? (all ? exceptions : exceptions.slice(0, 6)).map((e) => <ExceptionRow key={`${e.kind}${e.id}`} e={e} onGo={onGo} />) : <StateBox title="No exceptions">Every open routine request was decided by written policy.</StateBox>}
            {exceptions.length > 6 ? <button type="button" className="btn btn-secondary" onClick={() => setAll((a) => !a)}>{all ? "SHOW FEWER" : `SHOW ALL ${exceptions.length}`}</button> : null}
            <h3 className="ci-label" style={{ marginTop: 10 }}>Decided by policy · FYI ({d.window.fyiHours}h) · {fyi.length}</h3>
            {fyi.length ? fyi.map((f) => <FyiRow key={`${f.kind}${f.id}`} f={f} onDone={() => setNonce((n) => n + 1)} />) : <p className="ci-meta">No policy decisions in this window.</p>}
            <SourceLine method={d.method} />
          </div>
        );
      }}
    </ExtSection>
  );
}

/** Page 11 — the warden console's policy section (gate passes only). */
export function WardenPolicyPanel({ user, onGo }) {
  if (!isStaff(user)) return null;
  return (
    <div className="ci ext" style={{ padding: 0, marginTop: 18 }}>
      <ExceptionsInbox onGo={onGo} kinds={["gatepass"]} title="Needs the warden" />
    </div>
  );
}

// ---- page 16: a copy of a fee receipt ------------------------------------------------------

export function ReceiptCopy({ user, onGo }) {
  const [nonce, setNonce] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const staff = isStaff(user);
  const q = useExt(`xo:services:${user?.id}:${nonce}`, () => xo.services(), { enabled: Boolean(user) });
  if (!user) return null;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await attempt(() => xo.requestReceipt({ receipt }), (d) => (d.decidedBy === "POLICY" ? `${d.reference}: copy issued instantly under ${d.policyDecision?.citation?.section}.` : `${d.reference}: sent to the accounts office.`));
    setResult(r);
    setBusy(false);
    if (!r.error) {
      setReceipt("");
      setNonce((n) => n + 1);
    }
  };
  const decide = async (id, decision) => {
    const r = await attempt(() => xo.decideService(id, { decision, reason: decision === "REJECT" ? "Not found on the fee ledger" : undefined }), "Decided.");
    setResult(r);
    setNonce((n) => n + 1);
  };
  return (
    <div className="ext-card" style={{ marginTop: 18 }}>
      <div className="ext-row" style={{ justifyContent: "space-between" }}>
        <div className="ci-label">COPY OF A FEE RECEIPT · §9.4</div>
        <Tag kind="muted">TOUCHLESS WHEN ON THE LEDGER</Tag>
      </div>
      {!staff ? (
        <form className="ext-row" onSubmit={submit} style={{ marginTop: 10 }}>
          <input className="ci-input" style={{ flex: "1 1 200px" }} value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="Receipt number, e.g. RCP-T-1017" maxLength={40} aria-label="Receipt number" />
          <button type="submit" className="btn btn-primary" disabled={busy || receipt.trim().length < 3}>{busy ? "CHECKING…" : "GET A COPY"}</button>
        </form>
      ) : null}
      <Outcome result={result} />
      {result?.data?.policyDecision ? <PolicyVerdict policy={result.data.policyDecision} onGo={onGo} compact /> : null}
      <ExtSection q={q} lines={2}>
        {(d) => (
          <div className="ext-stack" style={{ marginTop: 10 }}>
            {d.requests.slice(0, 6).map((s) => (
              <div key={s.id} className="ext-row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--ci-line)", paddingTop: 8 }}>
                <div className="ext-row">
                  <b>{s.reference}</b><span className="ci-meta">{s.receipt}</span>
                  <Tag kind={s.status === "FULFILLED" ? "SAFE" : s.status === "REJECTED" ? "CRITICAL" : "WATCH"}>{s.status.replace("_", " ")}</Tag>
                  {s.decidedBy === "POLICY" ? <Tag kind="SAFE">⚡ {s.policyDecision?.citation?.section}</Tag> : s.decidedByName ? <span className="ci-meta">by {s.decidedByName}</span> : null}
                  {s.student && staff ? <span className="ci-meta">{s.student.name}</span> : null}
                </div>
                {s.output && !s.output.withdrawn && s.output.amount ? <span className="ci-meta">{s.output.label} · {inr(s.output.amount)} · paid {dt(s.output.paidAt)} · {s.output.mode}</span> : null}
                {staff && ["SUBMITTED", "UNDER_REVIEW"].includes(s.status) ? (
                  <span className="ext-row"><button type="button" className="btn btn-secondary" onClick={() => decide(s.id, "FULFILL")}>ISSUE COPY</button><button type="button" className="btn btn-secondary" onClick={() => decide(s.id, "REJECT")}>REJECT</button></span>
                ) : null}
                {staff && s.decidedBy === "POLICY" && !s.policyUndo ? <UndoPolicy kind="service" id={s.id} onDone={() => setNonce((n) => n + 1)} /> : null}
              </div>
            ))}
            {!d.requests.length ? <p className="ci-meta" style={{ margin: 0 }}>No receipt copies requested yet.</p> : null}
          </div>
        )}
      </ExtSection>
    </div>
  );
}

// ---- page 19: FAQ section ↔ rule ------------------------------------------------------------

/** Under an FAQ answer: the policy rules that cite this section, if any. */
export function FaqRuleLink({ sectionKey, onGo }) {
  const q = useExt(`xo:rules:${sectionKey}`, () => xo.rules({ section: sectionKey }), { enabled: Boolean(sectionKey) });
  const rules = q.data?.rules || [];
  if (!rules.length) return null;
  return (
    <div className="xo-verdict xo-verdict-auto" style={{ marginTop: 8 }}>
      <div className="ci-label">USED BY {rules.length === 1 ? "A RULE" : `${rules.length} RULES`} IN THE TOUCHLESS LANE</div>
      {rules.map((r) => (
        <div key={r.id} className="ci-meta" style={{ marginTop: 4 }}>
          <b>{r.citation?.section} {r.key} v{r.version}</b>{r.citation?.key !== sectionKey ? " (related rule)" : ""} · {r.action === "AUTO_APPROVE" ? "decides automatically when" : "sends to a person when"}: {r.conditions.map((c) => c.label).join(" · ")}
          {r.citation?.key !== sectionKey ? <> · <button type="button" className="ci-link xo-linkbtn" onClick={() => focusFaqSection(r.citation.key)}>READ {r.citation.section}</button></> : null}
          {onGo ? <> · <button type="button" className="ci-link xo-linkbtn" onClick={() => onGo(r.requestType === "GATE_PASS" ? "gatepass" : r.requestType === "FEE_RECEIPT_COPY" ? "fees" : "documents")}>WHERE IT APPLIES →</button></> : null}
        </div>
      ))}
    </div>
  );
}

/** Page 19 — the full rule list, each linked to its written section. */
export function PolicyRuleList({ onGo }) {
  const q = useExt("xo:rules:all", () => xo.rules());
  return (
    <ExtSection q={q} lines={3}>
      {(d) => (
        <div className="ext-card" style={{ marginTop: 18 }}>
          <div className="ci-label">RULES THAT DECIDE ROUTINE REQUESTS · {d.rules.length}</div>
          <p className="ci-meta" style={{ marginTop: 4 }}>Each rule cites the section above it comes from. A request that passes every condition is decided with no human touch; any other goes to the office.</p>
          {d.rules.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--ci-line)", paddingTop: 8, marginTop: 8 }}>
              <div className="ext-row"><Tag kind={r.action === "AUTO_APPROVE" ? "SAFE" : "WATCH"}>{r.action === "AUTO_APPROVE" ? "AUTO-APPROVE" : "TO A PERSON"}</Tag><b>{r.citation?.section} {r.title}</b><span className="ci-meta">v{r.version} · approved by {r.approvedByName || "—"}</span></div>
              <div className="ci-meta" style={{ marginTop: 4 }}>{r.conditions.map((c) => c.label).join(" · ")}</div>
              <button type="button" className="ci-link xo-linkbtn" onClick={() => { focusFaqSection(r.citation?.key); onGo?.("faq"); }}>READ {r.citation?.section} →</button>
            </div>
          ))}
        </div>
      )}
    </ExtSection>
  );
}

/** Page 19 — the section a rule (or an exception) linked to, with the rules that cite it. */
export function FocusedSection({ onGo }) {
  const [key, setKey] = useState(() => readFaqFocus());
  useEffect(() => {
    const on = (e) => {
      readFaqFocus();
      setKey(e.detail);
    };
    window.addEventListener("xo:faq-focus", on);
    return () => window.removeEventListener("xo:faq-focus", on);
  }, []);
  const q = useExt(`xo:faqsec:${key}`, () => ext.faqSections(), { enabled: Boolean(key) });
  if (!key) return null;
  const section = q.data?.sections?.find((s) => s.key === key);
  return (
    <article className="ext-card ext-card-strong" style={{ marginBottom: 18 }} aria-live="polite">
      <div className="ext-row" style={{ justifyContent: "space-between" }}>
        <div className="ci-label">LINKED POLICY SECTION</div>
        <button type="button" className="ci-link xo-linkbtn" onClick={() => setKey(null)}>CLOSE</button>
      </div>
      {section ? (
        <>
          <div className="ext-row" style={{ marginTop: 4 }}><b className="ext-code">{section.key}</b><span>{section.title}</span><Tag kind="muted">v{section.version}</Tag></div>
          <p className="ci-body" style={{ marginTop: 6 }}>{section.body}</p>
          <p className="ci-meta" style={{ margin: 0 }}>{section.source}</p>
        </>
      ) : q.loading ? <p className="ci-meta">Loading {key}…</p> : <p className="ci-meta">Section {key} is not in the corpus.</p>}
      <FaqRuleLink sectionKey={key} onGo={onGo} />
    </article>
  );
}
