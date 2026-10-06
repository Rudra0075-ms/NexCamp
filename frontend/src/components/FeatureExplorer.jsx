import React, { useCallback, useEffect, useRef, useState } from "react";
import imgAttendance from "../assets/features/attendance.webp";
import imgMess from "../assets/features/mess.webp";
import imgHostel from "../assets/features/hostel.webp";
import imgDebugging from "../assets/features/debugging.webp";
import imgIncident from "../assets/features/incident.webp";
import imgInvestigation from "../assets/features/investigation.webp";
import imgRisk from "../assets/features/risk.webp";
import imgIntervention from "../assets/features/intervention.webp";
import imgAdmin from "../assets/features/admin.webp";
import imgStudent from "../assets/features/student.webp";
import { token } from "../lib/palette.js";

/**
 * The landing page's feature exploration.
 *
 * Feature names are set as large display type. Pointing at one previews its
 * surface: an image of the page is revealed behind / through the type by the
 * ink layer (lib/inkReveal.js), following the cursor with a little inertia.
 * Hover (or keyboard focus, or a first tap on touch) only previews; a click,
 * Enter, or a second tap opens the surface through `onOpen(page, preview)`.
 *
 * The words keep the theme's text colour. The preview canvas sits above the
 * other rows but below the one being previewed, and settles above or below
 * that word, so the active name is never covered. The canvas takes its
 * colours from the theme's CSS variables.
 */

// The four primary surfaces, in landing-page order, then the rest.
export const FEATURES = [
  {
    id: "attendance", page: "attendance", word: "Attendance", img: imgAttendance,
    blurb: "Trend, heatmap and a what-if simulator for eligibility.",
    lede: "Attendance is a pattern, not a percentage. The surface shows where a student stands against the eligibility bar, which slots are slipping, and exactly how many classes put them back on the right side of it.",
    facts: ["Eligibility bar, live", "Slot-by-slot heatmap", "What-if simulator"]
  },
  {
    id: "mess", page: "mess", word: "Mess", img: imgMess,
    blurb: "Crowd density, demand curve, predicted peak and waste.",
    lede: "The central mess as demand, not a menu: how full it is right now, when the rush will peak, and how much food the day is on course to waste — early enough to act on.",
    facts: ["Live crowd density", "Predicted peak", "Waste forecast"]
  },
  {
    id: "hostel", page: "gatepass", word: "Hostel", img: imgHostel,
    blurb: "Gate passes: guardian OTP, warden approval, QR at the gate.",
    lede: "Leaving the hostel becomes one flow: apply, the guardian confirms by OTP, the warden approves, a QR opens the gate — and the return clock keeps counting until the student is back in.",
    facts: ["Guardian OTP", "Warden approval", "QR at the gate · return clock"]
  },
  {
    id: "debugging", page: "report", word: "Debugging", img: imgDebugging,
    blurb: "Report a problem once; it is routed, tracked and resolved.",
    lede: "A complaint is a digital object. Report it once in plain words; the system classifies it, spots duplicates, routes it to the right department and keeps a timeline until it is fixed.",
    facts: ["One request", "AI routing and duplicates", "Tracked to resolution"]
  }
];

export const MORE = [
  { id: "incident", page: "incident", word: "Incidents", img: imgIncident, blurb: "Seventeen complaints converge into one recurring incident." },
  { id: "investigation", page: "investigation", word: "Investigation", img: imgInvestigation, blurb: "Graph, evidence drawer and an AI that shows its work." },
  { id: "risk", page: "risk", word: "Risk", img: imgRisk, blurb: "Campus risk map, anomalies and silent problem detection." },
  { id: "intervention", page: "intervention", word: "Intervention", img: imgIntervention, blurb: "What the administration should do — and what if it doesn't." },
  { id: "admin", page: "admin", word: "Mission control", img: imgAdmin, blurb: "Health, queue, briefing and cross-domain signals." },
  { id: "student", page: "student", word: "Student", img: imgStudent, blurb: "One student's campus: attendance, mess, reports." },
  { id: "kiosk", page: "kiosk", word: "Kiosk", img: imgAdmin, blurb: "Assisted access for students without a smartphone: one ID, every service." }
];

const ALL = [...FEATURES, ...MORE];
// matches lib/inkReveal.js's preview size (42% of the width, 280–660px, 0.62 tall)
const previewHeight = (w) => (w < 768 ? w * 0.9 : Math.max(280, Math.min(w * 0.42, 660))) * 0.62;
const pad2 = (n) => String(n).padStart(2, "0");
const prefersReduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Letters of a word, each its own span so they can move in a stagger. */
function Letters({ text }) {
  return (
    <span className="fx-letters" aria-hidden="true">
      {Array.from(text).map((ch, i) => (
        <span key={i} className="fx-l" style={{ "--i": i }}>{ch === " " ? " " : ch}</span>
      ))}
    </span>
  );
}

export default function FeatureExplorer({ onOpen }) {
  const open = (i) => {
    const f = ALL[i];
    if (onOpen) onOpen(f.page, { src: f.img });
  };

  const item = (f, i, minor) => (
    <li key={f.id} className={"fx-row" + (minor ? " fx-row--minor" : "")}>
      <button
        type="button"
        className="fx-item"
        data-cursor="OPEN"
        aria-label={`${f.word} — ${f.blurb} Open the ${f.word.toLowerCase()} surface.`}
        onClick={() => open(i)}
      >
        {!minor ? <span className="fx-num">{pad2(i + 1)}</span> : null}
        <span className="fx-word">{f.word}</span>
        <span className="fx-meta">
          <span className="fx-blurb">{f.blurb}</span>
          <span className="fx-go">Open ↗</span>
        </span>
      </button>
    </li>
  );

  return (
    <section className="fx" data-scene="explore" aria-labelledby="fx-title">
      <div className="fx-head">
        <div className="fx-kicker">Explore the system</div>
        <h2 id="fx-title" className="fx-title">Four problems every campus has.<br />One place that sees them.</h2>
        <p className="fx-hint">Click a surface to open its dashboard.</p>
      </div>
      <div className="fx-stage">
        <nav aria-label="Campus surfaces">
          <ol className="fx-list">{FEATURES.map((f, i) => item(f, i, false))}</ol>
          <div className="fx-more-label">Also in the system</div>
          <ol className="fx-list fx-list--minor">{MORE.map((f, j) => item(f, FEATURES.length + j, true))}</ol>
        </nav>
      </div>
    </section>
  );
}

/** The four primary surfaces as editorial sections, after the explorer. */
export function FeatureSpotlights({ onOpen }) {
  return (
    <>
      {FEATURES.map((f, i) => (
        <section key={f.id} className={"fs" + (i % 2 ? " fs--flip" : "")} data-scene="spot" aria-labelledby={`fs-${f.id}`}>
          <div className="fs-top">
            <span className="fs-num">{pad2(i + 1)} / {pad2(FEATURES.length)}</span>
            <h2 id={`fs-${f.id}`} className="fs-title" data-scene-part="title">{f.word}</h2>
          </div>
          <div className="fs-grid">
            <div className="fs-body" data-scene-part="body">
              <p className="fs-lede">{f.lede}</p>
              <ul className="fs-facts">
                {f.facts.map((x) => <li key={x}>{x}</li>)}
              </ul>
              <button
                type="button"
                className="fs-cta"
                data-cursor="OPEN"
                onClick={(e) => {
                  const img = e.currentTarget.closest(".fs").querySelector(".fs-media img");
                  const r = img ? img.getBoundingClientRect() : null;
                  onOpen && onOpen(f.page, { src: f.img, rect: r && r.bottom > 0 && r.top < window.innerHeight ? { left: r.left, top: r.top, width: r.width, height: r.height, bare: true } : null });
                }}
              >
                Open {f.word.toLowerCase()} <span aria-hidden="true">↗</span>
              </button>
            </div>
            <figure className="fs-media" data-scene-part="media">
              <div className="fs-mat"><img src={f.img} alt={`The ${f.word.toLowerCase()} surface`} loading="lazy" decoding="async" /></div>
            </figure>
          </div>
        </section>
      ))}
    </>
  );
}
