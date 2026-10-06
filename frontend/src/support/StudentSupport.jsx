import React, { useCallback, useEffect, useState } from "react";
import { Skeleton, Tag } from "../components/intel/kit.jsx";
import { support } from "./api.js";
import "../components/intel/intel.css";
import "../ext/ext.css";
import "./support.css";

/*
 * 02 Student Dashboard — Silent Support System.
 *
 * A compact, optional, private card: a four-question check-in with an emoji
 * scale, a supportive (never diagnostic) response, "I don't know how to ask
 * for help", private / anonymous requests, "check on me later", the request's
 * progress, and the institution's configured emergency contacts.
 *
 * Nothing here is cached in the browser: the skip choice for this tab is the
 * only thing kept, in sessionStorage, and it holds no answers.
 */

const QUESTIONS = [
  { key: "feeling", text: "How have you been feeling recently?", low: "Very low", high: "Very good" },
  { key: "study", text: "How has studying felt recently?", low: "Very difficult", high: "Easy" },
  { key: "connection", text: "How connected do you feel with people around you?", low: "Very alone", high: "Very connected" },
  { key: "helpComfort", text: "How comfortable do you feel asking for help?", low: "Very hard", high: "Easy" }
];
const FACES = ["😞", "🙁", "😐", "🙂", "😄"];

const OPTION_TEXT = {
  COUNSELLOR: ["Talk to a counsellor", "A trained counsellor reaches out privately."],
  MENTOR: ["Talk to a mentor or faculty member", "Someone who can help with studies and workload."],
  PRIVATE_CONVERSATION: ["Request a private support conversation", "No explanation needed — just a conversation."],
  ANONYMOUS: ["Ask anonymously", "Your name and ID stay hidden. Replies arrive in your inbox."],
  CHECK_LATER: ["I don't want to talk right now. Check on me later.", "Nothing starts now. We'll simply check in later."]
};
const DEFAULT_ORDER = ["COUNSELLOR", "MENTOR", "PRIVATE_CONVERSATION", "ANONYMOUS", "CHECK_LATER"];
const TIMES = [["ANY", "Any time"], ["MORNING", "Morning"], ["AFTERNOON", "Afternoon"], ["EVENING", "Evening"]];
// Subtle chips only. The immediate-attention level shows the calm safety panel instead of a label.
const BAND_TAG = { STABLE: "muted", COULD_BENEFIT: "WATCH", SUPPORT_RECOMMENDED: "WATCH" };

const SKIP_KEY = "nex.support.skipped";
const readSkip = () => { try { return sessionStorage.getItem(SKIP_KEY) === "1"; } catch { return false; } };
const writeSkip = (on) => { try { on ? sessionStorage.setItem(SKIP_KEY, "1") : sessionStorage.removeItem(SKIP_KEY); } catch { /* storage unavailable: skip lasts for this render only */ } };

const UNAVAILABLE = "Support check-in is temporarily unavailable. You can still request human support.";

export default function StudentSupport({ live }) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [skipped, setSkipped] = useState(readSkip);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    support.me().then((data) => setState({ data, error: null, loading: false })).catch((err) => setState({ data: null, error: err, loading: false }));
  }, []);
  useEffect(() => { if (live) load(); else setState({ data: null, error: null, loading: false }); }, [live, load]);

  const answered = Object.keys(answers).length;

  async function submit(unsafe = false) {
    setBusy(true);
    setError(null);
    try {
      const out = await support.checkIn(unsafe ? { ...answers, unsafe: true } : answers);
      setResult(out);
      setAnswers({});
      if (out.suggestHelp) setHelpOpen(true);
      if (out.escalated) load();
    } catch (err) {
      setError(err.status === 429 ? err.message : UNAVAILABLE);
      if (unsafe) setResourcesOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    writeSkip(true);
    setSkipped(true);
    setAnswers({});
  }

  const data = state.data;
  const resources = result?.safety || data?.resources || null;
  const openCase = data?.openCase || null;

  return (
    <section className="ci sp" aria-labelledby="sp-title">
      <div className="ext-card sp-card">
        <div className="ci-row ci-between" style={{ alignItems: "baseline" }}>
          <div>
            <div className="ci-kicker sp-kicker">YOUR WELLBEING MATTERS · PRIVATE</div>
            <h2 id="sp-title" className="ci-h2" style={{ marginTop: 4 }}>{skipped && !result ? "Here if you need it" : "How are you feeling today?"}</h2>
          </div>
          <span className="ci-meta">Only you and the student support team can see this.</span>
        </div>

        {!live ? <p className="ci-body sp-note">{UNAVAILABLE}</p> : null}
        {live && state.loading && !data ? <div style={{ marginTop: 12 }}><Skeleton lines={2} /></div> : null}
        {live && state.error && !data ? <p className="ci-body sp-note" role="status">{UNAVAILABLE}</p> : null}

        {openCase ? <CaseTracker supportCase={openCase} onChange={load} /> : null}

        {/* The check-in: optional, every question skippable. */}
        {!skipped && !result ? (
          <div className="sp-questions">
            {QUESTIONS.map((q) => (
              <fieldset key={q.key} className="sp-q">
                <legend className="ci-body">{q.text}</legend>
                <div className="sp-scale" role="radiogroup" aria-label={q.text}>
                  {FACES.map((face, i) => {
                    const value = i + 1;
                    const on = answers[q.key] === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${value} of 5${i === 0 ? ` — ${q.low}` : i === 4 ? ` — ${q.high}` : ""}`}
                        className="sp-face"
                        onClick={() => setAnswers((a) => (on ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== q.key)) : { ...a, [q.key]: value }))}
                      >
                        <span aria-hidden="true">{face}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="sp-ends ci-meta" aria-hidden="true"><span>{q.low}</span><span>{q.high}</span></div>
              </fieldset>
            ))}
            <div className="ext-actions" style={{ alignItems: "center" }}>
              <button type="button" className="btn btn-primary" disabled={!answered || busy || !live} onClick={() => submit(false)}>{busy ? "Sending privately…" : "Submit check-in"}</button>
              <button type="button" className="btn btn-secondary" onClick={skip}>Skip for now</button>
              <span className="ci-meta">Answer as many as you like · {answered}/4</span>
            </div>
            <button type="button" className="ci-link ci-link-ink sp-unsafe" disabled={busy || !live} onClick={() => submit(true)}>I don't feel safe right now</button>
          </div>
        ) : null}

        {skipped && !result ? (
          <div className="ext-actions">
            <button type="button" className="ci-link ci-link-ink" onClick={() => { writeSkip(false); setSkipped(false); }}>Do a 30-second check-in</button>
          </div>
        ) : null}

        {error ? <div className="ci-result ci-result-warn" role="status">{error}</div> : null}

        {result ? <CheckInResult result={result} onAgain={() => { setResult(null); setSkipped(false); writeSkip(false); }} /> : null}

        {result?.band === "IMMEDIATE_ATTENTION" ? <SafetyPanel resources={resources} escalated={Boolean(result.escalated)} /> : null}

        {/* Always available, check-in or not. */}
        <div className="sp-help-row">
          <button type="button" className="btn btn-secondary sp-help-btn" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
            I don't know how to ask for help
          </button>
          <button type="button" className="ci-link ci-link-ink" aria-expanded={resourcesOpen} onClick={() => setResourcesOpen((v) => !v)}>
            Emergency &amp; help resources
          </button>
        </div>

        {helpOpen ? (
          <HelpOptions
            order={result?.options || DEFAULT_ORDER}
            hasCheckIn={Boolean(result || data?.latestCheckIn)}
            openCase={openCase}
            live={live}
            onDone={() => load()}
            onResources={() => setResourcesOpen(true)}
          />
        ) : null}

        {resourcesOpen && result?.band !== "IMMEDIATE_ATTENTION" ? <Resources resources={resources} /> : null}

        <p className="ci-meta sp-foot">
          This is a support tool, not a medical assessment. {data?.privacy || "Your answers are never shown to teachers, wardens or administrators."}
        </p>
      </div>
    </section>
  );
}

function CheckInResult({ result, onAgain }) {
  const byModel = result.ai?.source === "AI_MODEL";
  return (
    <div className="sp-result" role="status" aria-live="polite">
      <div className="ci-row" style={{ gap: 8 }}>
        {result.band !== "IMMEDIATE_ATTENTION" ? <Tag kind={BAND_TAG[result.band] || "muted"}>{result.label}</Tag> : null}
        <span className="ci-meta">Support suggestion — not a diagnosis</span>
      </div>
      <p className="sp-message">{result.message}</p>
      {result.reasons?.length ? (
        <ul className="sp-reasons">
          {result.reasons.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
      <p className="ci-body" style={{ margin: "6px 0 0" }}><b>Next:</b> {result.nextStep}</p>
      <div className="ci-prov" style={{ marginTop: 8 }}>
        <b>{byModel ? "WORDING · AI, CHECKED FOR SAFE LANGUAGE" : "WORDING · RULE-BASED"}</b>
        <span>· support level decided by fixed rules · a person always makes the decisions</span>
      </div>
      <div className="ext-actions"><button type="button" className="ci-link ci-link-ink" onClick={onAgain}>Check in again</button></div>
    </div>
  );
}

function SafetyPanel({ resources, escalated }) {
  return (
    <div className="sp-safety" role="alert">
      <h3 className="ci-h2" style={{ fontSize: 18 }}>Please reach a person right now.</h3>
      <p className="ci-body" style={{ margin: "6px 0 10px" }}>
        You don't have to handle this alone. {escalated ? "The student support team has been alerted and will reach out as soon as possible." : "Use one of the contacts below, or tell any staff member you trust."}
      </p>
      <ContactList rows={resources?.emergency} />
      <p className="ci-body" style={{ marginTop: 10 }}>{resources?.guidance || "If you are in immediate danger, contact your local emergency services or go to the nearest hospital."}</p>
    </div>
  );
}

function ContactList({ rows }) {
  if (!rows?.length) return null;
  return (
    <ul className="ext-list sp-contacts">
      {rows.map((row) => (
        <li key={`${row.label}-${row.contact}`}>
          <b>{row.label}</b> · <span className="ext-mono">{row.contact}</span>{row.note ? <span className="ci-meta"> · {row.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Resources({ resources }) {
  return (
    <div className="sp-resources">
      <div className="ci-label">EMERGENCY</div>
      <ContactList rows={resources?.emergency} />
      <p className="ci-body" style={{ margin: "6px 0 0" }}>{resources?.guidance || "Support resources could not be loaded. If you are in immediate danger, contact local emergency services or tell any staff member now."}</p>
      {resources?.help?.length ? (
        <>
          <div className="ci-label" style={{ marginTop: 12 }}>EVERYDAY HELP</div>
          <ContactList rows={resources.help} />
        </>
      ) : null}
      {resources?.note ? <p className="ci-meta" style={{ marginTop: 8 }}>{resources.note}</p> : null}
    </div>
  );
}

function HelpOptions({ order, hasCheckIn, openCase, live, onDone, onResources }) {
  const [pick, setPick] = useState(null);
  const [time, setTime] = useState("ANY");
  const [share, setShare] = useState(false);
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  async function send() {
    setBusy(true);
    setOutcome(null);
    try {
      const res = pick === "CHECK_LATER"
        ? await support.checkLater(days)
        : await support.request({ preference: pick, preferredTime: time, shareCheckIn: share, anonymous: pick === "ANONYMOUS" });
      setOutcome({
        ok: true,
        text: pick === "CHECK_LATER"
          ? "Okay. Nothing starts now — we'll check on you later. You can ask for support sooner at any time."
          : res?.existing ? "You already have an open private request — its progress is shown above." : "Your private support request has been received. Someone will reach out — you don't need to explain anything."
      });
      setPick(null);
      onDone();
    } catch (err) {
      setOutcome({ ok: false, text: err.status === 0 ? "No connection right now, so the request was not sent. Please use the help resources below, or try again shortly." : err.message || "The request could not be sent." });
      onResources();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sp-options">
      <p className="ci-body" style={{ margin: "0 0 10px" }}>Pick whatever feels easiest. You won't need to write anything.</p>
      <div className="sp-option-grid">
        {order.filter((key) => OPTION_TEXT[key]).map((key) => (
          <button key={key} type="button" className="sp-option" aria-pressed={pick === key} onClick={() => setPick(pick === key ? null : key)} disabled={!live}>
            <b>{OPTION_TEXT[key][0]}</b>
            <span className="ci-meta">{OPTION_TEXT[key][1]}</span>
          </button>
        ))}
        <button type="button" className="sp-option" onClick={onResources}>
          <b>View emergency &amp; help resources</b>
          <span className="ci-meta">Contacts set by your institution.</span>
        </button>
      </div>

      {pick && pick !== "CHECK_LATER" ? (
        <div className="sp-confirm">
          {openCase && openCase.preference !== "CHECK_LATER" ? <p className="ci-meta">You already have an open request — sending again just shows you that one.</p> : null}
          <div className="ci-label">WHEN SUITS YOU?</div>
          <div className="ext-chips" style={{ marginTop: 6 }}>
            {TIMES.map(([key, label]) => <button key={key} type="button" className="ci-chip" aria-pressed={time === key} onClick={() => setTime(key)}>{label}</button>)}
          </div>
          {hasCheckIn ? (
            <label className="sp-check">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
              <span>Share my latest check-in <i>level</i> (not my answers) with the support team</span>
            </label>
          ) : null}
          {pick === "ANONYMOUS" ? <p className="ci-meta" style={{ marginTop: 8 }}>Your name and student ID are hidden from the support team.</p> : null}
          <div className="ext-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>{busy ? "Sending privately…" : "Request private support"}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setPick(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {pick === "CHECK_LATER" ? (
        <div className="sp-confirm">
          <div className="ci-label">CHECK ON ME IN</div>
          <div className="ext-chips" style={{ marginTop: 6 }}>
            {[[1, "1 day"], [3, "3 days"], [7, "1 week"]].map(([n, label]) => <button key={n} type="button" className="ci-chip" aria-pressed={days === n} onClick={() => setDays(n)}>{label}</button>)}
          </div>
          <div className="ext-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={send}>{busy ? "Saving…" : "Check on me later"}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setPick(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {outcome ? <div className={outcome.ok ? "ci-result" : "ci-result ci-result-warn"} role="status">{outcome.text}</div> : null}
    </div>
  );
}

function CaseTracker({ supportCase, onChange }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const later = supportCase.preference === "CHECK_LATER";
  async function withdraw() {
    setBusy(true);
    try {
      await support.withdraw(supportCase.id);
      onChange();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }
  return (
    <div className="sp-tracker">
      <div className="ci-row ci-between">
        <div className="ci-row" style={{ gap: 8 }}>
          <span className="ci-label">YOUR PRIVATE REQUEST · {supportCase.reference}</span>
          {supportCase.anonymous ? <Tag kind="muted">ANONYMOUS</Tag> : null}
        </div>
        <span className="ci-meta">{supportCase.preferenceLabel}</span>
      </div>
      {later ? (
        <p className="ci-body" style={{ margin: "8px 0 0" }}>
          We'll check on you around <b>{new Date(supportCase.followUpAt).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</b>. No conversation has been started.
        </p>
      ) : (
        <ol className="sp-steps" aria-label="Request progress">
          {supportCase.steps.map((step) => (
            <li key={step.key} className={`${step.done ? "done" : ""} ${step.current ? "now" : ""}`} aria-current={step.current ? "step" : undefined}>
              <i aria-hidden="true" />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="ext-actions" style={{ marginTop: 8 }}>
        {confirm ? (
          <>
            <span className="ci-meta">Withdraw this request?</span>
            <button type="button" className="ci-link ci-link-ink" disabled={busy} onClick={withdraw}>Yes, withdraw</button>
            <button type="button" className="ci-link ci-link-ink" onClick={() => setConfirm(false)}>Keep it</button>
          </>
        ) : (
          <button type="button" className="ci-link ci-link-ink" onClick={() => setConfirm(true)}>{later ? "Cancel the check-in" : "Withdraw request"}</button>
        )}
      </div>
    </div>
  );
}
