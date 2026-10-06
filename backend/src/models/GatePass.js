import mongoose from "mongoose";
import { GATE_PASS_STATUS } from "../config/constants.js";

// One entry per thing the system did to this pass. Same shape as the complaint
// audit trail, so the frontend renders both with the same component.
const eventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    actor: { type: String, trim: true },
    message: { type: String, trim: true },
    status: { type: String, enum: GATE_PASS_STATUS },
    kind: {
      type: String,
      enum: ["ACTUAL DATA", "AI PREDICTION", "AI RECOMMENDATION", "EVIDENCE"],
      default: "ACTUAL DATA"
    }
  },
  { _id: false }
);

const gatePassSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    hostel: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true },
    hostelName: { type: String, trim: true },
    room: { type: String, trim: true },

    date: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    // KIOSK when a help-desk operator applied on the student's behalf.
    channel: { type: String, enum: ["APP", "KIOSK"] },
    destination: { type: String, trim: true, maxlength: 200 },

    // Server-authoritative schedule. Every timer in the interface is derived
    // from these two values, never from anything the browser holds.
    leaveAt: { type: Date, required: true },
    expectedReturnAt: { type: Date, required: true },

    status: {
      type: String,
      enum: GATE_PASS_STATUS,
      default: "PENDING_PARENT_VERIFICATION",
      index: true
    },

    parent: {
      name: { type: String, trim: true },
      // Only the masked form is persisted on the pass. The number itself stays
      // on the student's own record and never leaves the backend.
      phoneMasked: { type: String, trim: true },
      verified: { type: Boolean, default: false },
      verifiedAt: Date
    },

    approval: {
      decision: { type: String, enum: ["APPROVED", "REJECTED"] },
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      decidedByName: { type: String, trim: true },
      decidedAt: Date,
      note: { type: String, trim: true, maxlength: 400 }
    },

    // The QR carries a random token and the reference — nothing else. Only the
    // token's SHA-256 digest is stored, so a database read cannot forge a pass.
    // GATE-PASS QR FIX: the nonce below is stored too, but the token also needs
    // the server secret to derive, so that still holds for a database read alone.
    pass: {
      tokenHash: { type: String, select: false },
      // GATE-PASS QR FIX (see CHANGES-GATEPASS-QR-FIX.md): the nonce the token is derived from
      // with the server secret, so the same QR can be shown again. Optional; absent on older passes.
      nonce: { type: String, select: false },
      issuedAt: Date,
      exitScanAt: Date,
      returnScanAt: Date,
      scanCount: { type: Number, default: 0 }
    },

    exitAt: Date,
    returnAt: Date,
    actualDurationMinutes: Number,
    overdueMinutes: Number,

    warningSentAt: Date,
    overdueMarkedAt: Date,
    overdueNotifiedAt: Date,

    // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): who decided this request — the written
    // policy (Touchless Lane) or a person — and the policy engine's full verdict. Optional, no default.
    decidedBy: { type: String, enum: ["POLICY", "HUMAN"] },
    policyDecision: { type: mongoose.Schema.Types.Mixed, default: undefined },
    policyUndo: { type: mongoose.Schema.Types.Mixed, default: undefined },
    events: [eventSchema]
  },
  { timestamps: true }
);

gatePassSchema.index({ student: 1, createdAt: -1 });
gatePassSchema.index({ status: 1, expectedReturnAt: 1 });
gatePassSchema.index({ hostel: 1, status: 1 });

// GP-2026-000123, sequential per collection so the reference reads like a
// register entry rather than a database id.
gatePassSchema.pre("validate", async function assignReference(next) {
  if (this.reference) return next();
  const year = new Date().getFullYear();
  const count = await this.constructor.countDocuments({ reference: new RegExp(`^GP-${year}-`) });
  this.reference = `GP-${year}-${String(count + 1).padStart(6, "0")}`;
  next();
});

gatePassSchema.methods.log = function log(actor, message, kind = "ACTUAL DATA") {
  this.events.push({ actor, message, status: this.status, kind });
  return this;
};

export const GatePass = mongoose.model("GatePass", gatePassSchema);
