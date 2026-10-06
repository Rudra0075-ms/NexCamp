import mongoose from "mongoose";

/**
 * Shared pieces for the PS07 extension models.
 *
 * `historySchema` is the per-record audit trail every new workflow keeps (the
 * same idea as Complaint.audit and GatePass.events). The hash-chained audit log
 * is written alongside it by services/ext/extAudit.js.
 */
export const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    action: { type: String, trim: true, maxlength: 80 },
    actorName: { type: String, trim: true },
    actorRole: { type: String, trim: true },
    channel: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 500 },
    kind: { type: String, trim: true, default: "ACTUAL DATA" }
  },
  { _id: false }
);

// Sequential references from an atomic counter. The existing models count
// documents instead, which can collide after a delete (AUDIT.md B1); the new
// ones do not repeat that.
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
export const ExtCounter = mongoose.models.ExtCounter || mongoose.model("ExtCounter", counterSchema);

export async function nextReference(prefix, { year = new Date().getFullYear(), width = 4 } = {}) {
  const key = `${prefix}-${year}`;
  const row = await ExtCounter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${year}-${String(row.seq).padStart(width, "0")}`;
}

export const CHANNELS = ["APP", "SMS", "KIOSK"];
