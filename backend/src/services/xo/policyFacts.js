import { GatePass } from "../../models/GatePass.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { FeeAccount } from "../../models/ext/FeeAccount.js";
import { ServiceRequest } from "../../models/xo/ServiceRequest.js";
import { round } from "../../utils/text.js";
import { accountStatus } from "../ext/feeService.js";
import { istDateKey, istParts } from "../ext/istTime.js";

/**
 * The facts the policy engine decides on, read from the records the existing
 * pages already keep (the fee ledger of page 16, the gate-pass register of
 * page 11, the certificate requests of page 14). A fact that cannot be read is
 * returned as null, and the engine treats null as "Insufficient data" — it
 * never approves on a missing fact.
 */

export const RETURN_CUTOFF = "21:00";
const DAY = 864e5;

/** Pure: gate-pass timing facts from the pass's own times. */
export function gatePassTimingFacts({ leaveAt, expectedReturnAt, appliedAt }, { cutoff = RETURN_CUTOFF } = {}) {
  const leave = new Date(leaveAt);
  const back = new Date(expectedReturnAt);
  const applied = new Date(appliedAt || Date.now());
  const [ch, cm] = cutoff.split(":").map(Number);
  const r = istParts(back);
  const sameDay = istDateKey(leave) === istDateKey(back);
  return {
    leadTimeHours: round((leave - applied) / 3600000, 1),
    durationHours: round((back - leave) / 3600000, 1),
    returnBeforeCutoff: sameDay && (r.hour < ch || (r.hour === ch && r.minute <= cm)),
    sameDay,
    returnTimeIst: `${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`
  };
}

/** Pure: the overdue amount across fee accounts, or null when there is no ledger. */
export function overdueFrom(accounts, now = new Date()) {
  if (!accounts?.length) return null;
  return accounts.reduce((t, a) => t + accountStatus(a, now).totals.overdue, 0);
}

export const VISA_PATTERN = /\b(visa|passport|embassy|immigration|consulate)\b/i;

export async function bonafideFacts(student, { purpose = "", excludeId, now = new Date() } = {}) {
  const [accounts, recent] = await Promise.all([
    FeeAccount.find({ student: student._id }).lean(),
    DocumentRequest.countDocuments({ student: student._id, type: "BONAFIDE", createdAt: { $gte: new Date(now - 30 * DAY) }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
  ]);
  return {
    enrolled: student.role === "STUDENT" && Boolean(student.studentId),
    overdueDues: overdueFrom(accounts, now),
    requestsLast30Days: recent,
    purposeVisa: VISA_PATTERN.test(String(purpose))
  };
}

export async function gatePassFacts(gatePass, { now = new Date() } = {}) {
  const studentId = gatePass.student?._id || gatePass.student;
  const late = await GatePass.countDocuments({
    student: studentId,
    _id: { $ne: gatePass._id },
    createdAt: { $gte: new Date(now - 30 * DAY) },
    $or: [{ status: { $in: ["RETURNED_LATE", "OVERDUE"] } }, { overdueMinutes: { $gt: 0 } }]
  });
  return {
    guardianOtpVerified: gatePass.parent?.verified === true,
    ...gatePassTimingFacts({ leaveAt: gatePass.leaveAt, expectedReturnAt: gatePass.expectedReturnAt, appliedAt: gatePass.createdAt || now }),
    lateReturnsLast30Days: late
  };
}

/** Finds a payment on the student's ledger by receipt number. */
export async function findReceipt(student, receipt) {
  const accounts = await FeeAccount.find({ student: student._id }).lean();
  for (const account of accounts) {
    for (const head of account.heads || []) {
      const payment = (head.payments || []).find((p) => String(p.receipt).toUpperCase() === String(receipt || "").trim().toUpperCase());
      if (payment) return { academicYear: account.academicYear, head: head.head, label: head.label, amount: payment.amount, paidAt: payment.at, mode: payment.mode, receipt: payment.receipt };
    }
  }
  return null;
}

export async function feeReceiptFacts(student, { receipt, excludeId, now = new Date() } = {}) {
  const [found, copies] = await Promise.all([
    findReceipt(student, receipt),
    ServiceRequest.countDocuments({ student: student._id, type: "FEE_RECEIPT_COPY", status: "FULFILLED", createdAt: { $gte: new Date(now - 30 * DAY) }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
  ]);
  return { receiptOnLedger: Boolean(found), copiesLast30Days: copies };
}
