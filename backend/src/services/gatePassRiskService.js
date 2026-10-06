import { GATE_PASS_CLOSED_STATUS } from "../config/constants.js";
import { GatePass } from "../models/GatePass.js";
import { clamp, round } from "../utils/text.js";

/**
 * Gate-pass risk signals.
 *
 * This produces a *signal for a human to look at*, never a decision. Nothing
 * here rejects a pass, blocks a student, or feeds back into approval — the
 * warden reads the signal and the records behind it and decides.
 *
 * Every signal is counted from that student's own stored gate passes, and each
 * one carries the references it was counted from so the warden can open them.
 */

const NIGHT_START_HOUR = 23;
const NIGHT_END_HOUR = 5;

/**
 * @param {Array} passes  one student's passes: { reference, status, leaveAt,
 *                        expectedReturnAt, overdueMinutes, createdAt }
 */
export function scoreGatePassHistory(passes = [], { windowDays = 90 } = {}) {
  const total = passes.length;

  if (total < 3) {
    return {
      level: "INSUFFICIENT_DATA",
      score: null,
      signals: [],
      totalPasses: total,
      windowDays,
      note: `${total} pass${total === 1 ? "" : "es"} on record — too few to read a pattern from.`,
      method: "DATABASE_AGGREGATION"
    };
  }

  const overdue = passes.filter((pass) => pass.status === "OVERDUE" || pass.status === "RETURNED_LATE" || (pass.overdueMinutes || 0) > 0);
  const cancelled = passes.filter((pass) => pass.status === "CANCELLED");
  const rejected = passes.filter((pass) => pass.status === "REJECTED");

  const signals = [];

  const overdueRate = round((overdue.length / total) * 100);
  if (overdue.length >= 2) {
    const worst = [...overdue].sort((a, b) => (b.overdueMinutes || 0) - (a.overdueMinutes || 0))[0];
    signals.push({
      id: "REPEATED_OVERDUE",
      weight: clamp(overdue.length * 14, 0, 45),
      label: `${overdue.length} of ${total} passes returned late or went overdue (${overdueRate}%)`,
      detail: worst?.overdueMinutes ? `Longest overrun ${worst.overdueMinutes} minutes on ${worst.reference}.` : null,
      references: overdue.map((pass) => pass.reference).filter(Boolean).slice(0, 8)
    });
  }

  // Frequency, measured against the window the passes actually span.
  const sorted = [...passes].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const spanDays = Math.max(
    1,
    round((new Date(sorted[sorted.length - 1].createdAt) - new Date(sorted[0].createdAt)) / 864e5, 1)
  );
  const perWeek = round((total / spanDays) * 7, 1);
  if (perWeek >= 4) {
    signals.push({
      id: "HIGH_FREQUENCY",
      weight: clamp(Math.round((perWeek - 3) * 8), 0, 25),
      label: `${perWeek} passes per week across ${spanDays} days`,
      detail: "Well above a routine weekend pattern; worth confirming the reasons are genuine.",
      references: sorted.slice(-6).map((pass) => pass.reference).filter(Boolean)
    });
  }

  const cancelRate = round((cancelled.length / total) * 100);
  if (cancelled.length >= 3 && cancelRate >= 35) {
    signals.push({
      id: "REPEATED_CANCELLATION",
      weight: clamp(cancelled.length * 7, 0, 20),
      label: `${cancelled.length} of ${total} passes cancelled after being raised (${cancelRate}%)`,
      detail: "Repeated cancellation can mean the approval route is being tested rather than used.",
      references: cancelled.map((pass) => pass.reference).filter(Boolean).slice(0, 8)
    });
  }

  if (rejected.length >= 2) {
    signals.push({
      id: "REPEATED_REJECTION",
      weight: clamp(rejected.length * 8, 0, 20),
      label: `${rejected.length} passes rejected by a warden`,
      detail: "Previous rejections are context for the current request, not a reason to refuse it.",
      references: rejected.map((pass) => pass.reference).filter(Boolean).slice(0, 8)
    });
  }

  const nightly = passes.filter((pass) => {
    if (!pass.leaveAt) return false;
    const hour = new Date(pass.leaveAt).getHours();
    return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
  });
  if (nightly.length >= 2) {
    signals.push({
      id: "UNUSUAL_TIMING",
      weight: clamp(nightly.length * 9, 0, 22),
      label: `${nightly.length} passes with a departure between ${NIGHT_START_HOUR}:00 and 0${NIGHT_END_HOUR}:00`,
      detail: "Outside normal hostel movement hours.",
      references: nightly.map((pass) => pass.reference).filter(Boolean).slice(0, 8)
    });
  }

  const score = round(clamp(signals.reduce((total_, signal) => total_ + signal.weight, 0), 0, 95));
  const level = score >= 60 ? "HIGH" : score >= 35 ? "ELEVATED" : score > 0 ? "LOW" : "NONE";

  return {
    level,
    score,
    signals: signals.sort((a, b) => b.weight - a.weight),
    totalPasses: total,
    overduePasses: overdue.length,
    cancelledPasses: cancelled.length,
    rejectedPasses: rejected.length,
    passesPerWeek: perWeek,
    windowDays,
    spanDays,
    method: "DATABASE_AGGREGATION",
    governance:
      "A signal for a warden to review, not a decision. No pass is refused, delayed or flagged to the student " +
      "on the strength of this score, and the records behind every signal are listed above."
  };
}

/** Per-student risk signals across the hostel, highest first. */
export async function gatePassRiskBoard({ windowDays = 90, limit = 10, hostelId = null } = {}) {
  const since = new Date(Date.now() - windowDays * 864e5);
  const filter = { createdAt: { $gte: since } };
  if (hostelId) filter.hostel = hostelId;

  const passes = await GatePass.find(filter)
    .populate("student", "name studentId")
    .select("reference status leaveAt expectedReturnAt overdueMinutes createdAt student hostelName")
    .sort({ createdAt: 1 })
    .lean();

  const byStudent = new Map();
  for (const pass of passes) {
    const id = String(pass.student?._id || pass.student || "unknown");
    const entry = byStudent.get(id) || {
      student: pass.student?.name
        ? { id, name: pass.student.name, studentId: pass.student.studentId }
        : { id },
      hostelName: pass.hostelName,
      passes: []
    };
    entry.passes.push(pass);
    byStudent.set(id, entry);
  }

  const rows = [];
  for (const entry of byStudent.values()) {
    const assessment = scoreGatePassHistory(entry.passes, { windowDays });
    if (!assessment.signals.length) continue;
    rows.push({
      student: entry.student,
      hostelName: entry.hostelName,
      ...assessment,
      // The warden opens these; nothing is summarised away.
      records: entry.passes.slice(-10).map((pass) => ({
        reference: pass.reference,
        status: pass.status,
        leaveAt: pass.leaveAt,
        expectedReturnAt: pass.expectedReturnAt,
        overdueMinutes: pass.overdueMinutes || 0
      }))
    });
  }

  return {
    windowDays,
    passesExamined: passes.length,
    studentsExamined: byStudent.size,
    rows: rows.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit),
    closedStatuses: GATE_PASS_CLOSED_STATUS,
    method: "DATABASE_AGGREGATION",
    disclaimer:
      "Counted from stored gate-pass records. These are review prompts for a warden — the system takes no " +
      "automatic action against any student on the strength of them."
  };
}
