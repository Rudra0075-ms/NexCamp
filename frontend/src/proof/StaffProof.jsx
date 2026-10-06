import React, { useEffect, useRef, useState } from "react";
import { Drawer, StateBox, Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, day, useExt } from "../ext/kit.jsx";
import { pf } from "./api.js";
import { Deferred, DiffLines, ProofSection, RowTable, Why } from "./kit.jsx";

/*
 * Page 08 — asset reliability (F10).  Page 21 — channel parity (F8).
 * Page 13 — the notice linter inside the compose form (F4).
 * Page 15 — pre-flight: the consequences of a change before COMMIT (F3).
 */

// ---- 08 ----------------------------------------------------------------------------------

export function Reliability({ lowBw }) {
  const q = useExt("pf:reliability", () => pf.reliability(undefined, lowBw));
  return (
    <ProofSection kicker="PREDICT · ASSET RELIABILITY (MTBF)" title="Which equipment is due to fail next?" id="pf-reliability">
      <Deferred lowBw={lowBw} label="ASSET RELIABILITY">
        <ExtSection q={q} lines={4}>
          {(d) => d.assets.length ? (
            <div className="pf-cards">
              {d.assets.map((a) => (
                <div key={a.code} className="pf-card">
                  <div className="pf-row" style={{ justifyContent: "space-between" }}><b>{a.building} · {a.name}</b><Kind kind={a.kind} /></div>
                  <p className="ci-body" style={{ margin: "6px 0" }}>{a.headline}</p>
                  {a.recommendation ? <p className="ci-body" style={{ margin: 0 }}><Kind kind={a.recommendation.kind} /> {a.recommendation.text}</p> : null}
                  {!a.insufficient ? <Why><p>{a.formula}</p><p>Gaps between failures (days): {a.gapsDays.join(", ")} · mean (MTBF) {a.mtbfDays} · median {a.medianGapDays}.</p><RowTable rows={a.failures.map((f) => ({ date: day(f.at), record: f.reference, source: f.source, fix: f.fix }))} /></Why> : null}
                </div>
              ))}
            </div>
          ) : <StateBox title="No assets recorded" />}
        </ExtSection>
      </Deferred>
      <p className="pf-muted">{q.data?.source} · a next-failure estimate needs {q.data?.minFailures ?? 3}+ failures.</p>
    </ProofSection>
  );
}

// ---- 21 ----------------------------------------------------------------------------------

const GAP_TAG = { SLOWER: "HIGH", FASTER: "SAFE", "NO MEASURABLE GAP": "muted", "INSUFFICIENT DATA": "muted" };

export function EquityPanel({ lowBw, user }) {
  const staff = user && user.role !== "STUDENT";
  const q = useExt("pf:equity:full", () => pf.equity(lowBw), { enabled: Boolean(staff) });
  if (!staff) return null;
  return (
    <ProofSection kicker="AUDIT · CHANNEL PARITY" title="Are basic-phone and kiosk users served as well as app users?" id="pf-equity">
      <Deferred lowBw={lowBw} label="CHANNEL PARITY">
        <ExtSection q={q} lines={4}>
          {(d) => (
            <>
              <p className="ci-body"><b>{d.headline}</b></p>
              <div className="xo-table-wrap">
                <table className="xo-table">
                  <thead><tr><th>GROUP</th><th>MEDIAN TIME TO FIX</th><th>RATIO (90% INTERVAL)</th><th>COMPLETED</th><th>FIELDS COMPLETE</th><th>VERDICT</th></tr></thead>
                  <tbody>
                    {d.groups.map((g) => (
                      <tr key={`${g.dimension}${g.group}`}>
                        <td><b>{g.group}</b><div className="pf-muted">{g.dimension} · n {g.nResolved}/{g.n}</div></td>
                        <td>{g.medianHours ?? "—"} h <span className="pf-muted">vs {g.restMedianHours ?? "—"} h</span></td>
                        <td>{g.ratio ? `${g.ratio}× (${g.interval.low}–${g.interval.high})` : "—"}</td>
                        <td>{g.completionPct ?? "—"}% <span className="pf-muted">vs {g.restCompletionPct ?? "—"}%</span></td>
                        <td>{g.fieldCompletenessPct}% <span className="pf-muted">vs {g.restFieldCompletenessPct}%</span></td>
                        <td><Tag kind={GAP_TAG[g.verdict]}>{g.verdict}</Tag></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Why><p>{d.rule}</p><p>{d.method}. Groups are only those the system already records (channel, hostel, year) — no new personal attributes.</p><p>Field completeness: a room or precise location, a description of 40+ characters, and a photo.</p></Why>
            </>
          )}
        </ExtSection>
      </Deferred>
    </ProofSection>
  );
}

// ---- 13 ----------------------------------------------------------------------------------

const SEV_TAG = { WARN: "WATCH", INFO: "muted" };

/** Runs as the author types (debounced; slower in LOW BANDWIDTH). Writes nothing. */
export function NoticeLint({ draft, lowBw }) {
  const [state, setState] = useState({ data: null, error: null, loading: false });
  const last = useRef("");
  useEffect(() => {
    const key = JSON.stringify(draft);
    if (!draft.title && !draft.body) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    let alive = true;
    const t = setTimeout(() => {
      if (key === last.current) return;
      last.current = key;
      setState((s) => ({ ...s, loading: true }));
      pf.lint(draft)
        .then((d) => alive && setState({ data: d, error: null, loading: false }))
        .catch((e) => alive && setState({ data: null, error: e.status === 0 ? "Offline — the linter needs the server." : e.message, loading: false }));
    }, lowBw ? 1500 : 700);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [JSON.stringify(draft), lowBw]);
  const d = state.data;
  if (state.error) return <p className="ci-meta" role="status">Linter: {state.error}</p>;
  if (!d) return null;
  const items = [...d.findings.map((f) => ({ ...f, kind: "ACTUAL DATA" })), ...d.collisions];
  return (
    <div className="pf-card" role="status" aria-live="polite" style={{ opacity: state.loading ? 0.65 : 1 }}>
      <div className="pf-row" style={{ justifyContent: "space-between" }}>
        <div className="ci-label">NOTICE CHECK · {items.length ? `${items.length} THING${items.length === 1 ? "" : "S"} TO FIX` : "READY"}</div>
        <Tag kind={d.score >= 85 ? "SAFE" : d.score >= 60 ? "WATCH" : "HIGH"}>USABILITY {d.score}/100</Tag>
      </div>
      {items.length ? (
        <ul className="pf-lines" style={{ marginTop: 8 }}>
          {items.map((f, i) => <li key={i} className={`pf-line ${f.severity === "WARN" ? "warn" : ""}`}><Tag kind={SEV_TAG[f.severity] || "muted"}>{f.rule.replace(/_/g, " ")}</Tag> {f.message}{f.suggestion ? <div className="pf-muted">→ {f.suggestion}</div> : null}</li>)}
        </ul>
      ) : <p className="ci-meta">Date, time, venue, action, deadline and contact are all present, and nothing collides.</p>}
      <p className="ci-body" style={{ margin: "10px 0 0" }}><Kind kind={d.reach.kind} /> {d.reach.text}{d.reach.basis ? <span className="pf-muted"> Basis: {d.reach.basis}.</span> : null}</p>
      {d.attention.digest ? <p className="ci-body" style={{ margin: "6px 0 0" }}><Kind kind={d.attention.digest.kind} /> {d.attention.digest.text}</p> : null}
      <Why label="ATTENTION BUDGET">
        <p><Kind kind={d.attention.relation.kind} /> {d.attention.relation.text}</p>
        <RowTable rows={d.attention.bands.map((b) => ({ load: b.band, receipts: b.receipts, weeks: b.weeks, readRate: b.readRatePct === null ? "insufficient" : `${b.readRatePct}%` }))} />
        <p className="pf-muted">This week the audience has had a median of {d.attention.thisWeek.median} notices (max {d.attention.thisWeek.max}). {d.method}. Readability limits are {d.readability.limitsKind}.</p>
      </Why>
    </div>
  );
}

// ---- 15 ----------------------------------------------------------------------------------

/**
 * "PREVIEW IMPACT" beside the existing commit button. Opens a diff-style
 * drawer; COMMIT runs the existing flow unchanged, EDIT and CANCEL close it.
 */
export function PreflightButton({ body, onCommit, disabled }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const run = async () => {
    setOpen(true);
    setState({ loading: true, data: null, error: null });
    try {
      setState({ loading: false, data: await pf.preflight(body), error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: e.status === 0 ? "Offline — a preview needs the server. Nothing was committed." : e.details ? Object.values(e.details).join(" · ") : e.message });
    }
  };
  const d = state.data;
  return (
    <>
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={run}>PREVIEW IMPACT</button>
      <Drawer open={open} onClose={() => setOpen(false)} heading={d ? `This change will…` : "Pre-flight"} kicker="PRE-FLIGHT · NOTHING WRITTEN">
        {state.loading ? <p className="ci-meta" aria-busy="true">Working out every consequence…</p> : null}
        {state.error ? <StateBox kind="error" title="Could not preview">{state.error}</StateBox> : null}
        {d ? (
          <>
            <p className="ci-meta" style={{ marginTop: 0 }}>
              {d.change.kind === "CLASS" ? `${d.change.subject} · ${d.change.cohort} · ${d.change.type} ${d.change.originalSlot}${d.change.newSlot ? ` → ${d.change.newSlot}` : ""}` : `${d.change.meal} · ${d.change.date}`} · <Kind kind={d.kind} /> · {d.writes} records written
            </p>
            <DiffLines lines={d.lines} />
            <p className="pf-muted">{d.method}</p>
          </>
        ) : null}
        <div className="pf-drawer-actions">
          <button type="button" className="btn btn-primary" disabled={!d || d.blocking > 0} onClick={() => { setOpen(false); onCommit?.(); }}>{d?.blocking ? "COMMIT BLOCKED" : "COMMIT"}</button>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>EDIT</button>
          <button type="button" className="btn btn-secondary" onClick={() => { setOpen(false); setState({ loading: false, data: null, error: null }); }}>CANCEL</button>
        </div>
      </Drawer>
    </>
  );
}
