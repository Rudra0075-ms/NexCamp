import mongoose from "mongoose";

/** One inbound command and the reply sent back, from the SMS keyword channel. */
const smsMessageSchema = new mongoose.Schema(
  {
    phoneMasked: { type: String, trim: true },
    phoneHash: { type: String, trim: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    body: { type: String, trim: true, maxlength: 480 },
    command: { type: String, trim: true },
    reply: { type: String, trim: true, maxlength: 160 },
    // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): REFUSED added for staff work commands that are not allowed.
    outcome: { type: String, enum: ["OK", "UNREGISTERED", "RATE_LIMITED", "UNKNOWN_COMMAND", "ERROR", "REFUSED"], default: "OK" },
    // EXCEPTION-ONLY HOOK: the staff member, when the sender is a registered staff phone (optional).
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    relatedRef: { type: String, trim: true },
    // true for the demo simulator; false for a provider webhook.
    simulated: { type: Boolean, default: false },
    via: { type: String, trim: true },
    replyDelivery: { type: String, trim: true }
  },
  { timestamps: true }
);

smsMessageSchema.index({ phoneHash: 1, createdAt: -1 });

export const SmsMessage = mongoose.model("SmsMessage", smsMessageSchema);
