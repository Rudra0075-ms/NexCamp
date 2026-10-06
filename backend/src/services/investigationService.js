import { Attendance } from "../models/Attendance.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { clamp, round, sharedTerms, similarity } from "../utils/text.js";
import { findMatches } from "./memoryService.js";
// EXCEPTION-ONLY HOOK: the median comes from resolved history (3.8 days only as a labelled ASSUMPTION).
import { medianResponseDays } from "./xo/responseStats.js";

/**
 * Assembles the evidence behind an incident: why the system believes it exists.
 * The backend returns the evidence and its weights; the frontend draws the graph.
 */


export async function investigate(incidentId) {
  const incident = await Incident.findById(incidentId)
    .populate("building", "code name type occupancy historicalProblems affectedStudents")
    .lean();
  if (!incident) return null;

  const complaints = await Complaint.find({
    $or: [{ relatedIncident: incident._id }, { _id: { $in: incident.complaints || [] } }]
  })
    .select("reference title description createdAt status severity location")
    .sort({ createdAt: 1 })
    .lean();

  const matches = await findMatches(incident, { limit: 4 });
  const medianStat = await medianResponseDays({ category: incident.category });
  const MEDIAN_RESPONSE_DAYS = medianStat.days;

  const anchor = complaints[0];
  const phrasings = new Set(complaints.map((c) => c.description.trim().toLowerCase()));
  const overlaps = anchor
    ? complaints
        .slice(1)
        .map((c) => similarity(`${anchor.title} ${anchor.description}`, `${c.title} ${c.description}`))
    : [];
  const averageOverlap = overlaps.length
    ? round((overlaps.reduce((t, v) => t + v, 0) / overlaps.length) * 100)
    : 0;

  const firstAt = complaints[0]?.createdAt || incident.firstComplaintAt || incident.createdAt;
  const ageDays = round((Date.now() - new Date(firstAt)) / 864e5, 1);
  const delayDays = round(Math.max(0, ageDays - MEDIAN_RESPONSE_DAYS), 1);

  // Cross-domain: absences recorded in the same window for students of this block.
  const linkedAttendance = await Attendance.countDocuments({ linkedIncident: incident._id });

  // Confidence is a sum of named terms, each returned with its own weight, so
  // the UI's breakdown panel is the actual computation and not a re-statement.
  const confRows = [
    {
      label: `${complaints.length} complaints, one building`,
      weight: Math.min(31, complaints.length * 2),
      kind: "ACTUAL DATA"
    },
    {
      label: "Same location signature",
      weight: incident.building ? 18 : 0,
      kind: "ACTUAL DATA"
    },
    {
      label: `Similar descriptions (${averageOverlap}% keyword overlap)`,
      weight: round(clamp(averageOverlap / 100, 0, 1) * 16, 1),
      kind: "EVIDENCE"
    },
    {
      label: `${matches.length} historical incidents in campus memory`,
      weight: Math.min(14, matches.length * 3.5),
      kind: "ACTUAL DATA"
    },
    {
      label: `Maintenance delay pattern (${delayDays} days past the ${MEDIAN_RESPONSE_DAYS}-day median)`,
      weight: Math.min(10, delayDays * 0.8),
      kind: "EVIDENCE"
    }
  ];
  const confidence = round(clamp(confRows.reduce((total, row) => total + row.weight, 0), 0, 97));

  const possibleCauses = incident.possibleCauses?.length
    ? incident.possibleCauses
    : deriveCauses(incident, matches, { complaints, delayDays, medianDays: MEDIAN_RESPONSE_DAYS });

  const evidence = [
    {
      label: "VOLUME",
      value: `${complaints.length} complaints in ${ageDays} days`,
      kind: "ACTUAL DATA",
      weight: confRows[0].weight
    },
    {
      label: "LANGUAGE",
      value: `${phrasings.size} distinct phrasings, ${averageOverlap}% average keyword overlap`,
      kind: "EVIDENCE",
      weight: confRows[2].weight
    },
    {
      label: "LOCATION",
      value: incident.building ? `${incident.building.name} (${incident.building.code})` : "unresolved",
      kind: "ACTUAL DATA",
      weight: confRows[1].weight
    },
    {
      label: "HISTORY",
      value: matches.length
        ? matches
            .map((m) => `${new Date(m.memory.occurredOn).toISOString().slice(0, 10)} · ${m.memory.incidentType} (${m.similarity}%)`)
            .join(" · ")
        : "no matching historical incident",
      kind: "ACTUAL DATA",
      weight: confRows[3].weight
    },
    {
      label: "RESPONSE",
      value: `${delayDays} days beyond the ${MEDIAN_RESPONSE_DAYS}-day campus median`,
      kind: "EVIDENCE",
      weight: confRows[4].weight
    },
    {
      label: "CROSS-DOMAIN",
      value: linkedAttendance
        ? `${linkedAttendance} attendance records flagged against this incident`
        : "no attendance records linked yet",
      kind: "AI PREDICTION",
      weight: 0
    }
  ];

  const sharedLanguage = anchor
    ? complaints
        .slice(1)
        .flatMap((c) => sharedTerms(`${anchor.title} ${anchor.description}`, `${c.title} ${c.description}`, 3))
        .filter((term, index, all) => all.indexOf(term) === index)
        .slice(0, 10)
    : [];

  return {
    incident: {
      id: String(incident._id),
      reference: incident.reference,
      title: incident.title,
      category: incident.category,
      status: incident.status,
      risk: incident.risk,
      riskLevel: incident.riskLevel,
      affectedStudents: incident.affectedStudents,
      building: incident.building
        ? { id: String(incident.building._id), code: incident.building.code, name: incident.building.name }
        : null
    },
    confidence,
    confidenceBreakdown: confRows,
    evidence,
    possibleCauses,
    relatedComplaints: complaints.map((c) => ({
      id: String(c._id),
      reference: c.reference,
      title: c.title,
      description: c.description,
      status: c.status,
      createdAt: c.createdAt
    })),
    historicalIncidents: matches,
    sharedLanguage,
    locationMatches: complaints.filter((c) => c.location).map((c) => c.location),
    maintenancePattern: {
      medianResponseDays: MEDIAN_RESPONSE_DAYS,
      medianKind: medianStat.kind,
      medianSamples: medianStat.samples,
      medianScope: medianStat.scope,
      medianMethod: medianStat.method,
      medianNote: medianStat.note || null,
      thisCaseDays: ageDays,
      delayDays,
      effect: `Risk grows roughly 1.9 points per day beyond the median`
    },
    brief: buildBrief(incident, { complaints, ageDays, matches, delayDays, confidence, medianDays: MEDIAN_RESPONSE_DAYS }),
    method: "RULE_BASED_EVIDENCE_ASSEMBLY",
    disclaimer:
      "Confidence is a weighted sum of the named factors above, not the output of a trained model."
  };
}

function deriveCauses(incident, matches, { complaints, delayDays, medianDays: MEDIAN_RESPONSE_DAYS = 3.8 }) {
  const causes = [];
  if (matches.length) {
    causes.push({
      cause: matches[0].memory.cause || matches[0].memory.incidentType,
      confidence: matches[0].similarity,
      basis: `Matches ${new Date(matches[0].memory.occurredOn).toISOString().slice(0, 10)} in campus memory`
    });
  }
  if (complaints.length >= 5) {
    causes.push({
      cause: `Shared infrastructure fault affecting ${complaints.length} reporters at once`,
      confidence: Math.min(84, 40 + complaints.length * 2),
      basis: "Complaint volume concentrated in one building and category"
    });
  }
  if (delayDays > 0) {
    causes.push({
      cause: "Deferred maintenance allowing a minor fault to escalate",
      confidence: Math.min(72, 30 + delayDays * 3),
      basis: `${delayDays} days without an inspection against a ${MEDIAN_RESPONSE_DAYS}-day median`
    });
  }
  if (!causes.length) {
    causes.push({
      cause: "Insufficient evidence for a cause hypothesis",
      confidence: 20,
      basis: "Too few complaints and no historical match"
    });
  }
  return causes;
}

function buildBrief(incident, { complaints, ageDays, matches, delayDays, confidence, medianDays: MEDIAN_RESPONSE_DAYS = 3.8 }) {
  const where = incident.building?.name || "this block";
  const history = matches.length
    ? `The pattern matches ${matches.length} prior incident${matches.length === 1 ? "" : "s"} in campus memory, closest at ${matches[0].similarity}% similarity.`
    : "Campus memory holds no comparable incident.";
  const delay = delayDays
    ? ` No inspection has been raised in ${ageDays} days against a ${MEDIAN_RESPONSE_DAYS}-day median.`
    : "";
  return (
    `${complaints.length} complaint${complaints.length === 1 ? "" : "s"} filed over ${ageDays} days resolve into one ` +
    `${incident.category.toLowerCase()} incident in ${where}. ${history}${delay} ` +
    `Overall confidence ${confidence}% from the weighted factors listed above.`
  );
}
