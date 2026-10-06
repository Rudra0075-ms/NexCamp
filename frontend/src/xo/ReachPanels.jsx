import React, { useEffect, useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, Outcome, SourceLine, attempt, dt, useExt } from "../ext/kit.jsx";
import { xo } from "./api.js";

/*
 * Phase 5 — guaranteed reach, on page 13 (composer, delivery dashboard, feed,
 * class representatives) and page 12 (the help-desk kiosk list).
 */

const RUNG_LABEL = { IN_APP: "IN-APP", SMS: "SMS", CLASS_REP: "CLASS REP", KIOSK: "KIOSK LIST", NOT_DELIVERED: "NOT DELIVERED" };

/** True when the composer must go through /api/xo/notices (reach target, supersession, override). */
export const needsReachEndpoint = (o) => Boolean(o && (o.reachOn || o.supersedes || o.overrideQuietHours));

/** The payload additions the xo endpoint understands. */
export function reachPayload(o) {
  if (!o) return {};
  return {
    reachTarget: o.reachOn && o.deadline ? { pct: Number(o.pct) || 100, deadline: new Date(o.deadline).toISOString() } : undefined,
    supersedes: o.supersedes || undefined,
    overrideQuietHours: o.overrideQuietHours || undefined,
    overrideReason: o.overrideQuietHours ? o.overrideReason || undefined : undefined
  };
}

/** Composer additions: reach target + deadline, quiet-hours override, and the hygiene check. */
export function ReachOptions({ value, onChange, draft }) {
  const o = value || {};
  const set = (k, v) => onChange({ ...o, [k]: v });
  const [check, setCheck] = useState(null);
  const key = JSON.stringify(draft);
  useEffect(() => {
    if (!draft?.title && !draft?.body) {
      setCheck(null);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      xo.hygiene(draft).then((r) => alive && setCheck(r)).catch(() => alive && setCheck(null));
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ext-card">
      <div className="ci-label" style={{ marginBottom: 8 }}>Guaranteed reach</div>
      <label className="ext-row"><input type="checkbox" checked={Boolean(o.reachOn)} onChange={(e) => set("reachOn", e.target.checked)} /> <span>Reach target — keep escalating until this share of the audience has read it</span></label>
      {o.reachOn ? (
        <div className="ext-grid-3" style={{ marginTop: 8 }}>
          <label className="ext-field"><span className="ci-label">Target %</span><input className="ci-input" type="number" min="1" max="100" value={o.pct ?? 100} onChange={(e) => set("pct", e.target.value)} /></label>
          <label className="ext-field"><span className="ci-label">By</span><input className="ci-input" type="datetime-local" value={o.deadline || ""} onChange={(e) => set("deadline", e.target.value)} /></label>
          <p className="ci-meta" style={{ margin: 0, alignSelf: "end" }}>Unread recipients move in-app → SMS (25% of the time) → class rep (50%) → kiosk list (75%).</p>
        </div>
      ) : null}
      {check?.quietHours?.held ? (
        <div className="ci-result ci-result-warn" role="status" style={{ marginTop: 8 }}>
          {check.quietHours.text}
          <label className="ext-row" style={{ marginTop: 6 }}><input type="checkbox" checked={Boolean(o.overrideQuietHours)} onChange={(e) => set("overrideQuietHours", e.target.checked)} /> Send now anyway (recorded with your name)</label>
          {o.overrideQuietHours ? <input className="ci-input" style={{ marginTop: 6, width: "100%" }} placeholder="Why it cannot wait" maxLength={200} value={o.overrideReason || ""} onChange={(e) => set("overrideReason", e.target.value)} /> : null}
        </div>
      ) : null}
      {check?.supersedes ? (
        <div className="ci-result ci-result-warn" role="status" style={{ marginTop: 8 }}>
          {check.supersedes.text}
          <label className="ext-row" style={{ marginTop: 6 }}><input type="checkbox" checked={o.supersedes === check.supersedes.id} onChange={(e) => set("supersedes", e.target.checked ? check.supersedes.id : undefined)} /> Mark {check.supersedes.reference} as superseded by this notice</label>
        </div>
      ) : null}
      {check?.breadth ? <div className="ci-result ci-result-warn" role="status" style={{ marginTop: 8 }}>{check.breadth.text}</div> : null}
      {check && !check.quietHours.held && !check.supersedes && !check.breadth ? <p className="ci-meta" style={{ marginTop: 8 }}>Hygiene check: no night hold, no earlier notice this replaces, audience matches the text.</p> : null}
    </div>
  );
}

/** Delivery dashboard addition: the reach funnel and the unreached, with the rung each is on. */
export function ReachFunnel({ id }) {
  const q = useExt(`xo:reach:${id}`, () => xo.reachFunnel(id));
  return (
    <ExtSection q={q} lines={3}>
      {(d) => {
        const f = d.funnel;
        const bar = (label, n, p, tone) => (
          <div key={label}>
            <div className="ext-row" style={{ justifyContent: "space-between" }}><span className="ci-label">{label}</span><b className="ci-num">{n} · {p === null ? "—" : `${p}%`}</b></div>
            <div className={`xo-bar ${tone || ""}`}><i style={{ width: `${p || 0}%` }} /></div>
          </div>
        );
        return (
          <div className="ext-card ext-card-strong">
            <div className="ext-row" style={{ justifyContent: "space-between" }}>
              <div className="ci-label">REACH FUNNEL{d.notice.reachTarget ? ` · TARGET ${d.notice.reachTarget.pct}% BY ${dt(d.notice.reachTarget.deadline)}` : ""}</div>
              <span className="ext-row">{d.targetMet === true ? <Tag kind="SAFE">TARGET MET</Tag> : d.targetMet === false ? <Tag kind="WATCH">NOT YET</Tag> : null}<Kind kind={d.kind} /></span>
            </div>
            {d.notice.supersedes ? <p className="ci-meta">Replaces {d.notice.supersedes.reference} “{d.notice.supersedes.title}”.</p> : null}
            {d.notice.supersededBy ? <p className="ci-meta">Superseded by {d.notice.supersededBy.reference}.</p> : null}
            {d.notice.quietHoursOverride ? <p className="ci-meta">Sent during quiet hours by {d.notice.quietHoursOverride.byName}: {d.notice.quietHoursOverride.reason}</p> : null}
            <div className="ext-grid-3" style={{ marginTop: 8 }}>
              {bar("Delivered", f.delivered, f.pct.delivered, "ok")}
              {bar("Read", f.read, f.pct.read, "ok")}
              {bar("Acted", f.acted, f.pct.acted, "ok")}
              {bar("Unreached", f.unreached, f.pct.unreached)}
            </div>
            <div className="ext-row" style={{ marginTop: 10 }}>
              {d.ladder.map((l) => <span key={l.rung} className="ci-meta"><Tag kind="muted">{RUNG_LABEL[l.rung]}</Tag> {l.recipients}</span>)}
              <span className="ci-meta">· read via app {d.readVia.APP}, SMS {d.readVia.SMS}, kiosk {d.readVia.KIOSK}</span>
            </div>
            {d.dueNext.length ? <p className="ci-meta">Next: {d.dueNext.map((n) => `${RUNG_LABEL[n.rung]} at ${dt(n.at)}`).join(" · ")}</p> : null}
            {d.unreached.length ? (
              <div className="xo-table-wrap" style={{ marginTop: 8 }}>
                <table className="xo-table">
                  <thead><tr><th>UNREACHED</th><th>HOSTEL · SECTION</th><th>FALLBACK USED</th></tr></thead>
                  <tbody>{d.unreached.map((u, i) => <tr key={i}><td>{u.name} <span className="ci-meta">{u.studentId || ""}</span></td><td>{u.hostel || "—"} · {u.section || "—"}</td><td><Tag kind="muted">{RUNG_LABEL[u.lastRung.rung] || u.lastRung.rung}</Tag> <span className="ci-meta">{u.lastRung.note}</span></td></tr>)}</tbody>
                </table>
              </div>
            ) : <p className="ci-meta">Everyone in the audience has read it.</p>}
            <SourceLine method={d.method} />
          </div>
        );
      }}
    </ExtSection>
  );
}

/** Feed card addition: this notice was replaced by a newer one (or replaces one). */
export function SupersededNote({ n }) {
  if (n?.supersededBy) return <p className="ci-result ci-result-warn" style={{ marginTop: 8 }}>Replaced by {n.supersededBy.reference}: “{n.supersededBy.title}” — read that one instead.</p>;
  if (n?.supersedes) return <p className="ci-meta" style={{ marginTop: 6 }}>This replaces {n.supersedes.reference} (“{n.supersedes.title}”).</p>;
  return null;
}

/** Page 13 for a class representative: classmates who have not read a must-reach notice. */
export function ClassRepList() {
  const q = useExt("xo:classrep", () => xo.classRep());
  const d = q.data;
  if (!d?.isRep) return null;
  return (
    <div className="ext-card ext-card-accent" style={{ marginBottom: 18 }}>
      <div className="ci-label">CLASS REPRESENTATIVE · {d.cohort.branch} YEAR {d.cohort.year} SECTION {d.cohort.section}</div>
      <p className="ci-meta" style={{ marginTop: 4 }}>{d.note}</p>
      {d.items.length ? <ul className="ext-list" style={{ marginTop: 8 }}>{d.items.map((i, k) => <li key={k} className="ci-body"><b>{i.name}</b> <span className="ci-meta">{i.hostel} {i.room}</span> — {i.notice.reference} “{i.notice.title}”</li>)}</ul> : <p className="ci-meta">Nobody in your section is waiting on you right now.</p>}
    </div>
  );
}

function printList(d) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const rows = d.students.map((s) => `<tr><td>${s.name}</td><td>${s.studentId || ""}</td><td>${s.hostel || ""} ${s.room || ""}</td><td>${s.notices.map((n) => `${n.reference} — ${n.title}`).join("<br>")}</td><td style="width:90px"></td></tr>`).join("");
  w.document.write(`<!doctype html><title>Unread critical notices</title><style>body{font:13px sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;text-align:left;vertical-align:top}</style><h2>Students with unread critical notices</h2><p>${new Date(d.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · ${d.note}</p><table><tr><th>Name</th><th>ID</th><th>Room</th><th>Notices</th><th>Signature</th></tr>${rows}</table>`);
  w.document.close();
  w.print();
}

/** Page 12: the help-desk list of students with unread critical notices (printable). */
export function KioskReachList() {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState(null);
  const q = useExt(`xo:kiosklist:${nonce}`, () => xo.kioskList());
  const mark = async (reference, studentId) => {
    setResult(await attempt(() => xo.kioskRead({ reference, studentId }), (r) => `${r.reference} marked read for ${r.studentId} at the desk.`));
    setNonce((n) => n + 1);
  };
  return (
    <ExtSection q={q} lines={3}>
      {(d) => (
        <div className="ci ext" style={{ padding: 0 }}>
          <div className="ext-card">
            <div className="ext-row" style={{ justifyContent: "space-between" }}>
              <div className="ci-label">STUDENTS WITH UNREAD CRITICAL NOTICES · {d.students.length}</div>
              <span className="ext-row"><Kind kind={d.kind} /><button type="button" className="btn btn-secondary" onClick={() => printList(d)} disabled={!d.students.length}>PRINT LIST</button></span>
            </div>
            <p className="ci-meta" style={{ marginTop: 4 }}>{d.note}</p>
            {d.students.length ? (
              <div className="xo-table-wrap"><table className="xo-table">
                <thead><tr><th>STUDENT</th><th>ROOM</th><th>NOTICE</th><th></th></tr></thead>
                <tbody>{d.students.slice(0, 20).flatMap((s) => s.notices.map((n, i) => (
                  <tr key={`${s.studentId}${n.reference}`}>
                    <td>{i === 0 ? <><b>{s.name}</b> <span className="ci-meta">{s.studentId}</span></> : null}</td>
                    <td className="ci-meta">{i === 0 ? `${s.hostel || ""} ${s.room || ""}` : null}</td>
                    <td>{n.reference} — {n.title} {n.onKioskList ? <Tag kind="WATCH">ON KIOSK LIST</Tag> : null}</td>
                    <td><button type="button" className="btn btn-secondary" onClick={() => mark(n.reference, s.studentId)}>READ TO THEM ✓</button></td>
                  </tr>
                )))}</tbody>
              </table></div>
            ) : <StateBox title="Nobody waiting">Every critical notice has been read.</StateBox>}
            <Outcome result={result} />
          </div>
        </div>
      )}
    </ExtSection>
  );
}
