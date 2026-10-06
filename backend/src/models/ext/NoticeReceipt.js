import mongoose from "mongoose";
import { CHANNELS } from "./common.js";

/**
 * One recipient's copy of one notice.
 *
 * Created when the notice is published. `deliveredAt` is set only when the
 * notice actually reaches the person — their app fetches it, an SMS is sent,
 * or it is shown at a kiosk — so "delivered" is never claimed on creation.
 */
const noticeReceiptSchema = new mongoose.Schema(
  {
    notice: { type: mongoose.Schema.Types.ObjectId, ref: "Notice", required: true, index: true },
    // Named `student` as in the brief; a staff recipient (department notice) is stored here too.
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    deliveredAt: Date,
    readAt: Date,
    acknowledgedAt: Date,
    actionDoneAt: Date,
    channel: { type: String, enum: CHANNELS, default: "APP" },
    smsSentAt: Date,
    smsMode: { type: String, trim: true },
    smsError: { type: String, trim: true },
    // EXCEPTION-ONLY HOOK: the escalation rungs this recipient was moved along (in-app → SMS →
    // class representative → kiosk list), each with when and how. Optional.
    ladder: { type: [new mongoose.Schema({ rung: String, at: Date, note: String }, { _id: false })], default: undefined },
    // Grouping snapshot at publish time, for the delivery breakdown.
    snapshot: {
      hostel: String,
      branch: String,
      year: Number,
      section: String,
      role: String
    }
  },
  { timestamps: true }
);

noticeReceiptSchema.index({ notice: 1, student: 1 }, { unique: true });
noticeReceiptSchema.index({ student: 1, readAt: 1 });

export const NoticeReceipt = mongoose.model("NoticeReceipt", noticeReceiptSchema);
