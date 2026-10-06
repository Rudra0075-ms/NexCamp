import React, { useEffect, useRef, useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, Outcome, SourceLine, attempt, day, useExt } from "../ext/kit.jsx";
import { xo } from "./api.js";
import { hoursLabel } from "./kit.jsx";

/*
 * Small Exception-Only panels placed inside existing pages (NexCamp.jsx):
 *   01 the Friction Map, measured           02 time you saved this month
 *   05 known issue → +1 & Follow, and ETAs  06 reopened incidents, followers, asset history
 *   09 repair or replace
 * Each renders nothing (or the original text) when its data is missing.
 */

// ---- 01 ----------------------------------------------------------------------------------

/** The Friction Map's "new way" line, measured. Falls back to the original sentence. */
export function FrictionMeasured({ fallback }) {
  const q = useExt("xo:ledger:public", () => xo.ledgerPublic());
  const d = q.data;
  if (!d || d.now.kind === "INSUFFICIENT DATA") return <div style={{ fontSize: 12, marginTop: 6 }}>{fallback}</div>;
  return (
    <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.55 }}>
      <b>Measured, last {d.window.days} days:</b> {d.now.requests} requests · complaints fixed in a median {hoursLabel(d.now.complaintMedianHours)} · {d.now.touchesPerRequest} staff touches and {d.now.handoffs} hand-offs per closed request · {d.now.zeroTouch} closed with no human touch.
      <div style={{ opacity: 0.85, marginTop: 4 }}>Old path: {d.old.hops} hops, {hoursLabel(d.old.hours)} — ASSUMPTION ({String(d.old.source || "").split("—")[0].trim()}). New path: ACTUAL DATA from the Campus Event log.</div>
    </div>
  );
}

// ---- 02 ----------------------------------------------------------------------------------

export function TimeSaved() {
  const q = useExt("xo:ledger:me", () => xo.ledgerMine());
  const d = q.data;
  if (!d || !d.requests) return null;
  return (
    <div className="ci ext" style={{ padding: 0, marginTop: 14 }}>
      <div className="ext-row" role="note" style={{ border: "2px solid var(--ci-line)", padding: "10px 12px" }}>
        <b style={{ fontFamily: "var(--font-heading)", fontSize: 16 }}>Time you saved this month: about {d.hoursSaved} h</b>
        <span className="ci-meta">{d.officeVisitsAvoided} office visit{d.officeVisitsAvoided === 1 ? "" : "s"} avoided across {d.requests} request{d.requests === 1 ? "" : "s"} · {d.month}</span>
        <Kind kind={d.kind} />
        <span className="ci-meta" title={d.basis}>how?</span>
      </div>
    </div>
  );
}

// ---- 05 ----------------------------------------------------------------------------------

/**
 * While the student types: the existing cluster score against open incidents.
 * Debounced (longer on LOW BANDWIDTH); "Report anyway" leaves the form as it is.
 */
export function KnownIssue({ text, category, location, lowBw }) {
  const [check, setCheck] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const last = useRef("");
  useEffect(() => {
    const clean = String(text || "").trim();
    if (clean.length < (lowBw ? 20 : 12)) {
      setCheck(null);
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      const key = `${clean}|${category}|${location}`;
      if (key === last.current) return;
      last.current = key;
      xo.similar({ text: clean, category, location: location || undefined })
        .then((r) => alive && setCheck(r))
        .catch(() => alive && setCheck(null));
    }, lowBw ? 1800 : 900);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text, category, location, lowBw]);
  if (check?.planned) {
    return (
      <div className="ci ext" style={{ padding: 0 }}>
        <div className="xo-verdict xo-verdict-auto" role="status" aria-live="polite">
          <div className="ext-row" style={{ justifyContent: "space-between" }}><b className="xo-verdict-head">Planned work · {check.planned.reference}</b><Kind kind="ACTUAL DATA" /></div>
          <p className="ci-body" style={{ margin: "6px 0 0" }}>{check.planned.text}</p>
          {check.planned.notice ? <p className="ci-meta" style={{ margin: "4px 0 0" }}>Announced in notice {check.planned.notice}.</p> : null}
        </div>
      </div>
    );
  }
  const m = check?.match;
  if (!m || dismissed === m.incidentId) return null;
  const follow = async () => {
    setBusy(true);
    setResult(await attempt(() => xo.follow(m.incidentId, { room: location || undefined }), (d) => `You are following ${d.reference} (${d.followers} following). No duplicate was filed — updates reach you as the incident moves.`));
    setBusy(false);
  };
  return (
    <div className="ci ext" style={{ padding: 0 }}>
      <div className="xo-verdict xo-verdict-human" role="status" aria-live="polite">
        <div className="ext-row" style={{ justifyContent: "space-between" }}>
          <b className="xo-verdict-head">Known issue {m.reference} · {m.reports} report{m.reports === 1 ? "" : "s"}{m.followers ? ` · ${m.followers} following` : ""}</b>
          <Kind kind="ACTUAL DATA" />
        </div>
        <p className="ci-body" style={{ margin: "6px 0" }}>{m.title} — assigned to <b>{m.assignedTo}</b>{m.owner ? ` (${m.owner})` : ""}. Status {m.status.replace(/_/g, " ")}.</p>
        <p className="ci-meta" style={{ margin: 0 }}>Typical fix: {m.eta?.p50Hours !== null && m.eta?.p50Hours !== undefined ? `${hoursLabel(m.eta.p50Hours)} (P50) · ${hoursLabel(m.eta.p80Hours)} (P80), from ${m.eta.samples} finished` : m.eta?.text || "Insufficient history"}</p>
        <p className="ci-meta" style={{ margin: "4px 0 0" }}>Why it matched: {m.basis} Shared words: {m.sharedTerms.join(", ") || "—"}.</p>
        {result && !result.error ? null : (
          <div className="ext-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy || m.alreadyFollowing} onClick={follow}>{m.alreadyFollowing ? "ALREADY FOLLOWING" : busy ? "…" : "+1 & FOLLOW"}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setDismissed(m.incidentId)}>REPORT ANYWAY</button>
          </div>
        )}
        <Outcome result={result} />
      </div>
    </div>
  );
}

const CATEGORY_LABEL = { WATER: "water", ELECTRICITY: "electricity", "WI-FI": "Wi-Fi", CLEANLINESS: "cleanliness", MESS: "mess", SAFETY: "safety", HEALTH: "health", OTHER: "other" };

/** Page 05: the honest ETA for the chosen category. */
export function ReportEta({ category }) {
  const q = useExt(`xo:eta:${category}`, () => xo.eta({ type: "complaint", category }), { enabled: Boolean(category) });
  const d = q.data;
  if (!d) return null;
  return (
    <div className="ci" style={{ padding: 0 }}>
      <p className="ci-meta" style={{ margin: 0 }} role="note">
        <Kind kind={d.kind} /> Typical fix time for {CATEGORY_LABEL[category] || category} complaints: {d.text}
      </p>
    </div>
  );
}

// ---- 06 / 09 -------------------------------------------------------------------------------

/** Page 06: incidents that reopened or recurred after a fix, and who follows them. */
export function IncidentSignals() {
  const q = useExt("xo:incident:signals", () => xo.incidentSignals());
  return (
    <ExtSection q={q} lines={2}>
      {(d) =>
        d.incidents.length || Object.keys(d.followers || {}).length ? (
          <div className="ext-card">
            <div className="ci-label">REOPENED OR RECURRED AFTER A FIX</div>
            {d.incidents.map((i) => (
              <div key={i.incidentId} className="ext-row" style={{ marginTop: 8 }}>
                <Tag kind={i.signal === "REOPENED" ? "CRITICAL" : "WATCH"}>{i.signal.replace(/_/g, " ")}</Tag>
                <b>{i.reference}</b>
                <span className="ci-meta">{i.text}</span>
                {d.followers?.[i.incidentId] ? <span className="ci-meta">· {d.followers[i.incidentId]} student{d.followers[i.incidentId] === 1 ? "" : "s"} following (+1 instead of a duplicate)</span> : null}
              </div>
            ))}
            {!d.incidents.length ? <p className="ci-meta">No incident reopened after a fix.</p> : null}
            <SourceLine method={d.method} note="false-closure rule: a 'Not fixed' answer, or the same room or asset again within 7 days" />
          </div>
        ) : null
      }
    </ExtSection>
  );
}

/** Pages 06 and 09: repair history per asset, with the repair-or-replace arithmetic. */
export function AssetPanel({ building, compact = false }) {
  const q = useExt(`xo:assets:${building || "all"}`, () => xo.assets(building));
  return (
    <ExtSection q={q} lines={3}>
      {(d) => {
        const assets = d.assets.filter((a) => a.failures.length).slice(0, compact ? 1 : 4);
        if (!assets.length) return null;
        return (
          <div className="ext-stack">
            {assets.map((a) => (
              <article key={a.code} className="ext-card">
                <div className="ext-row" style={{ justifyContent: "space-between" }}>
                  <b style={{ fontFamily: "var(--font-heading)", fontSize: 16 }}>{a.headline}</b>
                  <Kind kind={a.kind} />
                </div>
                <p className="ci-meta" style={{ margin: "4px 0" }}>{a.building} · {a.category} · in service {a.ageMonths ?? "—"} months · {a.failures12m} failures in the last 12 months</p>
                {!compact ? (
                  <ul className="ext-list" style={{ marginTop: 6 }}>
                    {a.failures.slice(0, 5).map((f, i) => <li key={i} className="ci-meta">{day(f.at)} · {f.source === "COMPLAINT" ? f.reference : "campus memory"} · {f.fix}{f.hours !== null ? ` · ${hoursLabel(f.hours)}` : ""}</li>)}
                  </ul>
                ) : null}
                {a.recommendation ? (
                  <div className={`xo-verdict ${a.recommendation.action === "REPLACE" ? "xo-verdict-human" : "xo-verdict-auto"}`}>
                    <div className="ext-row"><Kind kind="RECOMMENDED ACTION" /><b>{a.recommendation.action === "REPLACE" ? `Replace ${a.name}` : `Keep repairing ${a.name}`}</b></div>
                    <p className="ci-meta" style={{ margin: "4px 0 0" }}>{a.recommendation.arithmetic}</p>
                    <p className="ci-meta" style={{ margin: "2px 0 0" }}>{a.recommendation.rule} Costs are ASSUMPTION — {a.costs.source}.</p>
                  </div>
                ) : null}
              </article>
            ))}
            <SourceLine method={d.method} note="failures counted from complaints and campus memory naming the asset (one per day)" />
          </div>
        );
      }}
    </ExtSection>
  );
}
