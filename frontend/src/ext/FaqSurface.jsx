import React, { useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { ExtSection, Kind, NetLine, Outcome, PageHead, SignInNote, SourceLine, attempt, dt, isAdmin, isStaff, useExt } from "./kit.jsx";
import { FaqRuleLink, FocusedSection, PolicyRuleList } from "../xo/TouchlessPanels.jsx"; // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md)

/*
 * 19 — ASK THE OFFICE. Deterministic keyword retrieval over the policy
 * corpus; every answer shows the exact section it came from. With a language
 * model configured, the section may be rephrased in the chosen language
 * (validated, numbers checked); without one, the section itself is shown.
 * A separate component from the ⌘K bar and the copilot, which are unchanged.
 */

const LANGS = [["EN", "English"], ["OR", "ଓଡ଼ିଆ"], ["HI", "हिन्दी"]];
import { FaqDrafts } from "../xo/ImportWhatIf.jsx"; // EXCEPTION-ONLY HOOK
const fromAppLang = (lang) => (lang === "ଓଡ଼ିଆ" ? "OR" : lang === "हिन्दी" ? "HI" : "EN");
const SUGGESTED = ["What time do I have to be back in the hostel?", "How do I get a bonafide certificate?", "What is the last date for mess fee?", "Can I keep an electric kettle in my room?"];

function Ask({ appLang, onGo }) {
  const [question, setQuestion] = useState("");
  const [lang, setLang] = useState(fromAppLang(appLang));
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [filed, setFiled] = useState(null);
  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion(text);
    setBusy(true);
    setError(null);
    setFiled(null);
    try {
      setAnswer(await ext.faqAsk(text, lang));
    } catch (e) {
      setError(e.status === 0 ? "Offline — the office assistant needs the server." : e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ext-stack">
      <form className="ci-ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input aria-label="Ask the office" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="Ask about hostel rules, fees, leave, certificates, mess…" style={{ flex: 1, border: 0, background: "none", font: "inherit", fontSize: 16, padding: "12px 14px", minWidth: 0 }} />
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "…" : "ASK"}</button>
      </form>
      <div className="ext-row">
        <div className="ci-seg" role="group" aria-label="Answer language">{LANGS.map(([k, l]) => <button key={k} type="button" aria-pressed={lang === k} onClick={() => setLang(k)}>{l}</button>)}</div>
        {SUGGESTED.map((s) => <button key={s} type="button" className="ci-chip" onClick={() => ask(s)}>{s}</button>)}
      </div>
      {error ? <div className="ci-result ci-result-err">{error}</div> : null}
      {answer ? (
        answer.answered ? (
          <article className="ext-card ext-card-strong" aria-live="polite">
            <div className="ext-row" style={{ justifyContent: "space-between" }}><Kind kind="EVIDENCE" /><span className="ci-meta">match score {answer.retrieval.topScore} (threshold {answer.retrieval.threshold}) · terms: {answer.retrieval.matchedTerms.join(", ")}</span></div>
            <p className="ci-body" style={{ fontSize: 16, marginTop: 10 }}>{answer.answer}</p>
            <div className="ext-card" style={{ marginTop: 10 }}>
              <div className="ci-label">Cited section</div>
              <div className="ext-row" style={{ marginTop: 4 }}><b className="ext-code">{answer.citation.key}</b><span>{answer.citation.title}</span><Tag kind="muted">v{answer.citation.version}</Tag></div>
              <p className="ci-meta" style={{ margin: "6px 0 0" }}>{answer.citation.source}</p>
            </div>
            {/* EXCEPTION-ONLY HOOK: the rules in the Touchless Lane that cite this section. */}
            <FaqRuleLink sectionKey={answer.citation.key} onGo={onGo} />
            {answer.alternatives?.length ? <p className="ci-meta">Also related: {answer.alternatives.map((a) => `${a.key} (${a.score})`).join(", ")}</p> : null}
            <SourceLine method={answer.retrieval.method} source={answer.source} note={answer.note} />
          </article>
        ) : (
          <article className="ext-card ext-card-accent" aria-live="polite">
            <Kind kind="INSUFFICIENT DATA" />
            <p className="ci-body" style={{ marginTop: 8 }}>{answer.message}</p>
            {answer.alternatives?.length ? <p className="ci-meta">Closest (below threshold): {answer.alternatives.map((a) => a.title).join(", ")}</p> : null}
            <div className="ext-actions"><button type="button" className="btn btn-primary" onClick={async () => setFiled(await attempt(() => ext.faqRequest({ queryId: answer.queryId }), (d) => `Filed as ${d.reference} with ${d.department || "the office"}. Track it under My Requests.`))}>CREATE A REQUEST</button></div>
            <Outcome result={filed} />
          </article>
        )
      ) : null}
    </div>
  );
}

function SectionEditor({ s, onSaved }) {
  const [body, setBody] = useState(s.body);
  const [result, setResult] = useState(null);
  return (
    <details className="ext-card">
      <summary><b className="ext-code">{s.key}</b> {s.title} <span className="ci-meta">· {s.category} · v{s.version}</span></summary>
      <label className="ext-field" style={{ marginTop: 8 }}><span className="ci-label">Body</span><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} /></label>
      <div className="ext-actions"><button type="button" className="btn btn-secondary" disabled={body === s.body} onClick={async () => { const r = await attempt(() => ext.faqSave(s.key, { body }), (d) => `Saved as v${d.version}; the change is audited.`); setResult(r); if (!r.error) onSaved?.(); }}>SAVE NEW VERSION</button></div>
      <Outcome result={result} />
    </details>
  );
}

export function FaqAdmin({ user }) {
  const [nonce, setNonce] = useState(0);
  const stats = useExt(`faqstats:${nonce}`, () => ext.faqStats());
  const sections = useExt(`faqsec:${nonce}`, () => ext.faqSections());
  return (
    <div className="ext-grid">
      <ExtSection q={stats}>
        {(d) => (
          <div className="ext-stack">
            <div className="ext-row"><Kind kind={d.kind} /><span className="ci-meta">{d.totals.asked} asked · {d.totals.answered} answered ({d.totals.answerRate ?? "—"}%) · {d.totals.requestsFiled} turned into requests</span></div>
            <div className="ext-card"><div className="ci-label">Most asked</div><ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>{d.mostAsked.map((m, i) => <li key={i} className="ci-body">{m.question} <span className="ci-meta">× {m.count} · {m.sectionKey || "unanswered"}</span></li>)}</ol></div>
            <div className="ext-card"><div className="ci-label">Unanswered — gaps in the corpus</div>{d.unanswered.length ? <ul className="ext-list" style={{ marginTop: 8 }}>{d.unanswered.map((u, i) => <li key={i} className="ci-meta">{u.question} · {dt(u.at)}{u.requestReference ? ` · ${u.requestReference}` : ""}</li>)}</ul> : <p className="ci-meta">None.</p>}</div>
          </div>
        )}
      </ExtSection>
      <ExtSection q={sections}>
        {(d) => (
          <div className="ext-stack">
            <div className="ci-label">Policy corpus ({d.sections.length} sections){isAdmin(user) ? " — editable" : ""}</div>
            {d.sections.map((s) => (isAdmin(user) ? <SectionEditor key={s.key} s={s} onSaved={() => setNonce((n) => n + 1)} /> : <details key={s.key} className="ext-card"><summary><b className="ext-code">{s.key}</b> {s.title}</summary><p className="ci-body">{s.body}</p></details>))}
          </div>
        )}
      </ExtSection>
    </div>
  );
}

export default function FaqSurface({ user, lang, onGo }) {
  const [tab, setTab] = useState("ASK");
  return (
    <div className="ci ext">
      <PageHead num="19" kicker="ASK THE OFFICE" title="Office questions, answered with the rule they come from.">
        Every answer quotes the exact policy section it used. If nothing matches closely enough, it says so and offers to send your question to the office as a request.
      </PageHead>
      <div style={{ marginTop: 18 }}><NetLine /></div>
      {!user ? <SignInNote what="the office assistant" /> : (
        <>
          {isStaff(user) ? <div className="ext-tabs" role="group" aria-label="Office FAQ" style={{ marginBottom: 18 }}>{[["ASK", "ASK"], ["ADMIN", "MOST ASKED & CORPUS"]].map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div> : null}
          {/* EXCEPTION-ONLY HOOK: a section linked from a rule or an exception opens here, with its rules. */}
          <FocusedSection onGo={onGo} />
          {tab === "ADMIN" && isStaff(user) ? <FaqAdmin user={user} /> : <Ask appLang={lang} onGo={onGo} />}
          <PolicyRuleList onGo={onGo} />
          {isStaff(user) ? <FaqDrafts /> : null}
        </>
      )}
      {!user ? null : <p className="ci-meta" style={{ marginTop: 18 }}>Retrieval is keyword overlap, not a language model.</p>}
    </div>
  );
}

