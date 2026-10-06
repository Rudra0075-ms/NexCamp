import React, { Suspense, lazy, useEffect, useState } from "react";
import { Guard, Skeleton } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { deviceSignals } from "./lowEnd.js";
import "../components/intel/intel.css";
import "./ext.css";

// Each surface is its own chunk, fetched only when the page is opened, so the
// first load on a low-end phone carries none of it.
const loaders = {
  notices: () => import("./NoticesSurface.jsx"),
  documents: () => import("./DocumentsSurface.jsx"),
  classes: () => import("./ClassesSurface.jsx"),
  fees: () => import("./FeesSurface.jsx"),
  requests: () => import("./RequestsSurface.jsx"),
  sms: () => import("./SmsSurface.jsx"),
  faq: () => import("./FaqSurface.jsx"),
  board: () => import("./BoardSurface.jsx"),
  device: () => import("./DeviceSurface.jsx"),
  tuesday: () => import("./TuesdayMode.jsx"),
  mission: () => import("./MissionPanels.jsx"),
  resources: () => import("./ResourcesSurface.jsx")
};
const NoticesSurface = lazy(loaders.notices);
const DocumentsSurface = lazy(loaders.documents);
const ClassesSurface = lazy(loaders.classes);
const FeesSurface = lazy(loaders.fees);
const RequestsSurface = lazy(loaders.requests);
const SmsSurface = lazy(loaders.sms);
const FaqSurface = lazy(loaders.faq);
const BoardSurface = lazy(loaders.board);
const DeviceSurface = lazy(loaders.device);
const TuesdayMode = lazy(loaders.tuesday);
const MissionPanels = lazy(loaders.mission);
const ResourcesSurface = lazy(loaders.resources);

// Once the app is idle and online, fetch the page chunks in the background so
// every new page still opens after the connection drops (the service worker
// keeps them in production). Skipped when the browser asks to save data.
if (typeof window !== "undefined") {
  const saveData = navigator.connection?.saveData;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 4000));
  if (!saveData) {
    window.addEventListener("load", () => idle(() => {
      if (navigator.onLine === false) return;
      for (const load of Object.values(loaders)) load().catch(() => {});
    }));
  }
}

const Loading = () => (
  <div className="ci" aria-busy="true">
    <Skeleton lines={5} />
  </div>
);

/*
 * The PS07 extension pack's entry points into the existing shell. NexCamp.jsx
 * imports this module and renders exactly three things from it (see HOOKS.md):
 * the new pages, the header controls, and the Mission Control panels.
 */

// Same shape as NexCamp.pageDefs: [id, num, short, name, blurb]. Numbering
// continues from the twelve existing surfaces.
export const EXT_PAGES = [
  ["notices", "13", "NOTICES", "Notice Center", "Targeted notices by hostel, branch, year and section — with delivery, read and action tracking."],
  ["documents", "14", "DOCUMENTS", "Certificates & Documents", "Bonafide and other certificates as PDFs with a QR code anyone can verify."],
  ["classes", "15", "CLASSES", "Classes & Mess", "Is tomorrow's class cancelled? Class changes, adjusted attendance and menu changes."],
  ["fees", "16", "FEES", "Fees & Dues", "Dues, due dates and reminders — read-only, by student and by hostel, branch and year."],
  ["requests", "17", "MY REQUESTS", "My Requests", "One timeline across every request, and 'Is it fixed?' after a repair."],
  ["sms", "18", "SMS PHONE", "SMS Keyword Channel", "Campus services from a basic phone — attendance, complaints, gate pass, menu, notices."],
  ["faq", "19", "ASK OFFICE", "Office FAQ", "Office questions answered with the exact policy section they come from."],
  ["board", "20", "YOU SAID, WE DID", "You Said, We Did", "Resolved recurring issues per hostel — reports in, fixes out."],
  ["device", "21", "DEVICE", "Device Readiness", "Measured bundle and payload sizes, and what the low modes switch off."],
  ["resources", "22", "RESOURCES", "Help & Resources", "Telegram-style verified academic and campus resource feed for Admin and Students."]
];

export const EXT_PAGE_IDS = EXT_PAGES.map(([id]) => id);

const SURFACES = {
  notices: NoticesSurface,
  documents: DocumentsSurface,
  classes: ClassesSurface,
  fees: FeesSurface,
  requests: RequestsSurface,
  sms: SmsSurface,
  faq: FaqSurface,
  board: BoardSurface,
  device: DeviceSurface,
  resources: ResourcesSurface
};

/** Renders the open extension page, or nothing. */
export default function ExtSurfaces({ page, ...props }) {
  const Surface = SURFACES[page];
  if (!Surface) return null;
  const name = EXT_PAGES.find(([id]) => id === page)?.[3] || page;
  return (
    <Guard key={page} name={name}>
      <Suspense fallback={<Loading />}>
        <Surface {...props} />
      </Suspense>
    </Guard>
  );
}

// ---- header controls ----------------------------------------------------------------

function useUnread(user) {
  const [n, setN] = useState(null);
  useEffect(() => {
    if (!user) {
      setN(null);
      return undefined;
    }
    let alive = true;
    const tick = () =>
      ext
        .noticeFeed(true)
        .then((r) => alive && setN(r.data.unread))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}

const DISMISS_KEY = "nex:ext:lowend-dismissed";

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Suggests the existing LOW render + LOW BANDWIDTH switches on a constrained device. */
export function LowEndPrompt({ lowBw, mode, onLowEnd }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const forced = typeof location !== "undefined" && new URLSearchParams(location.search).get("lowend") === "1";
  const signals = deviceSignals();
  const show = !dismissed && !(lowBw && mode === "LOW") && (signals.lowEnd || forced);
  if (!show) return null;
  const why = signals.lowEnd ? signals.reasons.join(", ") : "?lowend=1 in the address (demo of the prompt)";
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* per-visit only */
    }
  };
  return (
    <div className="ext-banner" role="status">
      <span style={{ flex: "1 1 240px" }}>This device looks constrained ({why}). Switch on LOW render and LOW BANDWIDTH for a lighter app?</span>
      <button type="button" className="primary" onClick={() => { onLowEnd(); dismiss(); }}>SWITCH ON</button>
      <button type="button" onClick={dismiss}>NOT NOW</button>
    </div>
  );
}

/** Tuesday Mode button + unread notices chip, placed beside the existing Replay controls. */
export function ExtHeader({ user, live, lowBw, mode, onGo, onLowEnd, onDemoStudent }) {
  const [open, setOpen] = useState(false);
  const unread = useUnread(live ? user : null);
  return (
    <>
      <span className="ext-header-bits">
        {unread ? (
          <button type="button" className="btn nx-link nx-link-soft" data-cursor="OPEN" onClick={() => onGo("notices")} aria-label={`${unread} unread notices`}>
            <span className="nx-sc">NOTICES</span>&nbsp;<span className="ext-badge">{unread}</span>
          </button>
        ) : null}
        <button type="button" className="btn nx-link" data-cursor="RUN" aria-pressed={open} onClick={() => setOpen((o) => !o)}>
          <span className="nx-sc">TUESDAY MODE</span>
        </button>
      </span>
      {open ? (
        <Suspense fallback={null}>
          <TuesdayMode user={user} onGo={onGo} onClose={() => setOpen(false)} onDemoStudent={onDemoStudent} />
        </Suspense>
      ) : null}
      <LowEndPrompt lowBw={lowBw} mode={mode} onLowEnd={onLowEnd} />
    </>
  );
}

/** Mission Control additions, loaded only for signed-in staff. */
export function ExtMissionControl(props) {
  if (!props.live || !props.user || !props.staff) return null;
  return (
    <Suspense fallback={<Loading />}>
      <MissionPanels {...props} />
    </Suspense>
  );
}
