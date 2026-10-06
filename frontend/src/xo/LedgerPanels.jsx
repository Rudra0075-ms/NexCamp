import React, { useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, SourceLine, day, useExt } from "../ext/kit.jsx";
import { xo } from "./api.js";
import { CalcBox, hoursLabel } from "./kit.jsx";

/*
 * Phase 3 — the Friction Ledger, measured from the Campus Event log (page 10),
 * reopen rate by department (Phase 4, page 10), and "You Said, We Did" before
 * and after the fix (page 20).
 */

const CUTS = [["byType", "REQUEST TYPE", "label"], ["byWeek", "WEEK", "week"], ["byHostel", "HOSTEL", "hostel"], ["byBranch", "BRANCH", "branch"], ["byYear", "YEAR", "year"], ["byChannel", "CHANNEL", "channel"]];

export function FrictionLedger() {
  const [cut, setCut] = useState("byType");
  const q = useExt("xo:ledger:30", () => xo.ledger(30));
  return (
    <ExtSection q={q} lines={5}>
      {(d) => {
        const t = d.totals;
        const [, , labelKey] = CUTS.find(([k]) => k === cut);
        return (
          <div className="ext-card ext-card-strong">
            <div className="ext-row" style={{ justifyContent: "space-between" }}>
              <div className="ci-label">FRICTION LEDGER · LAST {d.window.days} DAYS · {t.requests} REQUESTS</div>
              <Kind kind={d.kind} />
            </div>
            <div className="xo-grid" style={{ marginTop: 10 }}>
              <div><div className="ci-label">STUDENT-HOURS RETURNED</div><div className="xo-kpi"><b>{t.studentHoursReturned}</b></div><Kind kind="ESTIMATE" /></div>
              <div><div className="ci-label">OFFICE VISITS AVOIDED</div><div className="xo-kpi"><b>{t.officeVisitsAvoided}</b></div><Kind kind="ESTIMATE" /></div>
              <div><div className="ci-label">TOUCHES / CLOSED REQUEST</div><div className="xo-kpi"><b>{t.touchesPerRequestNow ?? "—"}</b><span className="ci-meta">was {t.touchesPerRequestOld ?? "—"} (ASSUMPTION)</span></div><Kind kind="ACTUAL DATA" /></div>
              <div><div className="ci-label">HAND-OFFS / CLOSED REQUEST</div><div className="xo-kpi"><b>{t.handoffsNow ?? "—"}</b><span className="ci-meta">was {t.handoffsOld ?? "—"}</span></div><Kind kind="ACTUAL DATA" /></div>
            </div>
            {d.insufficient ? <p className="ci-meta">{d.insufficient}</p> : null}
            <div className="ext-tabs" role="group" aria-label="Break the ledger down by" style={{ marginTop: 14 }}>
              {CUTS.map(([k, l]) => <button key={k} type="button" aria-pressed={cut === k} onClick={() => setCut(k)}>{l}</button>)}
            </div>
            <div className="xo-table-wrap" style={{ marginTop: 8 }}>
              <table className="xo-table">
                <thead><tr><th>{CUTS.find(([k]) => k === cut)[1]}</th><th>REQUESTS</th><th>MEDIAN TIME</th><th>OLD TIME</th><th>TOUCHES NOW / OLD</th><th>VISITS AVOIDED</th><th>HOURS RETURNED</th></tr></thead>
                <tbody>
                  {d[cut].map((r) => (
                    <tr key={String(r[labelKey])}>
                      <td>{String(r[labelKey])}</td>
                      <td>{r.requests} <span className="ci-meta">({r.closed} closed)</span></td>
                      <td>{hoursLabel(r.medianHours)}</td>
                      <td className="ci-meta">{hoursLabel(r.baseline?.hours ?? r.baselineMedianHours)}</td>
                      <td>{r.touchesPerRequestNow ?? "—"} / {r.touchesPerRequestOld ?? "—"}</td>
                      <td>{r.officeVisitsAvoided}</td>
                      <td>{r.studentHoursReturned}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CalcBox label="VIEW DEFINITIONS AND OLD PATHS">
              {Object.entries(d.definitions).map(([k, v]) => <p key={k} style={{ margin: "0 0 4px" }}><b>{k}</b> — {v}</p>)}
              <table><thead><tr><th>TYPE</th><th>OLD PATH (ASSUMPTION)</th><th>HOPS</th><th>TOUCHES</th><th>VISITS</th><th>TIME</th></tr></thead>
                <tbody>{d.byType.filter((r) => r.baseline).map((r) => <tr key={r.workflow}><td>{r.label}</td><td>{(r.baseline.oldPath || []).join(" → ")}</td><td>{r.baseline.hops}</td><td>{r.baseline.touches}</td><td>{r.baseline.officeVisits}</td><td>{hoursLabel(r.baseline.hours)}</td></tr>)}</tbody>
              </table>
              <p className="ci-meta" style={{ marginTop: 6 }}>Source of the old paths: {d.byType.find((r) => r.baseline)?.baseline.source}</p>
            </CalcBox>
            <SourceLine method={d.method} note="new path from the Campus Event log; old path from the baseline table" />
          </div>
        );
      }}
    </ExtSection>
  );
}

export function ReopenRates() {
  const q = useExt("xo:closures", () => xo.closures(180));
  return (
    <ExtSection q={q} lines={4}>
      {(d) => (
        <div className="ext-card">
          <div className="ext-row" style={{ justifyContent: "space-between" }}>
            <div className="ci-label">REOPEN RATE BY DEPARTMENT · {d.window.days} DAYS</div>
            <Kind kind={d.kind} />
          </div>
          <div className="xo-kpi" style={{ marginTop: 6 }}><b>{d.totals.ratePct ?? "—"}%</b><span className="ci-meta">{d.totals.flagged} of {d.totals.resolved} "resolved" complaints were not really fixed</span></div>
          <div className="xo-table-wrap"><table className="xo-table" style={{ marginTop: 8 }}>
            <thead><tr><th>DEPARTMENT</th><th>RESOLVED</th><th>FLAGGED</th><th>RATE</th></tr></thead>
            <tbody>{d.byDepartment.map((r) => <tr key={r.department}><td>{r.department}</td><td>{r.resolved}</td><td>{r.flagged}</td><td>{r.ratePct === null ? "—" : `${r.ratePct}%`}{r.kind === "INSUFFICIENT DATA" ? <span className="ci-meta"> · few samples</span> : null}</td></tr>)}</tbody>
          </table></div>
          <CalcBox label={`VIEW ${d.flags.length} FLAGGED CLOSURES`}>
            <p style={{ margin: "0 0 6px" }}>{d.rule}</p>
            {d.flags.slice(0, 20).map((f) => <p key={f.complaintId} style={{ margin: "0 0 4px" }}><b>{f.reference}</b> · {f.department} · closed {day(f.resolvedAt)} — {f.reasons.map((r) => r.text).join(" ")}</p>)}
          </CalcBox>
          <SourceLine method={d.method} />
        </div>
      )}
    </ExtSection>
  );
}

/** Page 20: each resolved recurring issue measured before and after its latest fix. */
export function BoardImpact({ hostel }) {
  const q = useExt(`xo:board:${hostel || ""}`, () => xo.boardImpact(hostel || undefined));
  return (
    <ExtSection q={q} lines={3}>
      {(d) =>
        d.issues.length ? (
          <div className="ext-card ext-card-strong">
            <div className="ext-row" style={{ justifyContent: "space-between" }}>
              <div className="ci-label">MEASURED · {d.window.weeks} WEEKS BEFORE VS AFTER THE LATEST FIX</div>
              <Kind kind={d.kind} />
            </div>
            <div className="xo-table-wrap"><table className="xo-table" style={{ marginTop: 8 }}>
              <thead><tr><th>ISSUE</th><th>FIXED</th><th>REPORTS / WEEK</th><th>TIME TO FIX</th><th>REOPEN RATE</th><th>VERDICT</th></tr></thead>
              <tbody>
                {d.issues.map((i) => (
                  <tr key={`${i.building}${i.category}`}>
                    <td><b>{i.building}</b> {i.category}<div className="ci-meta">resolved {i.resolvedTimes}× this year</div></td>
                    <td className="ci-meta">{day(i.fixAt)}<div>{i.fix}</div></td>
                    <td>{i.before.perWeek ?? "—"} → {i.after.perWeek ?? "—"}</td>
                    <td>{hoursLabel(i.before.medianHoursToFix)} → {hoursLabel(i.after.medianHoursToFix)}</td>
                    <td>{i.before.reopenRatePct ?? "—"}% → {i.after.reopenRatePct ?? "—"}%</td>
                    <td><Tag kind={i.kind === "INSUFFICIENT DATA" ? "muted" : i.changePct <= -30 ? "SAFE" : i.changePct >= 30 ? "CRITICAL" : "WATCH"}>{i.kind === "INSUFFICIENT DATA" ? "INSUFFICIENT DATA" : `${i.changePct > 0 ? "+" : ""}${i.changePct}%`}</Tag><div className="ci-meta">{i.verdict}</div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="ci-meta">{d.note}</p>
            <SourceLine method={d.method} />
          </div>
        ) : null
      }
    </ExtSection>
  );
}
