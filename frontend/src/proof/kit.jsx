import React, { useState } from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { Kind } from "../ext/kit.jsx";
import { CalcBox } from "../xo/kit.jsx";
import "./proof.css";

/*
 * Shared pieces for the Round 3 panels. Visual language is the existing
 * intel / ext / xo kit; these add a section frame, a LOW BANDWIDTH deferral,
 * the WHY? disclosure and the "change diff" line list.
 */

export function ProofSection({ kicker, title, children, id }) {
  return (
    <section className="pf-section ci ext" style={{ padding: 0 }} aria-labelledby={id}>
      <div className="pf-kicker">{kicker}</div>
      <h2 className="pf-h2" id={id}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * In LOW BANDWIDTH mode a panel does not fetch on its own: the reader asks for
 * it. Everywhere else it renders straight away.
 */
export function Deferred({ lowBw, label, children }) {
  const [open, setOpen] = useState(!lowBw);
  if (open) return children;
  return (
    <div className="pf-row" role="note">
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>{`LOAD ${label}`}</button>
      <span className="pf-muted">LOW BANDWIDTH mode — loaded only when asked.</span>
    </div>
  );
}

/** WHY? — the calculation behind a number. */
export function Why({ children, label = "WHY?" }) {
  return <CalcBox label={label}>{children}</CalcBox>;
}

export function Card({ label, value, kind, children }) {
  return (
    <div className="pf-card">
      <div className="ci-label">{label}</div>
      <b className="pf-num">{value ?? "—"}</b>
      {kind ? <Kind kind={kind} /> : null}
      {children ? <div className="ci-meta" style={{ marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

const SEVERITY_CLASS = { BLOCK: "block", WARN: "warn", OK: "ok" };

/** A diff-style list: "This change will…", each line with its claim kind and optional rows. */
export function DiffLines({ lines = [] }) {
  const [open, setOpen] = useState(null);
  return (
    <ul className="pf-lines">
      {lines.map((l, i) => (
        <li key={i} className={`pf-line ${SEVERITY_CLASS[l.severity] || ""}`}>
          <div className="pf-row">
            <Kind kind={l.kind} />
            {l.section ? <Tag kind="muted">{l.section}</Tag> : null}
            {l.severity === "BLOCK" ? <Tag kind="CRITICAL">BLOCKS COMMIT</Tag> : null}
          </div>
          <div style={{ marginTop: 4 }}>{l.text}</div>
          {l.formula ? <div className="pf-muted">{l.formula}</div> : null}
          {l.basis ? <div className="pf-muted">Basis: {l.basis}</div> : null}
          {l.rows?.length ? (
            <>
              <button type="button" className="ci-link xo-linkbtn" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{open === i ? "HIDE ROWS" : `SHOW ${l.rows.length} ROW${l.rows.length === 1 ? "" : "S"}`}</button>
              {open === i ? <RowTable rows={l.rows} /> : null}
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const cell = (v) => (v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "yes" : "no") : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : String(v));

export function RowTable({ rows }) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => typeof rows[0]?.[c] !== "object" || rows[0]?.[c] === null);
  return (
    <div className="xo-table-wrap">
      <table className="xo-table">
        <thead><tr>{cols.map((c) => <th key={c}>{c.replace(/([A-Z])/g, " $1").toUpperCase()}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{cell(r[c])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Insufficient({ text }) {
  return <StateBox title="Insufficient data">{text}</StateBox>;
}

/** Plain-date label for an IST "YYYY-MM-DD" key. */
export const dayLabel = (key) => (key ? new Date(`${key}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "—");
