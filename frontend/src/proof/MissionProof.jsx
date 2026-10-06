import React, { useMemo, useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, useExt } from "../ext/kit.jsx";
import { pf } from "./api.js";
import { Card, Deferred, Insufficient, ProofSection, RowTable, Why } from "./kit.jsx";

/*
 * Page 10 — "How work actually flows" (F1 process mining) and the service
 * equity summary (F8). Staff only; mounted by ProofEntry.
 */

const W = 920;
const ROW = 96;
const delayColour = (h) => (h === null || h === undefined ? "var(--color-neutral-400)" : h > 18 ? "var(--color-accent)" : h > 4 ? "var(--color-warn)" : "var(--ci-ok)");

/** Pure: node positions — the designed lifecycle on one row, anything else below it. */
export function layout(reference, nodes) {
  const pos = {};
  const step = (W - 120) / Math.max(1, reference.length - 1);
  reference.forEach((id, i) => (pos[id] = { x: 60 + i * step, y: ROW }));
  const extra = nodes.map((n) => n.id).filter((id) => !(id in pos));
  extra.forEach((id, i) => (pos[id] = { x: 60 + (i + 1) * ((W - 120) / (extra.length + 1)), y: ROW + 150 }));
  return pos;
}

function edgePath(a, b, index) {
  if (a.y === b.y) {
    const forward = b.x > a.x;
    const span = Math.abs(b.x - a.x);
    const lift = forward ? (span > 200 ? -40 - span / 12 : 0) : 40 + span / 10;
    if (!lift) return `M${a.x + 26} ${a.y} L${b.x - 26} ${b.y}`;
    const mx = (a.x + b.x) / 2;
    return `M${a.x} ${a.y + (lift > 0 ? 18 : -18)} Q${mx} ${a.y + lift * 1.6} ${b.x} ${b.y + (lift > 0 ? 18 : -18)}`;
  }
  const mx = (a.x + b.x) / 2 + (index % 2 ? 20 : -20);
  return `M${a.x} ${a.y + 18} Q${mx} ${(a.y + b.y) / 2} ${b.x} ${b.y - 18}`;
}

export function FlowGraph({ data, selected, onSelect }) {
  const pos = useMemo(() => layout(data.reference, data.graph.nodes), [data]);
  const max = Math.max(1, ...data.graph.edges.map((e) => e.count));
  const bottleneck = data.bottleneck ? `${data.bottleneck.from}→${data.bottleneck.to}` : null;
  const counts = Object.fromEntries(data.graph.nodes.map((n) => [n.id, n.count]));
  return (
    <div style={{ overflowX: "auto" }}>
      <svg className="pf-flow" viewBox={`0 0 ${W} ${ROW + 210}`} role="img" aria-label={`Directly-follows graph for ${data.workflow}: ${data.graph.edges.length} transitions`} style={{ minWidth: 560 }}>
        <defs>
          <marker id="pf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--color-neutral-700)" /></marker>
        </defs>
        {data.graph.edges.map((e, i) => {
          const a = pos[e.from];
          const b = pos[e.to];
          if (!a || !b || e.from === e.to) return null;
          const key = `${e.from}→${e.to}`;
          const on = selected === key;
          return (
            <g key={key} className="pf-edge" role="button" tabIndex={0} aria-label={`${e.from} to ${e.to}: ${e.count} cases, median wait ${e.medianHours} hours`} onClick={() => onSelect(on ? null : key)} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && onSelect(on ? null : key)}>
              <path d={edgePath(a, b, i)} fill="none" stroke={delayColour(e.medianHours)} strokeOpacity={on || key === bottleneck ? 1 : 0.7} strokeWidth={1.5 + (e.count / max) * 9} markerEnd="url(#pf-arrow)" strokeDasharray={key === bottleneck ? "none" : undefined} />
              <path d={edgePath(a, b, i)} fill="none" stroke="transparent" strokeWidth="18" />
            </g>
          );
        })}
        {Object.entries(pos).map(([id, p]) => (
          <g key={id}>
            <rect x={p.x - 58} y={p.y - 16} width="116" height="32" fill="var(--color-bg)" stroke={id === data.bottleneck?.to ? "var(--color-accent)" : "var(--ci-line)"} strokeWidth="2" />
            <text x={p.x} y={p.y + 1} textAnchor="middle" style={{ fontWeight: 700, fontSize: 10.5, letterSpacing: ".04em" }}>{id}</text>
            <text x={p.x} y={p.y + 30} textAnchor="middle" style={{ fontSize: 10, fill: "var(--color-neutral-700)" }}>{counts[id] || 0}</text>
          </g>
        ))}
      </svg>
      <div className="pf-legend" aria-hidden="true">
        <span><i style={{ background: "var(--ci-ok)" }} />median ≤ 4 h</span>
        <span><i style={{ background: "var(--color-warn)" }} />4–18 h</span>
        <span><i style={{ background: "var(--color-accent)" }} />&gt; 18 h</span>
        <span>thickness = cases · click an edge for its cases</span>
      </div>
    </div>
  );
}

export function ProcessFlow({ lowBw }) {
  const [workflow, setWorkflow] = useState("complaint");
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState(null);
  const q = useExt(`pf:mining:${workflow}:${days}`, () => pf.processMining(workflow, days));
  return (
    <ProofSection kicker="PROVE · PROCESS MINING OVER THE CAMPUS EVENT LOG" title="How work actually flows — and where it waits." id="pf-flow">
      <div className="pf-row" style={{ marginBottom: 12 }}>
        <div className="ext-chips" role="group" aria-label="Workflow">
          {[["complaint", "COMPLAINTS"], ["gatepass", "GATE PASSES"], ["certificate", "CERTIFICATES"]].map(([k, l]) => <button key={k} type="button" className="ci-chip" aria-pressed={workflow === k} onClick={() => { setWorkflow(k); setSelected(null); }}>{l}</button>)}
        </div>
        <div className="ext-chips" role="group" aria-label="Window">
          {[30, 90].map((d) => <button key={d} type="button" className="ci-chip" aria-pressed={days === d} onClick={() => { setDays(d); setSelected(null); }}>{`${d} DAYS`}</button>)}
        </div>
      </div>
      <Deferred lowBw={lowBw} label="PROCESS MAP">
        <ExtSection q={q} lines={5}>
          {(d) => d.insufficient ? <Insufficient text={d.text} /> : (
            <>
              <div className="pf-cards">
                <Card label="TOP BOTTLENECK" value={d.bottleneck ? `${d.bottleneck.from} → ${d.bottleneck.to}` : "none"} kind={d.bottleneck?.kind}>
                  {d.bottleneck?.text}
                  {d.bottleneck ? <Why><p>{d.bottleneck.formula}</p>{d.bottleneck.byDepartment?.length ? <RowTable rows={d.bottleneck.byDepartment} /> : null}<p className="pf-muted">“Slow” = more than {d.thresholds.slowWaitHours} h ({d.thresholds.slowWaitKind}).</p></Why> : null}
                </Card>
                <Card label="REWORK RATE" value={d.rework.ratePct === null ? "—" : `${d.rework.ratePct}%`} kind={d.rework.kind}>
                  {d.rework.reopened} reopened of {d.rework.resolved} resolved.
                  <Why><p>{d.rework.formula}</p></Why>
                </Card>
                <Card label="NON-CONFORMING CASES" value={`${d.conformance.nonConforming} / ${d.conformance.ofCases}`} kind={d.conformance.kind}>
                  {d.conformance.byKind.filter((k) => k.cases).map((k) => `${k.kind.toLowerCase()} ${k.cases}`).join(" · ") || "every case followed the designed lifecycle"}
                  {d.conformance.reassignedTwicePlus.length ? <div>Reassigned 2+ times: {d.conformance.reassignedTwicePlus.join(", ")}</div> : null}
                  <Why><p>Designed lifecycle: {d.reference.join(" → ")}.</p>{d.conformance.examples.length ? <RowTable rows={d.conformance.examples.map((e) => ({ case: e.ref, issues: e.issues.join("; ") }))} /> : null}</Why>
                </Card>
                <Card label="LOAD IMBALANCE" value={d.load.gini === null ? "—" : `Gini ${d.load.gini}`} kind={d.load.kind}>
                  {d.load.text}
                  <Why><p>{d.load.formula}</p>{d.load.staff.length ? <RowTable rows={d.load.staff} /> : null}</Why>
                </Card>
              </div>
              {d.recommendation ? <p className="ci-body" style={{ margin: "14px 0 6px" }}><Kind kind={d.recommendation.kind} /> {d.recommendation.text}</p> : null}
              <FlowGraph data={d} selected={selected} onSelect={setSelected} />
              {selected ? (() => {
                const e = d.graph.edges.find((x) => `${x.from}→${x.to}` === selected);
                return e ? (
                  <div className="pf-card" style={{ marginTop: 12 }}>
                    <div className="pf-row"><b>{e.from} → {e.to}</b><Tag kind="muted">{e.count} cases</Tag><span className="pf-muted">median {e.medianHours} h · P90 {e.p90Hours} h · {e.slowShare}% over {d.thresholds.slowWaitHours} h</span><Kind kind="ACTUAL DATA" /></div>
                    <RowTable rows={e.cases.map((c) => ({ case: c.ref, department: c.department, from: c.from, to: c.to, hours: c.hours }))} />
                  </div>
                ) : null;
              })() : null}
              <p className="pf-muted" style={{ marginTop: 10 }}>{d.cases} cases started in the last {d.windowDays} days ({d.completedCases} completed) · method {d.method}{q.data?.cached ? " · cached for 60 s" : ""}</p>
              <DepartmentTable rows={d.departments} />
            </>
          )}
        </ExtSection>
      </Deferred>
    </ProofSection>
  );
}

function DepartmentTable({ rows = [] }) {
  if (!rows.length) return null;
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="ci-link">HAND-OFF DELAY BY DEPARTMENT</summary>
      <RowTable rows={rows} />
    </details>
  );
}

/** Page 10 summary card for F8; the full table lives on page 21. */
export function EquityCard({ lowBw, onGo }) {
  const q = useExt("pf:equity:card", () => pf.equity(lowBw));
  return (
    <ProofSection kicker="AUDIT · SERVICE EQUITY" title="Is a kiosk or SMS user served as well as an app user?" id="pf-equity-card">
      <Deferred lowBw={lowBw} label="EQUITY CHECK">
        <ExtSection q={q} lines={3}>
          {(d) => (
            <div className="pf-card">
              <p className="ci-body" style={{ margin: 0 }}>{d.headline}</p>
              <div className="pf-row" style={{ marginTop: 8 }}>
                {(d.channel || []).map((g) => <Tag key={g.group} kind={g.verdict === "SLOWER" ? "HIGH" : g.verdict === "INSUFFICIENT DATA" ? "muted" : "SAFE"}>{g.group}: {g.verdict === "INSUFFICIENT DATA" ? "n too small" : `${g.ratio}×`}</Tag>)}
                <Kind kind={d.flagged?.length ? "AI DETECTED PATTERN" : "ACTUAL DATA"} />
              </div>
              <Why><p>{d.rule}</p><p className="pf-muted">{d.method}</p></Why>
              {onGo ? <button type="button" className="ci-link xo-linkbtn" onClick={() => onGo("device")}>FULL CHANNEL PARITY ON PAGE 21 →</button> : null}
            </div>
          )}
        </ExtSection>
      </Deferred>
    </ProofSection>
  );
}

export default function MissionProof({ lowBw, onGo }) {
  return (
    <>
      <ProcessFlow lowBw={lowBw} />
      <EquityCard lowBw={lowBw} onGo={onGo} />
    </>
  );
}
