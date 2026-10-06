import { AI_SOURCES } from "../../config/constants.js";
import { aiConfigured, env } from "../../config/env.js";
import { completeJson } from "../ai/providerClient.js";
import { guard } from "../ai/jsonGuard.js";
import { isSafeLanguage } from "./supportRules.js";

/**
 * Silent Support System — optional model phrasing.
 *
 * Uses the project's existing provider client (services/ai/providerClient.js),
 * so the same AI_PROVIDER / AI_API_KEY / AI_MODEL settings apply and no key is
 * handled here. What a model is allowed to do is deliberately small:
 *
 *   - it receives only the support band and plain reason lines — never the
 *     student's name, ID, raw answers or anything they typed;
 *   - it may only re-word the supportive message and the next step;
 *   - its output must pass the JSON guard AND the non-clinical language check,
 *     otherwise the rule-based wording is used;
 *   - it is never called for IMMEDIATE_ATTENTION: the safety message is fixed.
 *
 * The band is decided by supportRules.js before this runs and is never changed.
 */

const SYSTEM =
  "You write short, warm, plain-language messages for a university student-support check-in. " +
  "You are not a clinician and must never diagnose, name a condition, or suggest the student has an illness or disorder. " +
  "Encourage human connection and make asking for help feel easy. Reply only with one JSON object.";

const SPEC = {
  message: { type: "text", max: 260 },
  nextStep: { type: "text", max: 160 }
};

// A check-in should never wait long on a model; the rule-based text is ready.
const PHRASE_TIMEOUT_MS = 6000;

function labelled(source, extra = {}) {
  return {
    source,
    provider: source === AI_SOURCES.MODEL ? env.ai.provider : null,
    model: source === AI_SOURCES.MODEL ? env.ai.model : null,
    ...extra
  };
}

/**
 * @param {object} analysis  the result of analyseCheckIn()
 * @returns {Promise<{message, nextStep, source, provider, model, method}>}
 */
export async function phraseSupportMessage(analysis) {
  const fallback = { message: analysis.message, nextStep: analysis.nextStep };
  if (analysis.band === "IMMEDIATE_ATTENTION") {
    return { ...fallback, ...labelled(AI_SOURCES.NOT_CONFIGURED, { method: "FIXED_SAFETY_MESSAGE", source: "SAFETY_RULE" }) };
  }
  if (!aiConfigured()) {
    return { ...fallback, ...labelled(AI_SOURCES.NOT_CONFIGURED, { method: "RULE_BASED_SUPPORT_MESSAGE" }) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(PHRASE_TIMEOUT_MS, env.ai.timeoutMs || PHRASE_TIMEOUT_MS));
  try {
    const { json, latencyMs } = await completeJson({
      system: SYSTEM,
      signal: controller.signal,
      prompt: [
        `Support level (routing only, not a diagnosis): ${analysis.label}.`,
        analysis.reasons.length ? `What the student indicated:\n${analysis.reasons.map((r) => `- ${r}`).join("\n")}` : "The student indicated nothing in particular.",
        "",
        "Write one or two sentences (message) acknowledging the check-in kindly, and one short next step (nextStep).",
        "Use phrases like 'you may benefit from additional support' or 'would you like to talk to someone?'.",
        'Reply with JSON: { "message": string, "nextStep": string }'
      ].join("\n")
    });
    const { value } = guard(json, SPEC);
    const message = isSafeLanguage(value.message) ? value.message : fallback.message;
    const nextStep = isSafeLanguage(value.nextStep) ? value.nextStep : fallback.nextStep;
    const used = message !== fallback.message || nextStep !== fallback.nextStep;
    return {
      message,
      nextStep,
      ...labelled(used ? AI_SOURCES.MODEL : AI_SOURCES.FALLBACK, { method: used ? "LLM_SUPPORT_MESSAGE" : "RULE_BASED_SUPPORT_MESSAGE", latencyMs })
    };
  } catch (error) {
    // Expected operating condition. The reason is logged; the student's answers are not.
    console.warn(`supportAi: using rule-based wording — ${error.reason || error.message}`);
    return { ...fallback, ...labelled(AI_SOURCES.FALLBACK, { method: "RULE_BASED_SUPPORT_MESSAGE" }) };
  } finally {
    clearTimeout(timer);
  }
}
