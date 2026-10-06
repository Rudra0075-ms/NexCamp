import React, { useEffect, useState } from "react";
import { queueSize } from "../lib/net.js";

/** A thin top banner while the browser reports no connection. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  const [queued, setQueued] = useState(queueSize());
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const t = setInterval(() => setQueued(queueSize()), 3000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(t);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 950, background: "var(--color-warn)", color: "var(--color-on-accent)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".12em", fontWeight: 600, padding: "6px 14px", textAlign: "center" }}>
      OFFLINE — SHOWING THIS DEVICE'S LAST COPIES, MARKED AS CACHED. {queued ? `${queued} REQUEST${queued === 1 ? "" : "S"} HELD, SENT WHEN YOU RECONNECT.` : "ANYTHING YOU SUBMIT IS HELD AND SENT WHEN YOU RECONNECT."}
    </div>
  );
}
