import React, { Suspense, lazy } from "react";
import { Guard, Skeleton } from "../components/intel/kit.jsx";
import "../components/intel/intel.css";
import "../ext/ext.css";

/*
 * The Exception-Only Campus's entry points into the existing shell
 * (NexCamp.jsx imports only this module). Every panel is its own lazy chunk,
 * so the first load on a low-end phone carries none of it.
 */

const MissionXo = lazy(() => import("./MissionXo.jsx"));
const WardenPolicyPanel = lazy(() => import("./TouchlessPanels.jsx").then((m) => ({ default: m.WardenPolicyPanel })));

const Loading = () => (
  <div className="ci" aria-busy="true">
    <Skeleton lines={4} />
  </div>
);

/** Page 10 additions, staff only. */
export function XoMissionControl(props) {
  if (!props.live || !props.user || !props.staff) return null;
  return (
    <Guard name="Exception-only panels">
      <Suspense fallback={<Loading />}>
        <MissionXo {...props} />
      </Suspense>
    </Guard>
  );
}

/** Page 11 warden console: gate passes decided by policy (UNDO) and why the rest wait. */
export function XoWardenPanel(props) {
  if (!props.live || !props.user) return null;
  return (
    <Guard name="Gate-pass policy">
      <Suspense fallback={null}>
        <WardenPolicyPanel {...props} />
      </Suspense>
    </Guard>
  );
}

const inline = (name) => lazy(() => import("./InlinePanels.jsx").then((m) => ({ default: m[name] })));
const SLOTS = {
  frictionMeasured: inline("FrictionMeasured"),
  timeSaved: inline("TimeSaved"),
  knownIssue: inline("KnownIssue"),
  reportEta: inline("ReportEta"),
  incidentSignals: inline("IncidentSignals"),
  assets: inline("AssetPanel")
};

/**
 * A named Exception-Only panel inside an existing page. Renders `fallback`
 * (the page's original content, if any) until its chunk loads, and only when
 * the API is live and — unless `open` — someone is signed in.
 */
export function XoSlot({ name, fallback = null, live, user, open = false, ...props }) {
  const Panel = SLOTS[name];
  if (!Panel || !live || (!open && !user)) return fallback;
  return (
    <Guard name={name}>
      <Suspense fallback={fallback}>
        <Panel fallback={fallback} {...props} />
      </Suspense>
    </Guard>
  );
}

const change = (name) => lazy(() => import("./ChangePanels.jsx").then((m) => ({ default: m[name] })));
SLOTS.whatChanged = change("WhatChanged");

const importWhatIf = (name) => lazy(() => import("./ImportWhatIf.jsx").then((m) => ({ default: m[name] })));
SLOTS.whatsappImport = importWhatIf("WhatsAppImport");
SLOTS.policyWhatIf = importWhatIf("PolicyWhatIf");

const TuesdayTest = lazy(() => import("./TuesdayTest.jsx"));

/**
 * Phase 10: the TUESDAY TEST control, beside REPLAY INCIDENT in the header.
 * Replay incident, Replay boot and Tuesday Mode are untouched; this opens its
 * own panel (its own lazy chunk) only when pressed.
 */
export function XoTuesdayButton({ user, live, onGo, onDemoStudent }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" data-cursor="RUN" className="btn nx-link" aria-pressed={open} disabled={!live} title={live ? "Run four real errands with a stopwatch" : "Needs the live API"} onClick={() => setOpen((o) => !o)}>
        <span className="nx-sc">TUESDAY TEST</span>
      </button>
      {open ? (
        <Guard name="Tuesday Test">
          <Suspense fallback={null}>
            <TuesdayTest user={user} onGo={onGo} onClose={() => setOpen(false)} onDemoStudent={onDemoStudent} />
          </Suspense>
        </Guard>
      ) : null}
    </>
  );
}
