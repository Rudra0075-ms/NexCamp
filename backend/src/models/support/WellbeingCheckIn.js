import mongoose from "mongoose";
import { SUPPORT_BANDS } from "../../config/constants.js";

/**
 * One voluntary wellbeing check-in (Silent Support System).
 *
 * Stores only what the routing needs: four optional 1–5 answers, whether the
 * student said they do not feel safe, and the support band the rules produced.
 * No free text is ever stored. Rows expire on their own after
 * SUPPORT_CHECKIN_RETENTION_DAYS (default 90) through a TTL index, so old
 * answers do not accumulate.
 *
 * Readable only by the student who wrote it. The support team sees the band of
 * a check-in only when the student chose to share it with a request.
 */
const answer = { type: Number, min: 1, max: 5 };

const retentionDays = Math.max(7, Number(process.env.SUPPORT_CHECKIN_RETENTION_DAYS || 90));

const wellbeingCheckInSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // 1 = very low / very hard / very isolated / very uncomfortable, 5 = the opposite.
    answers: {
      feeling: answer,
      study: answer,
      connection: answer,
      helpComfort: answer
    },
    unsafe: { type: Boolean, default: false },
    band: { type: String, enum: SUPPORT_BANDS, required: true },
    score: { type: Number, min: 0, max: 20 }
  },
  { timestamps: true }
);

wellbeingCheckInSchema.index({ student: 1, createdAt: -1 });
wellbeingCheckInSchema.index({ createdAt: 1 }, { expireAfterSeconds: retentionDays * 86400 });

export const WellbeingCheckIn = mongoose.model("WellbeingCheckIn", wellbeingCheckInSchema);
