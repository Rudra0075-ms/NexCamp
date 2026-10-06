import React from "react";
import { createRoot } from "react-dom/client";
import NexCamp from "./NexCamp.jsx";
import "./styles/modernist.css";
import "./styles/theme.css";
import "./styles/cominvi.css";
// EXTENSION HOOK (see HOOKS.md): public /verify/:code page, PWA service worker, offline banner.
const VerifyPage = React.lazy(() => import("./ext/VerifyPage.jsx"));
import OfflineBanner from "./ext/OfflineBanner.jsx";
import { registerServiceWorker } from "./ext/pwa.js";

// Last line of defence: an error that escapes every section boundary would
// otherwise unmount the app and leave a blank white page.
class AppBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[nex-camp] the interface failed to render", error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ maxWidth: 640, margin: "12vh auto", padding: "0 20px", fontFamily: "Archivo, system-ui, sans-serif" }}>
        <div style={{ fontSize: 11, letterSpacing: ".2em", fontWeight: 700, color: "var(--color-muted)" }}>NEX CAMP</div>
        <h1 style={{ fontSize: 32, margin: "10px 0" }}>Something went wrong on this screen.</h1>
        <p style={{ fontSize: 15, lineHeight: 1.5 }}>{String(this.state.error?.message || this.state.error)}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 12, padding: "10px 16px", font: "inherit", fontWeight: 700, border: 0, borderRadius: 999, background: "var(--color-accent)", color: "var(--color-on-accent)", cursor: "pointer" }}>RELOAD</button>
      </div>
    );
  }
}

// EXTENSION HOOK: /verify/:code renders the public verifier; every other path renders the app exactly as before.
const verifyMatch = typeof location !== "undefined" ? /^\/verify\/?([^/]*)/.exec(location.pathname) : null;
registerServiceWorker();
if (verifyMatch) createRoot(document.getElementById("root")).render(<AppBoundary><OfflineBanner /><React.Suspense fallback={null}><VerifyPage initialCode={decodeURIComponent(verifyMatch[1] || "")} /></React.Suspense></AppBoundary>);
else
createRoot(document.getElementById("root")).render(<AppBoundary><NexCamp /></AppBoundary>);
// EXTENSION HOOK: offline banner in its own root, so the app tree above is untouched.
if (!verifyMatch && typeof document !== "undefined") { const host = document.createElement("div"); document.body.appendChild(host); createRoot(host).render(<OfflineBanner />); }
