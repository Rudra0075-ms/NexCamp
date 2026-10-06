import { AI_SOURCES } from "../../config/constants.js";
import { aiConfigured, env } from "../../config/env.js";
import { completeJson } from "./providerClient.js";
import { guard } from "./jsonGuard.js";

/**
 * The language layer for the student intelligence surfaces.
 *
 * The numbers, classifications and evidence on the Dashboard, Attendance and
 * Mess pages are always computed by the deterministic services. When a model
 * is configured, it is given those computed facts and asked for two things
 * only: which intent a free-text question belongs to, and a plainer wording of
 * an answer that has already been computed. Its output goes through the same
 * validation guard as the rest of the AI layer; anything that does not
 * validate is dropped and the rule-based wording stands.
 *
 * The provenance block says which of the two produced the text, every time.
 */

const SYSTEM =
  "You are the explanation layer of a university campus system. Reply with one JSON object and nothing else. " +
  "Use only the facts you are given. Never add numbers, dates, names or causes that are not in the facts. " +
  "If the facts do not answer the question, say that plainly.";

export function provenance(source, extra = {}) {
  return {
    source,
    provider: source === AI_SOURCES.MODEL ? env.ai.provider : null,
    model: source === AI_SOURCES.MODEL ? env.ai.model : null,
    ...extra
  };
}

function noteFor(source, reason) {
  if (source === AI_SOURCES.MODEL) return "Wording by the configured model from the computed facts; the figures are computed by rules.";
  if (source === AI_SOURCES.NOT_CONFIGURED) return "No AI provider is configured, so the rule-based analysis wrote this answer.";
  return `The AI provider was unavailable (${reason || "error"}), so the rule-based analysis wrote this answer.`;
}

/**
 * Asks the model to pick one intent id for a question. Returns null when no
 * model is configured, the call fails, or the reply is not one of `intents`.
 */
export async function classifyIntentWithModel(question, intents) {
  if (!aiConfigured()) return null;
  try {
    const { json } = await completeJson({
      system: SYSTEM,
      prompt:
        `Classify the student's question into exactly one intent id from this list, or UNKNOWN.\n` +
        intents.map((row) => `- ${row.id}: ${row.description}`).join("\n") +
        `\n\nQuestion: ${JSON.stringify(question)}\n\nReply as {"intent": "<id>", "confidence": <0-100>}.`
    });
    const { value } = guard(json, {
      intent: { type: "enum", values: [...intents.map((row) => row.id), "UNKNOWN"] },
      confidence: { type: "number", min: 0, max: 100 }
    });
    if (!value.intent || value.intent === "UNKNOWN") return null;
    return { intent: value.intent, confidence: value.confidence ?? null };
  } catch (error) {
    console.warn(`narrate: intent classification fell back to rules — ${error.message}`);
    return null;
  }
}

/**
 * Rewords a computed answer. `facts` is the rule-based answer: { answer,
 * points[] } plus whatever evidence strings the model may cite. Returns the
 * same shape with a provenance block.
 */
export async function narrate({ question, answer, points = [], facts = [] }) {
  if (!aiConfigured()) {
    return { answer, points, provenance: provenance(AI_SOURCES.NOT_CONFIGURED, { note: noteFor(AI_SOURCES.NOT_CONFIGURED) }) };
  }
  try {
    const { json, latencyMs } = await completeJson({
      system: SYSTEM,
      prompt:
        `A student asked: ${JSON.stringify(question)}\n\n` +
        `Computed answer: ${JSON.stringify(answer)}\n` +
        `Computed points:\n${points.map((p) => `- ${p}`).join("\n")}\n` +
        `Supporting facts:\n${facts.map((f) => `- ${f}`).join("\n")}\n\n` +
        `Rewrite the answer for the student in plain, direct language (max 2 sentences) and give up to 4 short points. ` +
        `Keep every number exactly as given. Reply as {"answer": "...", "points": ["..."]}.`
    });
    const { value, rejected } = guard(json, {
      answer: { type: "text", max: 360 },
      points: { type: "list", max: 200, limit: 4 }
    });
    if (!value.answer) throw new Error("model answer did not validate");
    return {
      answer: value.answer,
      points: value.points?.length ? value.points : points,
      provenance: provenance(AI_SOURCES.MODEL, { latencyMs, rejected, note: noteFor(AI_SOURCES.MODEL) })
    };
  } catch (error) {
    console.warn(`narrate: wording fell back to rules — ${error.message}`);
    return { answer, points, provenance: provenance(AI_SOURCES.FALLBACK, { note: noteFor(AI_SOURCES.FALLBACK, error.reason) }) };
  }
}
