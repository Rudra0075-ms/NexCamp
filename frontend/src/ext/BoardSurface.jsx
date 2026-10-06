import React, { useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { ExtSection, Kind, PageHead, SignInNote, SourceLine, day, hrs, useExt } from "./kit.jsx";
import { BoardImpact } from "../xo/LedgerPanels.jsx"; // EXCEPTION-ONLY HOOK
import { PfSlot } from "../proof/ProofEntry.jsx"; // ROUND-3 HOOK (see CHANGES-ROUND3.md)

/*
 * 20 — YOU SAID, WE DID. Resolved recurring issues per hostel, read-only from
 * campus memory and resolved incidents. Building, category, report counts,
 * the fix and the time it took — no names, IDs or rooms.
 */

export default function BoardSurface({ user, lowBw, live = true }) {
  const [hostel, setHostel] = useState("");
  const q = useExt(`board:${hostel}:${lowBw}`, () => ext.board(hostel || undefined, lowBw), { enabled: Boolean(user) });
  return (
    <div className="ci ext">
      <PageHead num="20" kicker="YOU SAID, WE DID" title="What students reported, and what was done about it.">
        Every card is a resolved issue from campus memory or a closed incident — how many reports it took, the fix, and how long the fix took. No personal information is shown.
      </PageHead>
      {!user ? <div style={{ marginTop: 18 }}><SignInNote what="the board" /></div> : (
        <ExtSection q={q}>
          {(d) => (
            <div className="ext-stack" style={{ marginTop: 18 }}>
              <div className="ext-row" style={{ justifyContent: "space-between" }}>
                <div className="ext-chips" role="group" aria-label="Hostel">
                  <button type="button" className="ci-chip" aria-pressed={!hostel} onClick={() => setHostel("")}>ALL CAMPUS</button>
                  {d.hostels.map((h) => <button key={h.code} type="button" className="ci-chip" aria-pressed={hostel === h.code} onClick={() => setHostel(h.code)}>{h.name}</button>)}
                </div>
                <Kind kind={d.kind} />
              </div>
              {/* EXCEPTION-ONLY HOOK: each recurring issue measured before and after its latest fix. */}
              <BoardImpact hostel={hostel} />
              {/* ROUND-3 HOOK: the proof badge — did the fix reduce complaints relative to comparable blocks? */}
              <PfSlot name="proofBadges" live={live} user={user} lowBw={lowBw} />
              {d.recurring.length ? (
                <div className="ext-card ext-card-strong">
                  <div className="ci-label">Recurring</div>
                  <ul className="ext-list" style={{ marginTop: 8 }}>{d.recurring.map((r) => <li key={`${r.building}${r.category}`} className="ci-body"><b>{r.building} {r.category}</b> — {r.occurrences} times; fastest fix {hrs(r.fastestHours)}, average {hrs(r.averageHours)}.</li>)}</ul>
                </div>
              ) : null}
              {d.cards.length ? (
                <div className="ext-grid">
                  {d.cards.map((c, i) => (
                    <article key={i} className="ext-card">
                      <div className="ext-row" style={{ justifyContent: "space-between" }}><Tag kind="muted">{c.building} · {c.category}</Tag><span className="ci-meta">{day(c.date)}</span></div>
                      <div className="ci-label" style={{ marginTop: 10 }}>You said</div>
                      <h3>{c.said}</h3>
                      <div className="ci-label">We did</div>
                      <p className="ci-body" style={{ margin: "4px 0 0" }}>{c.did}{c.hours != null ? <b> — in {hrs(c.hours)}</b> : null}</p>
                      <p className="ci-meta">{c.source === "CAMPUS_MEMORY" ? "Campus memory" : "Resolved incident"}{c.reportsBasis ? ` · reports: ${c.reportsBasis}` : ""}{c.recurrence ? ` · after: ${c.recurrence}` : ""}</p>
                    </article>
                  ))}
                </div>
              ) : <StateBox title="Insufficient data">{d.note}</StateBox>}
              <p className="ci-meta">{d.privacy}</p>
              <SourceLine method={d.method} />
            </div>
          )}
        </ExtSection>
      )}
    </div>
  );
}
