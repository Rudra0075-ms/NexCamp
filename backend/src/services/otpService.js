import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { OtpVerification } from "../models/OtpVerification.js";
import { ApiError } from "../utils/ApiError.js";
import { maskPhone, sendSms } from "./smsService.js";

/** A uniformly distributed n-digit code from the CSPRNG, leading zeros kept. */
function generateCode(length = env.gatePass.otpLength) {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, "0");
}

function messageFor(gatePass, studentName, code) {
  const leave = new Date(gatePass.leaveAt).toLocaleString("en-IN", { hour12: true });
  const back = new Date(gatePass.expectedReturnAt).toLocaleString("en-IN", { hour12: true });
  return (
    `${code} is the verification code for ${studentName}'s hostel gate pass ` +
    `${gatePass.reference} (out ${leave}, back by ${back}). ` +
    `Valid ${env.gatePass.otpTtlMinutes} minutes. Share it only if you approve this outing.`
  );
}

/**
 * Creates or refreshes the OTP challenge for a gate pass and sends it to the
 * guardian's number. Rate limited on both resend frequency and total sends.
 *
 * Returns what the student is allowed to know: the masked number, when the
 * code expires, and how it was dispatched. Never the code itself, unless the
 * explicit development escape hatch is on.
 */
export async function sendParentOtp({ gatePass, studentName, phone }) {
  const now = new Date();
  const existing = await OtpVerification.findOne({ gatePass: gatePass._id, consumedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .select("+codeHash");

  if (existing) {
    const since = (now - existing.lastSentAt) / 1000;
    if (since < env.gatePass.otpResendCooldownSeconds) {
      throw ApiError.badRequest(
        `Another code was just sent. Try again in ${Math.ceil(env.gatePass.otpResendCooldownSeconds - since)} seconds.`
      );
    }
    if (existing.sendCount >= env.gatePass.otpMaxSends) {
      throw ApiError.badRequest("Too many verification codes requested for this pass. Ask the warden to help.");
    }
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(now.getTime() + env.gatePass.otpTtlMinutes * 60_000);
  const phoneMasked = maskPhone(phone);

  let challenge;
  if (existing) {
    existing.codeHash = codeHash;
    existing.expiresAt = expiresAt;
    // A resend restarts the attempt budget; it is a new code, not a new guess.
    existing.attempts = 0;
    existing.sendCount += 1;
    existing.lastSentAt = now;
    existing.phoneMasked = phoneMasked;
    challenge = existing;
  } else {
    challenge = new OtpVerification({
      gatePass: gatePass._id,
      codeHash,
      phoneMasked,
      expiresAt,
      maxAttempts: env.gatePass.otpMaxAttempts
    });
  }

  const delivery = await sendSms(phone, messageFor(gatePass, studentName, code));
  challenge.delivered = delivery.delivered;
  challenge.deliveryMode = delivery.mode;
  challenge.deliveryError = delivery.error;
  await challenge.save();

  return {
    phoneMasked,
    expiresAt,
    sendCount: challenge.sendCount,
    attemptsRemaining: challenge.maxAttempts,
    delivery: { delivered: delivery.delivered, mode: delivery.mode, error: delivery.error },
    // Present only when GATE_PASS_REVEAL_OTP=true outside production.
    devCode: env.gatePass.revealOtp ? code : undefined
  };
}

/**
 * Checks a code against the live challenge. Wrong codes burn an attempt,
 * expired and exhausted challenges are refused outright, and a code can only
 * ever succeed once.
 */
export async function verifyParentOtp({ gatePass, code }) {
  const challenge = await OtpVerification.findOne({ gatePass: gatePass._id, consumedAt: { $exists: false } })
    .sort({ createdAt: -1 })
    .select("+codeHash");

  if (!challenge) throw ApiError.badRequest("No verification code is pending — request one first");
  if (challenge.isExpired()) throw ApiError.badRequest("That code has expired. Request a new one.");
  if (challenge.isExhausted()) {
    throw ApiError.badRequest("Too many incorrect attempts. Request a new code.");
  }

  const matches = await bcrypt.compare(String(code), challenge.codeHash);
  if (!matches) {
    challenge.attempts += 1;
    await challenge.save();
    const left = Math.max(0, challenge.maxAttempts - challenge.attempts);
    throw ApiError.badRequest(
      left ? `Incorrect code — ${left} attempt${left === 1 ? "" : "s"} left.` : "Incorrect code. Request a new one."
    );
  }

  challenge.consumedAt = new Date();
  await challenge.save();
  return { phoneMasked: challenge.phoneMasked, verifiedAt: challenge.consumedAt };
}

/** What the student's screen shows about the pending challenge, if any. */
export async function otpState(gatePassId) {
  const challenge = await OtpVerification.findOne({ gatePass: gatePassId }).sort({ createdAt: -1 });
  if (!challenge) return null;
  return {
    phoneMasked: challenge.phoneMasked,
    expiresAt: challenge.expiresAt,
    expired: challenge.isExpired(),
    consumed: Boolean(challenge.consumedAt),
    attempts: challenge.attempts,
    attemptsRemaining: Math.max(0, challenge.maxAttempts - challenge.attempts),
    sendCount: challenge.sendCount,
    delivery: { delivered: challenge.delivered, mode: challenge.deliveryMode, error: challenge.deliveryError }
  };
}
