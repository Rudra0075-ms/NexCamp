import React from "react";
import { s } from "../lib/style.js";

/**
 * The AI surface components.
 *
 * Presentational only — they render what the backend sent and nothing else.
 * None of them computes a confidence, invents a model name, or shows a figure
 * the response did not carry: a missing value renders as "not reported" rather
 * than as a plausible number.
 *
 * They follow the existing design language (heading font, 2px rules, gold
 * accent, tabular numerals) so a page carrying one does not look like a
 * different application, and they are written to reflow at phone width.
 */

const PRIORITY_DOT = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
  LOW: "🔵",
  INFORMATIONAL: "⚪"
};

const PRIORITY_COLOR = {
  CRITICAL: "var(--color-accent)",
  HIGH: "var(--color-warn)",
  MEDIUM: "var(--color-neutral-800)",
  LOW: "var(--color-neutral-700)",
  INFORMATIONAL: "var(--color-neutral-600)"
};

/** How a result was produced, in the vocabulary the backend uses. */
export function sourceLabel(source) {
  if (source === "AI_MODEL") return "AI MODEL";
  if (source === "DETERMINISTIC_FALLBACK") return "RULE-BASED FALLBACK";
  if (source === "AI_NOT_CONFIGURED") return "AI NOT CONFIGURED";
  if (source === "INSUFFICIENT_DATA") return "INSUFFICIENT DATA";
  // Not an AI result at all: a figure counted straight out of the database.
  if (source === "DATABASE_AGGREGATION") return "COUNTED FROM DATABASE";
  if (source === "STATISTICAL_BASELINE") return "STATISTICAL — NOT A MODEL";
  if (source === "DETERMINISTIC_NOTIFICATION_RULES" || source === "RULE_BASED") return "RULE-BASED";
  if (source === "SHA256_HASH_CHAIN") return "HASH-CHAINED RECORDS";
  if (source === "NO_SIGNAL") return "NO SIGNAL";
  return source || "UNKNOWN";
}

/**
 * The provenance chip that sits on every AI result.
 * Names the model only when a model actually produced the value.
 */
export function AiBadge({ source, provider, model, method, at }) {
  const live = source === "AI_MODEL";
  return (
    <span style={s(
      "display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; font-family: var(--font-heading); " +
      "font-weight: 800; font-size: 9px; letter-spacing: .12em; padding: 4px 8px; border: 2px solid " +
      (live ? "var(--color-accent)" : "var(--color-divider)") + "; color: " +
      (live ? "var(--color-accent-700)" : "var(--color-neutral-700)")
    )}>
      <span>{sourceLabel(source)}</span>
      {provider && model ? (
        <span style={s("color: var(--color-neutral-700); font-weight: 700")}>
          {provider} · {model}
        </span>
      ) : null}
      {method ? <span style={s("color: var(--color-neutral-600); font-weight: 700")}>{method}</span> : null}
      {at ? (
        <span style={s("color: var(--color-neutral-600); font-weight: 700; font-variant-numeric: tabular-nums")}>
          {new Date(at).toISOString().slice(11, 16)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A confidence figure, with where it came from.
 * Renders "not reported" rather than a number when the backend sent none —
 * a missing confidence is never filled in with a guess.
 */
export function AiConfidence({ value, basis }) {
  const known = typeof value === "number" && Number.isFinite(value);
  return (
    <div style={s("display: grid; gap: 4px")}>
      <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>CONFIDENCE</div>
      {known ? (
        <>
          <div style={s("display: flex; align-items: baseline; gap: 8px")}>
            <span style={s("font-family: var(--font-heading); font-weight: 800; font-size: 22px; line-height: 1; font-variant-numeric: tabular-nums; color: var(--color-accent-2)")}>
              {value}%
            </span>
          </div>
          <div style={s("height: 4px; border-radius: 4px; background: var(--color-neutral-300); overflow: hidden")}>
            <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", background: "var(--color-accent-2)" }}></div>
          </div>
        </>
      ) : (
        <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 14px; color: var(--color-neutral-700)")}>
          NOT REPORTED
        </div>
      )}
      {basis ? (
        <div style={s("font-size: 9px; letter-spacing: .1em; color: var(--color-neutral-600)")}>
          {basis === "MODEL_REPORTED"
            ? "the model's own stated certainty"
            : basis === "RULE_BASED_SIGNAL_COUNT"
              ? "count of rule signals that matched — not a model output"
              : basis.replace(/_/g, " ").toLowerCase()}
        </div>
      ) : null}
    </div>
  );
}

/** The banner shown when the AI service is unavailable or unconfigured. */
export function AiNotice({ text }) {
  if (!text) return null;
  return (
    <div style={s(
      "border-left: 3px solid var(--color-accent); background: var(--color-neutral-100); padding: 10px 12px; " +
      "font-size: 12px; line-height: 1.6; color: var(--color-neutral-800); margin-top: 12px"
    )}>
      {text}
    </div>
  );
}

/** A key/value grid in the house style. */
export function AiFacts({ rows }) {
  const entries = (rows || []).filter((row) => row && row.value !== undefined && row.value !== null && row.value !== "");
  if (!entries.length) return null;
  return (
    <div style={s(
      "display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); " +
      "border-top: 1px solid var(--color-divider); border-left: 1px solid var(--color-divider); margin-top: 12px"
    )}>
      {entries.map((row, i) => (
        <div key={i} style={s("background: var(--color-neutral-100); border-right: 1px solid var(--color-divider); border-bottom: 1px solid var(--color-divider); padding: 10px 12px")}>
          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>{row.label}</div>
          <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 14px; margin-top: 4px; word-break: break-word")}>
            {String(row.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A titled panel — the wrapper every AI section on a page uses. */
export function AiPanel({ kicker, title, badge, children, tone = "default" }) {
  return (
    <div style={s(
      "border: 1px solid " + (tone === "alert" ? "var(--color-accent)" : "var(--color-divider)") + "; border-radius: var(--radius-md); background: var(--color-surface); padding: 18px; margin-top: 20px"
    )}>
      <div style={s("display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap")}>
        <div>
          {kicker ? (
            <div style={s("font-size: 10px; letter-spacing: .16em; color: var(--color-muted); font-weight: 700")}>{kicker}</div>
          ) : null}
          {title ? (
            <h3 style={s("font-size: clamp(16px, 2vw, 20px); letter-spacing: -.01em; margin: 6px 0 0")}>{title}</h3>
          ) : null}
        </div>
        {badge || null}
      </div>
      {children}
    </div>
  );
}

/** The explanation block — reason, recommendation, and the data behind them. */
export function AiExplanation({ reason, reasons, recommendation, evidence, caveat }) {
  const lines = reasons && reasons.length ? reasons : reason ? [reason] : [];
  return (
    <div style={s("margin-top: 14px; display: grid; gap: 12px")}>
      {lines.length ? (
        <div>
          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>WHY</div>
          <ul style={s("margin: 6px 0 0; padding-left: 16px; font-size: 13px; line-height: 1.65; color: var(--color-neutral-800)")}>
            {lines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      ) : null}
      {recommendation ? (
        <div>
          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>RECOMMENDED ACTION</div>
          <div style={s("font-size: 13px; line-height: 1.6; margin-top: 4px")}>{recommendation}</div>
        </div>
      ) : null}
      {evidence && evidence.length ? (
        <div>
          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>EVIDENCE FROM THE DATABASE</div>
          <ul style={s("margin: 6px 0 0; padding-left: 16px; font-size: 12px; line-height: 1.65; color: var(--color-neutral-700)")}>
            {evidence.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      ) : null}
      {caveat ? (
        <div style={s("font-size: 11px; line-height: 1.6; color: var(--color-neutral-600); border-top: 1px solid var(--color-neutral-300); padding-top: 10px")}>
          {caveat}
        </div>
      ) : null}
    </div>
  );
}

/** One priority-graded notification row. */
export function PriorityRow({ priority, title, body, reason, source, at }) {
  const band = priority || "MEDIUM";
  return (
    <div style={s("display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: baseline; padding: 11px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
      <span style={s("font-size: 13px")} title={band}>{PRIORITY_DOT[band] || "⚪"}</span>
      <div style={s("min-width: 0")}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "12px", letterSpacing: ".06em", color: PRIORITY_COLOR[band] }}>
          {band} · {title}
        </div>
        {body ? <div style={s("font-size: 12px; color: var(--color-neutral-800); margin-top: 3px; line-height: 1.55")}>{body}</div> : null}
        {reason ? (
          <div style={s("font-size: 10px; color: var(--color-neutral-600); margin-top: 4px; line-height: 1.5")}>
            {source === "SAFETY_RULE" ? "Safety rule · " : source === "AI_MODEL" ? "AI model · " : "Rule-based · "}
            {reason}
          </div>
        ) : null}
      </div>
      <div style={s("font-size: 11px; color: var(--color-neutral-600); font-variant-numeric: tabular-nums; white-space: nowrap")}>
        {at ? new Date(at).toISOString().slice(11, 16) : ""}
      </div>
    </div>
  );
}

/** The universal request timeline (Feature 13). */
export function RequestTimeline({ timeline }) {
  if (!timeline) return null;
  const stages = timeline.stages || [];
  return (
    <div style={s("margin-top: 14px")}>
      <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700); margin-bottom: 10px")}>
        {String(timeline.kind || "").toUpperCase()} TIMELINE · {timeline.reference || ""}
      </div>
      <div style={s("display: flex; gap: 8px; flex-wrap: wrap")}>
        {stages.map((stage, i) => {
          const colour =
            stage.state === "DONE" ? "var(--color-accent)"
            : stage.state === "CURRENT" ? "var(--color-text)"
            : stage.state === "SKIPPED" ? "var(--color-neutral-400)"
            : "var(--color-neutral-300)";
          return (
            <div key={i} style={{ flex: "1 1 108px", borderTop: `3px solid ${colour}`, paddingTop: "8px", minWidth: "108px", opacity: stage.state === "SKIPPED" ? 0.45 : 1 }}>
              <div style={s("font-size: 9px; letter-spacing: .12em; color: var(--color-neutral-600)")}>
                {stage.state}
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "11px", letterSpacing: ".05em", marginTop: "2px" }}>
                {stage.label}
              </div>
              <div style={s("font-size: 10px; color: var(--color-neutral-600); font-variant-numeric: tabular-nums; margin-top: 2px")}>
                {stage.at ? new Date(stage.at).toISOString().slice(0, 16).replace("T", " ") : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The hash-chained audit history (Feature 14). */
export function AuditTimeline({ audit }) {
  if (!audit) return null;
  const chain = audit.chain || {};
  return (
    <div>
      <div style={{
        display: "flex", gap: "10px", alignItems: "baseline", flexWrap: "wrap", padding: "10px 12px",
        border: `1px solid ${chain.intact ? "var(--color-divider)" : "var(--color-warn)"}`,
        marginBottom: "14px"
      }}>
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "11px", letterSpacing: ".12em", color: chain.intact ? "var(--color-accent-700)" : "var(--color-accent)" }}>
          {chain.intact ? "CHAIN INTACT" : `CHAIN BROKEN AT #${chain.brokenAt}`}
        </span>
        <span style={s("font-size: 11px; color: var(--color-neutral-700); line-height: 1.5")}>{chain.detail}</span>
      </div>

      <div style={s("border-top: 1px solid var(--color-divider)")}>
        {(audit.entries || []).map((entry) => (
          <div key={entry.sequence} style={s("display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 12px; align-items: baseline; padding: 11px 0; border-bottom: 1px solid var(--color-neutral-300)")}>
            <div style={s("font-size: 11px; font-variant-numeric: tabular-nums; color: var(--color-neutral-600)")}>#{entry.sequence}</div>
            <div style={s("min-width: 0")}>
              <div style={s("font-family: var(--font-heading); font-weight: 800; font-size: 12px; letterSpacing: .05em")}>
                {entry.action} · {entry.entityRef || entry.entityType}
              </div>
              <div style={s("font-size: 12px; color: var(--color-neutral-800); margin-top: 3px; line-height: 1.55; word-break: break-word")}>
                {entry.field ? `${entry.field}: ` : ""}
                {entry.previousValue ? `${entry.previousValue} → ` : ""}
                {entry.newValue || "—"}
              </div>
              <div style={s("font-size: 10px; color: var(--color-neutral-600); margin-top: 4px")}>
                {entry.actorName} ({entry.actorRole}) · {new Date(entry.at).toISOString().slice(0, 16).replace("T", " ")}
                {entry.note ? ` · ${entry.note}` : ""}
              </div>
            </div>
            <div style={s("font-size: 10px; color: var(--color-neutral-600); font-family: monospace; white-space: nowrap")}>
              {entry.previousHashShort}→{entry.hashShort}
            </div>
          </div>
        ))}
      </div>

      <div style={s("font-size: 10px; letter-spacing: .04em; color: var(--color-neutral-600); margin-top: 12px; line-height: 1.6; max-width: 76ch")}>
        {audit.disclaimer}
      </div>
    </div>
  );
}

/**
 * The narration block that sits on top of an operational analysis (SLA,
 * workload, simulation, data quality, feedback, correlations).
 *
 * The figures beneath it were computed by the backend; this renders only how
 * they were phrased, and by what — the badge names a model only when one
 * actually wrote the text.
 */
export function AiNarrative({ narrated, label }) {
  if (!narrated) return null;
  return (
    <div style={s("border-left: 3px solid var(--color-accent); padding: 4px 0 4px 14px; margin-top: 14px")}>
      <div style={s("display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline")}>
        <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-muted); font-weight: 700")}>
          {label || "AI ANALYSIS"}
        </div>
        <AiBadge source={narrated.source} provider={narrated.provider} model={narrated.model} method={narrated.method} at={narrated.processedAt} />
      </div>
      {narrated.headline ? (
        <div style={s("font-size: 15px; line-height: 1.6; margin-top: 8px; text-wrap: pretty")}>{narrated.headline}</div>
      ) : null}
      {(narrated.insights || []).length ? (
        <ul style={s("margin: 8px 0 0; padding-left: 16px; font-size: 12px; line-height: 1.65; color: var(--color-neutral-800)")}>
          {narrated.insights.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      ) : null}
      {narrated.recommendation ? (
        <div style={s("margin-top: 10px")}>
          <div style={s("font-size: 9px; letter-spacing: .14em; color: var(--color-neutral-700)")}>RECOMMENDATION</div>
          <div style={s("font-size: 13px; line-height: 1.6; margin-top: 3px")}>{narrated.recommendation}</div>
        </div>
      ) : null}
      <AiNotice text={narrated.notice} />
    </div>
  );
}

/** A small uppercase chip for a risk or status band. */
export function BandChip({ band }) {
  const hot = band === "BREACHED" || band === "CRITICAL" || band === "HIGH" || band === "PROBLEM";
  const warm = band === "MEDIUM" || band === "WATCH";
  return (
    <span style={{
      fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: "9px", letterSpacing: ".12em", padding: "3px 7px",
      whiteSpace: "nowrap",
      borderRadius: "4px",
      background: hot ? "var(--color-accent)" : warm ? "var(--color-warn-100)" : "var(--color-neutral-200)",
      color: hot ? "var(--color-on-accent)" : warm ? "var(--color-warn-800)" : "var(--color-text)"
    }}>
      {band}
    </span>
  );
}

/** Loading line shown while an AI read is in flight. */
export function AiLoading({ text }) {
  return (
    <div style={s("font-size: 12px; letter-spacing: .06em; color: var(--color-neutral-700); margin-top: 12px")}>
      {text || "Analysing…"}
    </div>
  );
}

export const AI_PRIORITY_DOT = PRIORITY_DOT;
