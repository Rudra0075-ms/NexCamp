import React, { useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { RequestTimeline } from "../components/ai.jsx";
import EvalKicker from "../components/EvalKicker.jsx";
import { ext } from "./api.js";
import { DOC_TYPES, documentTimeline } from "./timelines.js";
import { ExtSection, Kind, NetLine, Outcome, PageHead, SignInNote, attempt, dt, isAdmin, isStaff, useExt } from "./kit.jsx";
import { DocEta, PolicyPreview, PolicyVerdict, UndoPolicy } from "../xo/kit.jsx"; // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md)
const OPEN_STATES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED"]; // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md)

/*
 * 14 — DOCUMENTS. Bonafide, no-dues, hostel-residence and character
 * certificates: request → review → approve / reject (reason required) →
 * issue as a PDF with a QR code and a short verification code. Only the
 * SHA-256 digest of the certificate's canonical content is stored.
 */

const SLA_TAG = { ON_TRACK: "SAFE", AT_RISK: "WATCH", BREACHED: "CRITICAL", MET: "SAFE", MET_LATE: "WATCH", NO_SLA: "muted" };

async function openPdf(id, setResult) {
  try {
    const blob = await ext.documentPdf(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.pdf`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    setResult({ error: error.message });
  }
}

export function RequestForm({ types, onDone, kioskStudentId, onGo }) {
  const [type, setType] = useState("BONAFIDE");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await attempt(
      () => (kioskStudentId ? ext.documentKiosk({ studentId: kioskStudentId, type, purpose }) : ext.documentRequest({ type, purpose })),
      // EXCEPTION-ONLY HOOK: an in-policy bonafide comes back already issued.
      (d) => (d.policy?.decision === "AUTO_APPROVE" ? `⚡ ${d.reference} issued instantly under ${d.policy.citation?.section} — download it below. Verification code ${d.certificate?.verificationCode}.` : `Submitted as ${d.reference}. Target: issued within ${d.sla?.slaHours ?? "—"} hours.`) + (kioskStudentId ? " Give the student this reference." : "")
    );
    setResult(r);
    if (!r.error) {
      setPurpose("");
      onDone?.();
    }
    setBusy(false);
  };
  return (
    <form className="ci-form" onSubmit={submit}>
      <div className="ext-field">
        <span className="ci-label">Document</span>
        <div className="ext-chips" role="radiogroup" aria-label="Document type">
          {(types || []).map((t) => (
            <button key={t.type} type="button" role="radio" aria-checked={type === t.type} aria-pressed={type === t.type} className="ci-chip" onClick={() => setType(t.type)}>
              {t.label} · {t.slaHours}h
            </button>
          ))}
        </div>
      </div>
      <label className="ext-field"><span className="ci-label">Purpose</span><input className="ci-input" required maxLength={300} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Education loan application — State Bank of India" /></label>
      <div><button type="submit" className="btn btn-primary" disabled={busy || !purpose.trim()}>{busy ? "SUBMITTING…" : "REQUEST DOCUMENT"}</button></div>
      <Outcome result={result} />
      {/* EXCEPTION-ONLY HOOK: the policy verdict — citation, conditions checked, what is missing. */}
      <DocEta type={type} />
      {result?.data?.policy ? <PolicyVerdict policy={result.data.policy} onGo={onGo} /> : <PolicyPreview type={type} purpose={purpose} kiosk={Boolean(kioskStudentId)} />}
    </form>
  );
}

function DocRow({ d, staff, admin, onChanged, onGo }) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn, text) => {
    setBusy(true);
    const r = await attempt(fn, text);
    setResult(r);
    setBusy(false);
    if (!r.error) onChanged?.();
  };
  return (
    <article className="ext-card">
      <div className="ext-row" style={{ justifyContent: "space-between" }}>
        <div className="ext-row">
          <b>{d.reference}</b>
          <Tag kind={d.status === "ISSUED" ? "SAFE" : d.status === "REJECTED" ? "CRITICAL" : "WATCH"}>{d.status}</Tag>
          {d.certificate?.revokedAt ? <Tag kind="CRITICAL">REVOKED</Tag> : null}
          <Tag kind={SLA_TAG[d.sla.state] || "muted"}>SLA {d.sla.state.replace("_", " ")}</Tag>
          {d.channel !== "APP" ? <Tag kind="muted">VIA {d.channel}{d.operator ? ` · ${d.operator.name}` : ""}</Tag> : null}
          {/* EXCEPTION-ONLY HOOK */}
          {d.decidedBy === "POLICY" ? <Tag kind="SAFE">⚡ AUTO-ISSUED UNDER {d.policyDecision?.citation?.section}</Tag> : null}
        </div>
        <span className="ci-meta">{dt(d.createdAt)}</span>
      </div>
      <h3>{d.typeLabel}{staff && d.student ? ` — ${d.student.name}` : ""}</h3>
      <p className="ci-body" style={{ margin: 0 }}>Purpose: {d.purpose}</p>
      {d.rejectionReason ? <p className="ci-result ci-result-err">Rejected: {d.rejectionReason}</p> : null}
      {d.evidence ? <div className="ext-row" style={{ marginTop: 8 }}><Kind kind="EVIDENCE" /><span className="ci-meta">{d.evidence.note}</span></div> : null}
      {d.certificate ? (
        <div className="ext-row" style={{ marginTop: 8 }}>
          <span className="ci-meta">Verification code</span><b className="ext-code">{d.certificate.verificationCode}</b>
          <span className="ci-meta">SHA-256 {d.certificate.digestShort}…</span>
          <a className="ci-link" href={`/verify/${d.certificate.verificationCode}`} target="_blank" rel="noopener noreferrer">VERIFY PAGE</a>
        </div>
      ) : null}
      {/* EXCEPTION-ONLY HOOK: why it was decided the way it was (compact), and staff UNDO of a policy issue. */}
      {d.policyDecision && (d.decidedBy === "POLICY" || OPEN_STATES.includes(d.status)) ? <PolicyVerdict policy={d.policyDecision} onGo={onGo} compact /> : null}
      {d.policyUndo ? <p className="ci-meta">{d.policyUndo.from ? `Reopened after ${d.policyUndo.byName} undid ${d.policyUndo.from}: ${d.policyUndo.reason}` : `Automatic issue undone by ${d.policyUndo.byName}: ${d.policyUndo.reason}${d.policyUndo.followUp ? ` · follow-up ${d.policyUndo.followUp}` : ""}`}</p> : null}
      {staff && d.decidedBy === "POLICY" && !d.policyUndo && !d.certificate?.revokedAt ? <UndoPolicy kind="document" id={d.id} onDone={onChanged} label="UNDO POLICY ISSUE" /> : null}
      <RequestTimeline timeline={documentTimeline(d)} />
      <div className="ext-actions">
        {d.status === "ISSUED" ? <button type="button" className="btn btn-secondary" onClick={() => openPdf(d.id, setResult)}>DOWNLOAD PDF</button> : null}
        {staff && d.status === "SUBMITTED" ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act(() => ext.documentReview(d.id, { decision: "START_REVIEW" }), "Now under review.")}>START REVIEW</button> : null}
        {staff && ["SUBMITTED", "UNDER_REVIEW"].includes(d.status) ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => ext.documentReview(d.id, { decision: "APPROVE" }), "Approved.")}>APPROVE</button> : null}
        {staff && d.status === "APPROVED" ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => ext.documentIssue(d.id), (r) => `Issued with code ${r.certificate?.verificationCode}.`)}>ISSUE CERTIFICATE</button> : null}
      </div>
      {staff && ["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(d.status) ? (
        <div className="ext-row" style={{ marginTop: 8 }}>
          <input className="ci-input" style={{ flex: "1 1 220px" }} placeholder="Reason (required to reject)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} />
          <button type="button" className="btn btn-secondary" disabled={busy || reason.trim().length < 5} onClick={() => act(() => ext.documentReview(d.id, { decision: "REJECT", reason }), "Rejected with reason.")}>REJECT</button>
        </div>
      ) : null}
      {admin && d.status === "ISSUED" && !d.certificate?.revokedAt ? (
        <div className="ext-row" style={{ marginTop: 8 }}>
          <input className="ci-input" style={{ flex: "1 1 220px" }} placeholder="Reason for revocation" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} />
          <button type="button" className="btn btn-secondary" disabled={busy || reason.trim().length < 5} onClick={() => act(() => ext.documentRevoke(d.id, reason), "Revoked. Verification now reports REVOKED.")}>REVOKE</button>
        </div>
      ) : null}
      <Outcome result={result} />
    </article>
  );
}

export default function DocumentsSurface({ user, lowBw, onGo }) {
  const staff = isStaff(user);
  const [filter, setFilter] = useState(staff ? "OPEN" : "ALL");
  const [nonce, setNonce] = useState(0);
  const q = useExt(`docs:${user?.id}:${nonce}:${lowBw}`, () => ext.documents(lowBw), { enabled: Boolean(user) });
  const refresh = () => setNonce((n) => n + 1);
  return (
    <div className="ci ext">
      <PageHead num="14" kicker="DOCUMENTS & CERTIFICATES" title={staff ? "Certificate desk, with an SLA on every request." : "Your certificates, without the office queue."}>
        Request a bonafide, no-dues, hostel-residence or character certificate. Once issued it downloads as a PDF with a QR code; anyone can scan it to check it is genuine, unchanged and not revoked.
      </PageHead>
      <EvalKicker
        problem="Office queues for routine certificates; paper slips and editable PDFs invite tampering and fraud."
        solution="Rule §4.2 evaluates 3 conditions (enrolled, dues ≤ ₹1,000, < 5 requests/month). If all pass: instant issuance in 0 touches with public QR code."
        tryAction="Submit a Bonafide request with dues under ₹1,000 to see instant auto-issuance, or test the public verify link."
      />
      <div style={{ marginTop: 18 }}><NetLine /></div>
      {!user ? <SignInNote what="your documents" /> : (
        <ExtSection q={q}>
          {(d) => {
            const OPEN = ["SUBMITTED", "UNDER_REVIEW", "APPROVED"];
            const list = d.documents.filter((x) => (filter === "OPEN" ? OPEN.includes(x.status) : filter === "DONE" ? !OPEN.includes(x.status) : true));
            return (
              <div className="ext-stack">
                <div className="ext-row"><Kind kind={d.kind} />{Object.entries(d.counts).map(([k, v]) => <span key={k} className="ci-meta">{k} {v}</span>)}</div>
                {!staff ? <div className="ext-card ext-card-strong"><div className="ci-label" style={{ marginBottom: 10 }}>New request</div><RequestForm types={d.types} onDone={refresh} onGo={onGo} /></div> : null}
                <div className="ext-tabs" role="group" aria-label="Filter documents">
                  {[["OPEN", "OPEN"], ["DONE", "ISSUED / REJECTED"], ["ALL", "ALL"]].map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
                </div>
                {list.length ? list.map((doc) => <DocRow key={doc.id} d={doc} staff={staff} admin={isAdmin(user)} onChanged={refresh} onGo={onGo} />) : <StateBox title="No requests here">Nothing matches this filter.</StateBox>}
              </div>
            );
          }}
        </ExtSection>
      )}
    </div>
  );
}

/** The kiosk's Documents tile (hooked into components/intel/Kiosk.jsx). */
export function KioskDocuments({ student }) {
  return (
    <div className="ci ext" style={{ padding: 0 }}>
      <div className="ext-stack">
        <p className="ci-meta" style={{ margin: 0 }}>Filed as {student.name} ({student.studentIdMasked}) with channel KIOSK; the operator's name is recorded on the request. The student collects the PDF in the app, or the desk prints it once issued.</p>
        <RequestForm types={DOC_TYPES} kioskStudentId={student.studentId} />
      </div>
    </div>
  );
}
