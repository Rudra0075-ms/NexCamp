import {
  AI_SOURCES,
  CATEGORIES,
  DEPARTMENTS,
  PRIORITIES,
  SEVERITIES
} from "../config/constants.js";
import { aiConfigured, aiPublicConfig, env } from "../config/env.js";
import { classify, findDuplicates, CATEGORY_DEPARTMENTS } from "./classificationService.js";
import { decideEscalation, reconcilePriority } from "./escalationService.js";
import { AiUnavailableError, completeJson } from "./ai/providerClient.js";
import { guard } from "./ai/jsonGuard.js";
import { round } from "../utils/text.js";

/**
 * The AI layer.
 *
 * One rule runs through every method here: an answer is either produced by a
 * configured model whose output passed validation, or it is produced by the
 * deterministic services that already shipped — and the response says which,
 * in `source`, every single time.
 *
 *   AI_MODEL               a provider answered and the output validated
 *   DETERMINISTIC_FALLBACK a provider is configured but failed; rules answered
 *   AI_NOT_CONFIGURED      no provider is set up at all; rules answered
 *
 * `model` and `provider` are null unless a model genuinely produced the value,
 * so the interface can never print a model name that did not do the work. No
 * confidence figure is ever invented: a rule-based confidence is labelled as
 * such, and a model's own figure is only kept if the model supplied one.
 *
 * Every method degrades to a usable answer. Nothing in the application stops
 * working because a provider is missing, slow or wrong.
 */

const SYSTEM_PROMPT =
  "You are the analysis layer of a university campus management system. " +
  "You answer only with a single JSON object and no prose outside it. " +
  "You may only use the facts given in the prompt — never invent counts, references, names or statistics. " +
  "If the data given does not support an answer, say so in the JSON rather than guessing.";

/** The shape every method returns for its provenance block. */
function provenance(source, extra = {}) {
  return {
    source,
    provider: source === AI_SOURCES.MODEL ? env.ai.provider : null,
    model: source === AI_SOURCES.MODEL ? env.ai.model : null,
    processedAt: new Date(),
    ...extra
  };
}

/** Why the deterministic path is answering, phrased for the interface. */
function fallbackNote(error) {
  if (!aiConfigured()) {
    return "AI service not configured — set AI_PROVIDER, AI_API_KEY and AI_MODEL to enable model analysis. The rule-based result below is what the system is using.";
  }
  return `AI provider unavailable (${error?.reason || "PROVIDER_ERROR"}) — the rule-based result below is what the system is using.`;
}

/**
 * Runs one model call and hands back a normalised outcome. Never throws: the
 * caller always gets either model output or the reason it did not.
 */
async function attempt(prompt) {
  if (!aiConfigured()) {
    return { ok: false, source: AI_SOURCES.NOT_CONFIGURED, error: new AiUnavailableError("not configured", { reason: "NOT_CONFIGURED" }) };
  }
  try {
    const result = await completeJson({ system: SYSTEM_PROMPT, prompt });
    return { ok: true, source: AI_SOURCES.MODEL, ...result };
  } catch (error) {
    // A provider failure is an expected operating condition, not an incident.
    console.warn(`aiService: falling back to rules — ${error.message}`);
    return { ok: false, source: AI_SOURCES.FALLBACK, error };
  }
}

export function status() {
  return {
    ...aiPublicConfig(),
    capabilities: [
      "classifyComplaint",
      "detectDuplicate",
      "analyzeRootCause",
      "summarizeCampus",
      "detectAnomaly",
      "predictDemand",
      "generateAdminAnswer",
      "assessGatePassRisk",
      "predictSlaBreach",
      "analyzeWorkload",
      "explainSimulation",
      "narrateDataQuality",
      "analyzeFeedback",
      "explainCorrelations",
      "suggestResolution"
    ],
    fallback: "DETERMINISTIC_SERVICES",
    note: aiConfigured()
      ? "A provider is configured. Individual results still report whether the model or the rule-based fallback answered."
      : "AI service not configured. Every AI surface runs its deterministic fallback and is labelled AI_NOT_CONFIGURED.",
    sources: AI_SOURCES
  };
}

// ---------------------------------------------------------------------------
// 1 · classifyComplaint — category, priority, severity, department, reasoning
// ---------------------------------------------------------------------------

const CLASSIFY_SPEC = {
  category: { type: "enum", values: CATEGORIES },
  subCategory: { type: "text", max: 60 },
  priority: { type: "enum", values: PRIORITIES },
  severity: { type: "enum", values: SEVERITIES },
  department: { type: "enum", values: DEPARTMENTS },
  confidence: { type: "number", min: 0, max: 100 },
  reason: { type: "text", max: 300 },
  suggestedAction: { type: "text", max: 200 },
  urgencyHours: { type: "number", min: 0, max: 168 }
};

/**
 * Classifies a complaint.
 *
 * The deterministic classifier runs first and always — it produces the baseline
 * that is kept when no model answers, and the safety rules that a model is not
 * allowed to talk the system out of.
 */
export async function classifyComplaint(complaint, { building } = {}) {
  const { classification: rules, duplicates } = await classify(complaint, { building });

  const text = `${complaint.title} ${complaint.description}`;
  const escalation = decideEscalation({
    text,
    basePriority: rules.priority,
    severity: rules.severity,
    duplicateProbability: rules.duplicateProbability,
    relatedCount: duplicates.length
  });

  const prompt = [
    "Classify this campus complaint.",
    "",
    `Title: ${complaint.title}`,
    `Description: ${complaint.description}`,
    `Student-selected category: ${complaint.category || "not stated"}`,
    `Location: ${complaint.location || building?.name || "not stated"}`,
    `Similar recent complaints in the same building: ${duplicates.length}`,
    "",
    `Allowed category values: ${CATEGORIES.join(", ")}`,
    `Allowed priority values: ${PRIORITIES.join(", ")}`,
    `Allowed severity values: ${SEVERITIES.join(", ")}`,
    `Allowed department values: ${DEPARTMENTS.join(" | ")}`,
    "",
    "Reply with JSON: { category, subCategory, priority, severity, department, confidence (0-100, your own certainty), reason (one sentence quoting what in the text decided it), suggestedAction, urgencyHours }"
  ].join("\n");

  const call = await attempt(prompt);

  if (!call.ok) {
    return {
      ...provenance(call.source, { method: rules.method }),
      category: rules.category,
      subCategory: rules.subCategory || null,
      priority: escalation.priority,
      severity: rules.severity,
      department: rules.routedTo,
      confidence: rules.confidence,
      confidenceBasis: "RULE_BASED_SIGNAL_COUNT",
      reason: rules.reasons[0],
      reasons: rules.reasons,
      suggestedAction: escalation.action,
      urgencyHours: rules.slaHours,
      escalation,
      duplicates,
      rules,
      notice: fallbackNote(call.error)
    };
  }

  const { value, rejected } = guard(call.json, CLASSIFY_SPEC);
  const merged = reconcilePriority(escalation, value.priority);

  const category = value.category || rules.category;
  // A model may name a department, but only one that exists, and a category it
  // picked has to stay consistent with the department it routed to.
  const department = value.department || CATEGORY_DEPARTMENTS[category] || rules.routedTo;

  return {
    ...provenance(AI_SOURCES.MODEL, { method: "LLM_STRUCTURED_CLASSIFICATION", latencyMs: call.latencyMs }),
    category,
    subCategory: value.subCategory || rules.subCategory || null,
    priority: merged.priority,
    severity: value.severity || rules.severity,
    department,
    // Only ever the model's own number. If it did not give one, the rule-based
    // figure is returned and labelled as rule-based.
    confidence: value.confidence ?? rules.confidence,
    confidenceBasis: value.confidence === undefined ? "RULE_BASED_SIGNAL_COUNT" : "MODEL_REPORTED",
    reason: value.reason || rules.reasons[0],
    reasons: [
      ...(value.reason ? [value.reason] : []),
      ...rules.reasons,
      merged.note,
      ...(escalation.rule === "SAFETY_RULE" ? escalation.reasons : [])
    ].filter(Boolean),
    suggestedAction: value.suggestedAction || escalation.action,
    urgencyHours: value.urgencyHours ?? rules.slaHours,
    escalation,
    priorityNote: merged.note,
    duplicates,
    rules,
    rejectedFields: rejected
  };
}

// ---------------------------------------------------------------------------
// 2 · detectDuplicate
// ---------------------------------------------------------------------------

const DUPLICATE_SPEC = {
  isDuplicate: { type: "boolean" },
  similarity: { type: "number", min: 0, max: 100 },
  reason: { type: "text", max: 300 },
  recommendation: { type: "text", max: 160 }
};

/**
 * Compares one complaint against the recent ones the keyword matcher surfaced.
 * The candidate list always comes from the database; the model only judges
 * whether the top candidate is really the same problem.
 */
export async function detectDuplicate(complaint, { candidates } = {}) {
  const scored = candidates || (await findDuplicates(complaint));
  const top = scored[0] || null;

  const base = {
    candidates: scored.slice(0, 5).map((row) => ({
      id: String(row.complaint._id),
      reference: row.complaint.reference,
      title: row.complaint.title,
      category: row.complaint.category,
      createdAt: row.complaint.createdAt,
      keywordOverlap: round(row.score * 100)
    })),
    // The ceiling on what keyword overlap alone can tell you.
    keywordMethod: "JACCARD_KEYWORD_OVERLAP"
  };

  if (!top) {
    // No candidate means no call was made and nothing was judged. Report that
    // fact rather than a verdict, and attribute it to nobody.
    return {
      ...base,
      source: AI_SOURCES.NOT_CONFIGURED,
      provider: null,
      model: null,
      method: "JACCARD_KEYWORD_OVERLAP",
      processedAt: new Date(),
      isDuplicate: false,
      similarity: 0,
      similarityBasis: "KEYWORD_OVERLAP",
      related: null,
      reason: "No complaint filed in the same building in the last 21 days shares enough wording to be a candidate.",
      recommendation: "Handle independently.",
      notice: "No candidate to compare against — no model was consulted."
    };
  }

  const prompt = [
    "Decide whether these two campus complaints describe the same underlying problem.",
    "",
    "NEW COMPLAINT",
    `Title: ${complaint.title}`,
    `Description: ${complaint.description}`,
    "",
    "EXISTING COMPLAINT",
    `Reference: ${top.complaint.reference}`,
    `Title: ${top.complaint.title}`,
    `Description: ${top.complaint.description}`,
    `Filed: ${new Date(top.complaint.createdAt).toISOString()}`,
    "",
    `Keyword overlap measured by the system: ${round(top.score * 100)}%`,
    "",
    "Reply with JSON: { isDuplicate (boolean), similarity (0-100), reason (one sentence), recommendation }"
  ].join("\n");

  const call = await attempt(prompt);

  if (!call.ok) {
    const overlap = round(top.score * 100);
    return {
      ...provenance(call.source, { method: "JACCARD_KEYWORD_OVERLAP" }),
      ...base,
      isDuplicate: overlap >= 55,
      similarity: overlap,
      similarityBasis: "KEYWORD_OVERLAP",
      related: base.candidates[0],
      reason: `${overlap}% of the content words in these two complaints are shared, and both are filed against the same building.`,
      recommendation: overlap >= 55 ? `Review against ${top.complaint.reference} before assigning.` : "Likely a separate problem — handle independently.",
      notice: fallbackNote(call.error)
    };
  }

  const { value, rejected } = guard(call.json, DUPLICATE_SPEC);

  return {
    ...provenance(AI_SOURCES.MODEL, { method: "LLM_SIMILARITY_JUDGEMENT", latencyMs: call.latencyMs }),
    ...base,
    isDuplicate: value.isDuplicate ?? round(top.score * 100) >= 55,
    similarity: value.similarity ?? round(top.score * 100),
    similarityBasis: value.similarity === undefined ? "KEYWORD_OVERLAP" : "MODEL_REPORTED",
    related: base.candidates[0],
    reason: value.reason || `Keyword overlap ${round(top.score * 100)}%.`,
    recommendation: value.recommendation || "Review both before assigning.",
    rejectedFields: rejected,
    governance: "A suggestion only. No complaint is merged, closed or deleted automatically."
  };
}

// ---------------------------------------------------------------------------
// 3 · analyzeRootCause
// ---------------------------------------------------------------------------

const ROOT_CAUSE_SPEC = {
  rootCause: { type: "text", max: 300 },
  confidence: { type: "number", min: 0, max: 100 },
  evidence: { type: "list", max: 220, limit: 6 },
  suggestedAction: { type: "text", max: 220 },
  alternativeExplanation: { type: "text", max: 220 }
};

/**
 * Suggests what might be behind a recurring pattern.
 *
 * @param {object} pattern  a row from recurrenceService.detectRecurring()
 * @param {Array}  samples  the complaint rows behind it
 */
export async function analyzeRootCause(pattern, samples = []) {
  const evidence = [
    `${pattern.occurrences} complaints in ${pattern.building.name}, all category ${pattern.category}.`,
    `Spread over ${pattern.distinctDays} days within a ${pattern.spanDays}-day span.`,
    `Average wording overlap between them: ${pattern.textSimilarity}%.`,
    ...(pattern.repeatedLocations.length
      ? [`${pattern.repeatedLocations[0].location} appears in ${pattern.repeatedLocations[0].occurrences} of them.`]
      : []),
    ...(pattern.unresolved ? [`${pattern.unresolved} are still unresolved.`] : [])
  ];

  const prompt = [
    "Several complaints in one campus building look like one underlying fault. Suggest the most likely root cause.",
    "",
    `Building: ${pattern.building.name} (${pattern.building.code})`,
    `Category: ${pattern.category}`,
    `Occurrences: ${pattern.occurrences} over ${pattern.spanDays} days`,
    "",
    "The complaints:",
    ...samples.slice(0, 12).map((row) => `- ${row.reference || "?"}: ${row.title} — ${row.description}`),
    "",
    "Use only the complaints above. Do not assert anything you cannot point at in them.",
    "Reply with JSON: { rootCause, confidence (0-100), evidence (array of short strings quoting the data), suggestedAction, alternativeExplanation }"
  ].join("\n");

  const call = await attempt(prompt);

  const label = "AI-GENERATED ANALYSIS";
  const caveat =
    "A hypothesis derived from complaint text and counts, not a diagnosis. Confirm on site before acting on it.";

  if (!call.ok) {
    // The deterministic read: name the observable pattern, do not speculate
    // about a mechanism the data cannot support.
    const shared = pattern.repeatedLocations[0];
    return {
      ...provenance(call.source, { method: "RULE_BASED_PATTERN_SUMMARY" }),
      label,
      rootCause:
        `Repeated ${pattern.category.toLowerCase()} failures concentrated in ${pattern.building.name}` +
        (shared ? `, ${shared.occurrences} of them at ${shared.location}` : "") +
        ". The concentration points at shared infrastructure in that block rather than isolated faults.",
      confidence: null,
      confidenceBasis: "NOT_AVAILABLE_WITHOUT_MODEL",
      evidence,
      suggestedAction: `Inspect the ${pattern.category.toLowerCase()} infrastructure serving ${pattern.building.name}${shared ? ` starting at ${shared.location}` : ""}.`,
      alternativeExplanation: "The same wording could also reflect one unresolved fault being re-reported by different students.",
      caveat,
      notice: fallbackNote(call.error)
    };
  }

  const { value, rejected } = guard(call.json, ROOT_CAUSE_SPEC);

  return {
    ...provenance(AI_SOURCES.MODEL, { method: "LLM_ROOT_CAUSE_ANALYSIS", latencyMs: call.latencyMs }),
    label,
    rootCause: value.rootCause || "The model did not return a usable root cause.",
    confidence: value.confidence ?? null,
    confidenceBasis: value.confidence === undefined ? "NOT_REPORTED" : "MODEL_REPORTED",
    // The counted evidence always ships alongside whatever the model cited.
    evidence: [...evidence, ...(value.evidence || [])],
    suggestedAction: value.suggestedAction || "Inspect the affected infrastructure.",
    alternativeExplanation: value.alternativeExplanation || null,
    caveat,
    rejectedFields: rejected
  };
}

// ---------------------------------------------------------------------------
// 4 · summarizeCampus
// ---------------------------------------------------------------------------

const SUMMARY_SPEC = {
  headline: { type: "text", max: 200 },
  bullets: { type: "list", max: 200, limit: 8 },
  topPriority: { type: "text", max: 200 }
};

/**
 * The daily campus summary.
 *
 * `facts` is assembled by the controller from database counts. The model is
 * only allowed to phrase them — and whether or not it does, the same counted
 * facts are returned alongside, so the interface always has real numbers.
 */
export async function summarizeCampus(facts) {
  const bullets = facts.lines;

  const prompt = [
    "Write a short operational summary of a university campus for its administrator.",
    "",
    "These are the only facts available. Every number in your summary must be one of these numbers.",
    ...bullets.map((line) => `- ${line}`),
    "",
    "Reply with JSON: { headline (one sentence), bullets (array of short factual lines), topPriority (what to do first and why) }"
  ].join("\n");

  const call = await attempt(prompt);

  if (!call.ok) {
    return {
      ...provenance(call.source, { method: "RULE_BASED_SUMMARY" }),
      headline: facts.headline,
      bullets,
      topPriority: facts.topPriority,
      facts,
      notice: fallbackNote(call.error)
    };
  }

  const { value, rejected } = guard(call.json, SUMMARY_SPEC);

  return {
    ...provenance(AI_SOURCES.MODEL, { method: "LLM_SUMMARY", latencyMs: call.latencyMs }),
    headline: value.headline || facts.headline,
    bullets: value.bullets?.length ? value.bullets : bullets,
    topPriority: value.topPriority || facts.topPriority,
    // The counted figures, so the interface can show what the prose was built from.
    facts,
    rejectedFields: rejected
  };
}

// ---------------------------------------------------------------------------
// 5 · detectAnomaly — narration over a statistical finding
// ---------------------------------------------------------------------------

const ANOMALY_SPEC = {
  interpretation: { type: "text", max: 260 },
  likelyCause: { type: "text", max: 200 },
  recommendedAction: { type: "text", max: 200 },
  severity: { type: "enum", values: ["LOW", "MEDIUM", "HIGH"] }
};

/**
 * Explains an anomaly that the statistics already found.
 *
 * The detection itself is never a model's job — volumeAnomalyService decides
 * what counts as an anomaly, and a model that is asked about one can only
 * describe it. It cannot create a finding, and it cannot suppress one.
 */
export async function detectAnomaly(finding) {
  const prompt = [
    "A campus management system flagged a statistical anomaly. Explain it for an administrator.",
    "",
    `Subject: ${finding.subject}`,
    `Latest day: ${finding.current} records`,
    `Median over the previous ${finding.baselineDays} days: ${finding.baselineMedian}`,
    `Direction: ${finding.direction}, change ${finding.changePct ?? "n/a"}%`,
    `Modified z-score: ${finding.zScore} against a threshold of ${finding.threshold}`,
    ...(finding.supporting?.length
      ? ["", "Most recent records:", ...finding.supporting.map((row) => `- ${row.reference || row.status}: ${row.title || ""}`)]
      : []),
    "",
    "Reply with JSON: { interpretation, likelyCause, recommendedAction, severity (LOW|MEDIUM|HIGH) }"
  ].join("\n");

  const call = await attempt(prompt);

  if (!call.ok) {
    return {
      ...provenance(call.source, { method: finding.method }),
      interpretation: finding.detail,
      likelyCause: null,
      recommendedAction:
        finding.direction === "UP"
          ? `Check whether one underlying fault is driving the rise in ${finding.subject}.`
          : `Confirm that the drop in ${finding.subject} is genuine and not a reporting failure.`,
      severity: Math.abs(finding.zScore) >= finding.threshold * 2 ? "HIGH" : "MEDIUM",
      severityBasis: "Z_SCORE_MAGNITUDE",
      finding,
      notice: fallbackNote(call.error)
    };
  }

  const { value, rejected } = guard(call.json, ANOMALY_SPEC);

  return {
    ...provenance(AI_SOURCES.MODEL, { method: "LLM_ANOMALY_NARRATION", latencyMs: call.latencyMs }),
    interpretation: value.interpretation || finding.detail,
    likelyCause: value.likelyCause || null,
    recommendedAction: value.recommendedAction || "Review the supporting records.",
    severity: value.severity || "MEDIUM",
    severityBasis: value.severity ? "MODEL_REPORTED" : "Z_SCORE_MAGNITUDE",
    // The statistics that produced the finding, unchanged.
    finding,
    rejectedFields: rejected
  };
}

// ---------------------------------------------------------------------------
// 6 · predictDemand — narration over a statistical forecast
// ---------------------------------------------------------------------------

const DEMAND_SPEC = {
  outlook: { type: "text", max: 240 },
  driver: { type: "text", max: 200 },
  preparation: { type: "text", max: 200 }
};

/**
 * Describes a forecast. The numbers come from predictionService and are passed
 * through untouched — a model never produces the figure itself.
 */
export async function predictDemand(prediction) {
  if (!prediction.available) {
    return {
      ...provenance(AI_SOURCES.NOT_CONFIGURED, { method: "STATISTICAL_BASELINE" }),
      available: false,
      outlook: "Not enough history to forecast yet.",
      reasons: prediction.sufficiency.reasons,
      prediction,
      // Nothing was asked of a model, so nothing is attributed to one.
      source: "INSUFFICIENT_DATA",
      notice:
        `A forecast needs at least ${prediction.sufficiency.requirement.minDays} days of history, ` +
        `${prediction.sufficiency.requirement.minActiveDays} of them active, and ` +
        `${prediction.sufficiency.requirement.minEvents} records. No estimate is shown until it does.`
    };
  }

  const forecast = prediction.forecast;
  const prompt = [
    "Describe a campus demand forecast for an administrator. Do not change any number.",
    "",
    `Metric: ${prediction.metric}`,
    `Expected tomorrow: ${forecast.expected} (range ${forecast.range.low}–${forecast.range.high})`,
    `Trend over the window: ${forecast.trend} (${forecast.basis.trendPct}%)`,
    `Busiest period observed: ${prediction.peak?.label || "not established"}`,
    `Most common category in the window: ${prediction.leadingCategory?.category || "n/a"} (${prediction.leadingCategory?.sharePct || 0}%)`,
    "",
    "Reply with JSON: { outlook, driver, preparation }"
  ].join("\n");

  const call = await attempt(prompt);

  if (!call.ok) {
    return {
      ...provenance(call.source, { method: "STATISTICAL_BASELINE" }),
      available: true,
      outlook:
        `Expect roughly ${forecast.expected} records tomorrow (${forecast.range.low}–${forecast.range.high}), ` +
        `on a ${forecast.trend.toLowerCase()} trend.`,
      driver: prediction.leadingCategory
        ? `${prediction.leadingCategory.category} accounts for ${prediction.leadingCategory.sharePct}% of the window.`
        : null,
      preparation: prediction.peak ? `Staff the ${prediction.peak.label} band, which carried ${prediction.peak.sharePct}% of records.` : null,
      prediction,
      label: "ESTIMATE",
      notice: fallbackNote(call.error)
    };
  }

  const { value, rejected } = guard(call.json, DEMAND_SPEC);

  return {
    ...provenance(AI_SOURCES.MODEL, { method: "LLM_FORECAST_NARRATION", latencyMs: call.latencyMs }),
    available: true,
    outlook: value.outlook || `Expect roughly ${forecast.expected} records tomorrow.`,
    driver: value.driver || null,
    preparation: value.preparation || null,
    prediction,
    label: "ESTIMATE",
    rejectedFields: rejected
  };
}

// ---------------------------------------------------------------------------
// 7 · generateAdminAnswer — the admin copilot
// ---------------------------------------------------------------------------

const ANSWER_SPEC = {
  answer: { type: "text", max: 900 },
  followUp: { type: "text", max: 160 }
};

/**
 * Answers an administrator's question from a dataset the controller has already
 * queried out of the database.
 *
 * The model never reaches the database. It is handed a fixed fact sheet and the
 * records behind it, and the records travel back to the interface with the
 * answer so an administrator can check every claim against the rows.
 */
export async function generateAdminAnswer({ question, facts, records, deterministicAnswer }) {
  const prompt = [
    "Answer a campus administrator's question using only the data below.",
    "",
    `Question: ${question}`,
    "",
    "DATA FROM THE CAMPUS DATABASE:",
    ...facts.map((line) => `- ${line}`),
    "",
    "Rules: every number you state must appear above. If the data does not answer the question, say exactly that.",
    "Reply with JSON: { answer, followUp (a question the administrator could ask next) }"
  ].join("\n");

  const call = await attempt(prompt);

  if (!call.ok) {
    return {
      ...provenance(call.source, { method: "RULE_BASED_INTENT_MATCH" }),
      answer: deterministicAnswer,
      followUp: null,
      facts,
      records,
      notice: fallbackNote(call.error)
    };
  }

  const { value, rejected } = guard(call.json, ANSWER_SPEC);

  return {
    ...provenance(AI_SOURCES.MODEL, { method: "LLM_GROUNDED_ANSWER", latencyMs: call.latencyMs }),
    answer: value.answer || deterministicAnswer,
    followUp: value.followUp || null,
    // Always returned: the interface shows the rows the answer was built from.
    facts,
    records,
    grounding: "The model was given only the facts listed here and has no database access.",
    rejectedFields: rejected
  };
}

// ---------------------------------------------------------------------------
// 8 · assessGatePassRisk — narration over counted signals
// ---------------------------------------------------------------------------

const GATE_RISK_SPEC = {
  summary: { type: "text", max: 260 },
  recommendedReview: { type: "text", max: 200 }
};

export async function assessGatePassRisk(assessment, student) {
  if (!assessment.signals?.length) {
    return {
      ...provenance(AI_SOURCES.NOT_CONFIGURED, { method: assessment.method }),
      source: "NO_SIGNAL",
      summary: assessment.note || "No unusual pattern in this student's gate-pass history.",
      recommendedReview: null,
      assessment
    };
  }

  const prompt = [
    "A hostel warden is reviewing gate-pass patterns. Summarise what the counted signals below show.",
    "Do not recommend punishment, refusal, or any action against the student — only what a warden should look at.",
    "",
    `Student reference: ${student?.studentId || "withheld"}`,
    `Passes in window: ${assessment.totalPasses}`,
    ...assessment.signals.map((signal) => `- ${signal.label}${signal.detail ? ` (${signal.detail})` : ""}`),
    "",
    "Reply with JSON: { summary, recommendedReview }"
  ].join("\n");

  const call = await attempt(prompt);

  if (!call.ok) {
    return {
      ...provenance(call.source, { method: assessment.method }),
      summary: assessment.signals.map((signal) => signal.label).join("; ") + ".",
      recommendedReview: "Open the listed passes and confirm the pattern with the student before drawing any conclusion.",
      assessment,
      notice: fallbackNote(call.error)
    };
  }

  const { value, rejected } = guard(call.json, GATE_RISK_SPEC);

  return {
    ...provenance(AI_SOURCES.MODEL, { method: "LLM_SIGNAL_NARRATION", latencyMs: call.latencyMs }),
    summary: value.summary || assessment.signals.map((signal) => signal.label).join("; "),
    recommendedReview: value.recommendedReview || "Review the listed passes with the student.",
    assessment,
    rejectedFields: rejected,
    governance: assessment.governance
  };
}

// ---------------------------------------------------------------------------
// 9–14 · narration over operational analyses
// ---------------------------------------------------------------------------

/**
 * The shared shape behind the operational narrators below.
 *
 * The analysis has already been computed from the database. A model — when one
 * is configured — may only phrase it, through a validated spec; the counted
 * `analysis` travels back unchanged either way, and the deterministic fallback
 * is always a complete, usable answer on its own.
 */
async function narrate({ prompt, spec, fallback, method }) {
  const call = await attempt(prompt);
  if (!call.ok) {
    return {
      ...provenance(call.source, { method: `${method}_RULE_BASED` }),
      ...fallback,
      notice: fallbackNote(call.error)
    };
  }
  const { value, rejected } = guard(call.json, spec);
  const merged = { ...fallback };
  for (const key of Object.keys(spec)) {
    const given = value[key];
    if (given !== undefined && !(Array.isArray(given) && !given.length)) merged[key] = given;
  }
  return {
    ...provenance(AI_SOURCES.MODEL, { method: `LLM_${method}`, latencyMs: call.latencyMs }),
    ...merged,
    rejectedFields: rejected
  };
}

const NARRATIVE_SPEC = {
  headline: { type: "text", max: 220 },
  insights: { type: "list", max: 220, limit: 5 },
  recommendation: { type: "text", max: 260 }
};

const JSON_REPLY = "Reply with JSON: { headline (one sentence), insights (array of short factual lines), recommendation }";

/** Feature 8 — explains the SLA forecast. The risk levels are never changed. */
export async function predictSlaBreach(forecast) {
  const top = forecast.rows.filter((row) => row.risk !== "LOW").slice(0, 6);
  const { BREACHED, HIGH, MEDIUM } = forecast.counts;
  const fallback = {
    headline: BREACHED || HIGH
      ? `${BREACHED} complaint${BREACHED === 1 ? " has" : "s have"} already breached SLA and ${HIGH} ${HIGH === 1 ? "is" : "are"} at high risk of breaching.`
      : `No open complaint is at high risk of breaching its SLA; ${MEDIUM} ${MEDIUM === 1 ? "needs" : "need"} watching.`,
    insights: top.slice(0, 4).map((row) => `${row.reference} (${row.category}, ${row.status}): ${row.risk} — ${row.reasons[0]}`),
    recommendation: top.length
      ? `Review ${top[0].reference} first${top[0].department ? ` with ${top[0].department}` : ""}.`
      : "Hold the normal schedule."
  };
  return narrate({
    method: "SLA_NARRATION",
    spec: NARRATIVE_SPEC,
    fallback,
    prompt: [
      "Explain a complaint SLA breach forecast to a campus administrator. Do not change any risk level or number.",
      "",
      `Open complaints examined: ${forecast.openExamined}. Resolved complaints in history: ${forecast.resolvedHistory}.`,
      `Counts — BREACHED: ${BREACHED}, HIGH: ${HIGH}, MEDIUM: ${MEDIUM}, LOW: ${forecast.counts.LOW}.`,
      "Highest-risk complaints:",
      ...top.map((row) => `- ${row.reference} · ${row.category} · ${row.status} · age ${row.ageHours}h of ${row.slaHours}h SLA · ${row.risk} · ${row.reasons.join(" ")}`),
      "",
      JSON_REPLY
    ].join("\n")
  });
}

/** Feature 9 — phrases the workload analysis. Recommends; never reassigns. */
export async function analyzeWorkload(analysis) {
  const flagged = analysis.departments.filter((row) => row.attention !== "NORMAL");
  const lead = analysis.departments[0];
  const fallback = {
    headline: lead
      ? `${lead.department} carries the largest queue: ${lead.pending} of ${analysis.totalPending} pending complaints.`
      : "No complaint is pending.",
    insights: flagged.slice(0, 4).map((row) => `${row.department}: ${row.flags.join(" ")}`),
    recommendation: flagged.length
      ? `Look at ${flagged[0].department}'s queue first — ${flagged[0].flags[0]}`
      : "No department queue stands out. Hold the current allocation."
  };
  return narrate({
    method: "WORKLOAD_NARRATION",
    spec: NARRATIVE_SPEC,
    fallback,
    prompt: [
      "Advise a campus administrator on complaint workload. Recommend where to look; do not reassign anyone or invent numbers.",
      "",
      `Total pending: ${analysis.totalPending}. Average per department: ${analysis.averagePending}. Throughput window: ${analysis.windowDays} days.`,
      ...analysis.departments.map((row) =>
        `- ${row.department}: ${row.pending} pending (${row.critical} critical, ${row.high} high), oldest ${row.oldestAgeDays}d, resolved ${row.resolvedInWindow} in window, days to clear ${row.daysToClear ?? "not measurable"}, attention ${row.attention}`
      ),
      "",
      JSON_REPLY
    ].join("\n")
  });
}

/** Feature 12 — describes a simulation. The estimate itself is arithmetic. */
export async function explainSimulation(input, result) {
  const worst = result.departments[0];
  const fallback = {
    headline:
      `A ${input.increasePct >= 0 ? "+" : ""}${input.increasePct}% change in complaints would mean about ${result.estimated.filedInWindow} filed ` +
      `per ${input.windowDays} days instead of ${result.current.filedInWindow}.`,
    insights: [
      `Backlog after ${input.horizonDays} days: about ${result.estimated.pendingAfterHorizon} (now ${result.current.pendingNow}).`,
      ...(worst ? [`${worst.department} would carry the largest queue: about ${worst.estimatedPendingAfterHorizon}.`] : [])
    ],
    recommendation: result.estimated.backlogChange > 0
      ? `Current throughput (${result.current.resolvedPerDay}/day) would not keep up; plan extra capacity${worst ? ` for ${worst.department}` : ""}.`
      : "Current throughput would absorb this change."
  };
  return narrate({
    method: "SIMULATION_NARRATION",
    spec: NARRATIVE_SPEC,
    fallback,
    prompt: [
      "Explain a what-if simulation to a campus administrator. It is an estimate; say so. Do not change any number.",
      "",
      `Scenario: complaint inflow ${input.increasePct >= 0 ? "+" : ""}${input.increasePct}%, horizon ${input.horizonDays} days, baseline window ${input.windowDays} days.`,
      `Current: ${result.current.filedInWindow} filed in window, ${result.current.resolvedPerDay} resolved/day, ${result.current.pendingNow} pending.`,
      `Estimated: ${result.estimated.filedInWindow} filed, ${result.estimated.pendingAfterHorizon} pending after horizon (change ${result.estimated.backlogChange}).`,
      ...result.departments.slice(0, 6).map((row) => `- ${row.department}: ${row.pendingNow} → ${row.estimatedPendingAfterHorizon}`),
      "",
      JSON_REPLY
    ].join("\n")
  });
}

/** Feature 15 — summarises the data-quality report. Never proposes deletions. */
export async function narrateDataQuality(report) {
  const worst = report.findings.slice().sort((a, b) => (a.severity === "HIGH" ? -1 : 1) - (b.severity === "HIGH" ? -1 : 1))[0];
  const fallback = {
    headline: report.checksFailing
      ? `${report.issuesFound} record${report.issuesFound === 1 ? "" : "s"} failed ${report.checksFailing} of ${report.checksRun} integrity checks.`
      : `All ${report.checksRun} integrity checks passed.`,
    insights: report.findings.slice(0, 5).map((row) => `${row.count} × ${row.title}`),
    recommendation: worst
      ? `Start with "${worst.title}" — open the listed records and correct them by hand.`
      : "No action needed."
  };
  return narrate({
    method: "DATA_QUALITY_NARRATION",
    spec: NARRATIVE_SPEC,
    fallback,
    prompt: [
      "Summarise a database integrity report for a campus administrator. Do not recommend deleting records.",
      "",
      `${report.checksRun} checks run, ${report.checksFailing} failing, ${report.issuesFound} records affected.`,
      ...report.findings.map((row) => `- [${row.severity}] ${row.title}: ${row.count} (${row.detail})`),
      "",
      JSON_REPLY
    ].join("\n")
  });
}

/** Feature 17 — reads the feedback aggregate. Invents no feedback. */
export async function analyzeFeedback(summary) {
  if (!summary.available) {
    return {
      ...provenance(AI_SOURCES.NOT_CONFIGURED, { method: "NO_FEEDBACK" }),
      source: "INSUFFICIENT_DATA",
      headline: summary.note,
      insights: [],
      recommendation: null
    };
  }
  const worst = summary.byCategory[0];
  const fallback = {
    headline: `${summary.total} rating${summary.total === 1 ? "" : "s"}, average ${summary.averageRating}/5 — ${summary.sentiment.NEGATIVE} negative, ${summary.sentiment.POSITIVE} positive.`,
    insights: [
      ...(worst ? [`Lowest-rated category: ${worst.key} at ${worst.averageRating}/5 over ${worst.count} rating${worst.count === 1 ? "" : "s"}.`] : []),
      ...(summary.repeatedIssues.length ? [`Words recurring in low ratings: ${summary.repeatedIssues.map((t) => `${t.term} (${t.count})`).join(", ")}.`] : []),
      ...(summary.suggestions.length ? [`${summary.suggestions.length} comment${summary.suggestions.length === 1 ? " contains" : "s contain"} a suggestion.`] : [])
    ],
    recommendation: worst && worst.averageRating < 3
      ? `Review how ${worst.key} complaints are being closed.`
      : "Satisfaction is holding; keep the current approach."
  };
  return narrate({
    method: "FEEDBACK_ANALYSIS",
    spec: NARRATIVE_SPEC,
    fallback,
    prompt: [
      "Analyse student feedback on resolved campus complaints for an administrator. Use only the data below.",
      "",
      `Ratings: ${summary.total}, average ${summary.averageRating}/5. Sentiment: ${JSON.stringify(summary.sentiment)}.`,
      `By category: ${summary.byCategory.map((row) => `${row.key} ${row.averageRating}/5 (${row.count})`).join("; ")}`,
      "Comments:",
      ...summary.recent.filter((row) => row.comment).slice(0, 12).map((row) => `- [${row.rating}/5, ${row.category}] ${row.comment}`),
      "",
      "Identify repeated issues, suggestions and satisfaction patterns.",
      JSON_REPLY
    ].join("\n")
  });
}

/** Feature 11 — phrases the cross-module findings as correlations only. */
export async function explainCorrelations(snapshot) {
  const fallback = {
    headline: snapshot.findings.length
      ? `${snapshot.findings.length} hostel${snapshot.findings.length === 1 ? " shows" : "s show"} several elevated signals at once.`
      : "No hostel shows two or more elevated signals together.",
    insights: snapshot.findings.map((row) => row.statement),
    recommendation: snapshot.findings.length
      ? `Review ${snapshot.findings[0].hostel} across maintenance, wardens and the academic office together.`
      : "No joint review is indicated."
  };
  return narrate({
    method: "CORRELATION_NARRATION",
    spec: NARRATIVE_SPEC,
    fallback,
    prompt: [
      "Describe co-occurring signals across campus modules. Call them possible correlations; never claim one causes another.",
      "",
      ...snapshot.hostels.map((row) =>
        `- ${row.name}: ${row.residents} residents, ${row.complaints} complaints (${snapshot.windowDays}d), ${row.incidents} open incidents, ${row.latePasses} late/overdue passes, ${row.lowAttendance} below ${snapshot.attendanceThreshold}% attendance`
      ),
      "Flagged:",
      ...snapshot.findings.map((row) => `- ${row.statement}`),
      "",
      JSON_REPLY
    ].join("\n")
  });
}

const RESOLUTION_SPEC = {
  suggestion: { type: "text", max: 320 },
  basedOn: { type: "list", max: 40, limit: 3 },
  caution: { type: "text", max: 200 }
};

/** Feature 16 — suggests a fix from resolutions that actually worked. */
export async function suggestResolution(complaint, learning) {
  if (!learning.precedents.length) {
    return {
      ...provenance(AI_SOURCES.NOT_CONFIGURED, { method: learning.method }),
      source: "INSUFFICIENT_DATA",
      suggestion: null,
      basedOn: [],
      caution: learning.note || "No sufficiently similar resolved complaint was found."
    };
  }
  const best = learning.precedents[0];
  const fallback = {
    suggestion: `${best.reference} (${best.textSimilarity}% similar) was resolved by: ${best.resolution}`,
    basedOn: learning.precedents.map((row) => row.reference),
    caution: "Matched on shared wording only — confirm the fault is the same before reusing the fix."
  };
  return narrate({
    method: "RESOLUTION_SUGGESTION",
    spec: RESOLUTION_SPEC,
    fallback,
    prompt: [
      "Suggest how to resolve a new campus complaint, using only the past resolutions listed.",
      "",
      `New complaint: ${complaint.title} — ${complaint.description}`,
      "Past resolved complaints:",
      ...learning.precedents.map((row) =>
        `- ${row.reference} (${row.textSimilarity}% similar, ${row.resolutionTimeHours ?? "?"}h, rating ${row.rating ?? "none"}): ${row.title} → ${row.resolution}`
      ),
      "",
      "Reply with JSON: { suggestion, basedOn (array of the references you used), caution }"
    ].join("\n")
  });
}

export const AI_METHODS = {
  classifyComplaint,
  detectDuplicate,
  analyzeRootCause,
  summarizeCampus,
  detectAnomaly,
  predictDemand,
  generateAdminAnswer,
  assessGatePassRisk,
  predictSlaBreach,
  analyzeWorkload,
  explainSimulation,
  narrateDataQuality,
  analyzeFeedback,
  explainCorrelations,
  suggestResolution,
  status
};
