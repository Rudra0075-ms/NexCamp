import React, { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton, StateBox, Tag } from "../components/intel/kit.jsx";
import { isOnline, queueSize, syncQueue } from "../lib/api.js";

/*
 * Shared pieces for the extension surfaces (13–21). Visual language comes from
 * the existing intel kit and modernist tokens; these helpers only add the
 * behaviour the new pages need: stale-copy reads, queued writes, provenance
 * labels, IST dates.
 */

// ---- data ---------------------------------------------------------------------

/**
 * Reads through ext/api.js (getResilient underneath). Keeps the last payload
 * while reloading, and exposes whether it is a stale offline copy.
 */
export function useExt(key, fetcher, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, stale: false, cachedAt: null, error: null, loading: enabled });
  const [nonce, setNonce] = useState(0);
  const ref = useRef(fetcher);
  ref.current = fetcher;
  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    ref
      .current()
      .then((res) => {
        if (!alive) return;
        const wrapped = res && typeof res === "object" && "stale" in res && "data" in res;
        setState({ data: wrapped ? res.data : res, stale: wrapped ? res.stale : false, cachedAt: wrapped ? res.cachedAt : Date.now(), error: null, loading: false });
      })
      .catch((error) => alive && setState((s) => ({ ...s, error, loading: false })));
    return () => {
      alive = false;
    };
  }, [key, enabled, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

/** Renders loading / error / stale states around a read. */
export function ExtSection({ q, lines = 4, emptyTitle, children }) {
  if (q.data) {
    // __cachedAt is set by the service worker when it answered from its cache.
    const swCopy = q.data && typeof q.data === "object" ? q.data.__cachedAt : null;
    return (
      <div style={{ opacity: q.loading ? 0.65 : 1, transition: "opacity .25s" }} aria-busy={q.loading || undefined}>
        {q.stale || swCopy ? <StaleNote at={swCopy || q.cachedAt} /> : null}
        {children(q.data)}
      </div>
    );
  }
  if (q.error) {
    const offline = q.error.status === 0;
    return (
      <StateBox kind={offline ? "offline" : "error"} title={offline ? "Offline — nothing cached yet" : q.error.status === 403 ? "Not available for this account" : "Could not load"} onRetry={q.reload}>
        {offline ? "This view has not been opened on this device while online, so there is no copy to show. Nothing is invented in its place." : q.error.message}
      </StateBox>
    );
  }
  if (q.loading) return <Skeleton lines={lines} />;
  return <StateBox title={emptyTitle || "Nothing to show"} />;
}

export function StaleNote({ at }) {
  return (
    <div className="ext-stale" role="status">
      <Tag kind="OFFLINE">CACHED COPY</Tag>
      <span>Shown from this device's last good copy{at ? ` (${dt(at)})` : ""} because the network request failed.</span>
    </div>
  );
}

/** The honest outcome of a write: done, queued offline, or refused. */
export function Outcome({ result }) {
  if (!result) return null;
  const cls = result.error ? "ci-result ci-result-err" : result.queued ? "ci-result ci-result-warn" : "ci-result";
  return (
    <div className={cls} role="status">
      {result.error || (result.queued ? "No connection — held on this device and sent automatically when the connection returns." : result.text)}
    </div>
  );
}

/** Runs a write and turns every outcome into an Outcome value. */
export async function attempt(fn, okText) {
  try {
    const res = await fn();
    if (res?.queued) return { queued: true };
    return { text: typeof okText === "function" ? okText(res?.data ?? res) : okText, data: res?.data ?? res };
  } catch (error) {
    return { error: error.message || "Request failed", details: error.details };
  }
}

// ---- labels -----------------------------------------------------------------------

const KIND_STYLE = {
  "ACTUAL DATA": "ACTUAL DATA",
  "BASELINE ESTIMATE": "PROJECTED",
  ESTIMATE: "ESTIMATED",
  SIMULATED: "SIMULATED",
  "MEASURED IN THIS DEMO": "ACTUAL DATA",
  EVIDENCE: "EVIDENCE",
  "RECOMMENDED ACTION": "RECOMMENDED ACTION",
  "AI PREDICTION": "AI PREDICTION",
  "AI HYPOTHESIS": "AI HYPOTHESIS",
  "INSUFFICIENT DATA": "INSUFFICIENT DATA"
};

/** A provenance chip. The label is always the API's own claim kind. */
export function Kind({ kind }) {
  if (!kind) return null;
  return <Tag kind={KIND_STYLE[kind] || "muted"}>{kind}</Tag>;
}

export function SourceLine({ method, source, note }) {
  const who =
    source === "AI_MODEL" ? "MODEL" : source === "DETERMINISTIC_FALLBACK" ? "RULE-BASED · AI PROVIDER UNAVAILABLE" : source === "AI_NOT_CONFIGURED" ? "RULE-BASED · NO AI PROVIDER CONFIGURED" : "DETERMINISTIC";
  return (
    <div className="ci-prov">
      <b>{who}</b>
      {method ? <span>· {method}</span> : null}
      {note ? <span>· {note}</span> : null}
    </div>
  );
}

export function PageHead({ num, kicker, title, children, right }) {
  return (
    <div className="ci-head" style={{ borderBottom: "2px solid var(--ci-line)", paddingBottom: 14 }}>
      <div style={{ minWidth: 0, flex: "1 1 320px" }}>
        <div className="ci-kicker">
          {num} — {kicker}
        </div>
        <h1 className="ci-h1" style={{ margin: "8px 0 0" }}>{title}</h1>
        {children ? <p className="ci-body" style={{ marginTop: 8, maxWidth: "72ch" }}>{children}</p> : null}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

export function SignInNote({ what = "this page" }) {
  if (!isOnline()) {
    return (
      <StateBox kind="offline" title="Offline and not signed in">
        Signing in needs the network, so {what} cannot show your data after an offline restart. Pages you opened while signed in keep working offline until the app is closed.
      </StateBox>
    );
  }
  return <StateBox title="Sign in required">Use the account chip in the status bar to sign in and open {what}.</StateBox>;
}

// ---- network line (same behaviour as the kiosk's) -------------------------------

export function NetLine() {
  const [s, set] = useState({ online: isOnline(), queued: queueSize() });
  useEffect(() => {
    const tick = () => set({ online: isOnline(), queued: queueSize() });
    const back = async () => {
      await syncQueue().catch(() => null);
      tick();
    };
    window.addEventListener("online", back);
    window.addEventListener("offline", tick);
    const t = setInterval(tick, 3000);
    return () => {
      window.removeEventListener("online", back);
      window.removeEventListener("offline", tick);
      clearInterval(t);
    };
  }, []);
  if (s.online && !s.queued) return null;
  return (
    <div className="ci-meta ext-netline" role="status">
      <Tag kind={s.online ? "SAFE" : "OFFLINE"}>{s.online ? "CONNECTED" : "OFFLINE"}</Tag>
      <span>{s.queued ? `${s.queued} request${s.queued === 1 ? "" : "s"} held — sent automatically when the connection returns.` : "Writes made now are held on this device and sent when the connection returns."}</span>
    </div>
  );
}

// ---- formatting -----------------------------------------------------------------------

export const dt = (value) =>
  value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
export const day = (value) => (value ? new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");
export const inr = (n) => (n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
export const pct = (n) => (n === null || n === undefined ? "Insufficient data" : `${n}%`);
export const hrs = (h) => (h === null || h === undefined ? "—" : h < 1 ? `${Math.round(h * 60)} min` : `${Math.round(h * 10) / 10}h`);

export const isStaff = (user) => Boolean(user && user.role !== "STUDENT");
export const isAdmin = (user) => user?.role === "ADMIN";

/** A small counter that reads well at 390px. */
export function Stat({ label, value, kind, sub }) {
  return (
    <div>
      <div className="ci-label">{label}</div>
      <div className="ci-big" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginTop: 6 }}>{value}</div>
      <div className="ext-row" style={{ marginTop: 6 }}>
        {kind ? <Kind kind={kind} /> : null}
        {sub ? <span className="ci-meta">{sub}</span> : null}
      </div>
    </div>
  );
}
