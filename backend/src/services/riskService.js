import { RISK_LEVELS } from "../config/constants.js";
import { clamp, round } from "../utils/text.js";

export function levelFor(score) {
  if (score >= 85) return "CRITICAL";
  if (score >= 70) return "HIGH";
  if (score >= 50) return "ELEVATED";
  if (score >= 30) return "EMERGING";
  return "LOW";
}

export const RISK_LEVEL_ORDER = RISK_LEVELS;

/**
 * Risk for one incident, from four readable terms. Every term is returned in
 * `factors` so the frontend can show the arithmetic rather than a magic number.
 */
export function scoreIncident({
  complaintCount = 0,
  ageDays = 0,
  affectedStudents = 0,
  severity = "MODERATE",
  historicalCount = 0,
  medianResponseDays = 3.8
}) {
  const volume = Math.min(30, complaintCount * 1.8);
  // Delay past the campus median is where risk really accelerates.
  const delay = Math.min(26, Math.max(0, ageDays - medianResponseDays) * 1.9);
  const reach = Math.min(20, (affectedStudents / 40) * 2);
  const severityWeight =
    severity === "CRITICAL" ? 16 : severity === "MAJOR" ? 11 : severity === "MODERATE" ? 6 : 2;
  const memory = Math.min(10, historicalCount * 2.5);

  const score = clamp(volume + delay + reach + severityWeight + memory, 0, 100);

  return {
    riskScore: round(score),
    riskLevel: levelFor(score),
    factors: [
      { label: `${complaintCount} complaints in this cluster`, weight: round(volume, 1) },
      { label: `${round(ageDays, 1)} days open against a ${medianResponseDays}-day median`, weight: round(delay, 1) },
      { label: `${affectedStudents} students in scope`, weight: round(reach, 1) },
      { label: `Severity read as ${severity}`, weight: severityWeight },
      { label: `${historicalCount} matching historical incidents`, weight: round(memory, 1) }
    ],
    method: "WEIGHTED_RULE_SUM"
  };
}

/**
 * Campus health is the inverse of the worst risk on campus, pulled down a little
 * by the size of the open complaint backlog.
 */
export function campusHealth({ risks = [], pendingComplaints = 0, activeIncidents = 0 }) {
  if (!risks.length) return { health: 100, worstRisk: 0, method: "WEIGHTED_RULE_SUM" };
  const sorted = [...risks].sort((a, b) => b - a);
  const worst = sorted[0];
  const average = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const backlog = Math.min(12, pendingComplaints * 0.2 + activeIncidents * 0.4);
  const health = clamp(100 - (worst * 0.45 + average * 0.35 + backlog), 0, 100);
  return {
    health: round(health),
    worstRisk: round(worst),
    averageRisk: round(average),
    method: "WEIGHTED_RULE_SUM"
  };
}

export function reduceRisk(current, { repairHours = 4, confidence = 90 } = {}) {
  // A fast, confident repair takes most of the risk out; slower windows leave
  // more behind, which is exactly what the what-if simulator compares.
  const effectiveness = clamp((confidence / 100) * (1 - clamp(repairHours / 48, 0, 0.7)), 0.2, 0.95);
  return round(clamp(current * (1 - effectiveness), 5, 100));
}
