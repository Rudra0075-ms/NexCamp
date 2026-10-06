import React, { useEffect, useState } from "react";
import { LineChart, StateBox, Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, day, useExt } from "../ext/kit.jsx";
import { pf } from "./api.js";
import { Deferred, Insufficient, ProofSection, RowTable, Why } from "./kit.jsx";

/*
 * Page 09 — "Did it work?" (F2, difference-in-differences) and "Best use of
 * this week's maintenance hours" (F7, knapsack). Page 20 — the proof badge.
 */

const VERDICT_TAG = { EFFECTIVE: "SAFE", INCONCLUSIVE: "WATCH", "NO EFFECT / WORSE": "HIGH", UNRELIABLE: "muted" };

function ImpactDetail({ id }) {
  const q = useExt(`pf:impact:${id}`, () => pf.impact(id));
  return (
    <ExtSection q={q} lines={4}>
      {(d) => {
        if (d.status !== "MEASURED") return <Insufficient text={d.text} />;
        return (
          <div className="pf-card">
            <div className="pf-row">
              <Tag kind={VERDICT_TAG[d.verdict] || "muted"}>{d.verdict}</Tag>
              <Kind kind={d.kind} />
              <span className="pf-muted">{d.treated.name} · {d.treated.category} · fix {day(d.fixedAt)}</span>
            </div>
            <p className="ci-body" style={{ margin: "8px 0" }}>{d.text}</p>
            <LineChart
              labels={d.chart.labels}
              series={[{ id: "t", label: d.treated.name, values: d.chart.treated, color: "var(--color-accent)", dots: true }, { id: "c", label: `Comparable blocks (${d.controls.map((c) => c.name).join(", ")})`, values: d.chart.control, color: "var(--color-text)", dash: "5 4" }]}
              markers={[{ index: d.chart.fixIndex, label: "FIX" }]}
              format={(v) => (Math.round(v * 10) / 10).toString()}
              height={200}
              yMin={0}
              ariaLabel="Complaints per day, treated block against the average of comparable blocks"
            />
            <Why>
              <p><b>{d.formula}</b></p>
              <p>90% interval {d.interval.low} to {d.interval.high} complaints/day — {d.interval.iterations} bootstrap resamples of days (seed {d.interval.seed}).</p>
              <p>Parallel-trend check: pre-period slope {d.parallelTrend.treatedSlope} (treated) vs {d.parallelTrend.controlSlope} (controls), gap {d.parallelTrend.gap} ≤ {d.parallelTrend.maxGap} ({d.parallelTrend.maxGapKind}).</p>
              {d.complaintsAvoided !== null ? <p>{d.avoidedFormula} ≈ {d.complaintsAvoided} complaints avoided.</p> : null}
              <RowTable rows={d.controls.map((c) => ({ controlBlock: c.name, complaintsBefore: c.pre, complaintsAfter: c.post }))} />
              {d.excluded?.length ? <p className="pf-muted">Excluded (had their own intervention): {d.excluded.join(", ")}.</p> : null}
              <p className="pf-muted">{d.method}. The measured effect is stored in campus memory beside this incident's outcome.</p>
            </Why>
          </div>
        );
      }}
    </ExtSection>
  );
}

export function ImpactPanel({ lowBw }) {
  const q = useExt("pf:badges", () => pf.badges());
  const [open, setOpen] = useState(null);
  return (
    <ProofSection kicker="PROVE · DID IT WORK?" title="Each completed fix, measured against blocks that were not fixed." id="pf-impact">
      <Deferred lowBw={lowBw} label="IMPACT PROOF">
        <ExtSection q={q} lines={3}>
          {(d) => d.badges.length ? (
            <div className="ext-stack">
              {d.badges.map((b) => (
                <div key={b.id} className="pf-card">
                  <div className="pf-row" style={{ justifyContent: "space-between" }}>
                    <div><b>{b.reference}</b> {b.action} <span className="pf-muted">· {b.building} {b.category}</span></div>
                    <div className="pf-row"><Tag kind={VERDICT_TAG[b.verdict] || "muted"}>{b.verdict || b.status.replace(/_/g, " ")}</Tag><Kind kind={b.kind} /></div>
                  </div>
                  <p className="ci-meta" style={{ margin: "6px 0" }}>{b.text}</p>
                  <button type="button" className="ci-link xo-linkbtn" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? "HIDE" : "SHOW THE COMPARISON"}</button>
                  {open === b.id ? <ImpactDetail id={b.id} /> : null}
                </div>
              ))}
            </div>
          ) : <StateBox title="No completed interventions yet">A fix can be measured once an intervention is completed and 14 days have passed.</StateBox>}
        </ExtSection>
      </Deferred>
    </ProofSection>
  );
}

export function Portfolio({ lowBw }) {
  const [hours, setHours] = useState(12);
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const [go, setGo] = useState(!lowBw);
  useEffect(() => {
    if (!go) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      setState((s) => ({ ...s, loading: true, error: null }));
      pf.portfolio(hours)
        .then((d) => alive && setState({ loading: false, data: d, error: null }))
        .catch((e) => alive && setState({ loading: false, data: null, error: e.status === 0 ? "Offline — the optimiser needs the server; nothing is guessed in its place." : e.message }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [hours, go]);
  const d = state.data;
  return (
    <ProofSection kicker="OPTIMISE · SIMULATED" title="Best use of this week's maintenance hours." id="pf-portfolio">
      <label className="ext-field" style={{ maxWidth: 440 }}>
        <span className="ci-label">Technician hours available this week: {hours} h</span>
        <input className="pf-slider" type="range" min="2" max="80" step="1" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-valuetext={`${hours} hours`} />
      </label>
      {!go ? <button type="button" className="btn btn-secondary" onClick={() => setGo(true)}>LOAD OPTIMISER</button> : null}
      {state.error ? <StateBox kind="error" title="Could not optimise">{state.error}</StateBox> : null}
      {d && !d.items ? <StateBox title="Nothing open">{d.text}</StateBox> : null}
      {d?.items ? (
        <div style={{ opacity: state.loading ? 0.6 : 1 }} aria-busy={state.loading || undefined}>
          <p className="ci-body"><Kind kind={d.kind} /> {d.text}</p>
          <div className="xo-table-wrap">
            <table className="xo-table">
              <thead><tr><th>SCHEDULE</th><th>HOURS</th><th>RISK × STUDENTS</th><th>WHY</th></tr></thead>
              <tbody>
                {d.selected.map((i) => (
                  <tr key={i.id}><td><b>{i.title}</b>{i.mandatory ? <> <Tag kind="CRITICAL">MANDATORY</Tag></> : null}</td><td>{i.hours} <Kind kind={i.hoursKind} /><div className="pf-muted">{i.hoursBasis}</div></td><td>{i.risk} × {i.students} = {i.value}{i.riskKind ? <div className="pf-muted">risk from priority ({i.riskKind})</div> : null}</td><td>{i.why || "highest value per hour that fits"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ci-body" style={{ marginTop: 10 }}><Kind kind="SIMULATED" /> {d.marginal.text}</p>
          {d.leftOut.length ? (
            <details><summary className="ci-link">LEFT OUT ({d.leftOut.length}) AND WHY</summary><RowTable rows={d.leftOut.map((i) => ({ item: i.title, hours: i.hours, value: i.value, why: i.why }))} /></details>
          ) : null}
          <Why><p>{d.objective}.</p><p>Covered {d.coveredValue} of {d.totalValue} ({d.coveredPct}%) using {d.usedHours} h; mandatory items need {d.mandatoryHours} h. {d.method}.</p></Why>
        </div>
      ) : null}
    </ProofSection>
  );
}

export default function InterventionProof({ lowBw, staff }) {
  if (!staff) return null;
  return (
    <>
      <ImpactPanel lowBw={lowBw} />
      <Portfolio lowBw={lowBw} />
    </>
  );
}

/** Page 20 — the proof badge beside each measured fix. */
export function ProofBadges({ lowBw }) {
  const q = useExt("pf:badges:board", () => pf.badges(lowBw));
  return (
    <ExtSection q={q} lines={2}>
      {(d) => d.badges.length ? (
        <div className="ext-card">
          <div className="ci-label">Measured, not claimed — did the fix reduce complaints relative to comparable blocks?</div>
          <ul className="ext-list" style={{ marginTop: 8 }}>
            {d.badges.map((b) => (
              <li key={b.id} className="ci-body">
                <Tag kind={VERDICT_TAG[b.verdict] || "muted"}>{b.verdict ? `PROOF: ${b.verdict}` : b.status.replace(/_/g, " ")}</Tag> <b>{b.building} {b.category}</b> — {b.action}. <span className="ci-meta">{b.text}</span> <Kind kind={b.kind} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ExtSection>
  );
}
