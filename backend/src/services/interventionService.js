import { clamp, round } from "../utils/text.js";
import { levelFor, reduceRisk } from "./riskService.js";

/**
 * What-if intervention simulation.
 *
 * Every scenario is arithmetic over the incident's current risk, its affected
 * population and the delay before work starts. Returned with `method` so the
 * frontend can label the projection as a prediction rather than a measurement.
 */

const SCENARIOS = {
  DO_NOTHING: { label: "DO NOTHING", delayHours: null, repairHours: null },
  REPAIR_NOW: { label: "REPAIR NOW", delayHours: 0, repairHours: 4 },
  DELAY_24H: { label: "24H DELAY", delayHours: 24, repairHours: 4 }
};

// Risk drifts up while nothing is done; the rate rises with the population.
function driftRisk(currentRisk, hours, affectedStudents) {
  const perHour = 0.08 + Math.min(0.12, affectedStudents / 4000);
  return round(clamp(currentRisk + hours * perHour, 0, 99));
}

function projectComplaints(risk, affectedStudents, hours) {
  // Roughly: the more at risk and the more people, the more will report it.
  const rate = (risk / 100) * (affectedStudents / 100) * (hours / 24);
  return Math.max(0, Math.round(rate * 1.6));
}

function projectAffected(baseAffected, risk, hours) {
  const spread = 1 + (risk / 100) * (hours / 24) * 0.55;
  return Math.round(baseAffected * spread);
}

export function simulateScenario({
  scenario = "REPAIR_NOW",
  currentRisk = 50,
  affectedStudents = 100,
  confidence = 85,
  delayHours,
  repairHours = 4,
  horizonHours = 24
}) {
  const preset = SCENARIOS[scenario] || SCENARIOS.REPAIR_NOW;
  const delay = delayHours ?? preset.delayHours;

  if (scenario === "DO_NOTHING" || delay === null) {
    const risk = driftRisk(currentRisk, horizonHours, affectedStudents);
    return {
      scenario,
      label: preset.label,
      windowHours: horizonHours,
      riskBefore: round(currentRisk),
      riskAfter: risk,
      riskLevel: levelFor(risk),
      affectedStudents: projectAffected(affectedStudents, risk, horizonHours),
      predictedComplaints: projectComplaints(risk, affectedStudents, horizonHours),
      method: "ARITHMETIC_PROJECTION",
      basis: `Risk drifts upward while no work is scheduled; projected over ${horizonHours} hours.`
    };
  }

  // Risk keeps climbing through the delay, then the repair pulls it down.
  const riskAtStart = driftRisk(currentRisk, delay, affectedStudents);
  const riskAfter = reduceRisk(riskAtStart, { repairHours, confidence });
  const totalHours = delay + repairHours;

  return {
    scenario,
    label: preset.label || `${delay}H DELAY`,
    windowHours: totalHours,
    delayHours: delay,
    repairHours,
    riskBefore: round(currentRisk),
    riskAtWorkStart: riskAtStart,
    riskAfter,
    riskLevel: levelFor(riskAfter),
    affectedStudents: projectAffected(affectedStudents, riskAtStart, totalHours * 0.4),
    predictedComplaints: projectComplaints(riskAtStart, affectedStudents, totalHours),
    method: "ARITHMETIC_PROJECTION",
    basis:
      `Risk drifts for ${delay}h before work starts, then a ${repairHours}h repair at ${confidence}% ` +
      "confidence removes most of what remains."
  };
}

/** Runs the three headline scenarios side by side for the decision simulator. */
export function compareScenarios(context) {
  const scenarios = ["DO_NOTHING", "REPAIR_NOW", "DELAY_24H"].map((scenario) =>
    simulateScenario({ ...context, scenario })
  );

  const best = scenarios.reduce((lowest, row) => (row.riskAfter < lowest.riskAfter ? row : lowest));
  const worst = scenarios.reduce((highest, row) => (row.riskAfter > highest.riskAfter ? row : highest));

  return {
    scenarios,
    recommended: best.scenario,
    riskSpread: round(worst.riskAfter - best.riskAfter),
    studentsSpared: Math.max(0, worst.affectedStudents - best.affectedStudents),
    complaintsAvoided: Math.max(0, worst.predictedComplaints - best.predictedComplaints),
    method: "ARITHMETIC_PROJECTION"
  };
}

/** Risk curves for the before/after chart: one point per horizon step. */
export function riskCurves(context, steps = 6, stepHours = 4) {
  const points = Array.from({ length: steps }, (_, index) => index * stepHours);
  return {
    stepHours,
    doNothing: points.map((hours) => ({
      hours,
      risk: driftRisk(context.currentRisk, hours, context.affectedStudents)
    })),
    repairNow: points.map((hours) => ({
      hours,
      risk:
        hours === 0
          ? round(context.currentRisk)
          : reduceRisk(context.currentRisk, {
              repairHours: Math.max(1, hours),
              confidence: context.confidence ?? 85
            })
    }))
  };
}

/** The recommendation text the AI puts in front of a human. */
export function recommendAction({ incident, building, investigation }) {
  const target = building?.name || "the affected block";
  const cause = investigation?.possibleCauses?.[0]?.cause;
  const hours = incident.risk >= 85 ? 4 : incident.risk >= 70 ? 8 : 24;

  return {
    recommendedAction: cause
      ? `Inspect ${target} — ${cause.toLowerCase()}`
      : `Inspect ${target} and confirm the reported ${incident.category.toLowerCase()} fault`,
    priority: incident.risk >= 85 ? "CRITICAL" : incident.risk >= 70 ? "HIGH" : "MEDIUM",
    expectedImpact: `${incident.risk >= 70 ? "HIGH" : "MODERATE"} — ${incident.affectedStudents} students`,
    estimatedResolutionHours: hours,
    confidence: investigation?.confidence ?? incident.confidence ?? 70,
    method: "RULE_BASED_RECOMMENDATION"
  };
}

export const SCENARIO_LIST = Object.keys(SCENARIOS);
