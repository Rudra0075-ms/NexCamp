import React, { useEffect, useState } from "react";
import { api, isOnline, queueSize, syncQueue } from "../../lib/api.js";
import { BarList, Guard, StateBox, Tag, invalidate } from "./kit.jsx";
import EvalKicker from "../EvalKicker.jsx";
import "./intel.css";
const KioskReachList = React.lazy(() => import("../../xo/ReachPanels.jsx").then((m) => ({ default: m.KioskReachList }))); // EXCEPTION-ONLY HOOK
// EXTENSION HOOK (see HOOKS.md): the Documents tile opens the new document flow.
const KioskDocuments = React.lazy(() => import("../../ext/DocumentsSurface.jsx").then((m) => ({ default: m.KioskDocuments })));

/*
 * Campus Service Kiosk — assisted access for students without a smartphone
 * (PS07 feature 5).
 *
 * A help-desk operator signs in with a staff account and enters the student's
 * ID from their card. Every service runs the same backend workflow the app
 * uses, so kiosk requests appear in the same queues and in Mission Control,
 * marked with the channel and the operator. Writes go through the existing
 * offline queue: on a dropped connection a complaint or mess rating is held
 * and replayed, and the screen says so instead of claiming success.
 */

const CATEGORIES = ["WATER", "ELECTRICITY", "WI-FI", "CLEANLINESS", "MESS", "SAFETY", "HEALTH", "OTHER"];
const MEALS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];

const pad = (n) => String(n).padStart(2, "0");
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function NetLine() {
  const [state, setState] = useState({ online: isOnline(), queued: queueSize() });
  useEffect(() => {
    const tick = () => setState({ online: isOnline(), queued: queueSize() });
    const onOnline = async () => {
      await syncQueue().catch(() => null);
      tick();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", tick);
    const t = setInterval(tick, 3000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", tick);
      clearInterval(t);
    };
  }, []);
  return (
    <div className="ci-meta" role="status" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Tag kind={state.online ? "SAFE" : "OFFLINE"}>{state.online ? "CONNECTED" : "OFFLINE"}</Tag>
      {state.queued ? <span>{state.queued} request{state.queued === 1 ? "" : "s"} held — sent automatically when the connection returns.</span> : <span>Requests made offline are held and sent when the connection returns.</span>}
    </div>
  );
}

function Outcome({ result }) {
  if (!result) return null;
  return <div role="status" className={`ci-result ${result.ok ? (result.queued ? "ci-result-warn" : "") : "ci-result-err"}`}>{result.text}</div>;
}

function ComplaintForm({ student }) {
  const [form, setForm] = useState({ category: "WATER", location: [student.hostelName, student.room].filter(Boolean).join(" · "), title: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await api.kioskComplaint({ studentId: student.studentId, ...form });
      if (res.queued) setResult({ ok: true, queued: true, text: "No connection — the complaint is held on this kiosk and will be filed automatically when the connection returns." });
      else {
        const c = res.data?.data?.complaint || res.data?.complaint;
        setResult({ ok: true, text: `Filed as ${c?.reference || "a new complaint"}. Give the student this reference. It is now in the staff queue${c?.department ? ` for ${c.department}` : ""}.` });
        setForm((f) => ({ ...f, title: "", description: "" }));
        invalidate("ps07:");
      }
    } catch (err) {
      setResult({ ok: false, text: err.message || "Could not file the complaint" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="ci-form" onSubmit={submit}>
      <label><span className="ci-label">Category</span>
        <select className="ci-select" value={form.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label><span className="ci-label">Where</span><input className="ci-input" value={form.location} onChange={set("location")} maxLength={160} /></label>
      <label><span className="ci-label">What is wrong (short)</span><input className="ci-input" value={form.title} onChange={set("title")} required minLength={3} maxLength={160} placeholder="e.g. No water on the second floor" /></label>
      <label><span className="ci-label">Details</span><textarea className="ci-input ci-textarea" style={{ fontFamily: "inherit", fontSize: 16 }} value={form.description} onChange={set("description")} required minLength={5} maxLength={2000} rows={4} /></label>
      <div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "FILING…" : "FILE COMPLAINT"}</button></div>
      <Outcome result={result} />
    </form>
  );
}

function GatePassForm({ student, service }) {
  const now = new Date(Date.now() + 30 * 60000);
  const [form, setForm] = useState({ reason: "", destination: "", leaveAt: localInput(now), expectedReturnAt: localInput(new Date(now.getTime() + 4 * 3600000)) });
  const [pass, setPass] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!service.available) return <StateBox title="Gate pass unavailable">{service.note}</StateBox>;

  const apply = async (e) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await api.kioskGatePass({
        studentId: student.studentId,
        reason: form.reason,
        destination: form.destination || undefined,
        leaveAt: new Date(form.leaveAt).toISOString(),
        expectedReturnAt: new Date(form.expectedReturnAt).toISOString()
      });
      setPass({ ...res.gatePass, otp: res.otp });
      setResult({ ok: true, text: `Applied as ${res.gatePass.reference}. A code was sent to the guardian at ${res.otp?.phoneMasked}. Ask the student to call the guardian and enter the code they read out.` });
    } catch (err) {
      setResult({ ok: false, text: err.message || "Could not apply" });
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.kioskVerifyOtp(pass.id, student.studentId, code);
      setResult({ ok: true, text: `Guardian verified. ${pass.reference} now waits for the warden's approval, as in the app.` });
      setPass(null);
      setCode("");
    } catch (err) {
      setResult({ ok: false, text: err.message || "The code did not match" });
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setBusy(true);
    try {
      const res = await api.kioskSendOtp(pass.id, student.studentId);
      setPass((p) => ({ ...p, otp: res.otp || p.otp }));
      setResult({ ok: true, text: "A new code was sent to the guardian." });
    } catch (err) {
      setResult({ ok: false, text: err.message || "Could not resend" });
    } finally {
      setBusy(false);
    }
  };

  if (pass) {
    return (
      <form className="ci-form" onSubmit={verify}>
        <label><span className="ci-label">Guardian's code</span>
          <input className="ci-input" inputMode="numeric" pattern="[0-9]{4,8}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus />
        </label>
        {pass.otp?.devCode ? <p className="ci-meta">Demo build: the SMS gateway is not connected, so the code is shown here — {pass.otp.devCode}.</p> : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "CHECKING…" : "VERIFY CODE"}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={resend}>RESEND CODE</button>
        </div>
        <Outcome result={result} />
      </form>
    );
  }
  return (
    <form className="ci-form" onSubmit={apply}>
      <p className="ci-meta" style={{ lineHeight: 1.5 }}>{service.note}</p>
      <label><span className="ci-label">Reason</span><input className="ci-input" value={form.reason} onChange={set("reason")} required maxLength={500} placeholder="e.g. Medical appointment" /></label>
      <label><span className="ci-label">Destination</span><input className="ci-input" value={form.destination} onChange={set("destination")} maxLength={200} /></label>
      <label><span className="ci-label">Leaving at</span><input className="ci-input" type="datetime-local" value={form.leaveAt} onChange={set("leaveAt")} required /></label>
      <label><span className="ci-label">Back by</span><input className="ci-input" type="datetime-local" value={form.expectedReturnAt} onChange={set("expectedReturnAt")} required /></label>
      <div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "APPLYING…" : "APPLY FOR GATE PASS"}</button></div>
      <p className="ci-meta">Gate passes need the guardian's live code, so they are not queued offline.</p>
      <Outcome result={result} />
    </form>
  );
}

function MessForm({ student }) {
  const [meal, setMeal] = useState("LUNCH");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!rating) return setResult({ ok: false, text: "Choose a rating from 1 to 5" });
    setBusy(true);
    setResult(null);
    try {
      const res = await api.kioskMessFeedback({ studentId: student.studentId, meal, rating, comment: comment || undefined });
      setResult(res.queued
        ? { ok: true, queued: true, text: "No connection — the rating is held and will be sent when the connection returns." }
        : { ok: true, text: `Recorded: ${meal.toLowerCase()} rated ${rating}/5. It counts in the mess analysis like any app rating.` });
      if (!res.queued) {
        setComment("");
        setRating(0);
      }
    } catch (err) {
      setResult({ ok: false, text: err.message || "Could not record the rating" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="ci-form" onSubmit={submit}>
      <div className="ci-seg" role="group" aria-label="Meal">
        {MEALS.map((m) => <button key={m} type="button" aria-pressed={meal === m} onClick={() => setMeal(m)}>{m}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} className="ci-chip" aria-pressed={rating === n} style={{ minHeight: 48, minWidth: 56, fontSize: 16 }} onClick={() => setRating(n)}>{n}★</button>)}
      </div>
      <label><span className="ci-label">Comment (optional)</span><input className="ci-input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} /></label>
      <div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "SENDING…" : "SUBMIT RATING"}</button></div>
      <Outcome result={result} />
    </form>
  );
}

function ServicePanel({ service, data }) {
  const { student } = data;
  if (service.key === "complaint") return <ComplaintForm student={student} />;
  if (service.key === "gatepass") return <GatePassForm student={student} service={service} />;
  if (service.key === "mess") return <MessForm student={student} />;
  if (service.key === "documents") return <React.Suspense fallback={null}><KioskDocuments student={student} /></React.Suspense>; // EXTENSION HOOK
  if (service.key === "attendance") {
    const a = data.attendance;
    return (
      <div className="ci-form">
        <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
          <b className="ci-num" style={{ fontFamily: "var(--font-heading)", fontSize: 48, fontWeight: 800 }}>{a.overall}%</b>
          <Tag kind={a.eligible ? "SAFE" : "AT RISK"}>{a.eligible ? "ELIGIBLE" : `BELOW ${a.threshold}%`}</Tag>
          <span className="ci-meta">{a.attendedClasses} of {a.totalClasses} classes attended</span>
        </div>
        <BarList max={100} threshold={a.threshold} unit="%" data={a.subjects.map((s) => ({ label: s.subject, value: s.percentage, highlight: s.atRisk }))} />
      </div>
    );
  }
  if (service.key === "notices") {
    return data.notices.length ? (
      <div className="ci-form">
        {data.notices.map((n, i) => (
          <div key={i} style={{ borderBottom: "1px solid var(--ci-soft)", paddingBottom: 10 }}>
            <b>{n.title}</b>
            {n.body ? <p className="ci-body" style={{ marginTop: 4 }}>{n.body}</p> : null}
            <span className="ci-meta">{new Date(n.at).toLocaleString("en-IN")}</span>
          </div>
        ))}
      </div>
    ) : <StateBox title="No notices">There are no notices for this student.</StateBox>;
  }
  return <StateBox title={`${service.label} unavailable`}>{service.note}</StateBox>;
}

export default function Kiosk({ live, signedIn, staff, operator }) {
  const [id, setId] = useState("");
  const [data, setData] = useState(null);
  const [service, setService] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const doLookup = async (targetId) => {
    const cleanId = (targetId || id).trim();
    if (!cleanId) return;
    setId(cleanId);
    setBusy(true);
    setError(null);
    try {
      setData(await api.kioskLookup(cleanId));
      setService(null);
    } catch (err) {
      setData(null);
      setError(err.message || "Lookup failed");
    } finally {
      setBusy(false);
    }
  };

  const lookup = (e) => {
    if (e) e.preventDefault();
    doLookup(id);
  };
  const end = () => {
    setData(null);
    setService(null);
    setId("");
    setError(null);
  };

  const effectiveOperator = operator || (staff ? "Staff Operator" : "Help Desk Operator (Desk 1)");

  return (
    <div className="ci">
      <div className="ci-head" style={{ borderBottom: "2px solid var(--ci-line)", paddingBottom: 14 }}>
        <div className="ci-kicker">12 — ASSISTED ACCESS</div>
        <h1 className="ci-h1" style={{ margin: "8px 0 0" }}>Campus Service Kiosk</h1>
        <p className="ci-body" style={{ marginTop: 8, maxWidth: "70ch" }}>
          For students without a smartphone. A help-desk operator enters the student ID; every request goes through the same system as the app and appears in Mission Control.
        </p>
      </div>

      <EvalKicker
        problem="Students without smartphones or cellular data are excluded from digital campus services."
        solution="Assisted operator kiosk using student ID card, routed into identical backend queues with operator attribution."
        tryAction="Click any of the Quick Student Lookup buttons (e.g. Pritish BPUT/CSE/22/0425) to launch an assisted session."
      />

      {!live ? (
        <div style={{ marginTop: 20 }}><StateBox kind="offline" title="Backend offline">The kiosk files requests into the live system, so it needs the NeX Camp API.</StateBox></div>
      ) : (
        <Guard name="Kiosk">
          <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
            <NetLine />
            {!data ? (
              <form onSubmit={lookup}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                  <span className="ci-meta" style={{ fontWeight: 600 }}>Quick Student Lookup:</span>
                  <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => doLookup("BPUT/CSE/22/0417")}>
                    ⚡ BPUT/CSE/22/0417 (Pritish · CSE)
                  </button>
                  <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => doLookup("BPUT/CSE/22/0418")}>
                    ⚡ BPUT/CSE/22/0418 (Ankita · CSE)
                  </button>
                  <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => doLookup("BPUT/CSE/22/0419")}>
                    ⚡ BPUT/CSE/22/0419 (Rahul · CSE)
                  </button>
                  <button type="button" className="btn btn-secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => doLookup("BPUT/CSE/22/0430")}>
                    ⚡ BPUT/CSE/22/0430 (Sourav · CSE)
                  </button>
                </div>
                <label className="ci-label" htmlFor="kiosk-id" style={{ display: "block", marginBottom: 8 }}>Student ID or Name</label>
                <div className="ci-kiosk-id">
                  <input id="kiosk-id" className="ci-input" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. BPUT/CSE/22/0417, or 0417, or Pritish" autoComplete="off" autoFocus />
                  <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "FINDING…" : "FIND STUDENT →"}</button>
                </div>
                {error ? <div style={{ marginTop: 12 }}><StateBox kind="error" title="Not found">{error}</StateBox></div> : null}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                  <p className="ci-meta" style={{ margin: 0 }}>Operator: {effectiveOperator}. Every request is recorded with the operator's name.</p>
                  <Tag kind="SAFE">ASSISTED KIOSK ACTIVE</Tag>
                </div>
              </form>
            ) : null}
            {/* EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): students with unread critical notices, printable. */}
            {!data ? (
              <React.Suspense fallback={null}><KioskReachList /></React.Suspense>
            ) : (
              <>
                <div className="ci-between" style={{ gap: 12, flexWrap: "wrap", borderBottom: "2px solid var(--ci-line)", paddingBottom: 14 }}>
                  <div>
                    <div className="ci-label">STUDENT</div>
                    <div className="ci-h2" style={{ marginTop: 4 }}>{data.student.name}</div>
                    <div className="ci-meta" style={{ marginTop: 4 }}>
                      {data.student.studentIdMasked} · {data.student.department}{data.student.semester ? ` · Sem ${data.student.semester}` : ""}{data.student.hostelName ? ` · ${data.student.hostelName} ${data.student.room || ""}` : ""}
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={end}>END SESSION</button>
                </div>
                <div className="ci-services">
                  {data.services.map((sv) => (
                    <button key={sv.key} type="button" className="ci-service" aria-pressed={service?.key === sv.key} disabled={!sv.available && sv.key !== "gatepass" && sv.key !== "documents" /* EXTENSION HOOK */} onClick={() => setService(sv)}>
                      <b>{sv.label}</b>
                      <span className="ci-meta">{sv.available || sv.key === "documents" /* EXTENSION HOOK */ ? "Available" : "Not available"}</span>
                    </button>
                  ))}
                </div>
                {service ? (
                  <div className="ci-section" style={{ borderTop: "2px solid var(--ci-line)", paddingTop: 16 }}>
                    <div className="ci-h2" style={{ marginBottom: 12 }}>{service.label}</div>
                    <Guard name={service.label}><ServicePanel service={service} data={data} /></Guard>
                  </div>
                ) : null}
                {data.complaints.length ? (
                  <div>
                    <div className="ci-label" style={{ marginBottom: 8 }}>Recent requests</div>
                    <div className="ci-table-wrap">
                      <table className="ci-table">
                        <thead><tr><th>Ref</th><th>Complaint</th><th>Status</th><th>Via</th></tr></thead>
                        <tbody>{data.complaints.map((c) => <tr key={c.id}><td className="ci-num">{c.reference}</td><td>{c.title}</td><td>{c.status}</td><td>{c.channel || "APP"}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </Guard>
      )}
    </div>
  );
}
