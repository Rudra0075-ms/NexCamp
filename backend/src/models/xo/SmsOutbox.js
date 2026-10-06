import mongoose from "mongoose";

/**
 * An outbound SMS the campus sent on its own (not a reply): the "Is it fixed?"
 * question after a DONE, the "waiting for a part" update. Kept so the page-18
 * demo and the audit can show exactly what reached each phone, and whether a
 * provider delivered it or it was only printed to the console (SIMULATED).
 */
const smsOutboxSchema = new mongoose.Schema(
  {
    phoneMasked: { type: String, trim: true },
    phoneHash: { type: String, trim: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    body: { type: String, trim: true, maxlength: 160 },
    purpose: { type: String, trim: true },
    relatedRef: { type: String, trim: true },
    delivery: { type: String, trim: true }
  },
  { timestamps: true }
);

export const SmsOutbox = mongoose.models.SmsOutbox || mongoose.model("SmsOutbox", smsOutboxSchema);
