import React, { useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { RequestTimeline } from "../components/ai.jsx";
import EvalKicker from "../components/EvalKicker.jsx";
import { ext } from "./api.js";
import { ExtSection, Kind, NetLine, Outcome, PageHead, SignInNote, SourceLine, attempt, dt, isStaff, useExt } from "./kit.jsx";
import { DecisionLine, EtaHint, useEtas } from "../xo/kit.jsx"; // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md)
import { PfSlot } from "../proof/ProofEntry.jsx"; // ROUND-3 HOOK (see CHANGES-ROUND3.md)

/*
 * 17 — MY REQUESTS. One timeline across complaints, gate passes, document
 * requests, action-required notices and reopen requests (read-only; the
 * complaint and gate-pass stages come from the existing timelineService).
 * Plus "Is it fixed?" for resolved complaints, and — for staff — attaching a
 * proof-of-fix photo, compressed on this device before upload.
 */

const KIND_LABEL = { complaint: "COMPLAINT", gatepass: "GATE PASS", document: "DOCUMENT", notice: "NOTICE ACTION", reopen: "REOPEN", /* EXCEPTION-ONLY HOOK */ service: "RECEIPT COPY" };

function FixQuestion({ item, onDone }) {
  const [comment, setComment] = useState("");
  const [result, setResult] = useState(null);
  const answer = async (response) => {
    const r = await attempt(() => ext.fixConfirm(item.complaintId, { response, comment: comment || undefined }), (d) => (d.reopen ? `Recorded. Reopen request ${d.reopen.reference} was sent to ${item.department}. The original complaint stays resolved.` : "Thanks — recorded as fixed."));
    setResult(r);
    if (!r.error) onDone?.();
  };
  return (
    <article className="ext-card ext-card-accent">
      <div className="ext-row" style={{ justifyContent: "space-between" }}><b>{item.reference}</b><span className="ci-meta">resolved {dt(item.resolvedAt)}</span></div>
      <h3>{item.title}</h3>
      {item.resolutionDescription ? <p className="ci-body" style={{ margin: 0 }}>Fix recorded: {item.resolutionDescription}</p> : null}
      {item.proofs.map((p) => (
        <figure key={p.id} style={{ margin: "10px 0 0", display: "grid", gap: 6 }}>
          {p.photo ? <img src={p.photo} alt={`Proof of fix for ${item.reference}`} loading="lazy" style={{ maxWidth: "min(100%, 320px)", border: "2px solid var(--ci-line)" }} /> : null}
          <figcaption className="ci-meta"><Kind kind="EVIDENCE" /> {p.note || "Photo"} — {p.byName}, {dt(p.at)}</figcaption>
        </figure>
      ))}
      {item.response === "PENDING" ? (
        <>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: 20, margin: "12px 0 6px" }}>Is it fixed?</p>
          <input className="ci-input" style={{ width: "100%" }} placeholder="Optional note" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={400} />
          <div className="ext-actions">
            <button type="button" className="btn btn-primary" onClick={() => answer("YES")}>YES, FIXED</button>
            <button type="button" className="btn btn-secondary" onClick={() => answer("NOT_FIXED")}>NOT FIXED</button>
          </div>
          <p className="ci-meta">No answer by {dt(item.answerBy)} is recorded as NO RESPONSE.</p>
        </>
      ) : (
        <div className="ext-row" style={{ marginTop: 10 }}><Tag kind={item.response === "YES" ? "SAFE" : item.response === "NOT_FIXED" ? "CRITICAL" : "muted"}>{item.response.replace("_", " ")}</Tag>{item.reopen ? <span className="ci-meta">Reopen {item.reopen.reference} · {item.reopen.status}</span> : null}</div>
      )}
      <Outcome result={result} />
    </article>
  );
}

function Mine({ user, lowBw }) {
  const [nonce, setNonce] = useState(0);
  const q = useExt(`mine:${user.id}:${nonce}:${lowBw}`, () => ext.myRequests(lowBw));
  const fixq = useExt(`fixmine:${user.id}:${nonce}`, () => ext.fixMine());
  const [kind, setKind] = useState("ALL");
  const etas = useEtas(); // EXCEPTION-ONLY HOOK: P50/P80 ETAs for open requests
  const [open, setOpen] = useState(true);
  return (
    <div className="ext-stack">
      <ExtSection q={fixq} lines={2}>
        {(d) => {
          const pending = d.items.filter((i) => i.response === "PENDING");
          return pending.length ? (
            <div className="ext-stack"><h2 className="ext-h2">Please confirm {pending.length === 1 ? "this fix" : "these fixes"}</h2>{pending.map((i) => <FixQuestion key={i.complaintId} item={i} onDone={() => setNonce((n) => n + 1)} />)}</div>
          ) : null;
        }}
      </ExtSection>
      <ExtSection q={q}>
        {(d) => {
          const items = d.items.filter((i) => (kind === "ALL" || i.kind === kind) && (!open || i.open));
          return (
            <div className="ext-stack">
              <div className="ext-row" style={{ justifyContent: "space-between" }}>
                <div className="ext-tabs" role="group" aria-label="Request kind">
                  {["ALL", "complaint", "gatepass", "document", "notice", "reopen", /* EXCEPTION-ONLY HOOK */ ...(d.summary.byKind.service ? ["service"] : [])].map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "ALL" ? `ALL ${d.summary.total}` : `${KIND_LABEL[k]} ${d.summary.byKind[k]}`}</button>)}
                </div>
                <label className="ext-row ci-meta"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> Open only ({d.summary.open})</label>
              </div>
              {items.length ? items.map((i) => (
                <article key={`${i.kind}${i.id}`} className="ext-card">
                  <div className="ext-row" style={{ justifyContent: "space-between" }}>
                    <div className="ext-row"><Tag kind="muted">{KIND_LABEL[i.kind]}</Tag><b>{i.reference}</b><Tag kind={i.open ? "WATCH" : "SAFE"}>{i.status}</Tag>{i.channel && i.channel !== "APP" ? <Tag kind="muted">VIA {i.channel}</Tag> : null}</div>
                    <span className="ci-meta">{dt(i.createdAt)}</span>
                  </div>
                  <h3>{i.title}</h3>
                  {/* EXCEPTION-ONLY HOOK: who decided — written policy or a named person — and why. */}
                  <DecisionLine decision={i.decision} />
                  <EtaHint item={i} etas={etas} />
                  <RequestTimeline timeline={i} />
                </article>
              )) : <StateBox title="Nothing here">No requests match.</StateBox>}
              <SourceLine method={d.method} note="read-only projection of the stored records" />
            </div>
          );
        }}
      </ExtSection>
    </div>
  );
}

// ---- staff: proof of fix ------------------------------------------------------------

/** Downscales to at most 800px and re-encodes as JPEG until it fits the cap. */
export async function compressImage(file, { maxSide = 800, maxChars = 130000 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file is not an image this browser can read"));
      el.src = url;
    });
    let scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    for (let attemptNo = 0; attemptNo < 6; attemptNo += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.7, 0.55, 0.4]) {
        const data = canvas.toDataURL("image/jpeg", quality);
        if (data.length <= maxChars) return { data, width: canvas.width, height: canvas.height, originalBytes: file.size, bytes: Math.round((data.length * 3) / 4) };
      }
      scale *= 0.75;
    }
    throw new Error("Could not compress the photo under the size cap");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProofForm({ c, onDone }) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch (error) {
      setResult({ error: error.message });
    }
  };
  const submit = async () => {
    setBusy(true);
    const r = await attempt(() => ext.fixAttach(c.id, { note: note || undefined, photo: photo?.data }), "Proof attached. The student has been asked to confirm the fix.");
    setResult(r);
    setBusy(false);
    if (!r.error) {
      setNote("");
      setPhoto(null);
      onDone?.();
    }
  };
  return (
    <div className="ext-stack" style={{ marginTop: 10 }}>
      <input type="file" accept="image/*" capture="environment" onChange={pick} aria-label={`Photo for ${c.reference}`} />
      {photo ? <div className="ext-row"><img src={photo.data} alt="Compressed preview" style={{ maxWidth: 160, border: "2px solid var(--ci-line)" }} /><span className="ci-meta">{Math.round(photo.originalBytes / 1024)} KB → {Math.round(photo.bytes / 1024)} KB · {photo.width}×{photo.height} (compressed on this device)</span></div> : null}
      <input className="ci-input" placeholder="Note — what was done" value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
      <div><button type="button" className="btn btn-primary" disabled={busy || (!note && !photo)} onClick={submit}>ATTACH PROOF</button></div>
      <Outcome result={result} />
    </div>
  );
}

function StaffFix({ lowBw }) {
  const [nonce, setNonce] = useState(0);
  const q = useExt(`fixres:${nonce}:${lowBw}`, () => ext.fixResolved(lowBw));
  const [open, setOpen] = useState(null);
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-stack">
          <p className="ci-body" style={{ margin: 0 }}>Optional step after the existing resolve flow: attach a photo and a note. The resolve flow itself is unchanged.</p>
          {d.complaints.map((c) => (
            <article key={c.id} className="ext-card">
              <div className="ext-row" style={{ justifyContent: "space-between" }}>
                <div className="ext-row"><b>{c.reference}</b><Tag kind="muted">{c.department}</Tag><Tag kind={c.proofs ? "SAFE" : "WATCH"}>{c.proofs ? `${c.proofs} PROOF` : "NO PROOF"}</Tag><Tag kind={c.confirmation === "YES" ? "SAFE" : c.confirmation === "NOT_FIXED" ? "CRITICAL" : "muted"}>{c.confirmation.replace("_", " ")}</Tag></div>
                <span className="ci-meta">resolved {dt(c.resolvedAt)}</span>
              </div>
              <h3>{c.title}</h3>
              <button type="button" className="ci-link" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "CLOSE" : "ATTACH PROOF OF FIX"}</button>
              {open === c.id ? <ProofForm c={c} onDone={() => setNonce((n) => n + 1)} /> : null}
            </article>
          ))}
        </div>
      )}
    </ExtSection>
  );
}

export default function RequestsSurface({ user, lowBw, live = true, onGo }) {
  const staff = isStaff(user);
  return (
    <div className="ci ext">
      <PageHead num="17" kicker={staff ? "PROOF OF FIX" : "MY REQUESTS"} title={staff ? "Show the fix, then let the student confirm it." : "Everything you have asked for, in one timeline."}>
        {staff
          ? "Attach a compressed photo and a note to a resolved complaint. The student is asked \"Is it fixed?\"; NOT FIXED opens a linked reopen request for the department, and 48 hours of silence is recorded as NO RESPONSE."
          : "Complaints, gate passes, certificates, notices that need an action, and reopen requests — each with the same stage-by-stage timeline, read straight from the records."}
      </PageHead>
      <EvalKicker
        problem="Staff mark complaints 'Resolved' to clear backlogs, but the physical defect persists ('closed problems that come back')."
        solution="'Is it fixed?' student confirmation creates a verified reopen loop (RPN-2026-0001) audited in Mission Control."
        tryAction="Click 'NOT FIXED' on any resolved complaint to test verified reopen generation and false closures audit."
      />
      <div style={{ marginTop: 18 }}><NetLine /></div>
      {!user ? <SignInNote what="your requests" /> : staff ? <StaffFix lowBw={lowBw} /> : <>{/* ROUND-3 HOOK: the one action that unblocks the most requests */}<PfSlot name="unblock" live={live} user={user} onGo={onGo} /><Mine user={user} lowBw={lowBw} /></>}
    </div>
  );
}
