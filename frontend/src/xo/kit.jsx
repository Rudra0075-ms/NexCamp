import React, { useEffect, useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { Kind, Outcome, attempt } from "../ext/kit.jsx";
import { xo } from "./api.js";
import "./xo.css";

/*
 * Shared pieces for the Exception-Only Campus UI. Visual language is the
 * existing intel/ext kit (ci-*, ext-* classes); these only add the policy
 * verdict, the "who decided" line, a VIEW CALCULATION disclosure and UNDO.
 */

// Opening the Office FAQ at one section (page 19 reads this on mount).
export const FAQ_FOCUS_KEY = "nex:xo:faq-section";
export function focusFaqSection(key) {
  try {
    sessionStorage.setItem(FAQ_FOCUS_KEY, key);
  } catch {
    /* focus is a convenience only */
  }
  // Already on page 19: the open section listens for this.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("xo:faq-focus", { detail: key }));
}

export function readFaqFocus() {
  try {
    const key = sessionStorage.getItem(FAQ_FOCUS_KEY);
    sessionStorage.removeItem(FAQ_FOCUS_KEY);
    return key;
  } catch {
    return null;
  }
}

const tick = (passed) => (passed ? "✓" : "✗");

/** The policy engine's verdict on one request, in plain words, with its citation. */
export function PolicyVerdict({ policy, onGo, compact = false }) {
  if (!policy) return null;
  if (policy.decision === "NOT_COVERED") {
    return <p className="ci-meta xo-verdict-note">{policy.reason}</p>;
  }
  const auto = policy.decision === "AUTO_APPROVE";
  const conditions = [...(policy.passedConditions || []), ...(policy.failedConditions || [])];
  return (
    <div className={`xo-verdict ${auto ? "xo-verdict-auto" : "xo-verdict-human"}`} role="status">
      <div className="ext-row" style={{ justifyContent: "space-between" }}>
        <b className="xo-verdict-head">{auto ? `⚡ Decided by written policy ${policy.citation?.section || ""}` : `→ Sent to a person${policy.citation?.section ? ` · ${policy.citation.section}` : ""}`}</b>
        <span className="ext-row"><Kind kind="ACTUAL DATA" /><Tag kind="muted">0 AI · RULES</Tag></span>
      </div>
      {!compact && policy.citation?.text ? <blockquote className="xo-cite">“{policy.citation.text}”</blockquote> : null}
      <p className="ci-meta" style={{ margin: "6px 0" }}>{policy.reason}</p>
      {conditions.length ? (
        <ul className="xo-checks" aria-label="Conditions checked">
          {conditions.map((c) => (
            <li key={c.field} className={c.passed ? "ok" : "bad"}>
              <span aria-hidden="true">{tick(c.passed)}</span> {c.label}
              {!c.passed && c.explanation ? <div className="ci-meta">{c.explanation}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ext-row" style={{ marginTop: 6 }}>
        <span className="ci-meta">Method {policy.method || "DETERMINISTIC_POLICY_RULES"} · rule {policy.matchedRule?.key || "—"}{policy.matchedRule?.version ? ` v${policy.matchedRule.version}` : ""}</span>
        {onGo && policy.citation?.key ? (
          <button type="button" className="ci-link xo-linkbtn" onClick={() => { focusFaqSection(policy.citation.key); onGo("faq"); }}>
            READ {policy.citation.section} IN THE OFFICE FAQ →
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** "Who decided, and why" — page 17. */
export function DecisionLine({ decision }) {
  if (!decision) return null;
  const failed = (decision.conditions || []).filter((c) => !c.passed);
  if (decision.by === "POLICY") {
    return (
      <div className="xo-decision" role="note">
        <Tag kind="SAFE">⚡ POLICY</Tag> <b>{decision.name}</b> <span className="ci-meta">— {decision.why}</span>
        {decision.conditions?.length ? <div className="ci-meta">Checked: {decision.conditions.map((c) => `${tick(c.passed)} ${c.label}`).join(" · ")}</div> : null}
        {decision.undone ? <div className="ci-meta">Undone by {decision.undone.byName}: {decision.undone.reason}</div> : null}
      </div>
    );
  }
  if (decision.by === "HUMAN") {
    return (
      <div className="xo-decision" role="note">
        <Tag kind="muted">PERSON</Tag> <b>{decision.name}</b>{decision.why ? <span className="ci-meta"> — {decision.why}</span> : null}
      </div>
    );
  }
  if (!decision.waitingOn) return null;
  return (
    <div className="xo-decision" role="note">
      <Tag kind="WATCH">WAITING ON</Tag> <b>{decision.waitingOn}</b>{decision.why ? <span className="ci-meta"> — {decision.why}</span> : null}
      {failed.length ? <div className="ci-meta">Not met: {failed.map((c) => c.label).join(" · ")}</div> : null}
    </div>
  );
}

/** A "VIEW CALCULATION" disclosure. */
export function CalcBox({ label = "VIEW CALCULATION", children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="xo-calc">
      <button type="button" className="ci-link xo-linkbtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "HIDE CALCULATION" : label}</button>
      {open ? <div className="xo-calc-body">{children}</div> : null}
    </div>
  );
}

/** UNDO a policy decision: reason required; the student is told. */
export function UndoPolicy({ kind, id, onDone, label = "UNDO" }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  if (!open) return <button type="button" className="btn btn-secondary xo-undo" onClick={() => setOpen(true)}>{label}</button>;
  const submit = async () => {
    setBusy(true);
    const r = await attempt(() => xo.undo(kind, id, reason), (d) => `Undone${d.followUp ? ` — new request ${d.followUp} is with the office` : ""}. The student has been told.`);
    setResult(r);
    setBusy(false);
    if (!r.error) onDone?.();
  };
  return (
    <div className="ext-row" style={{ marginTop: 6 }}>
      <input className="ci-input" style={{ flex: "1 1 220px" }} placeholder="Why? (the student is shown this)" value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} aria-label="Reason for the undo" />
      <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 5} onClick={submit}>{busy ? "UNDOING…" : "CONFIRM UNDO"}</button>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>CANCEL</button>
      <Outcome result={result} />
    </div>
  );
}

export const hoursLabel = (h) => (h === null || h === undefined ? "—" : h < 1 / 60 ? "instant" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h * 10) / 10}h` : `${Math.round((h / 24) * 10) / 10} days`);

/**
 * Before submitting: what the written policy would decide for this request,
 * for the signed-in student. A read-only dry run (POST /api/xo/policy/preview,
 * writes nothing); debounced so typing a purpose costs one request.
 */
export function PolicyPreview({ type, purpose, kiosk }) {
  const [verdict, setVerdict] = useState(null);
  const covered = type === "BONAFIDE" && !kiosk;
  useEffect(() => {
    if (!covered) {
      setVerdict(null);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      xo.preview({ type: "BONAFIDE_CERTIFICATE", purpose: purpose || "" })
        .then((v) => alive && setVerdict(v))
        .catch(() => alive && setVerdict(null));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [covered, purpose]);
  if (!covered || !verdict) return null;
  const auto = verdict.decision === "AUTO_APPROVE";
  return (
    <p className={`ci-meta xo-verdict-note`} role="status">
      <Tag kind={auto ? "SAFE" : "WATCH"}>{auto ? `⚡ INSTANT UNDER ${verdict.citation?.section}` : "GOES TO THE OFFICE"}</Tag>{" "}
      {auto ? "You meet every condition of the written policy — the certificate is issued the moment you submit, with no office visit." : (verdict.failedConditions || []).map((c) => c.explanation).join(" ") || verdict.reason}
    </p>
  );
}

// ---- ETAs (Phase 4): P50/P80 from finished requests, or "Insufficient history" ----------------

/** Every ETA in one read (GET /api/xo/eta). */
export function useEtas(enabled = true) {
  const [etas, setEtas] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    xo.eta()
      .then((r) => alive && setEtas(r?.data ?? r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  return etas;
}

const etaText = (e) => (!e ? null : e.p50Hours !== null && e.p50Hours !== undefined ? `typically ${hoursLabel(e.p50Hours)} (P50) · 8 in 10 within ${hoursLabel(e.p80Hours)} (P80), from ${e.samples} finished` : String(e.text || "").replace(/\.$/, ""));

/** The ETA line for an open page-17 item, when there is one. */
export function EtaHint({ item, etas }) {
  if (!etas || !item?.open) return null;
  let e = null;
  if (item.kind === "complaint") e = etas.complaints?.find((c) => c.department === item.decision?.waitingOn);
  else if (item.kind === "document") {
    const type = Object.keys({ BONAFIDE: 1, NO_DUES: 1, HOSTEL_RESIDENCE: 1, CHARACTER: 1 }).find((t) => item.title?.toUpperCase().startsWith(t.replace("_", " ")));
    e = etas.documents?.find((d) => d.type === type)?.office;
  } else if (item.kind === "gatepass" && item.status === "PENDING_WARDEN_APPROVAL") e = etas.gatePass?.warden;
  if (!e) return null;
  return <p className="ci-meta" style={{ margin: "4px 0 0" }}><Kind kind={e.kind} /> ETA: {etaText(e)}</p>;
}

/** Page 14: how long each path takes, from finished certificates. */
export function DocEta({ type }) {
  const etas = useEtas();
  const d = etas?.documents?.find((x) => x.type === type);
  if (!d) return null;
  return (
    <p className="ci-meta" style={{ margin: 0 }} role="note">
      <Kind kind={d.office.kind} /> Office path: {etaText(d.office)}.{type === "BONAFIDE" ? <> Policy path (§4.2): {d.policy.p50Hours !== null ? `${hoursLabel(d.policy.p50Hours)} median` : d.policy.text}.</> : null}
    </p>
  );
}
