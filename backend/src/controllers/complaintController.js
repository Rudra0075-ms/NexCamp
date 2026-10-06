import { AI_SOURCES, STAFF_ROLES } from "../config/constants.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { classifyComplaint, detectDuplicate, suggestResolution } from "../services/aiService.js";
import { record as recordAudit } from "../services/auditChainService.js";
import { attachToIncident } from "../services/incidentClusteringService.js";
import { notifyStaffOfEscalation, notifyStudentOfResolution } from "../services/escalationNotifier.js";
import { resolutionPrecedents, sentimentOf } from "../services/feedbackService.js";
import { scoreIncident } from "../services/riskService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { pageMeta, paginate } from "../utils/pagination.js";
import { created, ok } from "../utils/respond.js";
import { round } from "../utils/text.js";
import { emitEvent } from "../services/xo/eventService.js"; // EXCEPTION-ONLY HOOK
import { confirmFix, ensureConfirmation } from "../services/ext/fixService.js";

const isStaff = (user) => STAFF_ROLES.includes(user.role);
import { linkComplaint, plannedShutdownFor } from "../services/xo/changeService.js"; // EXCEPTION-ONLY HOOK

function shape(complaint) {
  return {
    id: String(complaint._id),
    reference: complaint.reference,
    title: complaint.title,
    description: complaint.description,
    category: complaint.category,
    subCategory: complaint.subCategory,
    location: complaint.location,
    building: complaint.building?.code
      ? { id: String(complaint.building._id), code: complaint.building.code, name: complaint.building.name }
      : complaint.building
        ? { id: String(complaint.building) }
        : null,
    priority: complaint.priority,
    severity: complaint.severity,
    status: complaint.status,
    department: complaint.department,
    student: complaint.student?.name
      ? { id: String(complaint.student._id), name: complaint.student.name, studentId: complaint.student.studentId }
      : complaint.student
        ? { id: String(complaint.student) }
        : null,
    relatedIncident: complaint.relatedIncident?.reference
      ? {
          id: String(complaint.relatedIncident._id),
          reference: complaint.relatedIncident.reference,
          title: complaint.relatedIncident.title,
          risk: complaint.relatedIncident.risk
        }
      : complaint.relatedIncident
        ? { id: String(complaint.relatedIncident) }
        : null,
    aiClassification: complaint.aiClassification,
    aiRouting: complaint.aiRouting || null,
    duplicateReview: complaint.duplicateReview || null,
    duplicateProbability: complaint.duplicateProbability,
    evidence: complaint.evidence,
    audit: complaint.audit,
    resolution: complaint.resolution,
    feedback: complaint.feedback || null,
    createdAt: complaint.createdAt,
    updatedAt: complaint.updatedAt
  };
}

async function resolveBuilding({ buildingCode, building, location }) {
  if (building) return Building.findById(building);
  if (buildingCode) return Building.findOne({ code: String(buildingCode).toUpperCase() });
  if (location) {
    // "HOSTEL B · FLOOR 2 · B-214" — match on the first segment.
    const head = String(location).split("·")[0].trim();
    if (head) {
      return Building.findOne({ $or: [{ name: new RegExp(`^${head}$`, "i") }, { code: head.toUpperCase() }] });
    }
  }
  return null;
}

/**
 * POST /api/complaints
 *
 * Unchanged in shape from the original: create, classify, cluster, respond. The
 * classification step now goes through the AI layer instead of straight to the
 * keyword classifier — and because that layer always falls back to the same
 * keyword classifier, this path behaves identically when no AI provider is
 * configured or when one is unreachable. A student can always file a complaint.
 */
export const createComplaint = asyncHandler(async (req, res) => {
  // Role separation: Only students can file complaints directly.
  // Administrative and Warden staff manage, review, approve, and resolve reports via Mission Control.
  if (!req.kiosk && req.user.role !== "STUDENT") {
    throw ApiError.forbidden("Administrative and Warden staff cannot submit complaints. Staff review, triage, and resolve reports via Mission Control.");
  }

  const building = await resolveBuilding(req.body);

  const complaint = new Complaint({
    student: req.user._id,
    title: req.body.title,
    description: req.body.description,
    category: req.body.category || "OTHER",
    subCategory: req.body.subCategory,
    location: req.body.location || building?.name,
    building: building?._id,
    audit: [
      {
        actor: req.user.name,
        message: `Report submitted by student · ${req.body.location || building?.name || "location not given"}`,
        kind: "ACTUAL DATA"
      },
      // Filed at the assisted-access kiosk: say who operated it.
      ...(req.kiosk
        ? [{ actor: req.operator.name, message: `Filed at the assisted-access kiosk by ${req.operator.name} (${req.operator.role}) for ${req.user.studentId || req.user.name}`, kind: "ACTUAL DATA" }]
        : [])
    ],
    channel: req.kiosk ? "KIOSK" : "APP"
  });

  const analysis = await classifyComplaint(complaint, { building });
  const { duplicates, escalation, rules } = analysis;

  complaint.aiClassification = {
    category: analysis.category,
    subCategory: analysis.subCategory || undefined,
    priority: analysis.priority,
    severity: analysis.severity,
    duplicateProbability: rules.duplicateProbability,
    affectedArea: rules.affectedArea,
    routedTo: analysis.department,
    slaHours: analysis.urgencyHours,
    confidence: analysis.confidence,
    method: analysis.method,
    reasons: analysis.reasons,
    classifiedAt: new Date(),
    // Provenance: which of the three sources produced the block above.
    source: analysis.source,
    provider: analysis.provider,
    model: analysis.model,
    confidenceBasis: analysis.confidenceBasis,
    suggestedAction: analysis.suggestedAction,
    safetyRule: escalation.rule === "SAFETY_RULE" ? escalation.safetyMatches.map((hit) => hit.id).join(",") : undefined,
    escalated: escalation.escalate,
    processedAt: analysis.processedAt
  };

  complaint.category = analysis.category;
  complaint.priority = analysis.priority;
  complaint.severity = analysis.severity;
  complaint.department = analysis.department;
  complaint.duplicateProbability = rules.duplicateProbability;
  complaint.duplicateOf = duplicates[0]?.complaint?._id;
  complaint.status = "CLASSIFIED";

  // Feature 2: the recommendation is recorded as a recommendation. Staff accept
  // or override it later through PATCH /api/complaints/:id/routing, and both
  // values survive that.
  complaint.aiRouting = {
    recommendedDepartment: analysis.department,
    recommendedBy:
      analysis.source === AI_SOURCES.MODEL ? `${analysis.provider}/${analysis.model}` : "classificationService",
    recommendedAt: new Date(),
    finalDepartment: analysis.department
  };

  const sourceLabel =
    analysis.source === AI_SOURCES.MODEL
      ? `${analysis.provider}/${analysis.model}`
      : analysis.source === AI_SOURCES.FALLBACK
        ? "rule-based fallback (AI provider unavailable)"
        : "rule-based (AI not configured)";

  complaint.audit.push({
    actor: analysis.source === AI_SOURCES.MODEL ? "aiService" : "classificationService",
    message:
      `${sourceLabel} classification: ${analysis.category} / ${analysis.priority} / ${analysis.severity}` +
      (duplicates.length ? ` — ${rules.duplicateProbability}% overlap with ${duplicates[0].complaint.reference}` : ""),
    kind: "AI PREDICTION"
  });

  // Feature 6: a safety rule is recorded as its own line, because it is not an
  // AI decision and must not read like one.
  if (escalation.rule === "SAFETY_RULE") {
    complaint.audit.push({
      actor: "escalationService",
      message: `Escalated to ${escalation.priority} by deterministic safety rule — ${escalation.reasons[0]}`,
      kind: "ACTUAL DATA"
    });
  }

  await complaint.save();

  // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): a complaint in a building and window of
  // planned work (e.g. a scheduled water shutdown) is linked to that planned event instead of
  // opening or growing an incident. With no planned work, this is exactly the original path.
  const plannedChange = await plannedShutdownFor({ building, category: complaint.category, at: new Date() }).catch(() => null);
  const attachment = plannedChange ? null : await attachToIncident(complaint);
  if (plannedChange) {
    complaint.audit.push({ actor: "changeService", message: `Linked to planned work ${plannedChange.reference} (${plannedChange.title}) — expected during this window, no incident opened`, kind: "ACTUAL DATA" });
    await complaint.save();
    await linkComplaint(plannedChange, complaint, req.user).catch(() => null);
  }
  if (attachment) {
    complaint.relatedIncident = attachment.incident._id;
    complaint.status = "ASSIGNED";
    complaint.audit.push({
      actor: "incidentClusteringService",
      message: `Merged into ${attachment.incident.reference} · ${attachment.incident.title} (${attachment.matchScore}% match)`,
      kind: "ACTUAL DATA"
    });
    complaint.audit.push({
      actor: "system",
      message: `Assigned to ${analysis.department}, SLA ${analysis.urgencyHours}h`,
      kind: "ACTUAL DATA"
    });
    await complaint.save();

    // The new complaint changes the incident's risk, so recompute it now.
    const incident = attachment.incident;
    const ageDays = (Date.now() - new Date(incident.firstComplaintAt || incident.createdAt)) / 864e5;
    const risk = scoreIncident({
      complaintCount: incident.complaints.length,
      ageDays,
      affectedStudents: incident.affectedStudents,
      severity: complaint.severity,
      historicalCount: incident.historicalMatches?.length || 0
    });
    incident.risk = risk.riskScore;
    incident.riskLevel = risk.riskLevel;
    await incident.save();
  }

  if (building) {
    await Building.findByIdAndUpdate(building._id, { $inc: { activeProblems: 1 } });
  }

  // Feature 14: the filing itself enters the tamper-evident chain. Audit
  // failures never break the submission — record() swallows and logs them.
  await recordAudit({
    entityType: "Complaint",
    entityId: complaint._id,
    entityRef: complaint.reference,
    action: "COMPLAINT_FILED",
    field: "status",
    previousValue: "",
    newValue: complaint.status,
    actor: req.user,
    note: `${analysis.category} / ${analysis.priority} via ${sourceLabel}`
  });

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  const eventBase = { student: req.user, subjectType: "Complaint", subjectId: complaint._id, subjectRef: complaint.reference, department: complaint.department };
  emitEvent({ ...eventBase, type: "COMPLAINT_CREATED", actor: req.user, channel: req.kiosk ? "KIOSK" : "APP", payload: { category: complaint.category, building: building?.code, room: complaint.location, priority: complaint.priority, operator: req.operator?.name } });
  emitEvent({ ...eventBase, type: "COMPLAINT_CLASSIFIED", actor: { name: "classificationService", role: "SYSTEM" }, channel: "SYSTEM", payload: { source: analysis.source, category: analysis.category, priority: analysis.priority, department: analysis.department } });
  if (attachment) emitEvent({ ...eventBase, type: "COMPLAINT_ASSIGNED", actor: { name: "incidentClusteringService", role: "SYSTEM" }, channel: "SYSTEM", payload: { department: analysis.department, incident: attachment.incident.reference, matchScore: attachment.matchScore } });

  // Feature 6 + 7: escalation reaches staff through the existing notification
  // system, at CRITICAL priority, without waiting for anyone to open a page.
  if (escalation.escalate) {
    await notifyStaffOfEscalation({ complaint, escalation, building });
  }

  const populated = await Complaint.findById(complaint._id)
    .populate("building", "code name")
    .populate("relatedIncident", "reference title risk");

  return created(
    res,
    {
      complaint: shape(populated),
      // The full AI block, so the student's own confirmation screen can show
      // what the system decided and why.
      ai: {
        source: analysis.source,
        provider: analysis.provider,
        model: analysis.model,
        method: analysis.method,
        category: analysis.category,
        subCategory: analysis.subCategory,
        priority: analysis.priority,
        severity: analysis.severity,
        department: analysis.department,
        confidence: analysis.confidence,
        confidenceBasis: analysis.confidenceBasis,
        reason: analysis.reason,
        reasons: analysis.reasons,
        suggestedAction: analysis.suggestedAction,
        urgencyHours: analysis.urgencyHours,
        processedAt: analysis.processedAt,
        notice: analysis.notice || null
      },
      escalation,
      // Kept for backward compatibility: the original response shape had a
      // top-level `classification`, and the frontend reads it.
      classification: complaint.aiClassification,
      duplicates: duplicates.slice(0, 5).map((row) => ({
        id: String(row.complaint._id),
        reference: row.complaint.reference,
        title: row.complaint.title,
        overlap: round(row.score * 100)
      })),
      // EXCEPTION-ONLY HOOK: additive — the planned work this complaint was linked to, if any.
      plannedChange: plannedChange ? { reference: plannedChange.reference, title: plannedChange.title, window: plannedChange.window, notice: plannedChange.notice?.reference || null } : null,
      incident: attachment
        ? {
            id: String(attachment.incident._id),
            reference: attachment.incident.reference,
            title: attachment.incident.title,
            complaintCount: attachment.incident.complaints.length,
            risk: attachment.incident.risk,
            matchScore: attachment.matchScore
          }
        : null
    },
    "Complaint submitted and classified"
  );
});

/** GET /api/complaints — students see their own, staff see everything. */
export const listComplaints = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};

  if (!isStaff(req.user) || req.query.mine === "true") filter.student = req.user._id;
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.category) filter.category = String(req.query.category).toUpperCase();
  if (req.query.incident) filter.relatedIncident = req.query.incident;
  if (req.query.buildingCode) {
    const building = await Building.findOne({ code: String(req.query.buildingCode).toUpperCase() }).lean();
    filter.building = building?._id ?? null;
  }

  const [rows, total] = await Promise.all([
    Complaint.find(filter)
      .populate("building", "code name")
      .populate("relatedIncident", "reference title risk")
      .populate("student", "name studentId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Complaint.countDocuments(filter)
  ]);

  return ok(res, { complaints: rows.map(shape), meta: pageMeta(page, limit, total) });
});

export const getComplaint = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id)
    .populate("building", "code name")
    .populate("relatedIncident", "reference title risk")
    .populate("student", "name studentId");

  if (!complaint) throw ApiError.notFound("No complaint with that id");
  if (!isStaff(req.user) && String(complaint.student._id) !== String(req.user._id)) {
    throw ApiError.forbidden("You can only read your own complaints");
  }

  return ok(res, { complaint: shape(complaint) });
});

/** PATCH /api/complaints/:id — workflow moves; staff only. */
export const updateComplaint = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw ApiError.notFound("No complaint with that id");

  const { status, resolutionDescription, adminMessage, studentSatisfaction, recurrence, ...rest } = req.body;

  // Captured before anything changes, so the audit chain records the real
  // previous value of every field an administrator touched.
  const before = { status: complaint.status, priority: complaint.priority, severity: complaint.severity, department: complaint.department };
  Object.assign(complaint, rest);

  const previousStatus = complaint.status;
  const transitioned = Boolean(status && status !== previousStatus);
  if (transitioned) {
    complaint.status = status;
    complaint.audit.push({
      actor: req.user.name,
      message: `Status moved to ${status}`,
      kind: "ACTUAL DATA"
    });
  }

  // Only a real transition resolves: a repeated PATCH to an already-resolved
  // complaint must not rewrite its resolution or count the building twice.
  if (transitioned && (status === "RESOLVED" || status === "APPROVED")) {
    const openedAt = new Date(complaint.createdAt);
    const hours = round((Date.now() - openedAt) / 36e5, 1);
    const incident = complaint.relatedIncident ? await Incident.findById(complaint.relatedIncident).lean() : null;
    const finalMsg = adminMessage || resolutionDescription || `Resolved and approved by ${req.user.name} (${req.user.role}).`;

    complaint.status = "RESOLVED"; // Standardize to RESOLVED
    complaint.resolution = {
      resolutionTimeHours: hours,
      resolvedBy: req.user._id,
      resolvedByName: req.user.name,
      resolvedByRole: req.user.role,
      resolutionDescription: finalMsg,
      adminMessage: finalMsg,
      studentSatisfaction,
      riskBefore: incident?.risk,
      riskAfter: incident?.resolution?.riskAfter,
      recurrence: recurrence || "None recorded yet",
      resolvedAt: new Date(),
      confirmWindowDays: 6,
      studentFlag: "PENDING"
    };
    complaint.audit.push({
      actor: req.user.name,
      message: `Approved & resolved by ${req.user.name} (${req.user.role}) in ${hours}h — ${finalMsg}`,
      kind: "ACTUAL DATA"
    });
    if (complaint.building) {
      await Building.findByIdAndUpdate(complaint.building, {
        $inc: { activeProblems: -1, historicalProblems: 1 }
      });
    }

    try {
      await ensureConfirmation(complaint, complaint.resolution.resolvedAt);
    } catch (_) {}
  }

  // Administrative rejection handling
  if (transitioned && status === "REJECTED") {
    const finalMsg = adminMessage || resolutionDescription || `Report reviewed and rejected by ${req.user.name} (${req.user.role}).`;
    complaint.status = "REJECTED";
    complaint.resolution = {
      resolvedBy: req.user._id,
      resolvedByName: req.user.name,
      resolvedByRole: req.user.role,
      resolutionDescription: finalMsg,
      adminMessage: finalMsg,
      resolvedAt: new Date(),
      confirmWindowDays: 0,
      studentFlag: "PENDING"
    };
    complaint.audit.push({
      actor: req.user.name,
      message: `Rejected by ${req.user.name} (${req.user.role}) — ${finalMsg}`,
      kind: "ACTUAL DATA"
    });
    if (complaint.building) {
      await Building.findByIdAndUpdate(complaint.building, {
        $inc: { activeProblems: -1 }
      });
    }
  }

  await complaint.save();

  // Feature 21: each changed field enters the tamper-evident chain.
  for (const field of ["status", "priority", "severity", "department"]) {
    const next = field === "status" ? complaint.status : complaint[field];
    if (next !== undefined && next !== before[field]) {
      await recordAudit({
        entityType: "Complaint",
        entityId: complaint._id,
        entityRef: complaint.reference,
        action: field === "status" && next === "RESOLVED" ? "COMPLAINT_RESOLVED" : `COMPLAINT_${field.toUpperCase()}_CHANGED`,
        field,
        previousValue: before[field] || "",
        newValue: next,
        actor: req.user,
        note: field === "status" && next === "RESOLVED" ? (adminMessage || resolutionDescription || "no description supplied") : undefined
      });
    }
  }

  if (transitioned && (status === "RESOLVED" || status === "APPROVED")) {
    await notifyStudentOfResolution({ complaint, note: adminMessage || resolutionDescription });
  }

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  if (transitioned) {
    emitEvent({ type: (status === "RESOLVED" || status === "APPROVED") ? "COMPLAINT_RESOLVED" : "COMPLAINT_STATUS_CHANGED", actor: req.user, student: complaint.student, subjectType: "Complaint", subjectId: complaint._id, subjectRef: complaint.reference, department: complaint.department, channel: "APP", payload: { from: previousStatus, to: complaint.status, hours: complaint.resolution?.resolutionTimeHours, adminMessage } });
  }

  const populated = await Complaint.findById(complaint._id)
    .populate("building", "code name")
    .populate("relatedIncident", "reference title risk")
    .populate("student", "name studentId");

  return ok(res, { complaint: shape(populated) }, "Complaint updated");
});

/** POST /api/complaints/:id/student-flag — 6-day Green/Red Flag confirmation */
export const studentFlagComplaint = asyncHandler(async (req, res) => {
  // Role separation: Only students can confirm or dispute problem resolutions.
  // Admin and Warden staff review, approve, and resolve reports, but cannot perform student confirmations.
  if (req.user.role !== "STUDENT") {
    throw ApiError.forbidden("Admin and Warden staff cannot perform student verification actions. Only the student who submitted the report can confirm with Green Flag or dispute with Red Flag.");
  }
  const { flag, response, comment } = req.body;
  const choice = flag || response || "GREEN_FLAG";
  const result = await confirmFix(req.params.id, req.user, { response: choice, comment });
  const updated = await Complaint.findById(req.params.id)
    .populate("building", "code name")
    .populate("relatedIncident", "reference title risk")
    .populate("student", "name studentId");

  return ok(res, { complaint: shape(updated), confirmation: result }, "Student verification recorded");
});

/** DELETE /api/complaints/:id — the author may withdraw, staff may remove. */
export const deleteComplaint = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw ApiError.notFound("No complaint with that id");

  const isAuthor = String(complaint.student) === String(req.user._id);
  if (!isAuthor && !isStaff(req.user)) throw ApiError.forbidden("You cannot delete this complaint");
  if (isAuthor && !isStaff(req.user) && complaint.status !== "PENDING" && complaint.status !== "CLASSIFIED") {
    throw ApiError.badRequest("A complaint already under investigation cannot be withdrawn");
  }

  if (complaint.relatedIncident) {
    await Incident.findByIdAndUpdate(complaint.relatedIncident, { $pull: { complaints: complaint._id } });
  }
  if (complaint.building) {
    await Building.findByIdAndUpdate(complaint.building, { $inc: { activeProblems: -1 } });
  }
  await complaint.deleteOne();

  return ok(res, { id: req.params.id }, "Complaint removed");
});

/**
 * PATCH /api/complaints/:id/routing — Feature 2.
 *
 * An authorised member of staff accepts the AI's department recommendation or
 * replaces it. The recommendation is never overwritten: both values, the
 * decision, the person and the timestamp are all kept, and the change enters
 * the tamper-evident audit chain.
 */
export const decideRouting = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw ApiError.notFound("No complaint with that id");

  const recommended = complaint.aiRouting?.recommendedDepartment || complaint.aiClassification?.routedTo || null;
  const chosen = req.body.department || recommended;
  if (!chosen) throw ApiError.badRequest("No department recommended and none supplied");

  const decision = chosen === recommended ? "ACCEPTED" : "MODIFIED";
  const previous = complaint.department || null;

  complaint.aiRouting = {
    ...(complaint.aiRouting?.toObject?.() || complaint.aiRouting || {}),
    recommendedDepartment: recommended || undefined,
    finalDepartment: chosen,
    decision,
    decidedBy: req.user._id,
    decidedByName: req.user.name,
    decidedByRole: req.user.role,
    decidedAt: new Date(),
    note: req.body.note
  };
  complaint.department = chosen;
  if (complaint.status === "CLASSIFIED") complaint.status = "ASSIGNED";

  complaint.audit.push({
    actor: req.user.name,
    message:
      decision === "ACCEPTED"
        ? `Accepted the recommended department: ${chosen}`
        : `Overrode the recommended department ${recommended || "(none)"} → ${chosen}${req.body.note ? ` — ${req.body.note}` : ""}`,
    kind: "ACTUAL DATA"
  });

  await complaint.save();

  await recordAudit({
    entityType: "Complaint",
    entityId: complaint._id,
    entityRef: complaint.reference,
    action: decision === "ACCEPTED" ? "ROUTING_ACCEPTED" : "ROUTING_OVERRIDDEN",
    field: "department",
    previousValue: previous,
    newValue: chosen,
    actor: req.user,
    note: req.body.note || `AI recommended ${recommended || "nothing"}`
  });

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: "COMPLAINT_ASSIGNED", actor: req.user, student: complaint.student, subjectType: "Complaint", subjectId: complaint._id, subjectRef: complaint.reference, department: chosen, channel: "APP", payload: { decision, recommended, chosen } });

  const populated = await Complaint.findById(complaint._id)
    .populate("building", "code name")
    .populate("relatedIncident", "reference title risk")
    .populate("student", "name studentId");

  return ok(res, { complaint: shape(populated), routing: complaint.aiRouting }, `Routing ${decision.toLowerCase()}`);
});

/**
 * GET /api/complaints/:id/duplicates — Feature 3.
 *
 * The candidates always come from the database. The verdict comes from the AI
 * layer when it is configured, and from keyword overlap when it is not — and
 * the response says which. Nothing is merged or deleted here.
 */
export const complaintDuplicates = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw ApiError.notFound("No complaint with that id");
  if (!isStaff(req.user) && String(complaint.student) !== String(req.user._id)) {
    throw ApiError.forbidden("You can only read your own complaints");
  }

  const result = await detectDuplicate(complaint);
  return ok(res, { complaint: { id: String(complaint._id), reference: complaint.reference }, duplicate: result });
});

/**
 * POST /api/complaints/:id/duplicate-review — Feature 3.
 *
 * LINKED records the relationship; SEPARATE dismisses it. Neither deletes
 * anything, and both complaints stay independently workable either way.
 */
export const reviewDuplicate = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw ApiError.notFound("No complaint with that id");

  const { decision, relatedId, note } = req.body;

  let related = null;
  if (decision === "LINKED") {
    if (!relatedId) throw ApiError.badRequest("relatedId is required when linking two complaints");
    related = await Complaint.findById(relatedId).select("reference").lean();
    if (!related) throw ApiError.notFound("No complaint with that relatedId");
    if (String(related._id) === String(complaint._id)) {
      throw ApiError.badRequest("A complaint cannot be linked to itself");
    }
  }

  const previous = complaint.duplicateReview?.decision || null;

  complaint.duplicateReview = {
    decision,
    relatedComplaint: related?._id,
    relatedReference: related?.reference,
    similarity: complaint.duplicateProbability,
    decidedBy: req.user._id,
    decidedByName: req.user.name,
    decidedAt: new Date(),
    note
  };
  // duplicateOf is the link the rest of the system reads. SEPARATE clears it
  // so a dismissed suggestion stops influencing anything downstream.
  complaint.duplicateOf = decision === "LINKED" ? related._id : undefined;

  complaint.audit.push({
    actor: req.user.name,
    message:
      decision === "LINKED"
        ? `Linked to ${related.reference} as the same underlying problem${note ? ` — ${note}` : ""}`
        : `Marked as a separate problem from the suggested duplicate${note ? ` — ${note}` : ""}`,
    kind: "ACTUAL DATA"
  });

  await complaint.save();

  await recordAudit({
    entityType: "Complaint",
    entityId: complaint._id,
    entityRef: complaint.reference,
    action: decision === "LINKED" ? "DUPLICATE_LINKED" : "DUPLICATE_DISMISSED",
    field: "duplicateOf",
    previousValue: previous,
    newValue: decision === "LINKED" ? related.reference : "SEPARATE",
    actor: req.user,
    note
  });

  const populated = await Complaint.findById(complaint._id)
    .populate("building", "code name")
    .populate("student", "name studentId");

  return ok(res, { complaint: shape(populated) }, `Marked as ${decision.toLowerCase()}`);
});

/**
 * POST /api/complaints/:id/reclassify — Feature 1, on demand.
 *
 * Re-runs the AI layer against a stored complaint. Useful after a provider is
 * configured for the first time: complaints filed while it was unavailable can
 * be analysed without being re-submitted. Staff only.
 */
export const reclassifyComplaint = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw ApiError.notFound("No complaint with that id");

  const building = complaint.building ? await Building.findById(complaint.building) : null;
  const previousCategory = complaint.aiClassification?.category || null;
  const analysis = await classifyComplaint(complaint, { building });
  const { escalation, rules } = analysis;

  complaint.aiClassification = {
    category: analysis.category,
    subCategory: analysis.subCategory || undefined,
    priority: analysis.priority,
    severity: analysis.severity,
    duplicateProbability: rules.duplicateProbability,
    affectedArea: rules.affectedArea,
    routedTo: analysis.department,
    slaHours: analysis.urgencyHours,
    confidence: analysis.confidence,
    method: analysis.method,
    reasons: analysis.reasons,
    classifiedAt: new Date(),
    source: analysis.source,
    provider: analysis.provider,
    model: analysis.model,
    confidenceBasis: analysis.confidenceBasis,
    suggestedAction: analysis.suggestedAction,
    safetyRule: escalation.rule === "SAFETY_RULE" ? escalation.safetyMatches.map((hit) => hit.id).join(",") : undefined,
    escalated: escalation.escalate,
    processedAt: analysis.processedAt
  };

  // A re-run updates the recommendation. It does not undo a human override:
  // finalDepartment and the decision that set it are left exactly as they are.
  complaint.aiRouting = {
    ...(complaint.aiRouting?.toObject?.() || complaint.aiRouting || {}),
    recommendedDepartment: analysis.department,
    recommendedBy:
      analysis.source === AI_SOURCES.MODEL ? `${analysis.provider}/${analysis.model}` : "classificationService",
    recommendedAt: new Date()
  };
  if (!complaint.aiRouting.decision) {
    complaint.aiRouting.finalDepartment = analysis.department;
    complaint.department = analysis.department;
  }

  complaint.audit.push({
    actor: analysis.source === AI_SOURCES.MODEL ? "aiService" : "classificationService",
    message: `Re-analysed on request by ${req.user.name}: ${analysis.category} / ${analysis.priority} / ${analysis.severity} (${analysis.source})`,
    kind: "AI PREDICTION"
  });

  await complaint.save();

  await recordAudit({
    entityType: "Complaint",
    entityId: complaint._id,
    entityRef: complaint.reference,
    action: "AI_RECLASSIFIED",
    field: "aiClassification.category",
    previousValue: previousCategory,
    newValue: analysis.category,
    actor: req.user,
    note: `source ${analysis.source}`
  });

  const populated = await Complaint.findById(complaint._id)
    .populate("building", "code name")
    .populate("relatedIncident", "reference title risk")
    .populate("student", "name studentId");

  return ok(
    res,
    {
      complaint: shape(populated),
      ai: {
        source: analysis.source,
        provider: analysis.provider,
        model: analysis.model,
        method: analysis.method,
        confidence: analysis.confidence,
        confidenceBasis: analysis.confidenceBasis,
        reason: analysis.reason,
        reasons: analysis.reasons,
        suggestedAction: analysis.suggestedAction,
        processedAt: analysis.processedAt,
        notice: analysis.notice || null
      },
      escalation
    },
    "Complaint re-analysed"
  );
});

/**
 * POST /api/complaints/:id/feedback — Feature 17.
 *
 * The author rates their own resolved complaint, once. The rating is the
 * student's own statement and is stored as given; the lexicon sentiment is
 * stored beside it and labelled with how it was computed.
 */
export const submitFeedback = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id);
  if (!complaint) throw ApiError.notFound("No complaint with that id");
  if (String(complaint.student) !== String(req.user._id)) {
    throw ApiError.forbidden("Only the student who filed this complaint can rate it");
  }
  if (complaint.status !== "RESOLVED") {
    throw ApiError.badRequest("A complaint can be rated once it has been resolved");
  }
  if (complaint.feedback?.rating) {
    throw ApiError.conflict("You have already rated this complaint");
  }

  const { rating, comment } = req.body;
  const sentiment = sentimentOf(comment, rating);

  complaint.feedback = {
    rating,
    comment,
    submittedAt: new Date(),
    sentiment: sentiment.label,
    sentimentMethod: sentiment.method
  };
  // The existing satisfaction field is on a 0–100 scale; the timeline's
  // FEEDBACK stage reads it.
  complaint.set("resolution.studentSatisfaction", rating * 20);
  complaint.audit.push({
    actor: req.user.name,
    message: `Student rated the resolution ${rating}/5${comment ? ` — "${comment.slice(0, 120)}"` : ""}`,
    kind: "ACTUAL DATA"
  });
  await complaint.save();

  await recordAudit({
    entityType: "Complaint",
    entityId: complaint._id,
    entityRef: complaint.reference,
    action: "FEEDBACK_SUBMITTED",
    field: "feedback.rating",
    previousValue: "",
    newValue: String(rating),
    actor: req.user
  });

  return created(res, { feedback: complaint.feedback, sentiment }, "Thank you — your rating was recorded");
});

/**
 * GET /api/complaints/:id/resolution-suggestions — Feature 16.
 *
 * Resolutions that worked on similar, genuinely resolved complaints, and a
 * suggestion built only from them. Staff only.
 */
export const resolutionSuggestions = asyncHandler(async (req, res) => {
  const complaint = await Complaint.findById(req.params.id).lean();
  if (!complaint) throw ApiError.notFound("No complaint with that id");

  const learning = await resolutionPrecedents(complaint);
  const suggestion = await suggestResolution(complaint, learning);

  return ok(res, {
    complaint: { id: String(complaint._id), reference: complaint.reference, category: complaint.category },
    learning,
    suggestion
  });
});

