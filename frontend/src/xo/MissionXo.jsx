import React from "react";
import { AssetPanel } from "./InlinePanels.jsx";
import { FrictionLedger, ReopenRates } from "./LedgerPanels.jsx";
import { ExceptionsInbox, TouchlessKpi } from "./TouchlessPanels.jsx";

/*
 * Page 10 — the Exception-Only Campus in Mission Control. Staff see the
 * Touchless Rate and only the requests that need a person.
 */

function Section({ kicker, title, children }) {
  return (
    <div style={{ marginTop: 44, borderTop: "1px solid var(--color-divider)", paddingTop: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: ".2em", color: "var(--color-accent-700)", fontWeight: 700 }}>{kicker}</div>
      <h2 style={{ fontSize: "clamp(22px, 3vw, 34px)", letterSpacing: "-.02em", margin: "8px 0 16px" }}>{title}</h2>
      <div className="ci ext" style={{ padding: 0 }}>{children}</div>
    </div>
  );
}

export default function MissionXo({ onGo }) {
  return (
    <>
      <Section kicker="THE EXCEPTION-ONLY CAMPUS · TOUCHLESS LANE" title="Routine requests decided by written policy. Staff see only the exceptions.">
        <div className="xo-grid">
          <TouchlessKpi />
          <ExceptionsInbox onGo={onGo} />
        </div>
      </Section>
      <Section kicker="THE EXCEPTION-ONLY CAMPUS · FRICTION LEDGER" title="Friction reduction, measured — not claimed.">
        <FrictionLedger />
      </Section>
      <Section kicker="THE EXCEPTION-ONLY CAMPUS · CLOSURES THAT HOLD" title="Was it really fixed? Reopen rate and repeat failures.">
        <div className="xo-grid">
          <ReopenRates />
          <AssetPanel />
        </div>
      </Section>
    </>
  );
}
