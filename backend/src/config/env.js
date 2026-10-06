import dotenv from "dotenv";

dotenv.config();

const required = ["MONGO_URI", "JWT_SECRET"];

const list = (value, fallback) =>
  String(value ?? fallback ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || "development",
  mongoUri: process.env.MONGO_URI || "",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  cookieName: process.env.COOKIE_NAME || "nex_token",
  clientUrls: list(process.env.CLIENT_URL, "http://localhost:5173"),
  demo: {
    studentEmail: process.env.DEMO_STUDENT_EMAIL || "pritish@bput.ac.in",
    studentPassword: process.env.DEMO_STUDENT_PASSWORD || "Campus@2026",
    adminEmail: process.env.DEMO_ADMIN_EMAIL || "control@bput.ac.in",
    adminPassword: process.env.DEMO_ADMIN_PASSWORD || "Control@2026",
    // Placeholder guardian number for the seeded students. Not a real number,
    // and never used unless a real SMS provider is configured.
    parentPhone: process.env.DEMO_PARENT_PHONE || "+910000000000"
  },

  // Outbound SMS for the gate-pass parent OTP. Credentials live here only —
  // nothing under this key is ever sent to the browser.
  sms: {
    // "console" prints the message to the server log and delivers nothing,
    // which is what development and CI run on. "http" and "twilio" are real.
    provider: (process.env.SMS_PROVIDER || "console").toLowerCase(),
    url: process.env.SMS_PROVIDER_URL || "",
    apiKey: process.env.SMS_PROVIDER_API_KEY || "",
    apiSecret: process.env.SMS_PROVIDER_API_SECRET || "",
    senderId: process.env.SMS_SENDER_ID || "CAMPUS",
    // Field names differ between Indian gateways; these keep the generic HTTP
    // provider usable without writing a new adapter for each one.
    toField: process.env.SMS_PROVIDER_TO_FIELD || "to",
    messageField: process.env.SMS_PROVIDER_MESSAGE_FIELD || "message",
    senderField: process.env.SMS_PROVIDER_SENDER_FIELD || "sender",
    authHeader: process.env.SMS_PROVIDER_AUTH_HEADER || "authorization",
    authScheme: process.env.SMS_PROVIDER_AUTH_SCHEME || "Bearer",
    timeoutMs: Number(process.env.SMS_TIMEOUT_MS || 8000)
  },

  // ---- AI provider -------------------------------------------------------
  // Nothing under this key is ever sent to the browser. When apiKey is empty
  // the AI layer reports itself as NOT_CONFIGURED and every feature falls back
  // to the deterministic services that already shipped — no fabricated model
  // name, no fabricated confidence.
  ai: {
    provider: (process.env.AI_PROVIDER || "").trim().toLowerCase(),
    apiKey: process.env.AI_API_KEY || "",
    model: (process.env.AI_MODEL || "").trim(),
    // Optional override. Each provider has a sane default in providerClient.js.
    baseUrl: (process.env.AI_BASE_URL || "").trim().replace(/\/$/, ""),
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 12000),
    maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 900),
    // Anthropic only; ignored by the OpenAI-compatible adapter.
    apiVersion: (process.env.AI_API_VERSION || "2023-06-01").trim(),
    // Hard ceiling on how much campus text one prompt may carry, so a large
    // database never turns into a large bill or a slow request.
    maxInputChars: Number(process.env.AI_MAX_INPUT_CHARS || 12000)
  },

  gatePass: {
    otpLength: 6,
    otpTtlMinutes: Number(process.env.GATE_PASS_OTP_TTL_MINUTES || 10),
    otpMaxAttempts: Number(process.env.GATE_PASS_OTP_MAX_ATTEMPTS || 5),
    otpMaxSends: Number(process.env.GATE_PASS_OTP_MAX_SENDS || 5),
    otpResendCooldownSeconds: Number(process.env.GATE_PASS_OTP_RESEND_SECONDS || 60),
    maxDurationHours: Number(process.env.GATE_PASS_MAX_HOURS || 12),
    // Development convenience only: returns the OTP in the API response so the
    // flow is demonstrable without a live SMS gateway. Refused in production.
    revealOtp:
      String(process.env.GATE_PASS_REVEAL_OTP || "").toLowerCase() === "true" &&
      (process.env.NODE_ENV || "development") !== "production",
    sweepSeconds: Number(process.env.GATE_PASS_SWEEP_SECONDS || 30)
  }
};

export const isProduction = env.nodeEnv === "production";

// Fail fast rather than booting a server that cannot authenticate anyone.
export function assertEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Copy backend/.env.example to backend/.env and fill it in."
    );
  }
  if (env.jwtSecret.length < 24) {
    throw new Error("JWT_SECRET must be at least 24 characters long.");
  }
}

// True only when a provider, a key and a model are all present. Everything in
// services/aiService.js keys off this rather than guessing.
export function aiConfigured() {
  return Boolean(env.ai.provider && env.ai.apiKey && env.ai.model);
}

// Safe to send to an authorised client: names the provider and model in use,
// never the key.
export function aiPublicConfig() {
  return {
    configured: aiConfigured(),
    provider: env.ai.provider || null,
    model: env.ai.model || null,
    timeoutMs: env.ai.timeoutMs
  };
}
