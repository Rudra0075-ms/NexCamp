import mongoose from "mongoose";

// One live OTP challenge per gate pass. The code itself is never stored: only
// a bcrypt digest, the same treatment the User password gets.
const otpVerificationSchema = new mongoose.Schema(
  {
    gatePass: { type: mongoose.Schema.Types.ObjectId, ref: "GatePass", required: true, index: true },
    purpose: { type: String, default: "PARENT_GATE_PASS_VERIFICATION" },

    codeHash: { type: String, required: true, select: false },
    phoneMasked: { type: String, trim: true },

    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    sendCount: { type: Number, default: 1 },
    lastSentAt: { type: Date, default: Date.now },

    consumedAt: Date,
    // How the message actually left the building — "console" when no provider
    // is configured, otherwise the provider name.
    deliveryMode: { type: String, trim: true },
    delivered: { type: Boolean, default: false },
    deliveryError: { type: String, trim: true }
  },
  { timestamps: true }
);

// Spent and expired challenges clear themselves out an hour past expiry.
otpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

otpVerificationSchema.methods.isExpired = function isExpired(now = new Date()) {
  return this.expiresAt.getTime() <= now.getTime();
};

otpVerificationSchema.methods.isExhausted = function isExhausted() {
  return this.attempts >= this.maxAttempts;
};

export const OtpVerification = mongoose.model("OtpVerification", otpVerificationSchema);
