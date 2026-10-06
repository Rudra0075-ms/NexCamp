import { env, isProduction } from "../config/env.js";

/**
 * Outbound SMS.
 *
 * Three providers, chosen with SMS_PROVIDER:
 *
 *   console  no credentials, nothing leaves the process — the message is
 *            written to the server log. This is the development default and
 *            keeps the whole gate-pass flow runnable with an empty .env.
 *   http     a generic JSON gateway (MSG91, Fast2SMS, TextLocal and most
 *            Indian aggregators fit this shape). Field names are configurable
 *            so a new gateway needs env changes, not code changes.
 *   twilio   Twilio's Messages resource, Basic auth with SID + auth token.
 *
 * Nothing in here is ever imported by the frontend, and no credential is ever
 * placed in an API response.
 */

const MASK_VISIBLE = 4;

/** "+919812345678" -> "+91XXXXXX5678". Safe to store and to display. */
export function maskPhone(phone) {
  const text = String(phone || "").trim();
  if (!text) return "";
  const tail = text.slice(-MASK_VISIBLE);
  const head = text.startsWith("+") ? text.slice(0, 3) : "";
  return `${head}${"X".repeat(Math.max(0, text.length - head.length - MASK_VISIBLE))}${tail}`;
}

/** Rejects anything that is not plausibly a dialable number. */
export function normalisePhone(phone) {
  const text = String(phone || "").replace(/[\s()-]/g, "");
  if (!/^\+?\d{8,15}$/.test(text)) return null;
  return text;
}

export function smsConfigured() {
  const { provider, url, apiKey, apiSecret } = env.sms;
  if (provider === "http") return Boolean(url && apiKey);
  if (provider === "twilio") return Boolean(url && apiKey && apiSecret);
  return false;
}

/** What the interface is allowed to know about the delivery channel. */
export function smsStatus() {
  return {
    provider: env.sms.provider,
    configured: smsConfigured(),
    mode: smsConfigured() ? "LIVE" : "DEVELOPMENT_LOG",
    senderId: env.sms.senderId
  };
}

async function sendOverHttp(to, message) {
  const { url, apiKey, senderId, toField, messageField, senderField, authHeader, authScheme, timeoutMs } = env.sms;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [authHeader]: authScheme ? `${authScheme} ${apiKey}` : apiKey
      },
      body: JSON.stringify({
        [toField]: to,
        [messageField]: message,
        [senderField]: senderId
      }),
      signal: controller.signal
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`SMS gateway responded ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return { delivered: true, mode: "http" };
  } finally {
    clearTimeout(timer);
  }
}

async function sendOverTwilio(to, message) {
  const { url, apiKey, apiSecret, senderId, timeoutMs } = env.sms;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`
      },
      body: new URLSearchParams({ To: to, From: senderId, Body: message }).toString(),
      signal: controller.signal
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`Twilio responded ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return { delivered: true, mode: "twilio" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one message. Never throws: delivery failure is reported in the return
 * value so a gate pass is not lost because a gateway was briefly unreachable.
 */
export async function sendSms(phone, message) {
  const to = normalisePhone(phone);
  if (!to) return { delivered: false, mode: "invalid", error: "Recipient number is not valid" };

  if (!smsConfigured()) {
    if (isProduction) {
      return {
        delivered: false,
        mode: "unconfigured",
        error: "No SMS provider is configured — set SMS_PROVIDER and its credentials"
      };
    }
    // Development: the message is visible to whoever is running the server,
    // which is what makes the flow demonstrable without a paid gateway.
    console.log(`[sms:console] to ${maskPhone(to)} — ${message}`);
    return { delivered: false, mode: "console" };
  }

  try {
    if (env.sms.provider === "twilio") return await sendOverTwilio(to, message);
    return await sendOverHttp(to, message);
  } catch (error) {
    console.error(`[sms:${env.sms.provider}] delivery failed:`, error.message);
    return { delivered: false, mode: env.sms.provider, error: error.message };
  }
}
