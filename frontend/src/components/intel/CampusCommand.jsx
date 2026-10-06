import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import {
  BarList,
  Confidence,
  Drawer,
  Guard,
  LineChart,
  Section,
  Sparkline,
  StateBox,
  Tag,
  invalidate,
  useApi
} from "./kit.jsx";
import "./intel.css";

/*
 * PS07 additions to Campus Mission Control: Campus Pulse, the Campus Early
 * Warning alert centre, cross-module trends, predictive insights, recurring
 * issue intelligence, WHY? explanations and the college adoption section.
 *
 * Every number is read from /api/ai/early-warning, /api/ai/predictive,
 * /api/ai/pulse or /api/ai/why. Nothing here computes a statistic of its own.
 * Statements carry their kind — ACTUAL DATA, AI DETECTED PATTERN,
 * AI HYPOTHESIS, AI PREDICTION, RECOMMENDED ACTION — so a guess never reads
 * as a fact.
 */

const DEPARTMENTS = [
  "MAINTENANCE · PLUMBING",
  "MAINTENANCE · ELECTRICAL",
  "IT · NETWORK",
  "HOUSEKEEPING",
  "MESS ADMINISTRATION",
  "SECURITY",
  "ACADEMIC OFFICE",
  "MEDICAL CENTRE",
  "GENERAL ADMINISTRATION"
];

const TIER_ORDER = ["CRITICAL", "WARNING", "WATCH", "NORMAL"];
const KIND_TAG = {
  "ACTUAL DATA": "ACTUAL DATA",
  "AI DETECTED PATTERN": "AI DETECTED PATTERN",
  "AI HYPOTHESIS": "AI HYPOTHESIS",
  "AI PREDICTION": "AI PREDICTION",
  "RECOMMENDED ACTION": "RECOMMENDED ACTION"
};

const EW_KEY = "ps07:early-warning";
const REFRESH = "ps07:refresh";
// Several panels read the same early-warning result; an action taken in any
// of them refreshes all of them, so the alert centre and the recurring panel
// never disagree about an alert's state.
function useEarlyWarning(enabled) {
  const q = useApi(EW_KEY, api.aiEarlyWarning, { enabled });
  const { reload } = q;
  useEffect(() => {
    window.addEventListener(REFRESH, reload);
    return () => window.removeEventListener(REFRESH, reload);
  }, [reload]);
  return q;
}

export function TierChip({ tier }) {
  return <span className={`ci-tier ci-tier-${tier}`}>{tier}</span>;
}

function KindLine({ kind, children }) {
  return (
    <div className="ci-kindline">
      <Tag kind={KIND_TAG[kind] || kind}>{kind}</Tag>
      <span>{children}</span>
    </div>
  );
}

function Wrap({ children }) {
  return <div className="ci ci-embed">{children}</div>;
}

function staffGate(live, staff) {
  if (!live) return "offline";
  if (!staff) return "auth";
  return null;
}

function Gate({ state }) {
  if (state === "offline") {
    return (
      <StateBox kind="offline" title="Backend offline">
        This analysis is computed by the NeX Camp API from stored records. It is not reachable, so nothing is shown rather than invented numbers.
      </StateBox>
    );
  }
  return <StateBox title="Sign in with a staff account">Early warnings, predictions and Campus Pulse read every module's records, so they are for staff accounts.</StateBox>;
}

// ---------------------------------------------------------------------------
// Actions — shared by the alert centre and the recurring-issue panel
// ---------------------------------------------------------------------------

function useAlertActions() {
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const act = useCallback(
    async (alert, action, extra = {}) => {
      setBusy(action);
      setResult(null);
      try {
        const res = await api.alertAct({
          key: alert.key,
          action,
          tier: alert.tier,
          complaintIds: alert.complaintIds || [],
          ...extra
        });
        const n = res?.complaintsTouched ?? 0;
        setResult({
          ok: true,
          status: res?.status,
          text: action === "RESOLVE"
            ? "Alert closed. Linked complaints stay open until each is resolved through its own review."
            : `${res?.status || action} · ${n} linked complaint${n === 1 ? "" : "s"} updated, with audit entries.`
        });
        invalidate("ps07:");
        window.dispatchEvent(new Event(REFRESH));
      } catch (error) {
        setResult({ ok: false, text: error.message || "The action failed" });
      } finally {
        setBusy(null);
      }
    },
    []
  );
  return { busy, result, act, clear: () => setResult(null) };
}

function ActionBar({ alert, actions, assignLabel = "ASSIGN", showResolve = true, onViewRelated }) {
  const [dept, setDept] = useState(alert.department || DEPARTMENTS[0]);
  const open = alert.complaintIds?.length || 0;
  return (
    <div className="ci-actionbar">
      <div className="ci-actions">
        <button type="button" className="btn btn-secondary ci-act" disabled={Boolean(actions.busy)} onClick={() => actions.act(alert, "INVESTIGATE")}>
          {actions.busy === "INVESTIGATE" ? "WORKING…" : "INVESTIGATE"}
        </button>
        <span className="ci-assign">
          <select className="ci-select" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department to assign">
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button type="button" className="btn btn-primary ci-act" disabled={Boolean(actions.busy)} onClick={() => actions.act(alert, "ASSIGN", { department: dept })}>
            {actions.busy === "ASSIGN" ? "WORKING…" : assignLabel}
          </button>
        </span>
        <button type="button" className="btn btn-secondary ci-act" disabled={Boolean(actions.busy)} onClick={() => actions.act(alert, "ESCALATE")}>
          {actions.busy === "ESCALATE" ? "WORKING…" : "ESCALATE"}
        </button>
        {showResolve ? (
          <button type="button" className="btn btn-secondary ci-act" disabled={Boolean(actions.busy)} onClick={() => actions.act(alert, "RESOLVE")}>
            {actions.busy === "RESOLVE" ? "WORKING…" : "RESOLVE ALERT"}
          </button>
        ) : null}
        {onViewRelated ? (
          <button type="button" className="btn btn-secondary ci-act" onClick={onViewRelated}>VIEW RELATED COMPLAINTS</button>
        ) : null}
      </div>
      <p className="ci-meta" style={{ marginTop: 8, lineHeight: 1.55 }}>
        {open
          ? `Investigate, assign and escalate update the ${open} open linked complaint${open === 1 ? "" : "s"} through the normal complaint workflow, with audit entries.`
          : "No open complaints are linked to this alert; actions record the operator's decision on the alert itself."}{" "}
        Resolving closes the alert only; each complaint is still resolved through its own review.
      </p>
      {actions.result ? (
        <div role="status" className={`ci-result ${actions.result.ok ? "" : "ci-result-err"}`}>
          {actions.result.text}
        </div>
      ) : null}
    </div>
  );
}

function RelatedList({ rows = [] }) {
  if (!rows.length) return <p className="ci-meta">No linked complaints.</p>;
  return (
    <div className="ci-table-wrap">
      <table className="ci-table">
        <thead><tr><th>Ref</th><th>Complaint</th><th>Room</th><th>Priority</th><th>Status</th><th>Filed</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="ci-num">{r.reference}</td>
              <td>{r.title}</td>
              <td>{r.room || "—"}</td>
              <td>{r.priority}</td>
              <td>{r.status}</td>
              <td className="ci-num">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature 8 · Campus Pulse
// ---------------------------------------------------------------------------

export function PulseCard({ live, staff }) {
  const gate = staffGate(live, staff);
  const q = useApi("ps07:pulse", api.aiPulse, { enabled: !gate });
  const [open, setOpen] = useState(false);
  if (gate) return <Wrap><div className="ci-pulse"><Gate state={gate} /></div></Wrap>;
  return (
    <Wrap>
      <Section q={q} live={live} lines={3}>
        {(p) => (
          <div className="ci-pulse">
            <div className="ci-pulse-score">
              <div className="ci-label">CAMPUS PULSE</div>
              <div className="ci-pulse-num">
                {p.score === null ? "—" : <><b className="ci-num">{p.score}</b><span>/100</span></>}
              </div>
              <Tag kind={p.score === null ? "INSUFFICIENT DATA" : p.score >= 80 ? "SAFE" : p.score >= 60 ? "WATCH" : "AT RISK"}>{p.band}</Tag>
              <div className="ci-meta" style={{ marginTop: 8 }}>{p.label || "PROTOTYPE OPERATIONAL INDICATOR"}</div>
            </div>
            <div className="ci-pulse-parts">
              <BarList
                max={100}
                data={p.components.map((c) => ({ label: c.label, value: c.value ?? 0, highlight: c.label === p.weakest }))}
                format={(v) => `${Math.round(v)}`}
              />
              {p.missing?.length ? <p className="ci-meta" style={{ marginTop: 8 }}>No data yet for: {p.missing.join(", ")} — left out and the weights rescaled.</p> : null}
              <button type="button" className="ci-link ci-link-ink" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>VIEW CALCULATION</button>
            </div>
            <Drawer open={open} onClose={() => setOpen(false)} heading={`Campus Pulse ${p.score ?? "—"}/100`} kicker="HOW THE SCORE IS CALCULATED">
              <p className="ci-body">{p.formula || p.note}</p>
              <div className="ci-table-wrap">
                <table className="ci-table">
                  <thead><tr><th>Component</th><th>Score</th><th>Weight</th><th>Used weight</th><th>Adds</th></tr></thead>
                  <tbody>
                    {p.components.map((c) => (
                      <tr key={c.key}>
                        <td>{c.label}</td>
                        <td className="ci-num">{c.value ?? "no data"}</td>
                        <td className="ci-num">{c.weight}</td>
                        <td className="ci-num">{c.effectiveWeight ?? 0}%</td>
                        <td className="ci-num">{c.contribution ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {p.components.map((c) => (
                <div key={c.key}>
                  <div className="ci-label" style={{ marginBottom: 4 }}>{c.label}</div>
                  <KindLine kind="ACTUAL DATA">{c.inputs}</KindLine>
                  <p className="ci-meta" style={{ lineHeight: 1.5, marginTop: 4 }}>{c.formula}</p>
                </div>
              ))}
              <p className="ci-meta" style={{ lineHeight: 1.55 }}>{p.disclaimer}</p>
            </Drawer>
          </div>
        )}
      </Section>
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
// Feature 4 · Campus Early Warning — the alert centre
// ---------------------------------------------------------------------------

function AlertDrawer({ alert, related, onClose }) {
  const actions = useAlertActions();
  const [showRelated, setShowRelated] = useState(false);
  if (!alert) return null;
  return (
    <Drawer open onClose={onClose} heading={alert.title} kicker={`${alert.tier} · ${alert.source}`}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <TierChip tier={alert.tier} />
        <Tag kind="ACTUAL DATA">{alert.state?.status || "OPEN"}</Tag>
        {alert.state?.department ? <span className="ci-meta">→ {alert.state.department}</span> : null}
        {alert.state?.by ? <span className="ci-meta">by {alert.state.by}</span> : null}
      </div>
      <div>
        <div className="ci-label" style={{ marginBottom: 6 }}>What changed</div>
        <KindLine kind="ACTUAL DATA">{alert.whatChanged}</KindLine>
      </div>
      <div>
        <div className="ci-label" style={{ marginBottom: 6 }}>Why it was detected</div>
        <KindLine kind="AI DETECTED PATTERN">{alert.whyDetected}</KindLine>
      </div>
      <div>
        <div className="ci-label" style={{ marginBottom: 6 }}>Who is affected</div>
        <KindLine kind="ACTUAL DATA">{alert.affected}</KindLine>
      </div>
      {alert.chart && alert.chart.values?.some((v) => v !== null) ? (
        <div>
          <div className="ci-label" style={{ marginBottom: 6 }}>Last 14 days · {alert.chart.unit}</div>
          <LineChart
            labels={alert.chart.labels}
            series={[{ label: alert.chart.unit, values: alert.chart.values, color: "var(--color-accent)" }]}
            height={170}
            yMin={0}
            format={(v) => (v === null || v === undefined ? "—" : String(Math.round(v * 10) / 10))}
            ariaLabel={`${alert.title}, daily values`}
          />
        </div>
      ) : null}
      <div>
        <div className="ci-label" style={{ marginBottom: 6 }}>Possible cause</div>
        <KindLine kind={alert.causeKind}>{alert.cause}</KindLine>
      </div>
      <div>
        <div className="ci-label" style={{ marginBottom: 6 }}>Confidence</div>
        {alert.confidence !== null && alert.confidence !== undefined ? <Confidence value={alert.confidence} /> : <span className="ci-meta">Measured, not estimated.</span>}
        <p className="ci-meta" style={{ marginTop: 6, lineHeight: 1.5 }}>{alert.confidenceBasis}</p>
      </div>
      <div>
        <div className="ci-label" style={{ marginBottom: 6 }}>Recommended action</div>
        <KindLine kind="RECOMMENDED ACTION">{alert.action}</KindLine>
      </div>
      <ActionBar alert={alert} actions={actions} onViewRelated={related?.length ? () => setShowRelated((v) => !v) : null} />
      {showRelated ? <RelatedList rows={related} /> : null}
    </Drawer>
  );
}

export function AlertCenter({ live, staff }) {
  const gate = staffGate(live, staff);
  const q = useEarlyWarning(!gate);
  const [filter, setFilter] = useState("ALL");
  const [openKey, setOpenKey] = useState(null);
  if (gate) return <Wrap><Gate state={gate} /></Wrap>;
  return (
    <Wrap>
      <Section q={q} live={live} loadingSteps={["Reading every module", "Comparing this week with last", "Grouping recurring problems", "Ranking alerts"]}>
        {(d) => {
          const shown = d.alerts.filter((a) => (filter === "ALL" ? true : a.tier === filter));
          const openAlert = d.alerts.find((a) => a.key === openKey) || null;
          const related = openAlert?.patternKey ? d.recurring.find((r) => r.key === openAlert.patternKey)?.related : null;
          return (
            <div className="ci-alertcenter">
              <div className="ci-tiers" role="group" aria-label="Filter alerts by tier">
                <button type="button" className="ci-tierbtn" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")}>
                  <span className="ci-label">ALL</span><b className="ci-num">{d.alerts.filter((a) => a.state.status !== "RESOLVED").length}</b>
                </button>
                {TIER_ORDER.map((t) => (
                  <button key={t} type="button" className={`ci-tierbtn ci-tierbtn-${t}`} aria-pressed={filter === t} onClick={() => setFilter(t)}>
                    <span className="ci-label">{t}</span><b className="ci-num">{d.counts[t] ?? 0}</b>
                  </button>
                ))}
              </div>
              {filter === "NORMAL" ? (
                <p className="ci-body" style={{ marginTop: 14 }}>
                  {d.counts.NORMAL} signal{d.counts.NORMAL === 1 ? "" : "s"} are within normal week-to-week variation:{" "}
                  {d.signals.filter((s) => s.trend.sufficient && s.trend.tier === "NORMAL").map((s) => s.label).join(", ") || "none"}.
                </p>
              ) : shown.length ? (
                <div className="ci-alerts">
                  {shown.map((a) => (
                    <button type="button" key={a.key} className={`ci-alert ci-alert-${a.tier} ${a.state.status === "RESOLVED" ? "is-resolved" : ""}`} onClick={() => setOpenKey(a.key)}>
                      <div className="ci-between" style={{ gap: 10 }}>
                        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <TierChip tier={a.tier} />
                          <span className="ci-label">{a.source}</span>
                        </span>
                        <span className="ci-label">{a.state.status}</span>
                      </div>
                      <div className="ci-h3" style={{ marginTop: 8 }}>{a.title}</div>
                      <div className="ci-meta" style={{ marginTop: 4, lineHeight: 1.5 }}>{a.whatChanged}</div>
                      <div className="ci-go">OPEN ALERT →</div>
                    </button>
                  ))}
                </div>
              ) : (
                <StateBox title={`No ${filter === "ALL" ? "" : filter.toLowerCase() + " "}alerts`}>Nothing in the records crosses a threshold at this tier.</StateBox>
              )}
              <p className="ci-meta" style={{ marginTop: 12, lineHeight: 1.55 }}>{d.disclaimer}</p>
              {openAlert ? <AlertDrawer alert={openAlert} related={related} onClose={() => setOpenKey(null)} /> : null}
            </div>
          );
        }}
      </Section>
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
// Feature 7 · WHY? — the evidence behind one graph
// ---------------------------------------------------------------------------

function WhyBody({ w }) {
  return (
    <>
      <p className="ci-h3" style={{ lineHeight: 1.35 }}>{w.headline}</p>
      {w.series?.some((p) => p.value !== null) ? (
        <LineChart
          labels={w.series.map((p) => p.date.slice(5))}
          series={[{ label: w.unit, values: w.series.map((p) => p.value), color: "var(--color-accent)" }]}
          height={170}
          yMin={/day|hours/.test(w.unit || "") ? 0 : undefined}
          format={(v) => (v === null || v === undefined ? "—" : String(Math.round(v * 100) / 100))}
          ariaLabel={`${w.label}, last 14 days`}
        />
      ) : null}
      <div>
        <div className="ci-label" style={{ marginBottom: 6 }}>What the records show</div>
        <div style={{ display: "grid", gap: 8 }}>{w.facts.map((f) => <KindLine key={f.text} kind={f.kind}>{f.text}</KindLine>)}</div>
      </div>
      <div>
        <div className="ci-label" style={{ marginBottom: 6 }}>Possible cause</div>
        {w.hypotheses?.length ? (
          <div style={{ display: "grid", gap: 8 }}>{w.hypotheses.map((h) => <KindLine key={h.text} kind={h.kind}>{h.text}</KindLine>)}</div>
        ) : (
          <KindLine kind="ACTUAL DATA">{w.cause}</KindLine>
        )}
      </div>
      {w.actions?.length ? (
        <div>
          <div className="ci-label" style={{ marginBottom: 6 }}>Recommended action</div>
          <div style={{ display: "grid", gap: 8 }}>{w.actions.map((a) => <KindLine key={a.text} kind={a.kind}>{a.text}</KindLine>)}</div>
        </div>
      ) : null}
      {w.trend?.rule ? <p className="ci-meta" style={{ lineHeight: 1.55 }}>Rule · {w.trend.rule}</p> : null}
    </>
  );
}

function WhyFetch({ metric }) {
  const q = useApi(`ps07:why:${metric}`, () => api.aiWhy(metric));
  return (
    <Section q={q} live lines={4}>
      {(w) => <WhyBody w={w} />}
    </Section>
  );
}

/**
 * A WHY? button for any existing graph. `metric` names the signal the graph
 * shows; `why` may be passed when the answer is already loaded.
 */
export function WhyButton({ metric, why, live = true, staff = true, label = "WHY?", heading }) {
  const [open, setOpen] = useState(false);
  const blocked = !live || !staff;
  return (
    <span className="ci" style={{ display: "inline", padding: 0, margin: 0, maxWidth: "none" }}>
      <button
        type="button"
        className="ci-why"
        onClick={() => setOpen(true)}
        disabled={blocked}
        title={blocked ? "Needs the backend and a staff account" : "Show the evidence behind this graph"}
      >
        {label}
      </button>
      {open ? (
        <Drawer open onClose={() => setOpen(false)} heading={heading || "Why did this change?"} kicker="AI EXPLANATION · FROM RECORDS">
          <Guard name="Explanation">{why ? <WhyBody w={why} /> : <WhyFetch metric={metric} />}</Guard>
        </Drawer>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Feature 2 · cross-module early-warning trends
// ---------------------------------------------------------------------------

export function EarlyWarningTrends({ live, staff }) {
  const gate = staffGate(live, staff);
  const q = useEarlyWarning(!gate);
  if (gate) return <Wrap><Gate state={gate} /></Wrap>;
  return (
    <Wrap>
      <Section q={q} live={live}>
        {(d) => (
          <div className="ci-trendgrid">
            {d.signals.map((s) => {
              const t = s.trend;
              return (
                <div key={s.key} className={`ci-trend ${t.sufficient ? `ci-trend-${t.tier}` : ""}`}>
                  <div className="ci-between" style={{ gap: 8 }}>
                    <span className="ci-label">{s.module}</span>
                    {t.sufficient ? <TierChip tier={t.tier} /> : <Tag kind="INSUFFICIENT DATA">INSUFFICIENT DATA</Tag>}
                  </div>
                  <div className="ci-h3" style={{ marginTop: 6 }}>{s.label}</div>
                  {t.sufficient ? (
                    <>
                      <div className="ci-trend-nums">
                        <b className="ci-num">{t.changePct === null ? "—" : `${t.changePct > 0 ? "+" : ""}${t.changePct}%`}</b>
                        <span className="ci-meta">{t.priorMean} → {t.recentMean} {s.unit}</span>
                      </div>
                      <Sparkline values={s.series.map((p) => p.value)} width={220} height={40} color={t.tier === "NORMAL" ? "var(--color-neutral-600)" : "var(--color-accent)"} />
                      <div className="ci-meta" style={{ marginTop: 4 }}>
                        {t.consecutive >= 2 ? `Worse ${t.consecutive} days in a row · ` : ""}{t.daysWithData} days with data
                      </div>
                    </>
                  ) : (
                    <p className="ci-meta" style={{ marginTop: 8, lineHeight: 1.5 }}>{t.reason}</p>
                  )}
                  <div style={{ marginTop: 10 }}>
                    <WhyButton why={s.why} heading={`Why: ${s.label}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
// Feature 3 · predictive insights
// ---------------------------------------------------------------------------

export function PredictiveInsights({ live, staff }) {
  const gate = staffGate(live, staff);
  const q = useApi("ps07:predictive", api.aiPredictive, { enabled: !gate });
  if (gate) return <Wrap><Gate state={gate} /></Wrap>;
  return (
    <Wrap>
      <Section q={q} live={live}>
        {(d) => (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Tag kind="AI PREDICTION">AI PREDICTION</Tag>
              <Tag kind="PROJECTED">ESTIMATED</Tag>
              <Tag kind="PROJECTED">BASED ON RECENT TRENDS</Tag>
            </div>
            <div className="ci-predgrid">
              {d.insights.map((p) => (
                <div key={p.key} className={`ci-pred ${p.sufficient ? "" : "is-muted"}`}>
                  <div className="ci-label">{p.title}</div>
                  <p className="ci-h3" style={{ marginTop: 6, lineHeight: 1.35 }}>{p.prediction}</p>
                  <div className="ci-kv" style={{ marginTop: 10 }}>
                    <span>Data used</span><span>{p.dataUsed}</span>
                    <span>Horizon</span><span>{p.horizon}</span>
                    <span>Action</span><span>{p.action || "—"}</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    {p.confidence !== null && p.confidence !== undefined ? <Confidence value={p.confidence} /> : <span className="ci-meta">No confidence given — not enough data to estimate.</span>}
                  </div>
                </div>
              ))}
            </div>
            <p className="ci-meta" style={{ marginTop: 12, lineHeight: 1.55 }}>{d.disclaimer}</p>
          </>
        )}
      </Section>
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
// Feature 1 · recurring issue intelligence, added under each existing
// RECURRING PROBLEM DETECTION pattern
// ---------------------------------------------------------------------------

export function RecurringIntel({ patternKey, live, staff }) {
  const gate = staffGate(live, staff);
  const q = useEarlyWarning(!gate);
  const actions = useAlertActions();
  const [showRelated, setShowRelated] = useState(false);
  const intel = q.data?.recurring?.find((r) => r.key === patternKey);
  const alert = q.data?.alerts?.find((a) => a.key === `recurring:${patternKey}`);
  if (gate || !intel) return null;
  const alertLike = alert || { key: `recurring:${patternKey}`, tier: "WATCH", department: intel.department, complaintIds: intel.related.filter((r) => r.status !== "RESOLVED").map((r) => r.id) };
  return (
    <Wrap>
      <div className="ci-recur">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Tag kind="AI DETECTED PATTERN">RECURRING ISSUE INTELLIGENCE</Tag>
          {alert ? <TierChip tier={alert.tier} /> : null}
          {alert?.state?.status && alert.state.status !== "OPEN" ? <span className="ci-label">{alert.state.status}{alert.state.department ? ` → ${alert.state.department}` : ""}</span> : null}
        </div>
        <p className="ci-body" style={{ marginTop: 8 }}>{intel.headline}</p>
        <div className="ci-kv" style={{ marginTop: 10 }}>
          <span>Location</span><span>{intel.location}</span>
          <span>Rooms</span><span>{intel.rooms.length ? intel.rooms.join(", ") : "Not room-specific"}</span>
          {intel.floors.length ? (<><span>Floors</span><span>{intel.floors.map((f) => `Floor ${f.floor}: ${f.count}`).join(" · ")}</span></>) : null}
          <span>Trend</span><span>{intel.trend.direction} · {intel.trend.last7} this week vs {intel.trend.prior7} last week</span>
          <span>Severity</span><span>{intel.severity} (highest classified priority)</span>
          <span>Previous incidents</span>
          <span>
            {intel.previousIncidents.length
              ? intel.previousIncidents.slice(0, 3).map((m) => `${new Date(m.occurredOn).toISOString().slice(0, 10)} · ${m.cause}${m.resolutionTimeHours ? ` (fixed in ${m.resolutionTimeHours}h)` : ""}`).join(" | ")
              : "None in campus memory"}
          </span>
        </div>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <KindLine kind={intel.causeKind}>Possible cause: {intel.cause}</KindLine>
          <p className="ci-meta" style={{ lineHeight: 1.5 }}>{intel.causeBasis}</p>
          <KindLine kind="RECOMMENDED ACTION">{intel.recommendation}</KindLine>
          <div>
            <Confidence value={intel.confidence} />
            <p className="ci-meta" style={{ marginTop: 4 }}>{intel.confidenceBasis} Built from: {intel.confidenceFactors.map((f) => `${f.label} +${f.points}`).join(", ")}.</p>
          </div>
        </div>
        <ActionBar alert={alertLike} actions={actions} assignLabel="ASSIGN MAINTENANCE" showResolve={false} onViewRelated={() => setShowRelated((v) => !v)} />
        {showRelated ? <RelatedList rows={intel.related} /> : null}
      </div>
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
// Feature 5 · kiosk activity, as Mission Control sees it
// ---------------------------------------------------------------------------

export function KioskActivity({ live, staff, onOpenKiosk }) {
  const gate = staffGate(live, staff);
  const q = useApi("ps07:kiosk-activity", api.kioskActivity, { enabled: !gate });
  if (gate) return null;
  return (
    <Wrap>
      <Section q={q} live={live} lines={2}>
        {(d) => (
          <div>
            {d.rows.length ? (
              <div className="ci-table-wrap">
                <table className="ci-table">
                  <thead><tr><th>Type</th><th>Ref</th><th>Request</th><th>Student</th><th>Status</th><th>Filed</th></tr></thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.reference}>
                        <td>{r.kind}</td><td className="ci-num">{r.reference}</td><td>{r.title}</td><td className="ci-num">{r.student}</td><td>{r.status}</td>
                        <td className="ci-num">{new Date(r.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ci-meta">No requests have been filed at the kiosk yet.</p>
            )}
            {onOpenKiosk ? <button type="button" className="btn btn-secondary" style={{ marginTop: 12, fontSize: 11, letterSpacing: ".1em" }} onClick={onOpenKiosk}>OPEN THE KIOSK →</button> : null}
          </div>
        )}
      </Section>
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
// Feature 6 · College adoption & migration
// ---------------------------------------------------------------------------

const SAMPLE_CSV = `Student ID,Name,Branch,Year,Hostel
BPUT/CSE/25/0101,ANANYA MISHRA,CSE,1,HOSTEL A
BPUT/ECE/25/0102,SOURAV PATTNAIK,ECE,1,HOSTEL C
BPUT/ME/24/0215,PRIYA SAHOO,ME,2,HOSTEL B
BPUT/CSE/22/0417,EXISTING RECORD,CSE,4,HOSTEL B
BPUT/CE/25/0107,,CE,7,HOSTEL Z`;

const PIPELINE = [
  ["EXPORT", "The college's existing records — spreadsheet, ERP or register export — saved as CSV."],
  ["MAP", "Columns mapped to Student ID | Name | Branch | Year | Hostel."],
  ["VALIDATE", "Every row checked against the live system: empty fields, bad years, unknown hostels, duplicates."],
  ["REVIEW", "An administrator reviews the dry-run report. Existing students are never overwritten."],
  ["IMPORT", "Approved rows are created; the rest are sent back for correction."],
  ["LIVE", "Students sign in, or use the assisted-access kiosk if they have no smartphone."]
];

const PHASES = [
  ["PHASE 1", "Pilot", "One hostel and the central mess for two weeks. Complaints, gate passes and mess feedback only.", "Pilot block wardens and mess manager"],
  ["PHASE 2", "Data migration", "Student master list, hostel room allocation and the class timetable imported through the validated CSV route.", "Academic office and hostel administration"],
  ["PHASE 3", "Staff onboarding", "Role accounts for wardens, maintenance, IT, mess and security; each learns their queue and the alert centre.", "Department heads"],
  ["PHASE 4", "Student onboarding", "App sign-in for students with phones; kiosk desks at hostel offices for those without. Notices go out in English, Odia and Hindi.", "Students and help-desk operators"],
  ["PHASE 5", "Campus-wide", "Every block and module live; attendance and ERP feeds connected where the college provides them.", "Whole campus"]
];

export function AdoptionSection({ live, isAdmin }) {
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setError("Excel files: use File → Save As → CSV in Excel first. This demo reads CSV only, so nothing is guessed from a binary file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result || ""));
      setError(null);
      setResult(null);
    };
    reader.readAsText(file);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.importPreview(csv));
    } catch (err) {
      setError(err.message || "Validation failed");
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    if (!result) return null;
    return result.errors
      ? `Import checked · ${result.ready} ready, ${result.skipped} already in the system, ${result.errors} need correction`
      : `Import validated successfully · ${result.ready} student${result.ready === 1 ? "" : "s"} ready to import${result.skipped ? `, ${result.skipped} already in the system` : ""}`;
  }, [result]);

  return (
    <Wrap>
      <div className="ci-adopt">
        <div>
          <div className="ci-label" style={{ marginBottom: 10 }}>Migration pipeline</div>
          <ol className="ci-pipeline">
            {PIPELINE.map(([k, text], i) => (
              <li key={k}>
                <span className="ci-num">{String(i + 1).padStart(2, "0")}</span>
                <b>{k}</b>
                <p className="ci-meta" style={{ lineHeight: 1.5 }}>{text}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="ci-grid-2" style={{ marginTop: 24 }}>
          <div>
            <div className="ci-label" style={{ marginBottom: 8 }}>CSV import demo · Student ID | Name | Branch | Year | Hostel</div>
            <textarea className="ci-input ci-textarea" rows={7} value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} aria-label="CSV to import" spellCheck={false} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <label className="btn btn-secondary" style={{ fontSize: 11, letterSpacing: ".1em", cursor: "pointer" }}>
                CHOOSE CSV FILE
                <input type="file" accept=".csv,.txt,.xls,.xlsx" onChange={onFile} style={{ display: "none" }} />
              </label>
              <button type="button" className="btn btn-primary" style={{ fontSize: 11, letterSpacing: ".1em" }} disabled={busy || !live || !isAdmin} onClick={run}>
                {busy ? "VALIDATING…" : "VALIDATE IMPORT"}
              </button>
              <button type="button" className="ci-link" onClick={() => { setCsv(SAMPLE_CSV); setResult(null); setError(null); }}>Reset sample</button>
            </div>
            {!live ? <p className="ci-meta" style={{ marginTop: 8 }}>Needs the backend: rows are checked against the live records.</p> : !isAdmin ? <p className="ci-meta" style={{ marginTop: 8 }}>Sign in as an administrator to run the import check.</p> : null}
            <p className="ci-meta" style={{ marginTop: 8, lineHeight: 1.55 }}>
              Demo mode: this is a dry run. No college database is connected, and no record is written — the check only reports what an import would do.
            </p>
          </div>
          <div>
            {error ? <StateBox kind="error" title="Import check failed">{error}</StateBox> : null}
            {result ? (
              <div className="ci-importres">
                <div role="status" className={`ci-result ${result.errors ? "ci-result-warn" : ""}`}>{summary}</div>
                <p className="ci-meta" style={{ margin: "8px 0", lineHeight: 1.5 }}>{result.note} Records written: {result.written}.</p>
                <div className="ci-table-wrap">
                  <table className="ci-table">
                    <thead><tr><th>Line</th><th>Student ID</th><th>Name</th><th>Branch</th><th>Year</th><th>Hostel</th><th>Result</th></tr></thead>
                    <tbody>
                      {result.results.map((r) => (
                        <tr key={r.line}>
                          <td className="ci-num">{r.line}</td><td className="ci-num">{r.studentId || "—"}</td><td>{r.name || "—"}</td><td>{r.branch || "—"}</td><td>{r.year || "—"}</td><td>{r.hostel}</td>
                          <td>
                            <Tag kind={r.status === "READY" ? "SAFE" : r.status === "ERROR" ? "AT RISK" : "WATCH"}>{r.status}</Tag>
                            {r.issues.length ? <div className="ci-meta" style={{ marginTop: 4 }}>{r.issues.join("; ")}</div> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : !error ? (
              <StateBox title="Run the check">The result shows each row as ready, already in the system, or needing correction — before anything is imported.</StateBox>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 28 }}>
          <div className="ci-label" style={{ marginBottom: 10 }}>Proposed rollout · five phases</div>
          <div className="ci-phases">
            {PHASES.map(([n, name, text, who]) => (
              <div key={n} className="ci-phase">
                <span className="ci-label" style={{ color: "var(--color-accent-700)" }}>{n}</span>
                <div className="ci-h3" style={{ marginTop: 4 }}>{name}</div>
                <p className="ci-meta" style={{ marginTop: 6, lineHeight: 1.5 }}>{text}</p>
                <p className="ci-meta" style={{ marginTop: 6 }}><b>Who:</b> {who}</p>
              </div>
            ))}
          </div>
          <p className="ci-meta" style={{ marginTop: 10, lineHeight: 1.55 }}>
            A proposed plan for a college adopting the system, not a record of past deployments.
          </p>
        </div>

        <div className="ci-grid-2" style={{ marginTop: 24 }}>
          {[
            ["STUDENTS", "Sign in with the college ID. Report a problem, apply for a gate pass, rate the mess and check attendance. No smartphone? The hostel help desk runs the same services on the kiosk."],
            ["STAFF", "Each department sees its own queue, sorted by SLA risk. Early-warning alerts arrive with the evidence, a possible cause and a suggested action; every action is audited."],
            ["ADMINISTRATORS", "Mission Control shows Campus Pulse, the alert centre and the predictions. Imports run as a dry run first, so existing records are never overwritten."]
          ].map(([who, text]) => (
            <div key={who} className="ci-phase">
              <span className="ci-label">ONBOARDING · {who}</span>
              <p className="ci-body" style={{ marginTop: 6, lineHeight: 1.55 }}>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </Wrap>
  );
}

