import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getResilient } from "../lib/api.js";
import { tr } from "./i18n.js";
import "./reel.css";

/*
 * THE 30-SECOND PROOF (see CHANGES-REEL.md). One request (GET /api/xo/reel)
 * before playback, then eleven scenes on one master clock: each scene acts the
 * problem out (beat A), shows the mechanism acting on it (beat B), and lands a
 * LIVE OUTPUT card built only from the API's figures (beat C), which then holds
 * still for at least 1.0 s.
 *
 * Every moving element carries data-* timing; the timeline turns those into
 * paused Web Animations and sets their currentTime from the clock on each
 * frame, so the same time code always shows the same frame (pause, back /
 * next, replay and screen recording are all seeks). Only transform and
 * opacity are animated. prefers-reduced-motion turns every movement into a
 * cross-fade; LOW render / ?lowend=1 creates no animation at all and cuts
 * between the end frames of the three beats. Numbers never count up: they
 * appear at their final value. Countable things in beats B and C are drawn
 * from the data (capped sets say the real number in text).
 */

export const DURATION = 30000;
const HOLD = 1030; // the card is still for the last 1.03 s of every scene
const CARD = 320; // card entrance
const PRE = 150; // beat C starts this long before the card rises
const OUT = 250; // scene-to-scene transition (≤ 300 ms)

const SCRIPT = [
  ["intro", 0, 2000, null, "One Tuesday. Four errands. Four queues.", "None needed a person to decide."],
  ["certificate", 2000, 5000, "FRICTION 30%", "Bonafide certificate: an office queue", "Written rule decides, cites its section"],
  ["duplicate", 5000, 8000, "FRICTION 30%", "Tap leaking 9 days; reported again and again", "Known issue offered while typing"],
  ["safety", 8000, 10500, "FRICTION 30%", "Sparks reported, stuck in the queue", "{n} hazard groups forced CRITICAL by rule"],
  ["provenFix", 10500, 13500, "ADMIN VISIBILITY 20%", "\"Closed\" problems come back", "Student asked: is it fixed?"],
  ["classChange", 13500, 16500, "BREADTH 20%", "Is tomorrow's class cancelled?", "One change → notice → attendance updated"],
  ["noticeReach", 16500, 19500, "ADMIN VISIBILITY 20%", "Mess menu changed; notice lost at 2 AM", "Read tracking; unread students escalated"],
  ["gatePass", 19500, 22000, "BREADTH 20%", "Gate pass on paper; guardian never told", "Guardian code → rule → QR → server clock"],
  ["noSmartphone", 22000, 25000, "ACCESSIBILITY 15%", "No smartphone, weak hostel network", "SMS keywords, staff SMS loop, kiosk"],
  ["adminView", 25000, 28000, "ADMIN VISIBILITY 20%", "Staff see volume, not what is stuck", "Exceptions only, with reason and UNDO"],
  ["ledger", 28000, 30000, "ADOPTION 15%", null, "Measured from one event log"]
];

/** Scene timing: A ≈ 35 %, B ≈ 25 %, C ≈ 40 % — C stretched where needed so the card still holds 1.03 s. */
export const SCENES = SCRIPT.map(([key, start, end, chip, problem, mechanism], i) => {
  const dur = end - start;
  const C = key === "ledger" ? 300 : Math.min(dur * 0.6, dur - HOLD - CARD - PRE);
  return { i, key, start, end, dur, chip, problem, mechanism, B: Math.round((C * 35) / 60), C, card: C + PRE, hold: dur - HOLD };
});

// ---- timing attributes ---------------------------------------------------------------------

/** k: entrance preset at `at` ms (scene time) for `d` ms. o: leaves at o. l: loop until ls. x: scene exit. */
const A = (k, at, d = 300, { o, ok, l, ls, la, from, x } = {}) => ({
  "data-k": k,
  "data-at": Math.round(at),
  "data-d": d,
  ...(o !== undefined ? { "data-o": Math.round(o) } : {}),
  ...(ok ? { "data-ok": ok } : {}),
  ...(l ? { "data-l": l } : {}),
  ...(ls !== undefined ? { "data-ls": Math.round(ls) } : {}),
  ...(la !== undefined ? { "data-la": Math.round(la) } : {}),
  ...(from ? { "data-from": from } : {}),
  ...(x ? { "data-x": x } : {})
});

const none = "translate(0px, 0px) scale(1) rotate(0deg)";
const ENTER = {
  fade: () => [{ opacity: 0 }, { opacity: 1 }],
  rise: () => [{ opacity: 0, transform: "translateY(56px)" }, { opacity: 1, transform: "translateY(0px)" }],
  slide: () => [{ opacity: 0, transform: "translateX(-56px)" }, { opacity: 1, transform: "translateX(0px)" }],
  slideR: () => [{ opacity: 0, transform: "translateX(56px)" }, { opacity: 1, transform: "translateX(0px)" }],
  drop: () => [{ opacity: 0, transform: "translateY(-70px)" }, { opacity: 1, transform: "translateY(0px)" }],
  pop: () => [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 1, transform: "scale(1)" }],
  stamp: () => [{ opacity: 0, transform: "scale(2.4)" }, { opacity: 1, transform: "scale(1)" }],
  grow: () => [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
  turn: () => [{ transform: "rotate(-200deg)" }, { transform: "rotate(0deg)" }],
  move: (el) => [{ opacity: 0, transform: el.dataset.from, offset: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, transform: none }]
};
const LOOPS = {
  drip: { per: 800, kf: [{ transform: "translateY(0px)", opacity: 1 }, { transform: "translateY(54px)", opacity: 0 }] },
  flicker: { per: 1000, kf: [{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }] }, // one gentle cycle per second (WCAG 2.3.1)
  pulse: { per: 1000, kf: [{ transform: "scale(1)" }, { transform: "scale(1.14)" }, { transform: "scale(1)" }] },
  crawl: { per: 2200, kf: [{ transform: "translateX(0px)" }, { transform: "translateX(12px)" }, { transform: "translateX(0px)" }] },
  drift: { per: 1700, kf: [{ transform: "translate(0px, 0px)" }, { transform: "translate(10px, -8px)" }, { transform: "translate(0px, 0px)" }] },
  scroll: { per: 1600, kf: [{ transform: "translateY(0px)" }, { transform: "translateY(-46px)" }] },
  spin: { per: 1000, kf: [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }] }
};
const EXIT = {
  out: () => [{ opacity: 1 }, { opacity: 0 }],
  fly: () => [{ opacity: 1, transform: none }, { opacity: 0, transform: "translate(170px, -150px) rotate(40deg)" }],
  shrink: () => [{ opacity: 1, transform: none }, { opacity: 0, transform: "translate(0px, 360px) scale(0.04)" }]
};
const EASE = "cubic-bezier(.2,.8,.2,1)";

/**
 * Builds the timeline for a mounted reel. mode: "full" | "reduced" | "static".
 * Returns render(t), which draws the frame at master time t (ms).
 */
function buildTimeline(root, mode, scenes) {
  const layers = [...root.querySelectorAll("[data-reel-layer]")].map((layer) => {
    const s = scenes[Number(layer.dataset.reelLayer)];
    const q = (x) => (x < s.B ? 0 : x < s.C ? s.B : s.C); // static mode: the beat an instant belongs to
    const anims = [];
    const cuts = [];
    for (const el of layer.querySelectorAll("[data-k]")) {
      const at = Number(el.dataset.at) || 0;
      const d = Number(el.dataset.d) || 300;
      const o = el.dataset.o !== undefined ? Number(el.dataset.o) : null;
      if (mode === "static") {
        cuts.push({ el, from: q(at), to: o === null ? Infinity : q(o) });
        continue;
      }
      const k = el.dataset.k;
      if (k !== "show") {
        const kf = mode === "reduced" ? ENTER.fade() : (ENTER[k] || ENTER.fade)(el);
        anims.push({ a: el.animate(kf, { duration: d, fill: "both", easing: k === "grow" || k === "turn" ? "ease-out" : EASE }), at });
      }
      const loop = LOOPS[el.dataset.l];
      if (loop && mode === "full") {
        const la = el.dataset.la !== undefined ? Number(el.dataset.la) : at + (k === "show" ? 0 : d);
        const stop = el.dataset.ls !== undefined ? Number(el.dataset.ls) : s.hold;
        if (stop > la) anims.push({ a: el.animate(loop.kf, { duration: loop.per, iterations: (stop - la) / loop.per, easing: "ease-in-out" }), at: la }); // ends exactly at `stop`
      }
      if (o !== null) anims.push({ a: el.animate(mode === "reduced" || !EXIT[el.dataset.ok] ? EXIT.out() : EXIT[el.dataset.ok](), { duration: el.dataset.ok === "fly" ? 420 : 160, fill: "forwards", easing: "ease-in" }), at: o });
      const x = el.dataset.x;
      if (x && s.i < scenes.length - 1) anims.push({ a: el.animate(mode === "reduced" ? EXIT.out() : (EXIT[x] || EXIT.out)(), { duration: OUT, fill: "forwards", easing: "ease-in" }), at: s.dur });
    }
    for (const x of anims) {
      x.a.pause();
      x.end = x.a.effect.getComputedTiming().endTime;
      x.last = undefined;
    }
    return { layer, s, anims, cuts, shown: null };
  });
  return function render(t) {
    for (const L of layers) {
      const local = t - L.s.start;
      const last = L.s.i === scenes.length - 1;
      const tail = mode === "static" ? 0 : OUT;
      const visible = local >= 0 && (last ? local <= L.s.dur : local < L.s.dur + tail);
      if (visible !== L.shown) {
        // Full / reduced motion: every layer stays composited and is shown by opacity, so a scene starting
        // never waits on a first paint. LOW render: a plain cut.
        if (mode === "static") L.layer.style.visibility = visible ? "visible" : "hidden";
        else L.layer.style.opacity = visible ? "1" : "0";
        L.shown = visible;
      }
      if (!visible) continue;
      for (const x of L.anims) {
        // Before its start or after its end an animation shows the same frame whatever the time, so it is only
        // touched when that changes — a still frame then costs nothing to draw. Seeking stays exact.
        const ct = Math.min(Math.max(local - x.at, -1), x.end);
        if (ct !== x.last) {
          x.a.currentTime = ct;
          x.last = ct;
        }
      }
      for (const c of L.cuts) {
        const on = local >= c.from && local < c.to;
        if (c.on !== on) {
          c.el.style.visibility = on ? "" : "hidden";
          c.on = on;
        }
      }
    }
  };
}

// ---- formatting (no rounding that could change what the API said) ---------------------------

const hrs = (h) => (h === null || h === undefined ? "—" : `${h} h`); // the API's own figure, never converted
const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);
const KIND_CLASS = { "ACTUAL DATA": "k-actual", SIMULATED: "k-sim", ESTIMATE: "k-est", ASSUMPTION: "k-est", "INSUFFICIENT DATA": "k-insuf" };
const Kind = ({ kind }) => (kind ? <span className={`reel-kind ${KIND_CLASS[kind] || "k-insuf"}`}>{kind}</span> : null);
const short = (s, n) => (String(s || "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ""));
const vals = (o) => Object.values(o || {});

// ---- icons (stroke 3, drawn round the origin) ----------------------------------------------

const IDoc = () => (<g><rect x="-17" y="-22" width="34" height="44" rx="3" /><line x1="-9" y1="-9" x2="9" y2="-9" /><line x1="-9" y1="0" x2="9" y2="0" /><line x1="-9" y1="9" x2="3" y2="9" /></g>);
const IDrop = () => <path d="M0 -21 C9 -8 14 0 14 7 A14 14 0 0 1 -14 7 C-14 0 -9 -8 0 -21 Z" />;
const ICal = () => (<g><rect x="-19" y="-16" width="38" height="36" rx="3" /><line x1="-19" y1="-5" x2="19" y2="-5" /><line x1="-9" y1="-22" x2="-9" y2="-11" /><line x1="9" y1="-22" x2="9" y2="-11" /></g>);
const IGate = () => (<g><path d="M-20 20 V-4 A20 20 0 0 1 20 -4 V20" /><line x1="-7" y1="20" x2="-7" y2="-14" /><line x1="7" y1="20" x2="7" y2="-14" /></g>);
const IPerson = () => (<g><circle cx="0" cy="-14" r="9" /><path d="M-15 22 V8 A15 15 0 0 1 15 8 V22" /></g>);
const ISpark = () => <path d="M-6 -20 L6 -4 L-4 -2 L8 18" />;
const IPhone = () => (<g><rect x="-26" y="-50" width="52" height="100" rx="8" /><rect x="-18" y="-40" width="36" height="34" rx="2" />{[0, 1, 2].map((r) => [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={-12 + c * 12} cy={8 + r * 12} r="2.5" className="f-cool" />))}</g>);
const IKiosk = () => (<g><rect x="-26" y="-40" width="52" height="56" rx="4" /><line x1="0" y1="16" x2="0" y2="38" /><line x1="-18" y1="38" x2="18" y2="38" /></g>);
const IFlag = () => (<g><line x1="-12" y1="22" x2="-12" y2="-22" /><path d="M-12 -22 H16 L8 -11 L16 0 H-12" /></g>);
const ROLE_ICON = { STUDENT: IPerson, WARDEN: IGate, ADMIN: IDoc, PARENT: IPerson };
const ROLE_NAME = { STUDENT: "STUDENT", WARDEN: "WARDEN", ADMIN: "ADMIN", PARENT: "GUARDIAN" };

/** Places an animated child: the outer <g> positions (SVG attribute), the inner one animates (CSS). */
const At = ({ x, y, children, ...anim }) => (<g transform={`translate(${x} ${y})`}><g {...anim}>{children}</g></g>);

// ---- the stage of each scene (viewBox 880 × 450) ---------------------------------------------

function Stage({ s, scene, t }) {
  const d = scene?.data || {};
  const ok = scene && scene.kind !== "INSUFFICIENT DATA";
  const { B, C } = s;
  switch (s.key) {
    case "intro": {
      const icons = [IDoc, IDrop, ICal, IGate];
      return (
        <g>
          {[70, 170, 270, 370].map((y, i) => {
            const Icon = icons[i];
            return (
              <g key={y}>
                <line x1="160" y1={y + 26} x2="850" y2={y + 26} className="c-cool ol" {...A("grow", i * 40, 260, { o: B + 160 })} />
                {[0, 1, 2].map((j) => <rect key={j} x={250 + j * 46} y={y - 4} width="34" height="30" rx="4" className="f-dim" {...A("fade", 80 + i * 40, 200, { o: B + 160 })} />)}
                <At x={90} y={y + 4} {...A("move", 60 + i * 50, 360, { from: "translateX(-90px)", o: B + 160 })}><g className="c-cool"><Icon /></g></At>
              </g>
            );
          })}
          <rect x="850" y="20" width="12" height="410" rx="6" className="f-warm" {...A("move", B, 240, { from: "translateX(-820px)", o: C })} />
          <text x="440" y="250" textAnchor="middle" className="t-xl" {...A("pop", C, 260)}>{t("30-SECOND PROOF")}</text>
        </g>
      );
    }
    case "certificate": {
      const conds = vals(d.conditions);
      const shown = conds.slice(0, 5);
      const step = shown.length ? Math.min(110, (C - B - 260) / shown.length) : 0;
      return (
        <g>
          <g {...A("show", 0, 0, { o: B })}>
            {[0, 1, 2, 3, 4, 5].map((i) => <At key={i} x={430 + i * 72} y={330} {...A("fade", i * 30, 200, { l: "crawl", ls: B })}><g className="c-cool"><IPerson /></g></At>)}
            <At x={860} y={318} {...A("move", 80, 620, { from: "translateX(-720px)" })}><g className="c-cool"><IDoc /></g></At>
          </g>
          {ok ? (
            <g>
              <rect x="230" y="30" width="420" height="330" rx="10" className="page" {...A("pop", B, 220)} />
              <text x="270" y="92" className="t-l warm" {...A("fade", B + 80, 160)}>{d.section || "—"}</text>
              <rect x="270" y="106" width="250" height="8" rx="4" className="f-warm ol" {...A("grow", B + 120, 180)} />
              {shown.map((c, i) => (
                <g key={i}>
                  <rect x="270" y={140 + i * 42} width="30" height="30" rx="5" className="c-paper" {...A("fade", B + 160, 120)} />
                  <rect x="314" y={150 + i * 42} width="300" height="10" rx="5" className="f-dim" {...A("fade", B + 160, 120)} />
                  <At x={285} y={155 + i * 42} {...A("pop", B + 200 + i * step, 160)}>{c.passed ? <path d="M-9 0 L-2 8 L10 -9" className="c-ok" /> : <path d="M-8 -8 L8 8 M8 -8 L-8 8" className="c-bad" />}</At>
                </g>
              ))}
              {conds.length > shown.length ? <text x="270" y="356" className="t-s">+{conds.length - shown.length}</text> : null}
              <g transform="translate(640 330) rotate(-8)">
                <g {...A("stamp", C, 220)}>
                  <rect x="-160" y="-38" width="320" height="76" rx="8" className={d.decision === "AUTO_APPROVE" ? "stamp ok" : "stamp bad"} />
                  <text x="0" y="13" textAnchor="middle" className={`t-l ${d.decision === "AUTO_APPROVE" ? "okt" : "badt"}`}>{d.decision === "AUTO_APPROVE" ? t("APPROVED") : t("TO A PERSON")}</text>
                </g>
              </g>
            </g>
          ) : null}
        </g>
      );
    }
    case "duplicate": {
      const followers = Math.min(Number(d.followers) || 0, 12);
      const p50 = d.eta?.p50Hours;
      const p80 = d.eta?.p80Hours;
      const max = p80 ? p80 * 1.25 : 1;
      const xOf = (h) => 60 + (760 * h) / max;
      return (
        <g>
          <g {...A("show", 0, 0, { o: B })}>
            <path d="M40 70 H120 V96 M120 70 H150 V100" className="c-cool" {...A("fade", 0, 200)} />
            <circle cx="135" cy="118" r="7" className="f-cool" {...A("show", 0, 0, { l: "drip", ls: B })} />
          </g>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={200 + i * 22} y={140 + i * 26} width="150" height="56" rx="14" className="bubble" {...A("drop", 120 + i * 110, 260, { o: B + 240 })} />
          ))}
          <g {...A("fade", B, 200)}>
            <rect x="340" y="20" width="310" height="300" rx="26" className="c-paper" />
            <text x="362" y="90" className="t-xs">{short(d.typed || "tap leaking in B-214", 22)}</text>
            <rect x="362" y="104" width="266" height="4" className="f-warm" />
          </g>
          {d.match ? (
            <g>
              <g {...A("rise", B + 160, 220)}>
                <rect x="356" y="186" width="278" height="110" rx="12" className="f-card" />
                <text x="374" y="226" className="t-xs warm">{short(t("Known issue"), 16)}</text>
                <text x="374" y="270" className="t-s">{d.reference}</text>
              </g>
              <g {...A("pop", B + 240, 200)}>
                <rect x="670" y="140" width="210" height="90" rx="12" className="f-card" />
                <text x="684" y="198" className="t-m">{d.reference}</text>
              </g>
              {Array.from({ length: followers }, (_, i) => <circle key={i} cx={690 + (i % 6) * 32} cy={262 + Math.floor(i / 6) * 32} r="11" className="f-warm" {...A("pop", B + 300 + i * 30, 140)} />)}
              {p50 !== null && p50 !== undefined && p80 ? (
                <g>
                  <line x1="60" y1="400" x2="820" y2="400" className="c-cool ol" {...A("grow", C, 150)} />
                  <rect x={xOf(0)} y="388" width={xOf(p80) - xOf(0)} height="24" rx="6" className="f-warm ol" {...A("grow", C + 40, 160)} />
                  <line x1={xOf(p50)} y1="372" x2={xOf(p50)} y2="428" className="c-text" {...A("pop", C + 200, 120)} />
                  <text x={xOf(p50)} y="364" textAnchor="middle" className="t-xs" {...A("fade", C + 320, 120)}>P50 {hrs(p50)}</text>
                  <text x={xOf(p80)} y="364" textAnchor="end" className="t-xs" {...A("fade", C + 320, 120)}>P80 {hrs(p80)}</text>
                </g>
              ) : null}
            </g>
          ) : null}
        </g>
      );
    }
    case "safety": {
      const ids = vals(d.ids);
      const n = ids.length;
      return (
        <g>
          <g {...A("show", 0, 0, { o: B + 180 })}>
            {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="60" y={40 + i * 64} width="380" height="46" rx="8" className="f-dim" {...A("fade", i * 30, 160)} />)}
            <rect x="60" y="360" width="380" height="46" rx="8" className="f-dim" {...A("fade", 120, 160)} />
            <At x={92} y={383} {...A("fade", 160, 160, { l: "flicker", ls: B + 180 })}><g className="c-warm"><ISpark /></g></At>
          </g>
          {ok ? (
            <g>
              {ids.map((id, i) => {
                const a = Math.PI * (0.15 + (0.7 * i) / Math.max(1, n - 1));
                return (
                  <At key={id} x={660 - Math.cos(a) * 170} y={230 - Math.sin(a) * 170} {...A("pop", B + i * 30, 180)}>
                    <circle r="30" className={id === d.rule ? "f-warm" : "f-shield"} />
                    <text y="10" textAnchor="middle" className={id === d.rule ? "t-xs dark" : "t-xs"}>{id.slice(0, 2)}</text>
                  </At>
                );
              })}
              <rect x="60" y="20" width="380" height="8" rx="4" className="f-warm" {...A("move", B + 60, 220, { from: "translateY(360px)", o: C })} />
              <g {...A("move", B + 180, 240, { from: "translateY(320px)" })}>
                <rect x="60" y="40" width="380" height="46" rx="8" className="f-card" />
                <At x={92} y={63}><g className="c-warm"><ISpark /></g></At>
                <rect x="250" y="47" width="180" height="32" rx="6" className="f-bad" {...A("pop", B + 330, 150)} />
                <text x="340" y="72" textAnchor="middle" className="t-xs" {...A("pop", B + 330, 150)}>CRITICAL</text>
              </g>
              <At x={660} y={330}>
                <rect x="-26" y="-6" width="52" height="40" rx="6" className="f-warm" {...A("pop", C, 160)} />
                <path d="M-16 -6 V-20 A16 16 0 0 1 16 -20 V-6" className="c-warm" {...A("move", C + 60, 200, { from: "translateY(-16px)" })} />
              </At>
            </g>
          ) : null}
        </g>
      );
    }
    case "provenFix": {
      const f = d.fix || {};
      const has = f.low !== null && f.low !== undefined && f.high !== null && f.high !== undefined;
      const lo = has ? Math.min(f.low, 0) : 0;
      const hi = has ? Math.max(f.high, 0) : 1;
      const pad = (hi - lo) * 0.18 || 1;
      const xOf = (v) => 80 + (720 * (v - (lo - pad))) / (hi - lo + 2 * pad);
      return (
        <g>
          <g {...A("fade", 0, 200)}>
            <rect x="140" y="110" width="300" height="110" rx="12" className="ghost" {...A("fade", 450, 260)} />
            <rect x="110" y="80" width="300" height="110" rx="12" className="f-card" />
            <text x="134" y="148" className="t-s">CLOSED</text>
          </g>
          <At x={360} y={135} {...A("pop", 140, 200, { o: B + 300 })}><path d="M-14 0 L-4 11 L15 -13" className="c-ok" /></At>
          <At x={360} y={135} {...A("pop", B + 300, 160)}><path d="M-12 -12 L12 12 M12 -12 L-12 12" className="c-bad" /></At>
          <g {...A("slideR", B, 220)}>
            <rect x="480" y="60" width="260" height="62" rx="20" className="bubble warm-b" />
            <text x="500" y="102" className="t-xs">{t("Student asked: is it fixed?").split(":")[1]?.trim() || "is it fixed?"}</text>
          </g>
          <At x={800} y={120} {...A("pop", B, 200)}><g className="c-cool"><IPerson /></g></At>
          <g {...A("pop", B + 220, 160)}>
            <rect x="620" y="160" width="110" height="56" rx="18" className="f-bad" />
            <text x="675" y="198" textAnchor="middle" className="t-s">NO</text>
          </g>
          <At x={455} y={95} {...A("pop", B + 380, 160)}><g className="c-bad"><IFlag /></g></At>
          {has ? (
            <g>
              <line x1="80" y1="360" x2="800" y2="360" className="c-cool ol" {...A("grow", C, 140)} />
              <line x1={xOf(0)} y1="330" x2={xOf(0)} y2="390" className="c-cool" {...A("fade", C, 140)} />
              <rect x={xOf(f.low)} y="346" width={xOf(f.high) - xOf(f.low)} height="28" rx="8" className="f-warm ol" {...A("grow", C + 60, 160)} />
              <circle cx={xOf(f.estimate)} cy="360" r="13" className="f-text" {...A("pop", C + 220, 120)} />
              <text x={xOf(f.low)} y="420" textAnchor="middle" className="t-xs" {...A("fade", C + 340, 110)}>{f.low}</text>
              <text x={xOf(f.high)} y="420" textAnchor="middle" className="t-xs" {...A("fade", C + 340, 110)}>{f.high}</text>
              <text x={xOf(0)} y="318" textAnchor="middle" className="t-xs" {...A("fade", C + 340, 110)}>0</text>
            </g>
          ) : null}
        </g>
      );
    }
    case "classChange": {
      const c = d.change;
      const p = d.preflight;
      const n = Math.min(Number(c?.recipients) || 0, 24);
      const m = Math.min(Number(p?.students) || 0, 24);
      const edge = Math.min(Number(p?.atEdge) || 0, m);
      return (
        <g>
          <g {...A("show", 0, 0, { o: B })}>
            <At x={200} y={190} {...A("pop", 40, 240)}><g className="c-cool" transform="scale(3)"><ICal /></g></At>
            <text x="200" y="232" textAnchor="middle" className="t-l cool" {...A("fade", 200, 200, { l: "pulse", ls: B })}>?</text>
            {[[470, 90], [560, 170], [650, 70], [720, 220], [520, 300], [780, 340], [620, 380], [430, 230]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="11" className="f-cool" {...A("fade", 60 + i * 20, 200, { l: "drift", ls: B })} />)}
          </g>
          {c ? (
            <g>
              <g {...A("pop", B, 200)}><rect x="0" y="70" width="256" height="74" rx="12" className="f-card" /><text x="128" y="118" textAnchor="middle" className="t-xs">{c.reference}</text></g>
              <line x1="256" y1="107" x2="284" y2="107" className="c-warm ol" {...A("grow", B + 120, 120)} />
              <g {...A("pop", B + 200, 200)}><rect x="284" y="70" width="256" height="74" rx="12" className="f-card" /><text x="412" y="118" textAnchor="middle" className="t-xs">{c.notice || "—"}</text></g>
              <path d="M540 107 L590 30 L590 250 Z" className="fan" {...A("fade", B + 260, 160)} />
              {Array.from({ length: n }, (_, i) => <circle key={i} cx={608 + (i % 8) * 34} cy={50 + Math.floor(i / 8) * 40} r="12" className="f-warm" {...A("pop", B + 280 + i * 10, 120)} />)}
            </g>
          ) : null}
          {p ? (
            <g>
              <text x="20" y="318" className="t-xs warm" {...A("fade", C, 140)}>{t("Pre-flight, dry run")}</text>
              {Array.from({ length: m }, (_, i) => <circle key={i} cx={36 + i * 34} cy="360" r="12" className="f-cool" {...A("fade", C, 140)} />)}
              {Array.from({ length: edge }, (_, i) => <circle key={i} cx={36 + i * 34} cy="360" r="12" className="f-amber" {...A("pop", C + 150, 140)} />)}
              {p.lunchClash ? <g {...A("pop", C + 300, 140)}><rect x="560" y="390" width="300" height="52" rx="10" className="f-bad" /><text x="710" y="426" textAnchor="middle" className="t-xs">{t("LUNCH PEAK")}</text></g> : null}
            </g>
          ) : null}
        </g>
      );
    }
    case "noticeReach": {
      const f = d.funnel || {};
      const stages = [["delivered", f.delivered], ["read", f.read], ["acknowledged", f.acknowledged], ["done", f.done]];
      const rungs = [["SMS", d.ladder?.SMS], ["class rep", d.ladder?.CLASS_REP], ["kiosk", d.ladder?.KIOSK]];
      return (
        <g>
          <g {...A("show", 0, 0, { o: B })}>
            <circle cx="110" cy="110" r="64" className="c-cool" {...A("fade", 0, 200)} />
            <text x="110" y="122" textAnchor="middle" className="t-s cool" {...A("fade", 0, 200)}>02:00</text>
            <rect x="240" y="60" width="300" height="90" rx="10" className="f-dim" {...A("drop", 120, 300)} />
            <g {...A("fade", 300, 200, { l: "scroll", ls: B })}>{[0, 1, 2, 3, 4].map((i) => <rect key={i} x="240" y={170 + i * 56} width="420" height="40" rx="8" className="f-dim2" />)}</g>
          </g>
          {ok ? (
            <g>
              {stages.map(([name, v], i) => (
                <g key={name}>
                  <rect x="40" y={40 + i * 92} width={Math.max(0, (520 * (Number(v) || 0)) / 100)} height="56" rx="8" className="f-warm ol" {...A("grow", B + i * 70, 200)} />
                  <rect x="40" y={40 + i * 92} width="520" height="56" rx="8" className="c-cool" {...A("fade", B, 160)} />
                  <text x="48" y={124 + i * 92} className="t-xs" {...A("fade", C, 140)}>{t(name)} {pct(v)}</text>
                </g>
              ))}
              {rungs.map(([name, v], r) => (
                <g key={name}>
                  <rect x="620" y={30 + r * 140} width="240" height="120" rx="10" className="c-paper" {...A("fade", B, 160)} />
                  <text x="634" y={64 + r * 140} className="t-xs" {...A("fade", C, 140)}>{t(name)} {v ?? 0}</text>
                  {Array.from({ length: Math.min(Number(v) || 0, 16) }, (_, i) => <circle key={i} cx={644 + (i % 8) * 26} cy={92 + r * 140 + Math.floor(i / 8) * 24} r="9" className="f-warm" {...A("drop", B + 200 + r * 120, 160)} />)}
                </g>
              ))}
            </g>
          ) : null}
        </g>
      );
    }
    case "gatePass": {
      const roles = Object.keys(d.alerted || {});
      const ref = d.latest?.reference || "";
      const cell = (r, c) => (ref.charCodeAt((r * 7 + c) % Math.max(1, ref.length)) + r * 3 + c * 5) % 3 !== 0 || (r < 2 && c < 2) || (r < 2 && c > 4) || (r > 4 && c < 2);
      return (
        <g>
          <At x={170} y={210} {...A("fade", 0, 160, { o: 260, ok: "fly" })}><rect x="-70" y="-46" width="140" height="92" rx="4" className="c-cool" /><line x1="-50" y1="-14" x2="50" y2="-14" className="c-cool" /><line x1="-50" y1="12" x2="30" y2="12" className="c-cool" /></At>
          <At x={420} y={230} {...A("fade", 60, 200, { o: B })}><g className="c-cool"><IPhone /></g></At>
          <g>
            <text x="40" y="120" className="t-m warm" {...A("slide", B, 200)}>• • • •</text>
            <g {...A("pop", B + 80, 200)}><rect x="220" y="70" width="250" height="90" rx="12" className="f-card" /><text x="345" y="128" textAnchor="middle" className="t-s">{d.sections || "—"}</text></g>
            {Array.from({ length: 7 }, (_, r) => <g key={r} {...A("fade", B + 140 + r * 25, 120)}>{Array.from({ length: 7 }, (_, c) => (cell(r, c) ? <rect key={c} x={520 + c * 22} y={50 + r * 22} width="20" height="20" className="f-text" /> : null))}</g>)}
            <circle cx="790" cy="130" r="58" className="c-paper" {...A("fade", B, 160)} />
            <g transform="translate(790 130)"><line x1="0" y1="0" x2="0" y2="-44" className="c-warm" {...A("turn", B + 100, 320)} /></g>
            {d.latest ? <g {...A("pop", B + 320, 150)}><rect x="650" y="210" width="210" height="52" rx="10" className={d.latest.status === "OVERDUE" ? "f-bad" : "f-card"} /><text x="755" y="246" textAnchor="middle" className="t-xs">{d.latest.status}</text></g> : null}
          </g>
          {roles.length ? (
            roles.map((role, i) => {
              const Icon = ROLE_ICON[role] || IPerson;
              return (
                <g key={role}>
                  <circle cx={130 + i * 200} cy="360" r="54" className="ring" {...A("pop", C, 160)} />
                  <At x={130 + i * 200} y={360} {...A("pop", C + 80, 160)}><g className="c-warm"><Icon /></g></At>
                  <text x={130 + i * 200} y="440" textAnchor="middle" className="t-xs" {...A("fade", C + 200, 120)}>{t(ROLE_NAME[role] || role)}</text>
                </g>
              );
            })
          ) : (
            <text x="40" y="380" className="t-xs" {...A("fade", C, 160)}>{t("No overdue alert on record")}</text>
          )}
        </g>
      );
    }
    case "noSmartphone": {
      const lines = Object.entries(d.lines || {}).sort((a, b) => a[0] - b[0]).map(([, l]) => l);
      return (
        <g>
          <At x={110} y={190} {...A("fade", 0, 200)}><g className="c-cool"><IPhone /></g></At>
          {[0, 1, 2, 3].map((i) => <rect key={i} x={160 + i * 14} y={110 - i * 10} width="9" height={14 + i * 10} className={i === 0 ? "f-cool" : "c-cool"} {...A("fade", 80, 200, { o: B })} />)}
          <g transform="translate(420 160)"><circle r="40" className="c-cool dash" {...A("fade", 100, 200, { l: "spin", ls: B, o: B })} /></g>
          <At x={420} y={160} {...A("pop", 560, 160, { o: B })}><path d="M-16 -16 L16 16 M16 -16 L-16 16" className="c-bad" /></At>
          {lines.map((l, i) => {
            const right = l.from !== "STUDENT";
            return (
              <g key={i} {...A(right ? "slideR" : "slide", B + i * 110, 200)}>
                <rect x={right ? 330 : 230} y={18 + i * 66} width="530" height="54" rx="16" className={l.from === "STAFF" ? "f-staff" : right ? "f-card" : "bubble"} />
                <text x={right ? 348 : 248} y={54 + i * 66} className="t-xs">{short(l.text, 29)}</text>
              </g>
            );
          })}
          <At x={110} y={380} {...A("pop", C, 160)}><g className="c-warm"><IKiosk /></g></At>
          <g {...A("pop", C + 120, 140)}><circle cx="160" cy="340" r="16" className="f-ok" /></g>
        </g>
      );
    }
    case "adminView": {
      const rows = Math.min(Number(d.exceptions) || 0, 5);
      return (
        <g>
          <g {...A("show", 0, 0, { o: B + 200 })}>
            <g {...A("fade", 0, 200, { l: "scroll", ls: B + 200 })}>
              {Array.from({ length: 60 }, (_, i) => <rect key={i} x={40 + (i % 10) * 82} y={30 + Math.floor(i / 10) * 70} width="70" height="56" rx="6" className="f-dim" />)}
            </g>
          </g>
          {ok ? (
            <g>
              <rect x="850" y="20" width="12" height="410" rx="6" className="f-warm" {...A("move", B, 260, { from: "translateX(-810px)", o: C })} />
              {Array.from({ length: rows }, (_, i) => (
                <g key={i} {...A("slide", B + 200 + i * 50, 180)}>
                  <rect x="60" y={40 + i * 66} width="600" height="54" rx="8" className="f-card" />
                  <rect x="80" y={52 + i * 66} width="150" height="30" rx="15" className="f-amber" />
                  <text x="155" y={75 + i * 66} textAnchor="middle" className="t-xxs dark">{t("REASON")}</text>
                  <rect x="540" y={52 + i * 66} width="100" height="30" rx="15" className="c-warm" />
                  <text x="590" y={75 + i * 66} textAnchor="middle" className="t-xxs">UNDO</text>
                </g>
              ))}
              <g {...A("pop", C, 160)}><rect x="700" y="60" width="160" height="70" rx="12" className="f-bad" /><text x="780" y="106" textAnchor="middle" className="t-s">SLA</text></g>
              {d.equityGap ? <At x={780} y={210} {...A("pop", C + 100, 160)}><g className="c-amber"><IFlag /></g></At> : null}
            </g>
          ) : null}
        </g>
      );
    }
    case "ledger": {
      const icons = [IDoc, IDrop, ISpark, IFlag, ICal, IDoc, IGate, IPhone, IKiosk];
      return (
        <g>
          <line x1="40" y1="225" x2="840" y2="225" className="c-warm ol" {...A("grow", 120, 200)} />
          {icons.map((Icon, i) => (
            <At key={i} x={70 + i * 92} y={225} {...A("move", i * 18, 260, { from: `translate(${((i * 97) % 300) - 150}px, ${((i * 53) % 260) - 130}px)` })}>
              <circle r="34" className="f-card" />
              <g className="c-warm" transform={Icon === IPhone ? "scale(.5)" : "scale(.8)"}><Icon /></g>
            </At>
          ))}
        </g>
      );
    }
    default:
      return null;
  }
}

// ---- the LIVE OUTPUT card of each scene --------------------------------------------------------

function cardFor(key, scene, t) {
  const d = scene?.data || {};
  if (!scene) return null;
  if (scene.kind === "INSUFFICIENT DATA" && key !== "ledger") {
    return { big: t("Insufficient history"), line: scene.error || d.text || "", insufficient: true };
  }
  switch (key) {
    case "certificate":
      return d.decision === "AUTO_APPROVE"
        ? { big: `${t("APPROVED")} · ${d.section}`, line: `${d.passed}/${d.total} ${t("conditions")} · ${d.staffTouches} ${t("staff touches")}`, sub: t("preview · nothing filed") }
        : { big: t("TO A PERSON"), line: d.failed || `${d.passed}/${d.total} ${t("conditions")}`, sub: `${d.section || ""} · ${t("preview · nothing filed")}` };
    case "duplicate":
      if (!d.match) return { big: t("Insufficient history"), line: d.text, insufficient: true };
      return {
        big: d.reference,
        line: `${d.reports} ${t("reports")} · ${d.followers} ${t("following")} · ${d.eta?.p50Hours !== null && d.eta?.p50Hours !== undefined ? `fix P50 ${hrs(d.eta.p50Hours)} / P80 ${hrs(d.eta.p80Hours)}` : d.eta?.text || t("Insufficient history")}`,
        sub: `${t("routed to")} ${d.assignedTo}`,
        extra: d.eta?.kind && d.eta.kind !== scene.kind ? [d.eta.kind] : []
      };
    case "safety":
      return { big: d.priority, line: `rule ${d.rule} · ${t("a model can't lower it")}`, sub: `“${d.sample}” · ${d.groups} ${t("hazard groups")}` };
    case "provenFix": {
      const f = d.fix || {};
      return {
        big: `${d.flagged} / ${d.total}`,
        line: t("resolutions flagged false closure"),
        sub: f.verdict ? `${t("Did the fix work?")} ${f.reference} · ${f.verdict} · ${t("90% interval")} ${f.low} … ${f.estimate} … ${f.high} /day` : `${t("Did the fix work?")} ${f.text || ""}`,
        extra: f.kind && f.kind !== scene.kind ? [f.kind] : []
      };
    }
    case "classChange": {
      const c = d.change;
      const p = d.preflight;
      return {
        big: c ? `${c.recipients} ${t("students")}` : `${p?.atEdge ?? 0} ${t("at the 75% edge")}`,
        line: c ? `${c.reference} → ${c.notice || "—"} → ${c.recipients} ${t("students")} · ${c.projections} ${t("attendance projections")}` : "",
        sub: p ? `${t("Pre-flight, dry run")}: ${p.change} · ${p.atEdge} ${t("at the 75% edge")}${p.lunchClash ? ` · ${t("lunch-peak clash")}` : ""}` : null,
        extra: p ? [p.kind] : []
      };
    }
    case "noticeReach":
      return {
        big: `${pct(d.funnel?.read)} ${t("read")}`,
        line: `${d.reference} · ${t("delivered")} ${pct(d.funnel?.delivered)} · ${t("read")} ${pct(d.funnel?.read)} · ${t("acknowledged")} ${pct(d.funnel?.acknowledged)} · ${t("done")} ${pct(d.funnel?.done)}`,
        sub: `${d.unread} ${t("still unread, moved to")} SMS ${d.ladder?.SMS} → ${t("class rep")} ${d.ladder?.CLASS_REP} → ${t("kiosk")} ${d.ladder?.KIOSK} · ${d.digestHeld} ${t("held for the morning digest")}`
      };
    case "gatePass": {
      const roles = Object.keys(d.alerted || {});
      const l = d.latest;
      return {
        big: d.sections || "—",
        line: l ? `${t("latest pass")} ${l.reference} · ${l.status}${l.decidedBy === "POLICY" && l.section ? ` · ${t("by policy under")} ${l.section}` : ""}` : "",
        sub: roles.length ? `${t("alerted")}: ${roles.map((r) => t(ROLE_NAME[r] || r)).join(", ")}` : t("No overdue alert on record")
      };
    }
    case "noSmartphone": {
      const lines = Object.entries(d.lines || {}).sort((a, b) => a[0] - b[0]).map(([, l]) => l.text);
      return {
        big: `${d.kiosk} ${t("kiosk requests")}`,
        line: lines.length ? lines.map((x) => short(x, 40)).join(" → ") : "",
        sub: `${d.kioskOperatorRecorded} ${t("operator recorded")}${d.loop ? "" : ` · ${t("No SMS work loop on record yet — latest stored SMS shown")}`}`,
        extra: [d.smsLabel].filter(Boolean)
      };
    }
    case "adminView":
      return {
        big: `${d.exceptions} ${t("exceptions need a person")}`,
        line: `${t("touchless")} ${pct(d.touchlessPct)} · ${d.pending} ${t("pending")} · ${d.slaBreached} ${t("SLA breaches")} · ${t("equity gap")}: ${d.equityGap ? t("yes") : t("no")}`,
        sub: d.equityHeadline,
        buckets: d.buckets
      };
    default:
      return null;
  }
}

function Card({ s, scene, t, narrow }) {
  if (s.key === "intro") {
    return (
      <div className="reel-card" {...A("rise", s.card, CARD, { x: "shrink" })}>
        <div className="reel-big">NeX Camp</div>
        <div className="reel-line">{t("Team CodexFlow · BPUT Hackathon 2026 · Problem Statement 07")}</div>
        <div className="reel-sub">BH26PS07T057</div>
      </div>
    );
  }
  if (s.key === "ledger") {
    const types = Object.values(scene?.data?.types || {});
    return (
      <div className="reel-card reel-card-end" {...A("rise", s.card, CARD)}>
        <div className="reel-card-lab">{t("LIVE OUTPUT")}</div>
        {scene && scene.kind !== "INSUFFICIENT DATA" ? (
          types.map((r, i) => (
            <div key={r.label} className="reel-ledger" {...A("slide", s.card + i * 50, 200)}>
              <b>{r.label}</b>
              <span>{t("now")} {hrs(r.nowHours)} · {r.touchesNow ?? "—"} {t("touches")}</span> <Kind kind={scene.data.nowKind} />
              <span className="muted">{t("old")} {hrs(r.oldHours)} · {r.touchesOld ?? "—"} {t("touches")}</span> <Kind kind={scene.data.oldKind} />
            </div>
          ))
        ) : (
          <div className="reel-line">{t("Insufficient history")} {scene?.error || ""}</div>
        )}
        <div className="reel-close" {...A("fade", s.card + CARD, 200)}>
          <div>{t("Rules + statistics · optional LLM off · seeded DEMO DATA")}</div>
          <div className="warm">NeX Camp · Team CodexFlow · BH26PS07T057</div>
        </div>
        <div className="reel-meta"><Kind kind={scene?.kind} /> <span className="reel-src">{scene?.source || "GET /api/xo/reel"}</span></div>
      </div>
    );
  }
  const c = cardFor(s.key, scene, t);
  if (!c) return null;
  const max = c.buckets ? Math.max(1, ...Object.values(c.buckets)) : 1;
  return (
    <div className={`reel-card${c.insufficient ? " is-insuf" : ""}`} {...A("rise", s.card, CARD, { x: "shrink" })}>
      <div className="reel-card-lab">{t("LIVE OUTPUT")}</div>
      <div className="reel-big">{c.big}</div>
      {c.line ? <div className="reel-line">{c.line}</div> : null}
      {c.sub ? <div className="reel-sub">{c.sub}</div> : null}
      {c.buckets ? (
        <div className="reel-buckets">
          {Object.entries(c.buckets).map(([b, n], i) => (
            <div key={b} className="reel-bucket">
              <span className="reel-bar ol" style={{ width: `${(narrow ? 60 : 220) * (n / max)}px` }} {...A("grow", s.card + i * 30, 120)} />
              <span {...A("fade", s.card + i * 30 + 130, 80)}>{b} · {n}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="reel-meta">
        <Kind kind={scene?.kind} />
        {(c.extra || []).map((k) => <span key={k} className={`reel-kind ${KIND_CLASS[k] || (k.startsWith("SIMULATED") ? "k-sim" : "k-insuf")}`}>{k}</span>)}
        <span className="reel-src">{scene?.source}</span>
      </div>
    </div>
  );
}

// ---- the overlay ------------------------------------------------------------------------------

const fmtClock = (ms) => {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const s = Math.floor(tenths / 10);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${tenths % 10}`;
};
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function ProofReel({ user, live, lang = "EN", recording = false, loop = false, lowRender = false, onAdmin, onClose }) {
  const t = (s, n) => tr(lang, s, n);
  const staff = Boolean(user && user.role !== "STUDENT");
  const mustSignIn = live && !staff;
  const mode = lowRender ? "static" : reducedMotion() ? "reduced" : "full";
  const [state, setState] = useState({ phase: "loading" });
  const [playing, setPlaying] = useState(false);
  const [warm, setWarm] = useState(true);
  const [box, setBox] = useState({ narrow: false, scale: 1, left: 0, top: 0 });
  const frameRef = useRef(null);
  const clockRef = useRef(null);
  const dotsRef = useRef([]);
  const clock = useRef({ t: 0, playing: false, base: 0, startAt: 0, raf: 0, render: null, scene: -1 });
  const dialogRef = useRef(null);

  // Fit the 1920 × 1080 frame (or the 390 × 844 portrait frame on a phone) to the window.
  useLayoutEffect(() => {
    const fit = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const narrow = W < 720 && H > W;
      const [fw, fh] = narrow ? [390, 844] : [1920, 1080];
      const scale = Math.min(W / fw, H / fh);
      setBox({ narrow, scale, left: (W - fw * scale) / 2, top: (H - fh * scale) / 2 });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // One request before playback. Offline: the last copy this device cached, with its time — or nothing.
  const load = () => {
    setState({ phase: "loading" });
    getResilient("/api/xo/reel?lite=1")
      .then((r) => setState({ phase: "ready", reel: r.data, stale: r.stale, cachedAt: r.cachedAt }))
      .catch((error) => setState({ phase: error.status === 401 || error.status === 403 ? "signin" : "nodata", error: error.message }));
  };
  useEffect(() => {
    if (mustSignIn) return;
    load();
  }, [mustSignIn, user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (ms) => {
    const c = clock.current;
    c.t = Math.max(0, Math.min(DURATION, ms));
    c.base = c.t;
    c.startAt = performance.now();
    draw();
  };
  const play = () => {
    const c = clock.current;
    if (c.t >= DURATION) c.t = 0;
    c.base = c.t;
    c.startAt = performance.now();
    c.playing = true;
    setPlaying(true);
  };
  const pause = () => {
    clock.current.playing = false;
    setPlaying(false);
  };
  const sceneAt = (ms) => SCENES.findIndex((s) => ms >= s.start && ms < s.end);
  const draw = () => {
    const c = clock.current;
    c.render?.(c.t);
    if (clockRef.current) clockRef.current.textContent = `${fmtClock(c.t)} / 00:30`;
    const now = c.t >= DURATION ? SCENES.length - 1 : sceneAt(c.t);
    dotsRef.current.forEach((el, i) => {
      if (!el) return;
      const s = SCENES[i + 1];
      const p = c.t >= s.end ? 1 : c.t < s.start ? 0 : mode === "static" ? 1 : (c.t - s.start) / s.dur;
      el.style.transform = `scaleX(${p})`;
    });
    if (now !== c.scene) c.scene = now;
  };

  // Build the timeline once the scenes are in the DOM, then start the clock.
  useLayoutEffect(() => {
    if (state.phase !== "ready" || !frameRef.current) return undefined;
    const c = clock.current;
    c.render = buildTimeline(frameRef.current, mode, SCENES);
    c.t = 0;
    draw();
    // Warm-up, under the opaque loading cover: draw each scene's final frame once, so no scene pays for its
    // first paint while the clock runs. The 30-second clock starts only after this.
    c.warm = mode === "static" ? -1 : 0;
    if (c.warm < 0) play();
    const tick = () => {
      if (c.warm >= 0) {
        if (c.warm < SCENES.length) {
          c.render(SCENES[c.warm].hold);
          c.warm += 1;
        } else {
          c.warm = -1;
          c.t = 0;
          draw();
          setWarm(false);
          play();
        }
      } else if (c.playing) {
        c.t = Math.min(DURATION, c.base + (performance.now() - c.startAt));
        if (c.t >= DURATION) {
          if (loop) {
            c.t = 0;
            c.base = 0;
            c.startAt = performance.now();
          } else {
            c.playing = false;
            setPlaying(false);
          }
        }
        draw();
      }
      c.raf = requestAnimationFrame(tick);
    };
    c.raf = requestAnimationFrame(tick);
    // A handle for screen recording and tests: seek the master timeline to any time code.
    window.__reel = { seek, play, pause, duration: DURATION, scenes: SCENES.map(({ key, start, end, B, C, hold }) => ({ key, start, end, B, C, hold })), get t() { return c.t; }, get playing() { return c.playing; }, mode, data: state.reel, stale: Boolean(state.stale), get ready() { return c.warm < 0; } };
    return () => {
      cancelAnimationFrame(c.raf);
      c.render = null;
      if (frameRef.current) for (const a of frameRef.current.getAnimations({ subtree: true })) a.cancel();
      delete window.__reel;
    };
  }, [state.phase, state.reel, mode, box.narrow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys: Esc closes, Space pauses, ← → step scenes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") return onClose();
      if (state.phase !== "ready") return undefined;
      const c = clock.current;
      if (e.key === " ") {
        e.preventDefault();
        return c.playing ? pause() : play();
      }
      if (e.key === "ArrowRight") return step(1);
      if (e.key === "ArrowLeft") return step(-1);
      return undefined;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    dialogRef.current?.focus();
    // The app underneath is hidden while the reel is open: nothing behind it animates or renders.
    document.documentElement.classList.add("reel-open");
    return () => {
      document.documentElement.classList.remove("reel-open");
      window.dispatchEvent(new Event("resize")); // the app's canvas re-measures itself
    };
  }, []);
  const step = (dir) => {
    const c = clock.current;
    const i = c.t >= DURATION ? SCENES.length - 1 : sceneAt(c.t);
    const cur = SCENES[i];
    const target = dir > 0 ? SCENES[Math.min(SCENES.length - 1, i + 1)].start : c.t - cur.start > 600 ? cur.start : SCENES[Math.max(0, i - 1)].start;
    seek(target);
  };

  const byKey = Object.fromEntries((state.reel?.scenes || []).map((s) => [s.key, s]));
  const narrow = box.narrow;
  return (
    <div ref={dialogRef} tabIndex={-1} className={`reel reel--${mode}${recording ? " reel--rec" : ""}`} role="dialog" aria-modal="true" aria-label={t("30-SECOND PROOF")} lang={lang === "ଓଡ଼ିଆ" ? "or" : lang === "हिन्दी" ? "hi" : "en"}>
      <div ref={frameRef} className={`reel-frame${narrow ? " reel-frame--narrow" : ""}`} style={{ transform: `translate(${box.left}px, ${box.top}px) scale(${box.scale})` }}>
        <div className="reel-head">
          <span className="reel-title">{t("30-SECOND PROOF")}</span>
          {state.stale ? <span className="reel-stale">{t("Cached copy from")} {new Date(state.cachedAt).toLocaleString("en-IN", { hour12: false })}</span> : null}
          <span ref={clockRef} className="reel-clock" aria-hidden="true">00:00.0 / 00:30</span>
        </div>
        {mustSignIn || state.phase === "signin" ? (
          <div className="reel-msg">
            <p>{t("Every scene reads staff views. Sign in as the admin account (control@bput.ac.in) to play it.")}</p>
            <button type="button" className="reel-btn reel-btn-main" onClick={onAdmin}>{t("SIGN IN AS THE ADMIN")}</button>
          </div>
        ) : state.phase === "loading" ? (
          <div className="reel-msg" aria-live="polite">
            <p>{t("Reading the live database…")}</p>
            <div className="reel-progress"><span /></div>
          </div>
        ) : state.phase === "nodata" ? (
          <div className="reel-msg" role="alert">
            <p className="reel-big">{t("No data cached")}</p>
            <p>{t("The server could not be reached and this device holds no earlier copy of the reel.")}</p>
            <button type="button" className="reel-btn reel-btn-main" onClick={load}>{t("RETRY")}</button>
          </div>
        ) : (
          SCENES.map((s) => (
            <section key={s.key} className={`reel-layer reel-${s.key}`} data-reel-layer={s.i} style={mode === "static" ? { visibility: "hidden" } : { opacity: 0 }}>
              <div className="reel-rows" {...A("show", 0, 0, { x: "out" })}>
                {s.problem ? (
                  <div className="reel-row r1" {...A("slide", 40, 380)}>
                    <span className="reel-lab">{t("PROBLEM")}</span>
                    <p>{t(s.problem)}</p>
                  </div>
                ) : null}
                <div className="reel-row r2" {...A("slide", s.B, 300)}>
                  <span className="reel-lab">{t("MECHANISM")}</span>
                  <p>{t(s.mechanism, byKey.safety?.data?.groups ?? "—")}</p>
                </div>
              </div>
              <div className="reel-stage" {...A("show", 0, 0, { x: "out" })}>
                <svg viewBox="0 0 880 450" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <Stage s={s} scene={byKey[s.key]} t={t} />
                </svg>
              </div>
              {s.chip ? <span className="reel-chip" {...A("pop", s.C, 220, { x: "out" })}>{t(s.chip)}</span> : null}
              <Card s={s} scene={byKey[s.key]} t={t} narrow={narrow} />
            </section>
          ))
        )}
        {state.phase === "ready" && warm && mode !== "static" ? (
          <div className="reel-cover" aria-live="polite">
            <div className="reel-msg">
              <p>{t("Reading the live database…")}</p>
              <div className="reel-progress"><span /></div>
            </div>
          </div>
        ) : null}
        <div className="reel-dots" aria-hidden="true">
          {SCENES.slice(1).map((s, i) => (
            <span key={s.key} className="reel-dot"><i ref={(el) => (dotsRef.current[i] = el)} /></span>
          ))}
        </div>
        <div className="reel-ctl">
          {state.phase === "ready" ? (
            <>
              <button type="button" className="reel-btn" onClick={() => step(-1)} aria-label={t("BACK")}>← {t("BACK")}</button>
              <button type="button" className="reel-btn reel-btn-main" onClick={() => (playing ? pause() : play())}>{playing ? t("PAUSE") : t("PLAY")}</button>
              <button type="button" className="reel-btn" onClick={() => step(1)} aria-label={t("NEXT")}>{t("NEXT")} →</button>
              <button type="button" className="reel-btn" onClick={() => { seek(0); play(); }}>{t("REPLAY")}</button>
            </>
          ) : null}
          <button type="button" className="reel-btn" onClick={onClose}>{t("CLOSE")}</button>
        </div>
      </div>
    </div>
  );
}
