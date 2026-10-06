import React, { Suspense, lazy, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/*
 * The 30-SECOND PROOF control, beside TUESDAY TEST in the header (see
 * CHANGES-REEL.md). Only this button is in the entry bundle; the reel itself
 * is its own lazy chunk, loaded when pressed — or at once with ?reel=1, the
 * screen-recording mode. It renders in a portal over the whole page.
 */

const ProofReel = lazy(() => import("./ProofReel.jsx"));
const query = () => (typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search));

export function ReelButton({ user, live, lang, lowRender, onAdmin }) {
  const q = query();
  const recording = q.get("reel") === "1";
  const [open, setOpen] = useState(recording);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  return (
    <>
      <button type="button" data-cursor="RUN" className="btn nx-link" aria-pressed={open} aria-haspopup="dialog" title={live ? "Every Tuesday problem, solved on screen from the live database, in 30 seconds" : "Offline — plays the last copy this device cached, if any"} onClick={() => setOpen((o) => !o)}>
        <span className="nx-sc">30-SECOND PROOF</span>
      </button>
      {open
        ? createPortal(
            <Suspense fallback={null}>
              <ProofReel user={user} live={live} lang={lang} recording={recording} loop={q.get("loop") === "1"} lowRender={lowRender || q.get("lowend") === "1"} onAdmin={onAdmin} onClose={() => setOpen(false)} />
            </Suspense>,
            document.body
          )
        : null}
    </>
  );
}
