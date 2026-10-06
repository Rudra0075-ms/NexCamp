import React, { useState } from "react";
import { api } from "../../lib/api.js";
import {
  AnimatedNumber, AskBox, Guard, Confidence, Drawer, Evidence, Provenance, Section, Sparkline, Tag,
  fmtPct, signed, title, useApi
} from "./kit.jsx";
import "./intel.css";

/*
 * 02 — Student Dashboard: "How am I doing, what needs attention, what next?"
 * Everything here comes from GET /api/students/me/intelligence, which is built
 * from the same analyses as the Attendance and Mess pages, so a number on the
 * dashboard always matches the page it links to.
 */

function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const RISK_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function RiskMeter({ level }) {
  const at = RISK_ORDER.indexOf(level);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3, marginTop: 10 }} aria-hidden="true">
        {RISK_ORDER.map((l, i) => (
          <i key={l} style={{ height: 6, display: "block", background: i <= at ? (at >= 2 ? "var(--color-accent)" : at === 1 ? "var(--color-warn)" : "var(--ci-ok)") : "var(--color-neutral-200)" }} />
        ))}
      </div>
      <div className="ci-row ci-between ci-meta" style={{ marginTop: 4, fontSize: 9.5, letterSpacing: ".1em" }}>
        <span>LOW</span><span>MEDIUM</span><span>HIGH</span><span>CRITICAL</span>
      </div>
    </div>
  );
}

export default function StudentIntel({ live, signedIn, userName, onNavigate, onReport }) {
  const [windowDays, setWindowDays] = useState(14);
  const [evidence, setEvidence] = useState(false);
  const q = useApi(`student:intel:${windowDays}`, () => api.studentIntelligence(windowDays), { enabled: live && signedIn });
  const first = String(q.data?.student?.name || userName || "").split(" ")[0];
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });

  return (
    <div className="ci" style={{ paddingBottom: 0 }}>
      <header className="ci-head">
        <div>
          <div className="ci-kicker">02 — Academic &amp; NeX Camp intelligence</div>
          <h1 className="ci-h1">{greeting()}{first ? `, ${title(first)}` : ""}.</h1>
          <div className="ci-meta">{today} · your campus at a glance</div>
        </div>
        <div className="ci-row" style={{ gap: 12 }}>
          <div className="ci-seg" role="group" aria-label="Compare against the last">
            {[7, 14, 30].map((d) => (
              <button key={d} type="button" aria-pressed={windowDays === d} onClick={() => setWindowDays(d)}>{d} DAYS</button>
            ))}
          </div>
          {onReport ? <button type="button" className="btn btn-primary" style={{ padding: "11px 16px", letterSpacing: ".08em" }} onClick={onReport}>REPORT A PROBLEM →</button> : null}
        </div>
      </header>

      <Section q={q} live={live} needsAuth signedIn={signedIn} lines={5} loadingSteps={["Reading your attendance", "Reading today's mess data", "Finding what changed", "Preparing your summary"]}>
        {(d) => <Guard name="Summary"><Summary d={d} onNavigate={onNavigate} onEvidence={() => setEvidence(true)} /></Guard>}
      </Section>

      <section className="ci-section" aria-label="Ask your campus data">
        <Guard name="Ask your campus data"><AskBox
          live={live}
          signedIn={signedIn}
          onNavigate={onNavigate}
          suggestions={q.data?.suggestions || ["Why did my attendance fall this month?", "What happens if I miss 3 classes?", "What is causing my attendance risk?", "Which meal is most popular?"]}
        /></Guard>
      </section>

      {q.data ? <Guard name="Changes and recommendations"><Details d={q.data} onNavigate={onNavigate} /></Guard> : null}

      <Drawer open={evidence && !!q.data?.insight} onClose={() => setEvidence(false)} heading="Why the dashboard says this">
        {q.data?.insight ? (
          <Evidence
            dataConsidered={q.data.insight.evidence.dataConsidered}
            pattern={q.data.insight.evidence.pattern}
            reasons={q.data.insight.evidence.reasons}
            rule={q.data.insight.evidence.rule}
            confidence={q.data.insight.confidence}
            basis={q.data.insight.evidence.confidenceBasis}
            extra={<Provenance provenance={q.data.insight.provenance} />}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function Summary({ d, onNavigate, onEvidence }) {
  const a = d.attendance;
  const m = d.mess;
  const next = d.upcoming?.classes?.[0];
  return (
    <>
      <div className="ci-strip">
        {a.empty ? (
          <div><div className="ci-label">Attendance</div><p className="ci-body" style={{ marginTop: 8 }}>{a.message}</p></div>
        ) : (
          <button type="button" className="ci-tile" onClick={() => onNavigate("attendance", { panel: "overview" })}>
            <div className="ci-label">Attendance · overall</div>
            <div className="ci-row" style={{ alignItems: "flex-end", gap: 14, marginTop: 8 }}>
              <span className="ci-big" style={{ fontSize: "clamp(44px, 5vw, 64px)" }}><AnimatedNumber value={a.overall} suffix="%" /></span>
              <Sparkline values={a.trend.map((t) => t.value)} color={a.eligible ? "var(--color-text)" : "var(--color-accent)"} />
            </div>
            <div className="ci-meta" style={{ marginTop: 6 }}>
              <span style={{ color: a.change < 0 ? "var(--color-accent-700)" : "var(--ci-ok)", fontWeight: 700 }}>{a.change === null ? "" : `${signed(a.change)} pts`}</span>
              {a.change === null ? "" : ` in ${d.windowDays} days · `}{a.attendedClasses} of {a.totalClasses} attended
            </div>
            <div className="ci-row" style={{ marginTop: 8, gap: 6 }}><Tag kind={a.status}>{a.status}</Tag><Tag kind={a.pattern}>{a.pattern}</Tag></div>
            <span className="ci-go">OPEN ATTENDANCE →</span>
          </button>
        )}

        {m ? (
          <button type="button" className="ci-tile" onClick={() => onNavigate("mess", { panel: "today", meal: m.meal })}>
            <div className="ci-label">Mess status · {title(m.meal)} {m.window?.join("–")}</div>
            <div className="ci-big" style={{ fontSize: "clamp(26px, 2.8vw, 36px)", marginTop: 12 }}>{m.status === "NORMAL DEMAND" ? "Normal" : title(m.status)}</div>
            <div className="ci-meta" style={{ marginTop: 8 }}>
              {m.peak ? `Peak ${m.peak.crowd} at ${m.peak.time} · ${m.peak.utilisation}% of seats` : m.prediction ? `Predicted ${m.prediction.predicted} covers` : "No mess data today"}
            </div>
            <div className="ci-row" style={{ marginTop: 8, gap: 6 }}>
              {(m.labels || []).slice(0, 2).map((l) => <Tag key={l.label} kind={l.label} title={l.reason}>{l.label}</Tag>)}
              {m.feedbackAlert && !(m.labels || []).some((l) => l.label === "FEEDBACK ALERT") ? <Tag kind="FEEDBACK ALERT">FEEDBACK ALERT</Tag> : null}
            </div>
            <span className="ci-go">OPEN MESS →</span>
          </button>
        ) : (
          <div><div className="ci-label">Mess status</div><p className="ci-body" style={{ marginTop: 8 }}>No mess data recorded.</p></div>
        )}

        {d.risk ? (
          <button type="button" className="ci-tile" onClick={() => onNavigate("attendance", { panel: "subjects" })}>
            <div className="ci-label">Current risk · academic</div>
            <div className="ci-big" style={{ fontSize: "clamp(38px, 4.4vw, 56px)", marginTop: 8, color: d.risk.level === "LOW" ? "var(--ci-ok)" : d.risk.level === "MEDIUM" ? "var(--color-warn)" : "var(--color-accent)" }}>{d.risk.level}</div>
            <RiskMeter level={d.risk.level} />
            <div className="ci-meta" style={{ marginTop: 8 }}>{d.risk.drivers.slice(1, 3).join(" · ") || d.risk.status}</div>
            <span className="ci-go">SEE WHAT DRIVES IT →</span>
          </button>
        ) : null}

        {next ? (
          <button type="button" className="ci-tile" onClick={() => onNavigate("attendance", { panel: "subjects", subject: next.subject })}>
            <div className="ci-label">Next class · inferred</div>
            <div className="ci-big" style={{ fontSize: "clamp(22px, 2.4vw, 30px)", marginTop: 12 }}>{title(next.subject)}</div>
            <div className="ci-meta" style={{ marginTop: 8 }}>{next.day} {next.date?.slice(5)} · {next.slot}</div>
            <div className="ci-meta" style={{ marginTop: 6, fontSize: 10 }} title={d.upcoming.classesBasis}>From your register's repeating slots — check the official timetable</div>
          </button>
        ) : null}
      </div>

      {d.insight ? (
        <section className="ci-section">
          <div className="ci-ai-block" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 18, alignItems: "center" }}>
            <div>
              <Tag kind="AI INSIGHT">AI insight</Tag>
              <p className="ci-answer-text" style={{ fontSize: "clamp(16px, 1.5vw, 19px)", maxWidth: "70ch" }}>“{d.insight.text}”</p>
              <div className="ci-row" style={{ gap: 16 }}>
                <button type="button" className="ci-link" onClick={onEvidence}>View evidence</button>
                <button type="button" className="ci-link ci-link-ink" onClick={() => onNavigate("attendance", { panel: "simulator" })}>Simulate attendance</button>
                <Confidence value={d.insight.confidence} basis={d.insight.evidence.confidenceBasis} />
              </div>
              <Provenance provenance={d.insight.provenance} />
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

function Details({ d, onNavigate }) {
  return (
    <section className="ci-section ci-split" aria-label="Changes and recommendations">
      <div>
        <div className="ci-section-head"><h3 className="ci-h3">What changed</h3><span className="ci-meta">Last {d.windowDays} days</span></div>
        {d.changes.length ? (
          <div className="ci-rule">
            {d.changes.map((c) => (
              <button type="button" key={c.title} className="ci-tile ci-rowbtn" onClick={() => onNavigate(c.action.page, c.action.focus)} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto", gap: 10, width: "100%", padding: "12px 4px", borderBottom: "1px solid var(--ci-soft)", alignItems: "center" }}>
                <span className={c.direction === "DOWN" ? "ci-arrow-down" : c.direction === "UP" ? "ci-arrow-up" : "ci-arrow-flat"} style={{ fontSize: 18 }} aria-label={c.direction}>{c.direction === "DOWN" ? "↓" : c.direction === "UP" ? "↑" : "→"}</span>
                <span>
                  <b style={{ fontSize: 14 }}>{c.title}</b>
                  <span className="ci-meta" style={{ display: "block", marginTop: 2 }}>{c.detail}</span>
                </span>
                <Tag kind="ACTUAL DATA">{c.domain}</Tag>
              </button>
            ))}
          </div>
        ) : <p className="ci-body">Nothing moved noticeably in this window.</p>}

        {d.signals.length ? (
          <div style={{ marginTop: 22, display: "grid", gap: 10 }}>
            <h3 className="ci-h3">Signals the system detected</h3>
            {d.signals.map((s) => (
              <div key={s.title} className="ci-panel" style={{ borderLeft: `3px solid ${s.tone === "high" ? "var(--color-accent)" : "var(--ci-ai)"}` }}>
                <Tag kind={s.kind}>{s.kind}</Tag>
                <div style={{ fontWeight: 700, fontSize: 15, margin: "8px 0 4px" }}>{s.title}</div>
                <div className="ci-body" style={{ fontSize: 13 }}>{s.body}</div>
                <button type="button" className="ci-link" style={{ marginTop: 10 }} onClick={() => onNavigate(s.action.page, s.action.focus)}>{s.action.label}</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <div className="ci-section-head"><h3 className="ci-h3">What to do next</h3><Tag kind="AI RECOMMENDATION">AI recommendation</Tag></div>
        {d.recommendations.length ? (
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
            {d.recommendations.map((r, i) => (
              <li key={r.text} className="ci-panel" style={{ display: "grid", gridTemplateColumns: "26px minmax(0, 1fr)", gap: 10 }}>
                <span className="ci-big" style={{ fontSize: 22, color: "var(--ci-ai)" }}>{i + 1}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{r.text}</div>
                  <button type="button" className="ci-link" style={{ marginTop: 8 }} onClick={() => onNavigate(r.action.page, r.action.focus)}>{r.action.label} →</button>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="ci-body">No action needed right now.</p>}

        <div style={{ marginTop: 22 }}>
          <div className="ci-section-head"><h3 className="ci-h3">Coming up</h3><span className="ci-meta">Inferred, not the official timetable</span></div>
          <div className="ci-rule">
            {(d.upcoming.classes || []).map((u) => (
              <div key={u.at + u.subject} style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--ci-soft)", fontSize: 13 }}>
                <span className="ci-meta">{u.day} {u.date?.slice(5)} · {u.slot}</span>
                <b>{title(u.subject)}</b>
              </div>
            ))}
            {d.upcoming.meal ? (
              <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10, padding: "9px 0", fontSize: 13 }}>
                <span className="ci-meta">{title(d.upcoming.meal.meal)} · {d.upcoming.meal.window?.[0]}</span>
                <span>{d.upcoming.meal.menu.map(title).join(", ") || "Menu not recorded"}</span>
              </div>
            ) : null}
          </div>
          {d.attendance?.semester ? (
            <div className="ci-panel" style={{ marginTop: 14 }}>
              <Tag kind="PROJECTED STATUS">Projected · end of semester</Tag>
              <div className="ci-row" style={{ gap: 24, marginTop: 10 }}>
                <div><div className="ci-label">At your recent rate</div><div className="ci-big" style={{ fontSize: 30, color: d.attendance.semester.projectedAtRecentRate < d.attendance.threshold ? "var(--color-accent)" : "var(--color-text)" }}>{fmtPct(d.attendance.semester.projectedAtRecentRate)}</div></div>
                <div><div className="ci-label">If you attend every class</div><div className="ci-big" style={{ fontSize: 30 }}>{fmtPct(d.attendance.semester.projectedIfAttendAll)}</div></div>
              </div>
              <div className="ci-meta" style={{ marginTop: 8 }}>{d.attendance.semester.remaining} classes left this semester · arithmetic projection, not a guarantee</div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
