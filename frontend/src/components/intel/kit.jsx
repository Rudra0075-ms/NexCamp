import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api.js";

/*
 * Shared building blocks for the three intelligence surfaces (Student
 * Dashboard, Attendance, Mess). Everything here renders what the backend
 * computed; nothing in this file produces a number of its own except the
 * geometry of a chart.
 */

// ---- data ---------------------------------------------------------------------

// One cache for every intelligence read, keyed by the request, so moving between
// the dashboard and the pages never refetches the same thing twice in a row.
const cache = new Map();
const TTL = 20000;

export function invalidate(prefix = "") {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}

/**
 * A GET with loading / error state. Keeps showing the previous data while a
 * new key loads, so filters change the picture without a blank flash.
 */
export function useApi(key, fetcher, { enabled = true } = {}) {
  const [state, setState] = useState(() => {
    const hit = cache.get(key);
    return { data: hit?.data ?? null, loading: enabled && !hit?.data, error: null };
  });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false }));
      return undefined;
    }
    let alive = true;
    const hit = cache.get(key);
    if (hit?.data && Date.now() - hit.at < TTL) {
      setState({ data: hit.data, loading: false, error: null });
      return undefined;
    }
    setState((prev) => ({ data: prev.data ?? hit?.data ?? null, loading: true, error: null }));
    const pending = hit?.promise || fetcherRef.current();
    cache.set(key, { ...(hit || {}), promise: pending });
    pending
      .then((data) => {
        cache.set(key, { at: Date.now(), data });
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        cache.delete(key);
        if (alive) setState((prev) => ({ data: prev.data, loading: false, error }));
      });
    return () => {
      alive = false;
    };
  }, [key, enabled, nonce]);

  const reload = useCallback(() => {
    cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);
  return { ...state, reload };
}

/** Calls `fn` `wait` ms after the inputs stop changing. */
export function useDebounced(value, wait = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), wait);
    return () => clearTimeout(t);
  }, [JSON.stringify(value), wait]); // eslint-disable-line react-hooks/exhaustive-deps
  return debounced;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return undefined;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

function useWidth(ref, fallback = 640) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const measure = () => ref.current && setWidth(Math.max(240, Math.round(ref.current.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// ---- formatting ---------------------------------------------------------------

export const fmtPct = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${Number(v).toFixed(d).replace(/\.0$/, "")}%`);
export const fmtNum = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("en-IN"));
const ACRONYMS = new Set(["DBMS", "OS", "AI"]);
export const title = (value) =>
  String(value || "")
    .split(/(\s+)/)
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())))
    .join("");
export const signed = (v, d = 1) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Number(v)).toFixed(d).replace(/\.0$/, "")}`);

// ---- labels ---------------------------------------------------------------------

const TAG_CLASS = {
  "AI ANALYSIS": "ai", "AI PREDICTION": "ai", "AI RECOMMENDATION": "ai", "AI INSIGHT": "ai", "AI CLASSIFICATION": "ai",
  "AI DETECTED PATTERN": "ai", "AI CONFIDENCE": "ai", "AI SIMULATION": "ai",
  EVIDENCE: "ev", "CAMPUS MEMORY": "ev", "RECOMMENDED ACTION": "ev", "AI HYPOTHESIS": "ai", ESTIMATED: "proj",
  "ACTUAL DATA": "data", "CURRENT DATA": "data", "CURRENT STATUS": "data", RECORDED: "data",
  "SIMULATED RESULT": "sim", SIMULATED: "sim",
  "PROJECTED STATUS": "proj", PROJECTED: "proj", PREDICTION: "proj",
  "INSUFFICIENT DATA": "muted", "NOT UNDERSTOOD": "muted", OFFLINE: "muted",
  SAFE: "ok", LOW: "ok", STABLE: "muted", IMPROVING: "ok", "NORMAL DEMAND": "muted", "DEMAND STEADY": "muted",
  WATCH: "warn", MEDIUM: "warn", IRREGULAR: "warn", "LOW DEMAND": "warn", "WASTE RISK": "warn", "DEMAND FALLING": "warn",
  "RATINGS IMPROVING": "ok", "RATINGS DECLINING": "bad", "AT RISK": "bad", HIGH: "bad", CRITICAL: "bad", DECLINING: "bad", "HIGH DEMAND": "bad", "FEEDBACK ALERT": "bad", "DEMAND RISING": "warn"
};

export function Tag({ kind, children, title: tip }) {
  const label = children ?? kind;
  const cls = TAG_CLASS[String(kind || label).toUpperCase()] || "muted";
  return (
    <span className={`ci-tag ci-tag-${cls}`} title={tip}>
      {label}
    </span>
  );
}

export function Confidence({ value, basis, label = "AI CONFIDENCE" }) {
  if (value === null || value === undefined) {
    return basis ? <span className="ci-meta" title={basis}>{basis.split(".")[0]}</span> : null;
  }
  const on = Math.round(value / 10);
  return (
    <span className="ci-conf" title={basis || undefined} aria-label={`${label} ${value}%`}>
      <span className="ci-label" style={{ color: "var(--ci-ai)" }}>{label}</span>
      <span className="ci-conf-bars" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < on ? "on" : ""} />)}
      </span>
      {Math.round(value)}%
    </span>
  );
}

/** Who wrote the words: the rules, or a named model. Never implies a model that did not run. */
export function Provenance({ provenance, method }) {
  if (!provenance && !method) return null;
  const src = provenance?.source;
  const who = src === "AI_MODEL"
    ? `MODEL · ${provenance.provider}/${provenance.model}`
    : src === "AI_NOT_CONFIGURED" ? "RULE-BASED · NO AI PROVIDER CONFIGURED"
    : src === "DETERMINISTIC_FALLBACK" ? "RULE-BASED · AI PROVIDER UNAVAILABLE"
    : "RULE-BASED";
  return (
    <div className="ci-prov">
      <b>{who}</b>
      {method ? <span>· {method}</span> : null}
      {provenance?.note ? <span>· {provenance.note}</span> : null}
    </div>
  );
}

// ---- numbers ---------------------------------------------------------------------

/** A number that tweens to its new value, so a change reads as a change. */
export function AnimatedNumber({ value, decimals = 1, suffix = "", prefix = "" }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      setShown(value);
      return undefined;
    }
    const start = Number(from.current ?? value);
    const end = Number(value);
    if (reduced || start === end) {
      setShown(end);
      from.current = end;
      return undefined;
    }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 420);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(start + (end - start) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  if (shown === null || shown === undefined || Number.isNaN(Number(shown))) return <span>—</span>;
  const text = Number(shown).toFixed(decimals).replace(decimals > 0 ? /\.0+$/ : /$^/, "");
  return <span className="ci-num">{prefix}{decimals === 0 ? Number(text).toLocaleString("en-IN") : text}{suffix}</span>;
}

// ---- states ------------------------------------------------------------------------

export function Skeleton({ lines = 3, height = 14 }) {
  return (
    <div aria-hidden="true" style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="ci-skel" style={{ height, width: `${92 - i * 14}%` }} />)}
    </div>
  );
}

const DEFAULT_STEPS = ["Reading your records", "Finding patterns", "Comparing with history", "Preparing the analysis"];

/** Shown only while a real request is in flight; it never delays a result. */
export function Analyzing({ steps = DEFAULT_STEPS, label = "Analysing" }) {
  const reduced = useReducedMotion();
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (reduced) return undefined;
    const t = setInterval(() => setAt((i) => Math.min(steps.length - 1, i + 1)), 380);
    return () => clearInterval(t);
  }, [steps.length, reduced]);
  return (
    <div className="ci-steps" role="status" aria-live="polite" aria-label={label}>
      {steps.map((step, i) => (
        <div key={step} className={`ci-step ${i < at ? "done" : i === at ? "now" : ""}`}>
          <i />
          {step}…
        </div>
      ))}
    </div>
  );
}

export function StateBox({ kind = "empty", title: heading, children, onRetry }) {
  return (
    <div className={`ci-state ${kind === "error" ? "ci-state-err" : ""}`} role={kind === "error" ? "alert" : "status"}>
      <div className="ci-state-title">{heading}</div>
      {children ? <div className="ci-body">{children}</div> : null}
      {onRetry ? <button type="button" className="ci-link ci-link-ink" style={{ justifySelf: "start" }} onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

/** The one place that decides which state a data section is in. */
export function Section({ q, live, needsAuth = false, signedIn = true, loadingSteps, children, lines = 4 }) {
  if (!live) {
    return (
      <StateBox kind="offline" title="Backend offline">
        This analysis is computed by the NeX Camp API from real records. It is not reachable right now, so
        nothing is shown rather than invented numbers.
      </StateBox>
    );
  }
  if (needsAuth && !signedIn) return <StateBox title="Sign in to see your analysis">This section reads your own records.</StateBox>;
  if (q.error && !q.data) {
    return (
      <StateBox kind="error" title="Could not load the analysis" onRetry={q.reload}>
        {q.error.message || "The request failed."}
      </StateBox>
    );
  }
  if (!q.data) return loadingSteps ? <Analyzing steps={loadingSteps} /> : <Skeleton lines={lines} />;
  return (
    <div style={{ opacity: q.loading ? 0.6 : 1, transition: "opacity .25s" }} aria-busy={q.loading || undefined}>
      {children(q.data)}
    </div>
  );
}

/**
 * Keeps a failure inside one section. Without it, any runtime error while
 * rendering unmounts the whole app and the site goes blank; with it, only
 * the affected section shows an error and everything else keeps working.
 */
export class Guard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(`[nex-camp] ${this.props.name || "section"} failed to render`, error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="ci-section">
        <StateBox kind="error" title={`${this.props.name || "This section"} could not be shown`} onRetry={() => this.setState({ error: null })}>
          {String(this.state.error?.message || this.state.error)} — the rest of the page still works.
        </StateBox>
      </div>
    );
  }
}

// ---- drawer ---------------------------------------------------------------------

export function Drawer({ open, onClose, heading, kicker = "AI EVIDENCE", children }) {
  const closeRef = useRef(null);
  const headingId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  // Rendered into #ci-portal (inside the app root, so the translator still
  // reaches it) because an animated ancestor with a transform would otherwise
  // trap position: fixed and clip the drawer to its section.
  const target = typeof document !== "undefined" ? document.getElementById("ci-portal") : null;
  const drawer = (
    <>
      <div className="ci-scrim" onClick={onClose} />
      <aside className="ci-drawer" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <div className="ci-drawer-head">
          <div>
            <Tag kind="EVIDENCE">{kicker}</Tag>
            <h2 id={headingId} className="ci-h2" style={{ marginTop: 8 }}>{heading}</h2>
          </div>
          <button type="button" ref={closeRef} className="ci-drawer-close" onClick={onClose} aria-label="Close evidence">×</button>
        </div>
        <div className="ci-drawer-body">{children}</div>
      </aside>
    </>
  );
  return target ? createPortal(drawer, target) : drawer;
}

/** The standard evidence layout: data considered, detected pattern, reasoning, confidence. */
export function Evidence({ dataConsidered = [], pattern, reasons = [], rule, confidence, basis, rows = [], method, extra }) {
  return (
    <>
      {dataConsidered.length ? (
        <div>
          <div className="ci-label" style={{ marginBottom: 8 }}>Data considered</div>
          <ul className="ci-ev-list">{dataConsidered.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      ) : null}
      {pattern ? (
        <div>
          <div className="ci-label" style={{ marginBottom: 6 }}>Detected pattern</div>
          <Tag kind={pattern}>{pattern}</Tag>
        </div>
      ) : null}
      {reasons.length ? (
        <div>
          <div className="ci-label" style={{ marginBottom: 8 }}>Reasoning factors</div>
          <ul className="ci-points">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      ) : null}
      {rows.length ? (
        <div>
          <div className="ci-label" style={{ marginBottom: 8 }}>Records behind it</div>
          <div className="ci-kv">{rows.flatMap((r, i) => [<span key={`k${i}`}>{r.label}</span>, <span key={`v${i}`}>{r.value}</span>])}</div>
        </div>
      ) : null}
      {extra}
      {confidence !== undefined || basis ? (
        <div>
          <div className="ci-label" style={{ marginBottom: 8 }}>Confidence</div>
          {confidence !== null && confidence !== undefined ? <Confidence value={confidence} /> : <span className="ci-meta">Not an estimate — exact arithmetic.</span>}
          {basis ? <p className="ci-meta" style={{ marginTop: 6, lineHeight: 1.5 }}>{basis}</p> : null}
        </div>
      ) : null}
      {rule ? (
        <div>
          <div className="ci-label" style={{ marginBottom: 6 }}>Rule applied</div>
          <p className="ci-meta" style={{ lineHeight: 1.55 }}>{rule}</p>
        </div>
      ) : null}
      {method ? <div className="ci-meta">Method · {method}</div> : null}
    </>
  );
}

// ---- charts -------------------------------------------------------------------------

/**
 * Line chart over categorical x. `series` values align with `labels` and may be
 * null. Hovering or focusing shows every series at that point.
 */
export function LineChart({ labels = [], series = [], height = 220, yMin, yMax, threshold, thresholdLabel, format = (v) => fmtPct(v), markers = [], bands = [], ariaLabel }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState(null);
  const values = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
  const lo = yMin ?? Math.floor(Math.min(...values, threshold ?? Infinity) - 4);
  const hi = yMax ?? Math.ceil(Math.max(...values, threshold ?? -Infinity) + 4);
  const L = 36;
  const R = 12;
  const T = 12;
  const B = 24;
  const n = Math.max(1, labels.length - 1);
  const x = (i) => L + (i / n) * (width - L - R);
  const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (height - T - B);
  const ticks = useMemo(() => {
    const step = (hi - lo) / 4;
    return Array.from({ length: 5 }, (_, i) => lo + i * step);
  }, [lo, hi]);
  const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(width / 70))));

  const pathFor = (vals) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || v === undefined) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - L) / (width - L - R)) * n);
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };

  if (!values.length) return <StateBox title="No data to chart">Nothing is recorded for this selection.</StateBox>;

  return (
    <div className="ci-chart" ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel || "Line chart"}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={width - R} y1={y(t)} y2={y(t)} stroke="var(--color-neutral-200)" />
            <text x={0} y={y(t) + 3}>{format(t)}</text>
          </g>
        ))}
        {bands.map((b) => (
          <rect key={b.label} x={x(b.from)} y={T} width={Math.max(2, x(b.to) - x(b.from))} height={height - T - B} fill={b.color || "var(--color-accent)"} opacity=".07" />
        ))}
        {threshold !== undefined && threshold !== null ? (
          <g>
            <rect x={L} y={y(threshold)} width={width - L - R} height={Math.max(0, height - B - y(threshold))} fill="var(--color-accent)" opacity=".05" />
            <line x1={L} x2={width - R} y1={y(threshold)} y2={y(threshold)} stroke="var(--color-accent)" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={L + 4} y={y(threshold) - 5} style={{ fill: "var(--color-accent-700)", fontWeight: 700 }}>{thresholdLabel || `${threshold}% REQUIRED`}</text>
          </g>
        ) : null}
        {series.map((s) => (
          <path key={s.id || s.label} d={pathFor(s.values)} className="ci-line" stroke={s.color || "var(--color-text)"} strokeDasharray={s.dash || undefined} />
        ))}
        {series.map((s) => s.values.map((v, i) => (v !== null && v !== undefined && (s.dots || i === s.values.length - 1) ? (
          <circle key={`${s.label}-${i}`} cx={x(i)} cy={y(v)} r={i === s.values.length - 1 ? 4 : 2.5} fill={s.color || "var(--color-text)"} />
        ) : null)))}
        {markers.map((m) => (
          <g key={`${m.index}-${m.label}`}>
            <line x1={x(m.index)} x2={x(m.index)} y1={T} y2={height - B} stroke={m.color || "var(--color-text)"} strokeDasharray="2 3" />
            <text x={x(m.index) + 4} y={T + 10} style={{ fill: m.color || "var(--color-text)", fontWeight: 700 }}>{m.label}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % labelEvery === 0 || i === labels.length - 1 ? (
          <text key={`x${i}`} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}>{l}</text>
        ) : null))}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={T} y2={height - B} stroke="var(--color-text)" strokeWidth=".8" /> : null}
      </svg>
      {hover !== null ? (
        <div className="ci-tip" style={{ left: x(hover), top: Math.min(...series.map((s) => (s.values[hover] ?? null) === null ? height : y(s.values[hover]))) }}>
          <div style={{ opacity: 0.7 }}>{labels[hover]}</div>
          {series.map((s) => (s.values[hover] !== null && s.values[hover] !== undefined ? <div key={s.label}>{s.label}: <b>{format(s.values[hover])}</b></div> : null))}
        </div>
      ) : null}
      <table className="ci-sr">
        <caption>{ariaLabel}</caption>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l + i}><th>{l}</th>{series.map((s) => <td key={s.label}>{s.label} {s.values[i] === null || s.values[i] === undefined ? "—" : format(s.values[i])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal bars with an optional threshold tick. */
export function BarList({ data = [], max, unit = "", threshold, format }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value || 0));
  const show = format || ((v) => `${fmtNum(Math.round(v * 10) / 10)}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) minmax(0, 1fr) 72px", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: d.highlight ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.label}>{d.label}</span>
          <div className="ci-bar" role="presentation">
            <i style={{ width: `${Math.max(0, Math.min(100, ((d.value || 0) / top) * 100))}%`, background: d.highlight ? "var(--color-accent)" : d.color || "var(--color-neutral-600)" }} />
            {threshold !== undefined ? <b style={{ left: `${(threshold / top) * 100}%` }} /> : null}
          </div>
          <span className="ci-num" style={{ fontSize: 12, fontWeight: 700, textAlign: "right" }}>{show(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical columns — for weekday or slot patterns. */
export function Columns({ data = [], height = 150, unit = "", threshold, format }) {
  const top = Math.max(1, ...data.map((d) => d.value || 0), threshold || 0);
  const show = format || ((v) => (v === null || v === undefined ? "—" : `${fmtNum(v)}${unit === "%" ? "%" : ""}`));
  return (
    <div role="img" aria-label={data.map((d) => `${d.label} ${show(d.value)}`).join(", ")}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, borderBottom: "2px solid var(--ci-line)", position: "relative" }}>
        {threshold !== undefined ? <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(threshold / top) * 100}%`, borderTop: "1.5px dashed var(--color-accent)" }} /> : null}
        {data.map((d) => (
          <div key={d.label} style={{ flex: 1, minWidth: 0, display: "grid", alignContent: "end", gap: 4, height: "100%" }} title={`${d.label}: ${show(d.value)}`}>
            <span className="ci-num" style={{ fontSize: 10, textAlign: "center", color: "var(--color-neutral-700)" }}>{show(d.value)}</span>
            <div style={{ height: `${d.value ? Math.max(2, (d.value / top) * (height - 22)) : 0}px`, background: d.highlight ? "var(--color-accent)" : d.color || "var(--color-neutral-400)", transition: "height .5s var(--ci-ease)" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {data.map((d) => <span key={d.label} style={{ flex: 1, minWidth: 0, fontSize: 10, textAlign: "center", letterSpacing: ".04em", color: d.highlight ? "var(--color-text)" : "var(--color-neutral-700)", fontWeight: d.highlight ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>)}
      </div>
    </div>
  );
}

export function Sparkline({ values = [], width = 120, height = 36, color = "var(--color-text)" }) {
  const clean = values.filter((v) => v !== null && v !== undefined);
  if (clean.length < 2) return null;
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const px = (i) => 1 + (i / (clean.length - 1)) * (width - 2);
  const py = (v) => height - 2 - ((v - lo) / Math.max(0.001, hi - lo)) * (height - 4);
  const d = clean.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
      <circle cx={px(clean.length - 1)} cy={py(clean[clean.length - 1])} r="2.8" fill={color} />
    </svg>
  );
}

/** Renders the visualisation spec the query endpoint returns. */
export function Viz({ spec }) {
  if (!spec) return null;
  const data = (spec.data || []).filter((d) => d.value !== null && d.value !== undefined);
  return (
    <div>
      <div className="ci-label" style={{ marginBottom: 10 }}>{spec.title}</div>
      {spec.type === "line" ? (
        <LineChart labels={data.map((d) => d.label)} series={[{ label: title(spec.unit || "value"), values: data.map((d) => d.value), color: "var(--ci-ai)" }]} height={170} format={(v) => fmtNum(Math.round(v))} ariaLabel={spec.title} />
      ) : spec.type === "compare" ? (
        <BarList data={data} unit={spec.threshold !== undefined ? "%" : ""} threshold={spec.threshold} max={spec.threshold !== undefined ? 100 : undefined} />
      ) : (
        <BarList data={data} unit={spec.unit} threshold={spec.threshold} max={spec.unit === "%" ? 100 : undefined} />
      )}
    </div>
  );
}

// ---- the question box ----------------------------------------------------------------

const ASK_STEPS = ["Understanding the question", "Finding the relevant data", "Analysing your records", "Preparing the answer"];

/**
 * Ask your campus data anything. The answer, the evidence and the next action
 * all come from POST /api/students/me/query.
 */
export function AskBox({ domain = null, suggestions = [], placeholder = "Ask your campus data anything…", live, signedIn, onNavigate, heading = "Ask your campus data" }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [evidence, setEvidence] = useState(false);
  const inputId = useId();

  const ask = async (text) => {
    const q = String(text ?? question).trim();
    if (!q) {
      setError("Type a question first.");
      return;
    }
    if (q.length > 300) {
      setError("Keep the question under 300 characters.");
      return;
    }
    setQuestion(q);
    if (!live) {
      setError("The NeX Camp API is offline, so there is no data to answer from.");
      return;
    }
    if (!signedIn) {
      setError("Sign in to ask about your own records.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.studentQuery(q, domain));
    } catch (e) {
      setError(e.status === 429 ? "Too many questions in a minute — wait a moment." : e.message || "The question could not be answered.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="ci-row ci-between" style={{ marginBottom: 10 }}>
        <Tag kind="AI ANALYSIS">{heading}</Tag>
        <span className="ci-meta">Answers come from your records — each one shows its evidence</span>
      </div>
      <form className="ci-ask" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <label htmlFor={inputId} className="ci-sr">{heading}</label>
        <span className="ci-ask-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 14 14"><path d="M1 7h2l1.5-4 3 8L9 7h4" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        </span>
        <input id={inputId} value={question} maxLength={300} onChange={(e) => { setQuestion(e.target.value); setError(null); }} placeholder={placeholder} autoComplete="off" />
        <button type="submit" disabled={busy}>{busy ? "ANALYSING…" : "ASK"}</button>
      </form>
      {suggestions.length ? (
        <div className="ci-suggest">
          <span className="ci-label">Try</span>
          {suggestions.map((s) => <button type="button" key={s} className="ci-chip" onClick={() => ask(s)} disabled={busy}>{s}</button>)}
        </div>
      ) : null}
      {error ? <div role="alert" className="ci-meta" style={{ color: "var(--color-accent-700)", fontWeight: 700, marginTop: 10 }}>{error}</div> : null}
      {busy ? <div className="ci-answer"><Analyzing steps={ASK_STEPS} label="Answering your question" /></div> : null}
      {!busy && result ? <Answer result={result} onNavigate={onNavigate} onAsk={ask} onEvidence={() => setEvidence(true)} /> : null}
      <Drawer open={evidence && !!result} onClose={() => setEvidence(false)} heading={result?.question || ""}>
        {result ? (
          <Evidence
            dataConsidered={result.evidence?.dataConsidered || []}
            rows={result.evidence?.rows || []}
            reasons={result.points || []}
            confidence={result.confidence}
            basis={result.confidenceBasis}
            method={`${result.intent} · intent by ${result.intentSource === "AI_MODEL" ? "model" : "rules"} (${result.intentConfidence}%) · ${result.method}`}
            extra={result.provenance ? <Provenance provenance={result.provenance} /> : null}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function Answer({ result, onNavigate, onAsk, onEvidence }) {
  const r = result;
  return (
    <div className="ci-answer" aria-live="polite">
      <div className="ci-answer-head">
        <span className="ci-label">You asked</span>
        <b style={{ fontSize: 14 }}>{r.question}</b>
        <span style={{ flex: 1 }} />
        <Tag kind={r.kind}>{r.kind}</Tag>
        {r.domain && r.domain !== "GENERAL" ? <Tag kind="ACTUAL DATA">{r.domain}</Tag> : null}
      </div>
      <div className="ci-answer-body">
        <div>
          <div className={r.insufficient ? "" : r.kind === "SIMULATED RESULT" ? "ci-sim-block" : "ci-ai-block"}>
            <span className="ci-label" style={{ color: r.insufficient ? undefined : r.kind === "SIMULATED RESULT" ? "var(--color-accent-700)" : "var(--ci-ai)" }}>{r.insufficient ? "Answer" : r.kind}</span>
            <p className="ci-answer-text">{r.answer}</p>
            {r.points?.length ? <ul className="ci-points">{r.points.map((p) => <li key={p}>{p}</li>)}</ul> : null}
          </div>
          {r.recommendation ? <div className="ci-rec"><span className="ci-label" style={{ display: "block", marginBottom: 4, color: "var(--color-accent-700)" }}>AI recommendation</span>{r.recommendation}</div> : null}
          {r.suggestions?.length && r.insufficient ? (
            <div className="ci-suggest">{r.suggestions.map((s) => <button type="button" key={s} className="ci-chip" onClick={() => onAsk(s)}>{s}</button>)}</div>
          ) : null}
          <div className="ci-row" style={{ marginTop: 14, gap: 14 }}>
            {r.action && onNavigate ? (
              <button type="button" className="btn btn-primary" style={{ fontSize: 11, letterSpacing: ".1em", padding: "10px 14px" }} onClick={() => onNavigate(r.action.page, r.action.focus)}>
                {r.action.label} →
              </button>
            ) : null}
            {!r.insufficient ? <button type="button" className="ci-link" onClick={onEvidence}>View evidence</button> : null}
          </div>
          <Provenance provenance={r.provenance} />
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {r.visualization ? <Viz spec={r.visualization} /> : null}
          {r.confidence !== undefined ? <Confidence value={r.confidence} basis={r.confidenceBasis} /> : null}
        </div>
      </div>
    </div>
  );
}
