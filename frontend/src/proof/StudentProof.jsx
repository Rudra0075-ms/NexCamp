import React, { useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ExtSection, Kind, Outcome, attempt, useExt } from "../ext/kit.jsx";
import { pf } from "./api.js";
import { Card, Deferred, Insufficient, ProofSection, RowTable, Why, dayLabel } from "./kit.jsx";

/*
 * Page 02 — your best time to eat (F5).  Page 03 — point of no return, and the
 * staff view of systemic vs individual absence (F6).  Page 04 — the forecast
 * adjusted for students on approved gate passes, with its backtest (F5).
 * Page 17 — the one action that unblocks the most requests (F9).
 */

const tomorrowKey = () => new Date(Date.now() + 864e5 + 5.5 * 36e5).toISOString().slice(0, 10);

// ---- 02 ----------------------------------------------------------------------------------

export function BestSlot({ lowBw }) {
  const [meal, setMeal] = useState("LUNCH");
  const q = useExt(`pf:slot:${meal}`, () => pf.bestSlot(meal));
  const [result, setResult] = useState(null);
  return (
    <div className="ci ext" style={{ padding: 0, marginTop: 14 }}>
      <Deferred lowBw={lowBw} label="BEST TIME TO EAT">
        <div className="pf-card">
          <div className="pf-row" style={{ justifyContent: "space-between" }}>
            <div className="ci-label">YOUR BEST TIME TO EAT TODAY</div>
            <div className="ext-chips" role="group" aria-label="Meal">{["BREAKFAST", "LUNCH", "DINNER"].map((m) => <button key={m} type="button" className="ci-chip" aria-pressed={meal === m} onClick={() => { setMeal(m); setResult(null); }}>{m}</button>)}</div>
          </div>
          <ExtSection q={q} lines={2}>
            {(d) => d.insufficient ? <p className="ci-meta">{d.text}</p> : !d.recommendation ? <p className="ci-meta">{d.text}</p> : (
              <>
                <p className="ci-body" style={{ margin: "8px 0", fontSize: 17 }}><b>{d.recommendation.text}</b></p>
                <div className="pf-row">
                  <Kind kind={d.recommendation.kind} />
                  {d.accepted || result?.data ? <Tag kind="SAFE">NOTED</Tag> : <button type="button" className="btn btn-secondary" onClick={async () => setResult(await attempt(() => pf.acceptSlot({ meal: d.meal, date: d.date, slot: d.recommendation.slot, peakSlot: d.recommendation.peak.slot, queueMinutes: d.recommendation.queueMinutes }), "Noted — this helps measure whether suggestions spread the queue."))}>I'LL GO THEN</button>}
                </div>
                <Outcome result={result} />
                <Why><p>{d.basis}</p><p className="pf-muted">{d.granularity}</p><RowTable rows={d.slots.map((s) => ({ slot: s.time, medianQueueMin: s.queueMinutes, medianHeadcount: s.crowd, busy: d.busy.some((b) => s.time >= b.start && s.time < b.end) ? "in class" : "" }))} /></Why>
              </>
            )}
          </ExtSection>
        </div>
      </Deferred>
    </div>
  );
}

// ---- 03 ----------------------------------------------------------------------------------

const PNR_TAG = { PASSED: "CRITICAL", APPROACHING: "WATCH", SAFE_AT_RECENT_RATE: "SAFE" };

export function PointOfNoReturn({ lowBw }) {
  const q = useExt("pf:pnr", () => pf.pointOfNoReturn());
  return (
    <ProofSection kicker="PREVENT · POINT OF NO RETURN" title="The last date on which recovery is still mathematically possible." id="pf-pnr">
      <Deferred lowBw={lowBw} label="POINT OF NO RETURN">
        <ExtSection q={q} lines={4}>
          {(d) => d.subjects.length ? (
            <div className="pf-cards">
              {d.subjects.map((s) => (
                <div key={s.subject} className="pf-card">
                  <div className="pf-row" style={{ justifyContent: "space-between" }}><b>{s.subject}</b><Tag kind={PNR_TAG[s.status] || "muted"}>{s.status.replace(/_/g, " ")}</Tag></div>
                  <div className="pf-muted">{s.attended}/{s.held} attended ({s.percentage}%) · best case {s.bestCase}%</div>
                  <p className="ci-body" style={{ margin: "6px 0" }}>{s.status === "APPROACHING" ? <>Recovery still possible until <b>{dayLabel(s.lastSafeDate)}</b> — after {s.classesLeftBeforeNoReturn} more class{s.classesLeftBeforeNoReturn === 1 ? "" : "es"} at {s.recentMissRate === null ? "your semester" : "your recent"} miss rate ({Math.round((s.missRateUsed ?? 0) * 100)}%), it no longer is.</> : s.text}</p>
                  <Kind kind={s.kind} />
                  <Why><p>{s.formula}</p><p className="pf-muted">Recent miss rate: {s.recentBasis}. Semester end {d.semesterEnd} ({d.semesterEndKind}).</p></Why>
                </div>
              ))}
            </div>
          ) : <StateBox title="No attendance records">Nothing is recorded for your account yet.</StateBox>}
        </ExtSection>
      </Deferred>
    </ProofSection>
  );
}

const VERDICT_KIND = { SYSTEMIC: "HIGH", MIXED: "WATCH", INDIVIDUAL: "WATCH", STABLE: "SAFE" };

export function SectionAnalysis({ lowBw }) {
  const q = useExt("pf:sections", () => pf.sections());
  const [open, setOpen] = useState(null);
  return (
    <ProofSection kicker="AUDIT · SYSTEMIC OR INDIVIDUAL?" title="Is the drop about the students, or about the class slot?" id="pf-sections">
      <Deferred lowBw={lowBw} label="SECTION ANALYSIS">
        <ExtSection q={q} lines={5}>
          {(d) => (
            <>
              <p className="pf-muted" style={{ marginTop: 0 }}>Scope: {d.scope.sees}. {d.noFacultyRole}</p>
              <div className="ext-stack">
                {d.sections.map((s, i) => (
                  <div key={`${s.section}${s.subject}`} className="pf-card">
                    <div className="pf-row" style={{ justifyContent: "space-between" }}>
                      <b>{s.branch}-{s.year}{s.section} · {s.subject}</b>
                      <div className="pf-row"><Tag kind={VERDICT_KIND[s.verdict] || "muted"}>{s.verdict}</Tag><Kind kind={s.kind} /></div>
                    </div>
                    <p className="ci-meta" style={{ margin: "6px 0" }}>{s.text}</p>
                    {s.verdict !== "INSUFFICIENT DATA" ? <button type="button" className="ci-link xo-linkbtn" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{open === i ? "HIDE EVIDENCE" : "EVIDENCE"}</button> : null}
                    {open === i ? (
                      <div style={{ marginTop: 8 }}>
                        {s.slots?.length ? <><div className="ci-label">By weekday and slot (presence %)</div><RowTable rows={s.slots.map((x) => ({ slot: x.slot, before: x.baseline, recent: x.recent, dropPts: x.drop }))} /></> : null}
                        {s.individuals?.length ? <><div className="ci-label" style={{ marginTop: 8 }}>Students needing attention</div><RowTable rows={s.individuals} /></> : null}
                        {s.evidence?.length ? <><div className="ci-label" style={{ marginTop: 8 }}>Same time, same place</div><ul className="ext-list">{s.evidence.map((e, k) => <li key={k} className="ci-body"><Kind kind={e.kind} /> {e.text}</li>)}</ul><p className="pf-muted"><Kind kind="AI HYPOTHESIS" /> {s.evidenceNote}</p></> : null}
                        <p className="pf-muted">{s.rule}</p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <h3 className="ext-h2" style={{ marginTop: 18 }}>Students approaching the point of no return</h3>
              {d.approaching.length ? <RowTable rows={d.approaching.slice(0, 20).map((a) => ({ student: a.name, cohort: a.cohort, subject: a.subject, status: a.status, classesLeft: a.classesLeft, noReturnOn: a.noReturnDate, daysLeft: a.daysLeft, now: `${a.percentage}%` }))} /> : <p className="ci-meta">No student in scope is within reach of the point of no return.</p>}
            </>
          )}
        </ExtSection>
      </Deferred>
    </ProofSection>
  );
}

export function AttendanceProof({ lowBw, user }) {
  if (!user) return null;
  if (user.role === "STUDENT") return <PointOfNoReturn lowBw={lowBw} />;
  if (user.role === "ADMIN" || user.role === "WARDEN") return <SectionAnalysis lowBw={lowBw} />;
  return null;
}

// ---- 04 ----------------------------------------------------------------------------------

const TRUST = { BACKTESTED_BETTER: ["SAFE", "BACKTESTED · BETTER"], BACKTESTED_NOT_BETTER: ["WATCH", "BACKTESTED · NOT BETTER"], UNPROVEN: ["muted", "NOT YET BACKTESTED"] };

export function PresenceForecast({ lowBw }) {
  const [meal, setMeal] = useState("LUNCH");
  const [date, setDate] = useState(tomorrowKey());
  const q = useExt(`pf:presence:${meal}:${date}`, () => pf.presence(meal, date));
  return (
    <ProofSection kicker="PREVENT · PRESENCE-AWARE FORECAST" title="The forecast, minus students the gate-pass register says will be away." id="pf-presence">
      <div className="pf-row" style={{ marginBottom: 12 }}>
        <div className="ext-chips" role="group" aria-label="Meal">{["BREAKFAST", "LUNCH", "DINNER"].map((m) => <button key={m} type="button" className="ci-chip" aria-pressed={meal === m} onClick={() => setMeal(m)}>{m}</button>)}</div>
        <label className="ext-field" style={{ maxWidth: 200 }}><span className="ci-label">Date</span><input className="ci-input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
      </div>
      <Deferred lowBw={lowBw} label="PRESENCE FORECAST">
        <ExtSection q={q} lines={4}>
          {(d) => d.base.insufficient ? <Insufficient text={d.base.reason} /> : (
            <>
              <div className="pf-cards">
                <Card label="SAME-WEEKDAY FORECAST" value={`${d.base.predicted} covers`} kind={d.base.kind}>range {d.base.low}–{d.base.high} · {d.base.method}</Card>
                <Card label="PRESENCE ADJUSTMENT" value={d.adjustment ? `${d.adjustment.covers} covers` : "—"} kind={d.adjustment?.kind || "INSUFFICIENT DATA"}>{d.adjustment ? d.adjustment.text : d.participation.basis}</Card>
                <Card label="ADJUSTED FORECAST" value={d.adjusted ? `${d.adjusted.predicted} covers` : "—"} kind={d.adjusted?.kind}>{d.adjusted ? `range ${d.adjusted.low}–${d.adjusted.high}` : "not available"}</Card>
                <Card label="BACKTEST" value={d.backtest.insufficient ? "—" : `${d.backtest.maeWith} vs ${d.backtest.maeWithout}`} kind={d.backtest.kind}><Tag kind={TRUST[d.trust][0]}>{TRUST[d.trust][1]}</Tag> {d.backtest.text}</Card>
              </div>
              <Why>
                <p>{d.adjustment?.formula}</p>
                <p>Participation: {d.participation.basis} <Kind kind={d.participation.kind} /></p>
                {d.backtest.rows?.length ? <RowTable rows={d.backtest.rows.map((r) => ({ day: r.date, actual: r.actual, forecast: r.predicted, away: r.away, adjusted: r.predicted + r.adjustment }))} /> : null}
                <p className="pf-muted">Backtest: each past day predicted only from the days before it, with and without the adjustment; mean absolute error over days that had students away.</p>
              </Why>
              <p className="pf-muted" style={{ marginTop: 8 }}>Suggested-slot uptake: {d.nudges?.text}</p>
            </>
          )}
        </ExtSection>
      </Deferred>
    </ProofSection>
  );
}

// ---- 17 ----------------------------------------------------------------------------------

export function Unblock({ onGo }) {
  const q = useExt("pf:unblock", () => pf.unblock());
  return (
    <ExtSection q={q} lines={2}>
      {(d) => (
        <div className="ext-card ext-card-strong" style={{ marginBottom: 16 }}>
          <div className="pf-row" style={{ justifyContent: "space-between" }}><div className="ci-label">THE ONE THING THAT UNBLOCKS THE MOST</div><Kind kind={d.kind} /></div>
          <p className="ci-body" style={{ margin: "8px 0", fontSize: 16 }}><b>{d.text}</b></p>
          {d.best?.page && onGo ? <button type="button" className="btn btn-secondary" onClick={() => onGo(d.best.page)}>GO TO {d.best.pageLabel}</button> : null}
          <Why label="WHAT IS BLOCKED BY WHAT">
            <RowTable rows={d.requests.map((r) => ({ request: r.label, decision: r.decision.replace(/_/g, " "), blockedBy: r.failed.map((c) => c.explanation || c.label).join(" · ") || "—" }))} />
            <p className="pf-muted">{d.method}. Conditions about how a request is filled in (lead time, duration) are not counted as blockers you can clear.</p>
          </Why>
        </div>
      )}
    </ExtSection>
  );
}
