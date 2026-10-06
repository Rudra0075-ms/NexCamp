import { env, aiConfigured } from "../../config/env.js";

/**
 * The only place in the codebase that talks to an AI provider.
 *
 * Two adapters cover every provider this project needs:
 *
 *   anthropic  — the Messages API (api.anthropic.com/v1/messages)
 *   openai     — any OpenAI-compatible /chat/completions endpoint, which is
 *                what OpenAI, Groq, Together, OpenRouter, Ollama and most
 *                local runtimes all speak
 *
 * The key is read from the environment here and never leaves this module. No
 * caller receives it, no response echoes it, and nothing under env.ai is ever
 * serialised into an API response — see aiPublicConfig() in config/env.js.
 */

const DEFAULT_BASE = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com"
};

export class AiUnavailableError extends Error {
  constructor(message, { reason = "PROVIDER_ERROR", status } = {}) {
    super(message);
    this.name = "AiUnavailableError";
    this.reason = reason;
    this.status = status;
  }
}

/** Which adapter a provider name maps to. Unknown names are OpenAI-compatible. */
function adapterFor(provider) {
  return provider === "anthropic" ? "anthropic" : "openai";
}

function baseUrlFor(provider) {
  if (env.ai.baseUrl) return env.ai.baseUrl;
  return DEFAULT_BASE[adapterFor(provider)];
}

/**
 * Keeps a prompt inside the configured character ceiling. Truncation is
 * announced in the text itself so the model is never silently given half a
 * dataset and asked to count it.
 */
export function capInput(text, limit = env.ai.maxInputChars) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[truncated — ${value.length - limit} further characters omitted]`;
}

/** Pulls the first JSON object out of a model reply that may be fenced or prefaced. */
export function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to a brace scan */
  }

  const start = candidate.indexOf("{");
  if (start < 0) return null;
  // Walk to the matching brace rather than taking the last one, so trailing
  // prose after a complete object does not break the parse.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function buildRequest({ adapter, system, prompt }) {
  const base = baseUrlFor(env.ai.provider);

  if (adapter === "anthropic") {
    return {
      url: `${base}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ai.apiKey,
        "anthropic-version": env.ai.apiVersion
      },
      body: {
        model: env.ai.model,
        max_tokens: env.ai.maxOutputTokens,
        system,
        messages: [{ role: "user", content: prompt }]
      }
    };
  }

  return {
    url: `${base}/v1/chat/completions`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.ai.apiKey}`
    },
    body: {
      model: env.ai.model,
      max_tokens: env.ai.maxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    }
  };
}

function readText(adapter, payload) {
  if (adapter === "anthropic") {
    const blocks = Array.isArray(payload?.content) ? payload.content : [];
    return blocks.filter((block) => block?.type === "text").map((block) => block.text).join("\n");
  }
  return payload?.choices?.[0]?.message?.content || "";
}

/**
 * One provider call that must come back as a JSON object.
 *
 * Throws AiUnavailableError on anything that is not a validated object: not
 * configured, timeout, transport failure, non-2xx, or unparseable output. Every
 * caller in aiService.js turns that into a labelled deterministic fallback
 * rather than into a failed request.
 */
export async function completeJson({ system, prompt, signal } = {}) {
  if (!aiConfigured()) {
    throw new AiUnavailableError("No AI provider is configured", { reason: "NOT_CONFIGURED" });
  }

  const adapter = adapterFor(env.ai.provider);
  const request = buildRequest({ adapter, system, prompt: capInput(prompt) });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ai.timeoutMs);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = error.name === "AbortError";
    throw new AiUnavailableError(
      timedOut ? `AI request timed out after ${env.ai.timeoutMs}ms` : "AI provider unreachable",
      { reason: timedOut ? "TIMEOUT" : "TRANSPORT" }
    );
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* handled below */
  }

  if (!response.ok) {
    // Provider error bodies can quote request headers, so only the status and a
    // short provider-supplied message are surfaced — never the raw body.
    const detail = typeof payload?.error?.message === "string" ? payload.error.message.slice(0, 200) : "";
    throw new AiUnavailableError(`AI provider returned ${response.status}${detail ? ` — ${detail}` : ""}`, {
      reason: "HTTP_ERROR",
      status: response.status
    });
  }

  const json = extractJson(readText(adapter, payload));
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new AiUnavailableError("AI provider did not return a JSON object", { reason: "BAD_OUTPUT" });
  }

  return {
    json,
    provider: env.ai.provider,
    model: env.ai.model,
    latencyMs: Date.now() - startedAt
  };
}
