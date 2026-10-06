import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import {
  AnimatedNumber, Guard, AskBox, Columns, Confidence, Drawer, Evidence, LineChart, Section, StateBox, Tag,
  fmtNum, fmtPct, invalidate, signed, title, useApi, useDebounced
} from "./kit.jsx";
import "./intel.css";

/*
 * 04 — Mess Intelligence Center.
 * "What is happening with meals, what are the demand and feedback patterns,
 * and what happens under different scenarios?" — from GET /api/mess/intelligence
 * and POST /api/mess/simulate. Simulations never change a mess record.
 */

const MEALS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];
const THEME_LABEL = { TASTE: "Taste", QUANTITY: "Quantity", VARIETY: "Variety", TEMPERATURE: "Temperature", HYGIENE: "Hygiene", QUEUE: "Queue & crowding", AVAILABILITY: "Availability", OTHER: "Other" };

function scrollToPanel(panel) {
  const el = document.getElementById(`ci-mess-${panel}`);
  if (el) el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function MessIntel({ live, signedIn, focus, onFocusDone, onNavigate }) {
  const [meal, setMeal] = useState(null);
  const [date, setDate] = useState("");
  const [fbMeal, setFbMeal] = useState("");
  const [fbTheme, setFbTheme] = useState("");
  const [days, setDays] = useState(28);
  const [simSeed, setSimSeed] = useState(null);

  const params = { meal, date, days, feedbackMeal: fbMeal, feedbackTheme: fbTheme };
  const key = `mess:intel:${JSON.stringify(params)}`;
  const q = useApi(key, () => api.messIntelligence(params), { enabled: live });

  useEffect(() => {
    if (!focus || !q.data) return;
    if (focus.meal) setMeal(focus.meal);
    if (focus.panel === "feedback" && focus.meal) setFbMeal(focus.meal);
    if (focus.panel === "simulator") setSimSeed({ meal: focus.meal, attendanceChangePct: focus.attendanceChangePct });
    const t = setTimeout(() => { scrollToPanel(focus.panel || "today"); onFocusDone?.(); }, 60);
    return () => clearTimeout(t);
  }, [focus, q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusMeal = meal || q.data?.focus?.meal || "LUNCH";
  const tomorrow = isoDay(new Date(Date.now() + 864e5));

  return (
    <div className="ci">
      <header className="ci-head">
        <div>
          <div className="ci-kicker">04 — Mess intelligence center</div>
          <h1 className="ci-h1">Central Mess · demand, feedback, scenarios.</h1>
          <div className="ci-meta">{q.data?.dataRange ? `Mess log ${q.data.dataRange.from} → ${q.data.dataRange.to} · ${q.data.dataRange.mealDays} meal services` : "Mess records and student ratings"}</div>
        </div>
        <div className="ci-row" style={{ gap: 12 }}>
          <div className="ci-seg" role="group" aria-label="Meal">
            {MEALS.map((m) => <button key={m} type="button" aria-pressed={focusMeal === m} onClick={() => setMeal(m)}>{m}</button>)}
          </div>
          <label className="ci-row" style={{ gap: 6 }}>
            <span className="ci-label">Date</span>
            <input className="ci-input" type="date" value={date || q.data?.focus?.date || ""} min={q.data?.dataRange?.from} max={tomorrow} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
      </header>

      <Section q={q} live={live} lines={6} loadingSteps={["Reading the mess log", "Classifying demand", "Grouping feedback", "Building predictions"]}>
        {(d) => (
          <>
            <Guard name="Today's meals"><Today d={d} focusMeal={focusMeal} onMeal={(m) => { setMeal(m); }} /></Guard>
            <Guard name="Meal analysis"><Focus d={d} focusMeal={focusMeal} /></Guard>
            <Guard name="Feedback intelligence"><Feedback d={d} fbMeal={fbMeal} setFbMeal={setFbMeal} fbTheme={fbTheme} setFbTheme={setFbTheme} days={days} setDays={setDays} signedIn={signedIn} live={live} onSubmitted={() => { invalidate("mess:intel:"); q.reload(); }} /></Guard>
            <Guard name="Meal popularity"><Menu d={d} /></Guard>
            <Guard name="Demand patterns"><Patterns d={d} focusMeal={focusMeal} /></Guard>
            <Guard name="Demand simulator"><Simulator d={d} live={live} seed={simSeed} defaultMeal={focusMeal} tomorrow={tomorrow} /></Guard>
          </>
        )}
      </Section>

      <section className="ci-section" id="ci-mess-ask">
        <Guard name="Ask about the mess"><AskBox
          domain="MESS"
          heading="Ask about the mess"
          placeholder="e.g. What happens if 15% more students choose dinner?"
          live={live}
          signedIn={signedIn}
          onNavigate={(page, f) => {
            if (page === "mess") {
              if (f?.meal) setMeal(f.meal);
              if (f?.panel === "feedback" && f.meal) setFbMeal(f.meal);
              if (f?.panel === "simulator") setSimSeed({ meal: f.meal, attendanceChangePct: f.attendanceChangePct, at: Date.now() });
              scrollToPanel(f?.panel || "today");
            } else onNavigate?.(page, f);
          }}
          suggestions={["Which meal is most popular?", "Why is dinner demand increasing?", "What meals receive the most negative feedback?", "What happens if 15% more students choose dinner?", "What meals are most frequently unavailable?"]}
        /></Guard>
      </section>
    </div>
  );
}

// ---- today --------------------------------------------------------------------------

function Today({ d, focusMeal, onMeal }) {
  const ratings = Object.fromEntries(d.feedback.byMeal.map((r) => [r.meal, r]));
  return (
    <section className="ci-section" id="ci-mess-today">
      <div className="ci-section-head"><h3 className="ci-h3">Today's meals</h3><span className="ci-meta">Select a meal to analyse it</span></div>
      <div className="ci-meals">
        {d.today.map((t) => (
          <button key={t.meal} type="button" className="ci-meal" aria-pressed={focusMeal === t.meal} onClick={() => onMeal(t.meal)}>
            <div className="ci-row ci-between"><b style={{ fontSize: 15, letterSpacing: ".04em" }}>{t.meal}</b><span className="ci-meta">{t.window.join("–")}</span></div>
            <div className="ci-row" style={{ gap: 6 }}>
              {t.labels.length ? t.labels.map((l) => <Tag key={l.label} kind={l.label} title={l.reason}>{l.label}</Tag>) : <Tag kind="INSUFFICIENT DATA">NO CLASS</Tag>}
            </div>
            <div className="ci-row" style={{ gap: 16, alignItems: "flex-end" }}>
              <div>
                <div className="ci-label">{t.covers !== null ? "Covers · recorded" : "Covers · predicted"}</div>
                <div className="ci-big" style={{ fontSize: 34 }}>{fmtNum(t.covers ?? t.prediction?.predicted)}</div>
              </div>
              {t.peak ? <div className="ci-meta" style={{ paddingBottom: 4 }}>peak {t.peak.crowd} at {t.peak.time}<br />{t.peak.utilisation}% of seats · queue {t.queueMax} min</div> : null}
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
              {t.menu.length ? t.menu.map((m) => (
                <li key={m.item} style={{ fontSize: 12.5 }}>
                  <span className={m.available ? "" : "ci-soldout"}>{title(m.item)}</span>
                  {m.available ? <span className="ci-meta"> · {m.takenPercentage}% taken</span> : <span style={{ color: "var(--color-accent-700)", fontWeight: 700, fontSize: 11 }}> · SOLD OUT {m.soldOutAt}</span>}
                </li>
              )) : <li className="ci-meta">Menu not recorded</li>}
            </ul>
            {ratings[t.meal] ? <div className="ci-meta">Rated {ratings[t.meal].averageRating}★ · {ratings[t.meal].responses} ratings in {d.windowDays} days</div> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- focus meal: classification + prediction -------------------------------------------

function Focus({ d, focusMeal }) {
  const [open, setOpen] = useState(false);
  // While a newly selected meal loads, keep the last analysis on screen
  // (dimmed) instead of collapsing the section — a collapse moves everything
  // below it and reads as the page going blank.
  const f = d.focus;
  const shownMeal = f?.meal || focusMeal;
  const pending = shownMeal !== focusMeal;
  const today = d.today.find((t) => t.meal === shownMeal);
  const p = f?.prediction;
  const demand = f?.demand;
  const history = f?.history || [];

  return (
    <section className="ci-section" id="ci-mess-prediction" aria-busy={pending || undefined}>
      <div className="ci-section-head"><h3 className="ci-h3">{title(shownMeal)} · {f?.date}</h3><span className="ci-meta">{pending ? `Loading ${title(focusMeal).toLowerCase()}…` : "Classification and prediction for the selected meal and date"}</span></div>
      {!f ? <StateBox title="No meal selected">Choose a meal above.</StateBox> : (
        <div className="ci-split-rev" style={{ opacity: pending ? 0.55 : 1, transition: "opacity .2s" }}>
          <div className="ci-panel ci-panel-strong">
            <div className="ci-row ci-between"><Tag kind="AI CLASSIFICATION">Demand classification</Tag>{demand ? <Confidence value={demand.confidence} basis={demand.method} /> : null}</div>
            {demand ? (
              <>
                <div className="ci-big" style={{ fontSize: "clamp(28px, 3vw, 40px)", marginTop: 12, color: demand.label === "HIGH DEMAND" ? "var(--color-accent)" : demand.label === "LOW DEMAND" ? "var(--color-warn)" : "var(--color-text)" }}>{demand.label}</div>
                <div className="ci-label" style={{ marginTop: 12 }}>AI analysis</div>
                <ul className="ci-points" style={{ marginTop: 6 }}>{demand.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </>
            ) : <p className="ci-body" style={{ marginTop: 10 }}>{f.served ? "Not enough history to classify." : "This meal has not been served on this date yet — see the prediction."}</p>}
            {today?.trend && today.trend.label !== "INSUFFICIENT DATA" ? (
              <div style={{ marginTop: 14 }}><Tag kind={today.trend.label}>{today.trend.label}</Tag> <span className="ci-meta">{signed(today.trend.perWeekPct)}% a week over the last 14 days</span></div>
            ) : null}
            {today?.feedback?.labels?.length ? (
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>{today.feedback.labels.map((l) => <div key={l.label} className="ci-meta"><Tag kind={l.label}>{l.label}</Tag> {l.reason}</div>)}</div>
            ) : null}
            <button type="button" className="ci-link" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>View supporting data</button>
          </div>

          <div>
            {p && !p.insufficient ? (
              <div className="ci-ai-block">
                <div className="ci-row ci-between"><Tag kind="AI PREDICTION">{`Prediction · ${p.weekday?.toLowerCase()}`}</Tag><Confidence value={p.confidence} basis={p.confidenceBasis} /></div>
                <div className="ci-row" style={{ gap: 28, alignItems: "flex-end", marginTop: 10 }}>
                  <div><div className="ci-label">Expected diners</div><div className="ci-big" style={{ fontSize: "clamp(44px, 5vw, 64px)", color: "var(--ci-ai)" }}><AnimatedNumber value={p.predicted} decimals={0} /></div><div className="ci-meta">likely {fmtNum(p.low)}–{fmtNum(p.high)} (≈80% range)</div></div>
                  <div style={{ minWidth: 180, flex: 1 }}>
                    <div className="ci-label">Busiest slot · seat demand</div>
                    <div className="ci-bar" style={{ height: 14, marginTop: 8 }}><i style={{ width: `${Math.min(100, p.peakUtilisation)}%`, background: p.peakUtilisation >= 90 ? "var(--color-accent)" : "var(--ci-ai)" }} /><b style={{ left: "90%" }} /></div>
                    <div className="ci-meta" style={{ marginTop: 6 }}>{p.peakUtilisation}% of {p.capacity} seats · ~{p.peakCrowd} at once</div>
                  </div>
                </div>
                {f.served ? <div className="ci-meta" style={{ marginTop: 8 }}>Actually recorded: <b>{fmtNum(f.served.covers)}</b> covers ({signed(((f.served.covers - p.predicted) / p.predicted) * 100)}% vs prediction)</div> : null}
                <p className="ci-meta" style={{ marginTop: 8 }}>A prediction, not a guarantee · {p.method}</p>
              </div>
            ) : <StateBox title="No prediction">{p?.reason || "Not enough history for this meal."}</StateBox>}
            <div className="ci-panel" style={{ marginTop: 14 }}>
              <div className="ci-legend" style={{ marginBottom: 6 }}><span><i style={{ background: "var(--color-text)" }} />Recorded covers</span><span><i style={{ background: "var(--ci-ai)" }} />Same weekday as the selected date</span></div>
              <LineChart
                labels={history.map((h) => h.date.slice(5))}
                series={[
                  { label: "Covers", values: history.map((h) => h.covers), color: "var(--color-text)" },
                  { label: "Same weekday", values: history.map((h) => (p && !p.insufficient && h.weekday === new Date(`${p.date}T12:00:00`).getDay() ? h.covers : null)), color: "var(--ci-ai)", dots: true, dash: "1 0" }
                ]}
                format={(v) => fmtNum(Math.round(v))}
                height={190}
                ariaLabel={`${shownMeal} covers per day`}
              />
            </div>
          </div>
        </div>
      )}

      {d.tomorrow.length ? (
        <div className="ci-strip" style={{ marginTop: 18 }}>
          {d.tomorrow.map((t) => (
            <div key={t.meal}>
              <Tag kind="AI PREDICTION">{`Tomorrow · ${t.meal}`}</Tag>
              <div className="ci-big" style={{ fontSize: 30, marginTop: 8 }}>{fmtNum(t.predicted)}</div>
              <div className="ci-bar" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, t.peakUtilisation)}%`, background: "var(--ci-ai)" }} /></div>
              <div className="ci-meta" style={{ marginTop: 4 }}>peak seats {t.peakUtilisation}% · confidence {t.confidence}%</div>
            </div>
          ))}
        </div>
      ) : null}

      <Drawer open={open} onClose={() => setOpen(false)} heading={`${title(shownMeal)} · supporting data`}>
        {f ? (
          <Evidence
            dataConsidered={[`Mess log · ${d.dataRange?.mealDays} meal services`, p && !p.insufficient ? `${p.samples.length} earlier ${p.weekday?.toLowerCase()}s of ${shownMeal.toLowerCase()}` : "Same-weekday history", "Seat capacity 850"]}
            pattern={demand?.label}
            reasons={[...(demand?.reasons || []), ...(p?.levelShift ? [`Recent level shift applied: ${signed(p.levelShift, 0)} covers (half the gap between the last 7 days and the 3 weeks before).`] : [])]}
            rows={(p?.samples || []).map((s) => ({ label: s.date, value: `${fmtNum(s.covers)} covers` }))}
            confidence={p?.confidence ?? null}
            basis={p?.confidenceBasis}
            rule="HIGH DEMAND when covers are ≥10% above the same-weekday baseline or the busiest slot fills ≥90% of seats; LOW DEMAND when ≥10% below; otherwise NORMAL."
            method={`${demand?.method || ""} · ${p?.method || ""}`}
          />
        ) : null}
      </Drawer>
    </section>
  );
}

// ---- feedback -----------------------------------------------------------------------------

function Feedback({ d, fbMeal, setFbMeal, fbTheme, setFbTheme, days, setDays, signedIn, live, onSubmitted }) {
  const fb = d.feedback;
  const [ev, setEv] = useState(null);
  const total = fb.sentiment.POSITIVE + fb.sentiment.NEUTRAL + fb.sentiment.NEGATIVE;
  const pct = (n) => (total ? (n / total) * 100 : 0);
  return (
    <section className="ci-section" id="ci-mess-feedback">
      <div className="ci-section-head">
        <h3 className="ci-h3">Mess feedback intelligence</h3>
        <div className="ci-row" style={{ gap: 8 }}>
          <div className="ci-seg" role="group" aria-label="Feedback window">
            {[7, 14, 28].map((n) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{n}D</button>)}
          </div>
        </div>
      </div>
      <div className="ci-row" style={{ gap: 6, marginBottom: 14 }}>
        <span className="ci-label">Meal</span>
        {["", ...MEALS].map((m) => <button key={m || "ALL"} type="button" className="ci-chip" aria-pressed={fbMeal === m} onClick={() => setFbMeal(m)}>{m || "All meals"}</button>)}
        {fbTheme ? <button type="button" className="ci-chip" aria-pressed="true" onClick={() => setFbTheme("")}>{THEME_LABEL[fbTheme]} ×</button> : null}
      </div>

      <div className="ci-split">
        <div>
          <div className="ci-row" style={{ gap: 28, alignItems: "flex-end" }}>
            <div><div className="ci-label">Responses analysed</div><div className="ci-big" style={{ fontSize: 52 }}><AnimatedNumber value={fb.responses} decimals={0} /></div></div>
            <div><div className="ci-label">Average rating</div><div className="ci-big" style={{ fontSize: 52 }}>{fb.averageRating ?? "—"}<span style={{ fontSize: 22 }}>★</span></div></div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div className="ci-label">Sentiment</div>
              <div className="ci-stack" style={{ marginTop: 8 }} aria-label={`${fb.sentiment.POSITIVE} positive, ${fb.sentiment.NEUTRAL} neutral, ${fb.sentiment.NEGATIVE} negative`}>
                <i style={{ width: `${pct(fb.sentiment.POSITIVE)}%`, background: "var(--ci-ok)" }} />
                <i style={{ width: `${pct(fb.sentiment.NEUTRAL)}%`, background: "var(--color-neutral-400)" }} />
                <i style={{ width: `${pct(fb.sentiment.NEGATIVE)}%`, background: "var(--color-accent)" }} />
              </div>
              <div className="ci-meta" style={{ marginTop: 4 }}>{fb.sentiment.POSITIVE} positive · {fb.sentiment.NEUTRAL} neutral · {fb.sentiment.NEGATIVE} negative</div>
            </div>
          </div>

          <div className="ci-label" style={{ marginTop: 20, marginBottom: 8 }}>What comments are about · {fb.withComments} with text · select a theme to filter</div>
          {fb.distribution.length ? (
            <div style={{ display: "grid", gap: 4 }}>
              {fb.distribution.map((t) => (
                <button key={t.theme} type="button" className="ci-tile ci-rowbtn" aria-pressed={fbTheme === t.theme} onClick={() => setFbTheme(fbTheme === t.theme ? "" : t.theme)} style={{ display: "grid", gridTemplateColumns: "minmax(0, 130px) minmax(0, 1fr) 54px", gap: 10, alignItems: "center", padding: "6px 4px", background: fbTheme === t.theme ? "color-mix(in srgb, var(--color-accent) 8%, transparent)" : undefined }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{THEME_LABEL[t.theme]}</span>
                  <span className="ci-stack" title={`${t.negative} negative · ${t.positive} positive`}>
                    <i style={{ width: `${(t.negative / Math.max(1, fb.distribution[0].count)) * 100}%`, background: "var(--color-accent)" }} />
                    <i style={{ width: `${((t.count - t.negative - t.positive) / Math.max(1, fb.distribution[0].count)) * 100}%`, background: "var(--color-neutral-400)" }} />
                    <i style={{ width: `${(t.positive / Math.max(1, fb.distribution[0].count)) * 100}%`, background: "var(--ci-ok)" }} />
                  </span>
                  <b className="ci-num" style={{ fontSize: 13, textAlign: "right" }}>{fmtPct(t.share, 0)}</b>
                </button>
              ))}
              <div className="ci-legend" style={{ marginTop: 6 }}><span><i style={{ background: "var(--color-accent)", height: 8 }} />Negative</span><span><i style={{ background: "var(--color-neutral-400)", height: 8 }} />Neutral</span><span><i style={{ background: "var(--ci-ok)", height: 8 }} />Positive</span></div>
            </div>
          ) : <StateBox title="No comments in this selection" />}
          <p className="ci-meta" style={{ marginTop: 10 }}>Themes and sentiment are assigned by keyword rules and a word-list score blended with the star rating — {fb.method}.</p>
        </div>

        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          {fb.patterns.length ? fb.patterns.slice(0, 2).map((p) => (
            <div key={p.meal + p.theme} className="ci-ai-block">
              <div className="ci-row ci-between"><Tag kind="AI DETECTED PATTERN">AI detected pattern</Tag><Confidence value={p.confidence} basis="Grows with the number of mentions and the size of the rise." /></div>
              <p className="ci-answer-text" style={{ fontSize: 16 }}>“{p.headline}”</p>
              <button type="button" className="ci-link" onClick={() => setEv(p)}>View evidence</button>
            </div>
          )) : <StateBox title="No rising complaint theme">No theme rose sharply week over week.</StateBox>}

          {fb.complaints.count ? (
            <div className="ci-panel">
              <div className="ci-label" style={{ marginBottom: 6 }}>Formal mess complaints · {fb.complaints.count}</div>
              {fb.complaints.items.map((c) => (
                <div key={c.reference} style={{ fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--ci-soft)" }}>
                  <span className="ci-meta">{c.reference}</span> · {c.title} <span className="ci-meta">· {c.themes.map((t) => THEME_LABEL[t]).join(", ")} · {c.status}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div>
            <div className="ci-label" style={{ marginBottom: 6 }}>Latest comments</div>
            {fb.recent.slice(0, 5).map((r, i) => (
              <div key={`${r.date}-${r.meal}-${i}`} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--ci-soft)" }}>
                <span className="ci-meta">{r.date} · {r.meal} · {r.rating}★</span>
                <div>“{r.comment}”</div>
              </div>
            ))}
          </div>

          <RateMeal signedIn={signedIn} live={live} onSubmitted={onSubmitted} />
        </div>
      </div>

      <Drawer open={!!ev} onClose={() => setEv(null)} heading={ev ? `${THEME_LABEL[ev.theme]} at ${ev.meal.toLowerCase()}` : ""}>
        {ev ? (
          <Evidence
            dataConsidered={[`Student ratings for ${ev.meal.toLowerCase()} over the last 14 days`, "Comments filed under a theme by keyword rules"]}
            pattern="AI DETECTED PATTERN"
            reasons={[ev.headline, `${ev.last7} mentions in the last 7 days against ${ev.previous7} in the 7 before.`]}
            rows={ev.samples.map((s) => ({ label: `${s.date} · ${s.rating}★`, value: s.comment }))}
            confidence={ev.confidence}
            basis="Grows with the number of negative mentions and the size of the rise; it is not a model probability."
            method={ev.method}
          />
        ) : null}
      </Drawer>
    </section>
  );
}

function RateMeal({ signedIn, live, onSubmitted }) {
  const [meal, setMeal] = useState("LUNCH");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  if (!live) return null;
  if (!signedIn) return <p className="ci-meta">Sign in to rate a meal.</p>;
  const submit = async (e) => {
    e.preventDefault();
    if (!rating) { setMsg({ err: true, text: "Choose a rating from 1 to 5." }); return; }
    setBusy(true);
    try {
      const r = await api.messFeedback({ meal, rating, comment: comment.trim() || undefined });
      setMsg({ err: false, text: `Recorded · filed under ${r.feedback.themes.map((t) => THEME_LABEL[t]).join(", ") || "no theme"} · ${r.feedback.sentiment.toLowerCase()}` });
      setRating(0);
      setComment("");
      onSubmitted?.();
    } catch (err) {
      setMsg({ err: true, text: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="ci-panel" onSubmit={submit} style={{ display: "grid", gap: 10 }}>
      <div className="ci-label">Rate today's meal</div>
      <div className="ci-row" style={{ gap: 6 }}>
        <select className="ci-select" aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value)}>{MEALS.map((m) => <option key={m}>{m}</option>)}</select>
        <div role="radiogroup" aria-label="Rating" className="ci-row" style={{ gap: 4 }}>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} className="ci-chip" aria-pressed={rating === n} onClick={() => setRating(n)}>{n}★</button>)}
        </div>
      </div>
      <input className="ci-input" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What stood out? (optional)" aria-label="Comment" />
      <button type="submit" className="btn btn-primary" disabled={busy} style={{ justifySelf: "start", fontSize: 11, letterSpacing: ".1em", padding: "9px 14px" }}>{busy ? "SENDING…" : "SUBMIT RATING"}</button>
      {msg ? <div className="ci-meta" role="status" style={{ color: msg.err ? "var(--color-accent-700)" : "var(--ci-ok)", fontWeight: 700 }}>{msg.text}</div> : null}
    </form>
  );
}

// ---- menu popularity + availability ------------------------------------------------------

function Menu({ d }) {
  const [sort, setSort] = useState("uptake");
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => d.menu.slice().sort((a, b) => (sort === "soldout" ? b.soldOutCount - a.soldOutCount || (b.averageTaken ?? 0) - (a.averageTaken ?? 0) : (b.averageTaken ?? 0) - (a.averageTaken ?? 0))), [d.menu, sort]);
  const rows = all ? sorted : sorted.slice(0, 10);
  return (
    <section className="ci-section" id="ci-mess-menu">
      <div className="ci-section-head">
        <h3 className="ci-h3">Meal popularity &amp; availability</h3>
        <div className="ci-seg" role="group" aria-label="Sort by">
          <button type="button" aria-pressed={sort === "uptake"} onClick={() => setSort("uptake")}>MOST TAKEN</button>
          <button type="button" aria-pressed={sort === "soldout"} onClick={() => setSort("soldout")}>MOST SOLD OUT</button>
        </div>
      </div>
      {rows.length ? (
        <div className="ci-table-wrap">
          <table className="ci-table">
            <thead><tr><th>Dish</th><th>Meal</th><th style={{ width: "34%" }}>Share of prepared servings taken</th><th>Served</th><th>Sold out</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item}>
                  <td><b>{title(r.item)}</b></td>
                  <td className="ci-meta">{r.meals.join(", ")}</td>
                  <td><div style={{ display: "grid", gridTemplateColumns: "minmax(60px, 1fr) 48px", gap: 10, alignItems: "center" }}><div className="ci-bar"><i style={{ width: `${r.averageTaken ?? 0}%`, background: (r.averageTaken ?? 0) >= 95 ? "var(--color-accent)" : "var(--color-neutral-600)" }} /></div><b>{fmtPct(r.averageTaken, 0)}</b></div></td>
                  <td className="ci-meta">{r.timesServed}×</td>
                  <td>{r.soldOutCount ? <span style={{ color: "var(--color-accent-700)", fontWeight: 700 }}>{r.soldOutCount}× · {fmtPct(r.soldOutRate, 0)}<span className="ci-meta"> · last {r.soldOut[r.soldOut.length - 1]?.at}</span></span> : <span className="ci-meta">never</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length > 10 ? <button type="button" className="ci-link ci-link-ink" style={{ marginTop: 12 }} onClick={() => setAll(!all)}>{all ? "Show top 10" : `Show all ${sorted.length} dishes`}</button> : null}
        </div>
      ) : <StateBox title="No dishes recorded in this window" />}
    </section>
  );
}

// ---- patterns ----------------------------------------------------------------------------

function Patterns({ d, focusMeal }) {
  const all = d.patterns.byWeekday.flatMap((r) => r.days.map((x) => x.average || 0));
  const max = Math.max(1, ...all);
  const slots = d.patterns.bySlot.filter((s) => s.meal === focusMeal);
  const quiet = slots.slice().sort((a, b) => a.averageQueue - b.averageQueue || a.averageCrowd - b.averageCrowd)[0];
  return (
    <section className="ci-section" id="ci-mess-patterns">
      <div className="ci-section-head"><h3 className="ci-h3">Demand patterns</h3><span className="ci-meta">Averages over the last {d.windowDays} days</span></div>
      <div className="ci-grid-2">
        <div className="ci-panel ci-table-wrap">
          <div className="ci-label" style={{ marginBottom: 10 }}>Day-wise · average covers</div>
          <table className="ci-table" style={{ minWidth: 420 }}>
            <thead><tr><th>Meal</th>{d.patterns.byWeekday[0]?.days.map((x) => <th key={x.weekday}>{x.weekday}</th>)}</tr></thead>
            <tbody>
              {d.patterns.byWeekday.map((r) => (
                <tr key={r.meal}>
                  <td><b style={{ fontSize: 12 }}>{r.meal}</b></td>
                  {r.days.map((x) => {
                    const k = (x.average || 0) / max;
                    return <td key={x.weekday} style={{ background: `color-mix(in srgb, var(--color-accent) ${Math.round(k * 55)}%, transparent)`, color: k > 0.7 ? "var(--color-bg)" : "inherit", textAlign: "center", fontSize: 11, padding: "8px 4px" }} title={`${x.samples} days`}>{x.average === null ? "—" : fmtNum(x.average)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ci-panel">
          <div className="ci-label" style={{ marginBottom: 10 }}>Time pattern · {title(focusMeal)} · average diners by slot</div>
          {slots.length ? (
            <>
              <Columns data={slots.map((s) => ({ label: s.time, value: s.averageCrowd, highlight: quiet && s.time === quiet.time }))} height={150} />
              {quiet ? <div className="ci-rec" style={{ marginTop: 12 }}>Shortest queue: <b>{quiet.time}</b> ({quiet.averageQueue} min on average) — highlighted.</div> : null}
            </>
          ) : <StateBox title="No slots recorded for this meal" />}
        </div>
      </div>
    </section>
  );
}

// ---- simulator ------------------------------------------------------------------------------

function Simulator({ d, live, seed, defaultMeal, tomorrow }) {
  const [meal, setMeal] = useState(defaultMeal);
  const [date, setDate] = useState(tomorrow);
  const [pctChange, setPctChange] = useState(0);
  const [expected, setExpected] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [item, setItem] = useState("");
  const [shift, setShift] = useState(20);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!seed) return;
    if (seed.meal) setMeal(seed.meal);
    if (seed.attendanceChangePct !== undefined) { setPctChange(seed.attendanceChangePct); setExpected(null); }
  }, [seed]);

  const input = useDebounced({ meal, date, pctChange, expected, prepared, item, shift }, 240);
  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    setBusy(true);
    const body = { meal: input.meal, date: input.date };
    if (input.expected !== null) body.expectedDiners = input.expected;
    else body.attendanceChangePct = input.pctChange;
    if (input.prepared) body.preparedCovers = input.prepared;
    if (input.item) { body.item = input.item; body.selectionShiftPct = input.shift; }
    api.messSimulate(body)
      .then((r) => { if (alive) { setRes(r); setErr(null); } })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [JSON.stringify(input), live]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset item-level inputs when the meal changes; menus differ per meal.
  useEffect(() => { setItem(""); setExpected(null); setPrepared(null); }, [meal]);

  const s = res?.simulation;
  const p = res?.prediction;
  const baseline = p && !p.insufficient ? p.predicted : null;
  const shown = expected ?? (s ? s.expected : null);

  return (
    <section className="ci-section" id="ci-mess-simulator">
      <div className="ci-section-head"><h3 className="ci-h3">Mess demand simulator</h3><span className="ci-meta">What if… · calculated by the server · no mess record changes</span></div>
      <div className="ci-split-rev">
        <div className="ci-panel" style={{ display: "grid", gap: 14 }}>
          <div className="ci-row" style={{ gap: 10 }}>
            <label style={{ flex: 1 }}><span className="ci-label" style={{ display: "block", marginBottom: 6 }}>Meal</span>
              <select className="ci-select" style={{ width: "100%" }} value={meal} onChange={(e) => setMeal(e.target.value)}>{MEALS.map((m) => <option key={m}>{m}</option>)}</select></label>
            <label style={{ flex: 1 }}><span className="ci-label" style={{ display: "block", marginBottom: 6 }}>Date</span>
              <input className="ci-input" style={{ width: "100%" }} type="date" value={date} min={d.dataRange?.from} onChange={(e) => setDate(e.target.value || tomorrow)} /></label>
          </div>
          <div>
            <div className="ci-label" style={{ marginBottom: 6 }}>Students expected {baseline !== null ? <span className="ci-meta">(predicted {fmtNum(baseline)})</span> : null}</div>
            <div className="ci-stepper" style={{ gridTemplateColumns: "64px minmax(0, 1fr) 64px" }}>
              <button type="button" onClick={() => setExpected(Math.max(0, (shown ?? baseline ?? 0) - 100))} aria-label="100 fewer">−100</button>
              <input type="number" inputMode="numeric" aria-label="Students expected" value={shown ?? ""} onChange={(e) => setExpected(e.target.value === "" ? null : Math.max(0, Math.min(20000, Math.round(Number(e.target.value)))))} />
              <button type="button" onClick={() => setExpected(Math.min(20000, (shown ?? baseline ?? 0) + 100))} aria-label="100 more">+100</button>
            </div>
            <div className="ci-row" style={{ gap: 6, marginTop: 8 }}>
              <span className="ci-label">Or change by</span>
              {[-20, -10, 0, 10, 15, 20].map((v) => <button key={v} type="button" className="ci-chip" aria-pressed={expected === null && pctChange === v} onClick={() => { setExpected(null); setPctChange(v); }}>{v > 0 ? `+${v}` : v}%</button>)}
            </div>
          </div>
          <label>
            <span className="ci-label" style={{ display: "block", marginBottom: 6 }}>Kitchen prepares (covers) · optional</span>
            <input className="ci-input" type="number" inputMode="numeric" style={{ width: "100%" }} placeholder={s ? `default ${fmtNum(s.prepared)} (prediction + 5%)` : "prediction + 5%"} value={prepared ?? ""} onChange={(e) => setPrepared(e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))))} />
          </label>
          <div>
            <div className="ci-label" style={{ marginBottom: 6 }}>What if more students select one dish?</div>
            <select className="ci-select" style={{ width: "100%" }} value={item} onChange={(e) => setItem(e.target.value)} aria-label="Dish">
              <option value="">— no dish scenario —</option>
              {(res?.menu || []).map((m) => <option key={m.item} value={m.item}>{title(m.item)} · {fmtNum(m.servings)} prepared</option>)}
            </select>
            {item ? (
              <label style={{ display: "block", marginTop: 8 }}>
                <span className="ci-meta">Selection change: <b>{shift > 0 ? "+" : ""}{shift}%</b></span>
                <input className="ci-range" type="range" min={-50} max={100} step={5} value={shift} onChange={(e) => setShift(Number(e.target.value))} />
              </label>
            ) : null}
          </div>
        </div>

        <div aria-live="polite">
          {err ? <StateBox kind="error" title="Simulation failed">{err}</StateBox> : null}
          {s?.insufficient ? <StateBox title="Cannot simulate this meal">{s.reason}</StateBox> : null}
          {s && !s.insufficient ? (
            <>
              <div className="ci-vs">
                <div>
                  <Tag kind="AI PREDICTION">Predicted</Tag>
                  <div className="ci-big" style={{ fontSize: "clamp(38px, 4.4vw, 56px)", marginTop: 10, color: "var(--ci-ai)" }}>{fmtNum(s.baseline)}</div>
                  <div className="ci-meta">{p.weekday?.toLowerCase()} {title(s.meal).toLowerCase()} · confidence {p.confidence}%</div>
                </div>
                <div className="ci-vs-arrow" aria-hidden="true">→</div>
                <div className="ci-sim-block" style={{ opacity: busy ? 0.65 : 1 }}>
                  <Tag kind="SIMULATED RESULT">Simulated demand</Tag>
                  <div className="ci-big" style={{ fontSize: "clamp(38px, 4.4vw, 56px)", marginTop: 10 }}><AnimatedNumber value={s.expected} decimals={0} /></div>
                  <div className="ci-meta">{signed(s.delta, 0)} covers ({signed(s.deltaPct)}%)</div>
                </div>
              </div>
              <div className="ci-strip" style={{ marginTop: 16 }}>
                <div><div className="ci-label">Prepared</div><div className="ci-big" style={{ fontSize: 30, marginTop: 6 }}>{fmtNum(s.prepared)}</div></div>
                <div><div className="ci-label">Estimated surplus</div><div className="ci-big" style={{ fontSize: 30, marginTop: 6 }}>{fmtNum(s.surplus)}</div><div className="ci-meta">≈ {s.surplusKg} kg of food</div></div>
                <div><div className="ci-label">Estimated shortage</div><div className="ci-big" style={{ fontSize: 30, marginTop: 6, color: s.shortage ? "var(--color-accent)" : "var(--color-text)" }}>{fmtNum(s.shortage)}</div><div className="ci-meta">{s.shortage ? "students without a full meal" : "none"}</div></div>
              </div>
              <div className="ci-panel" style={{ marginTop: 14 }}>
                <div className="ci-row ci-between"><div className="ci-label">Capacity impact · busiest slot</div><Tag kind={s.capacityStatus === "WITHIN CAPACITY" ? "SAFE" : s.capacityStatus === "NEAR CAPACITY" ? "WATCH" : "CRITICAL"}>{s.capacityStatus}</Tag></div>
                <div className="ci-bar" style={{ height: 14, marginTop: 10 }}><i style={{ width: `${Math.min(100, s.peakUtilisation)}%`, background: s.peakUtilisation >= 90 ? "var(--color-accent)" : "var(--color-text)" }} /><b style={{ left: "90%" }} /></div>
                <div className="ci-meta" style={{ marginTop: 6 }}>~{fmtNum(s.peakCrowd)} diners at once · {s.peakUtilisation}% of {s.capacity} seats</div>
              </div>
              {s.item ? (
                <div className="ci-sim-block" style={{ marginTop: 14 }}>
                  <Tag kind="SIMULATED RESULT">{`What if ${s.item.selectionShiftPct > 0 ? "+" : ""}${s.item.selectionShiftPct}% select ${title(s.item.item)}?`}</Tag>
                  <div className="ci-row" style={{ gap: 24, marginTop: 10 }}>
                    <div><div className="ci-label">Current demand</div><div className="ci-big" style={{ fontSize: 26 }}>{fmtNum(s.item.currentDemand)}</div></div>
                    <div><div className="ci-label">Projected demand</div><div className="ci-big" style={{ fontSize: 26 }}>{fmtNum(s.item.projectedDemand)}</div></div>
                    <div><div className="ci-label">Prepared</div><div className="ci-big" style={{ fontSize: 26 }}>{fmtNum(s.item.servingsPrepared)}</div></div>
                  </div>
                  <div className="ci-meta" style={{ marginTop: 8, fontWeight: 700, color: s.item.shortfall ? "var(--color-accent-700)" : "var(--ci-ok)" }}>
                    {s.item.shortfall ? `Short by ${fmtNum(s.item.shortfall)} servings — likely runs out around ${s.item.runsOutAt}.` : "Enough prepared for this scenario."}
                  </div>
                </div>
              ) : null}
              <details style={{ marginTop: 12 }}>
                <summary className="ci-link ci-link-ink" style={{ display: "inline-block", cursor: "pointer" }}>Assumptions</summary>
                <ul className="ci-points" style={{ marginTop: 8 }}>{[...s.assumptions, ...(s.item ? [s.item.assumption] : [])].map((a) => <li key={a}>{a}</li>)}</ul>
              </details>
              <div className="ci-meta" style={{ marginTop: 8 }}>{s.note}</div>
            </>
          ) : null}
          {!s && !err ? <StateBox title="Calculating…" /> : null}
        </div>
      </div>
    </section>
  );
}
