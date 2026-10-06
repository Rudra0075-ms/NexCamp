import React, { useEffect, useRef, useState } from "react";
import { Tag } from "../components/intel/kit.jsx";
import { translate } from "../lib/i18n.js";
import { ext } from "./api.js";
import { day, dt } from "./kit.jsx";
import "../components/intel/intel.css";
import "./ext.css";

/*
 * Public certificate verification — /verify/:code. No account needed: a bank,
 * embassy or employer scanning the QR sees only the status, the certificate
 * type, the issue date and a partially masked name.
 */

const CANONICAL = /\/(?:Nex|CIO)Canonical \(([A-Za-z0-9+/=]+)\)/ // NeX Camp files, and files issued before the rename;

function fromBase64Utf8(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export default function VerifyPage({ initialCode = "" }) {
  const [code, setCode] = useState(initialCode);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copy, setCopy] = useState("");
  const [copyResult, setCopyResult] = useState(null);
  const [lang, setLang] = useState("EN");
  const root = useRef(null);

  useEffect(() => {
    if (initialCode) check(initialCode);
  }, [initialCode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => translate(root.current, lang), 400);
    translate(root.current, lang);
    return () => clearInterval(t);
  }, [lang]);

  async function check(value) {
    setBusy(true);
    setError(null);
    setCopyResult(null);
    try {
      setResult(await ext.verify(value.trim()));
      window.history.replaceState(null, "", `/verify/${encodeURIComponent(value.trim().toUpperCase())}`);
    } catch (e) {
      setResult(null);
      setError(e.status === 0 ? "The verification service cannot be reached from this device right now." : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkCopy(content) {
    setCopyResult(null);
    try {
      setCopyResult(await ext.verifyCopy(result.code, content));
    } catch (e) {
      setCopyResult({ error: e.message });
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const match = CANONICAL.exec(String(reader.result));
      if (!match) {
        setCopyResult({ error: "This file does not carry the certificate's embedded content block, so it cannot be checked." });
        return;
      }
      const content = fromBase64Utf8(match[1]);
      setCopy(content);
      checkCopy(content);
    };
    reader.readAsBinaryString(file);
  }

  const tamper = () => {
    const altered = copy.replace(/name=([^\n]+)/, (_, n) => `name=${n.split("").reverse().join("")}`);
    setCopy(altered);
    checkCopy(altered);
  };

  return (
    <div ref={root} style={{ minHeight: "100vh", background: "var(--color-bg)", fontFamily: "var(--font-body)", color: "var(--color-text)" }}>
      <header style={{ borderBottom: "1px solid var(--color-divider)", padding: "12px clamp(16px, 3vw, 40px)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <a href="/" style={{ fontFamily: "var(--font-heading)", fontSize: 24, color: "inherit", textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}><img src="/logo-mark.png" alt="" width={32} height={32} style={{ borderRadius: 6, display: "block" }} />NeX Camp</a>
        <span style={{ fontSize: 10, letterSpacing: ".22em", color: "var(--color-neutral-700)" }}>CERTIFICATE VERIFICATION</span>
        <span style={{ flex: "1 1 auto" }} />
        {["EN", "ଓଡ଼ିଆ", "हिन्दी"].map((l) => <button key={l} type="button" className="ext-toggle" aria-pressed={lang === l} onClick={() => setLang(l)}>{l}</button>)}
      </header>
      <main className="ci ext" style={{ maxWidth: 880 }}>
        <div className="ci-kicker">PUBLIC VERIFY</div>
        <h1 className="ci-h1">Is this certificate genuine?</h1>
        <p className="ci-body" style={{ maxWidth: "62ch" }}>Enter the code printed beside the QR code. The institution stores only a SHA-256 digest of each certificate's content, so any change to the certified details makes verification fail.</p>
        <form className="ci-kiosk-id" style={{ marginTop: 18 }} onSubmit={(e) => { e.preventDefault(); if (code.trim()) check(code); }}>
          <input className="ci-input" aria-label="Verification code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EF23" autoComplete="off" />
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "CHECKING…" : "VERIFY →"}</button>
        </form>
        {error ? <div className="ci-result ci-result-err" role="alert">{error}</div> : null}
        {result ? (
          <section className="ext-card ext-card-strong" style={{ marginTop: 22 }} aria-live="polite">
            <div className={`ext-verdict ext-verdict-${result.status}`}>{result.status.replace("_", " ")}</div>
            <p className="ci-body" style={{ marginTop: 10 }}>{result.message}</p>
            {result.status !== "NOT_FOUND" ? (
              <div className="ci-kv" style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) minmax(0, 1fr)", gap: "8px 14px", marginTop: 12 }}>
                <span className="ci-label">Certificate</span><b>{result.typeLabel}</b>
                <span className="ci-label">Issued to</span><b>{result.nameMasked}</b>
                <span className="ci-label">Issued on</span><b>{day(result.issuedAt)}</b>
                <span className="ci-label">Serial</span><b className="ext-code">{result.serial}</b>
                <span className="ci-label">Digest</span><span className="ext-code">{result.digestShort}…</span>
                {result.revokedAt ? (<><span className="ci-label">Revoked</span><b>{dt(result.revokedAt)} — {result.revocationReason}</b></>) : null}
              </div>
            ) : null}
            <div className="ci-prov"><b>{result.method}</b><span>· checked {dt(result.checkedAt)}</span></div>
          </section>
        ) : null}
        {result && result.status !== "NOT_FOUND" ? (
          <section className="ext-card" style={{ marginTop: 18 }}>
            <div className="ci-label">Check a copy you were given</div>
            <p className="ci-meta">Choose the PDF: its embedded content block is read on this device and only that text is sent for hashing.</p>
            <input type="file" accept="application/pdf" onChange={onFile} aria-label="Certificate PDF" />
            {copy ? (
              <>
                <pre className="ext-code" style={{ whiteSpace: "pre-wrap", background: "var(--color-neutral-200)", padding: 10, marginTop: 10, maxHeight: 220, overflow: "auto" }}>{copy}</pre>
                <div className="ext-actions"><button type="button" className="btn btn-secondary" onClick={tamper}>SIMULATE TAMPERING (REVERSE THE NAME)</button></div>
              </>
            ) : null}
            {copyResult ? (
              copyResult.error ? <div className="ci-result ci-result-err">{copyResult.error}</div> : (
                <div className={`ci-result ${copyResult.copyMatches ? "" : "ci-result-err"}`} role="status">
                  <Tag kind={copyResult.copyMatches ? "SAFE" : "CRITICAL"}>{copyResult.copyMatches ? "COPY MATCHES" : "COPY ALTERED"}</Tag> {copyResult.copyMessage}
                </div>
              )
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
