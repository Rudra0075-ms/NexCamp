import { ROLES, STAFF_ROLES } from "../config/constants.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { GatePass } from "../models/GatePass.js";
import { Incident } from "../models/Incident.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import {
  analyzeRootCause,
  detectAnomaly,
  generateAdminAnswer,
  predictDemand,
  status as aiStatus,
  summarizeCampus,
  assessGatePassRisk,
  analyzeFeedback,
  analyzeWorkload,
  explainCorrelations,
  explainSimulation,
  narrateDataQuality,
  predictSlaBreach
} from "../services/aiService.js";
import { runDataQualityChecks } from "../services/dataQualityService.js";
import { feedbackAnalysis } from "../services/feedbackService.js";
import {
  crossModuleSnapshot,
  digitalTwin,
  digitalTwinNode,
  simulateLoad,
  simulationBaseline,
  slaForecast,
  workloadAnalysis
} from "../services/operationsIntelligenceService.js";
import { history as auditHistory } from "../services/auditChainService.js";
import { ground, SUPPORTED_ADMIN_QUESTIONS } from "../services/copilotService.js";
import { gatePassRiskBoard, scoreGatePassHistory } from "../services/gatePassRiskService.js";
import { predictComplaintVolume } from "../services/predictionService.js";
import { evidenceFor, findRecurring } from "../services/recurrenceService.js";
import { timelineFor } from "../services/timelineService.js";
import { detectVolumeAnomalies } from "../services/volumeAnomalyService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";

const isStaff = (user) => STAFF_ROLES.includes(user.role);

/**
 * GET /api/ai/status
 *
 * Whether an AI provider is configured, and which one. Never the key. Every
 * authenticated user may read this, because the interface has to be able to
 * say "AI service not configured" instead of pretending.
 */
export const getStatus = asyncHandler(async (_req, res) => ok(res, aiStatus()));

/** GET /api/ai/recurring — Feature 4. Counted from complaint records. */
export const getRecurring = asyncHandler(async (req, res) => {
  const result = await findRecurring({
    windowDays: req.query.days ? Number(req.query.days) : 30,
    limit: req.query.limit ? Number(req.query.limit) : 8
  });
  return ok(res, result);
});

/**
 * GET /api/ai/root-cause/:buildingCode/:category — Feature 5.
 *
 * Takes the recurring pattern for one building and category and asks the AI
 * layer what might be behind it. Labelled as a hypothesis, never a diagnosis.
 */
export const getRootCause = asyncHandler(async (req, res) => {
  const { buildingCode, category } = req.params;
  const windowDays = req.query.days ? Number(req.query.days) : 30;

  const recurring = await findRecurring({ windowDays, limit: 50 });
  const pattern = recurring.patterns.find(
    (row) =>
      row.building.code.toUpperCase() === String(buildingCode).toUpperCase() &&
      row.category.toUpperCase() === String(category).toUpperCase()
  );

  if (!pattern) {
    throw ApiError.notFound(
      `No recurring ${category} pattern in ${buildingCode} over the last ${windowDays} days. ` +
        "Root-cause analysis only runs on patterns that clear the recurrence threshold."
    );
  }

  const building = await Building.findOne({ code: String(buildingCode).toUpperCase() }).select("_id").lean();
  const samples = await Complaint.find({
    ...(building ? { building: building._id } : {}),
    category: pattern.category,
    createdAt: { $gte: new Date(Date.now() - windowDays * 864e5) }
  })
    .select("reference title description createdAt location status")
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const analysis = await analyzeRootCause(pattern, samples);

  return ok(res, {
    pattern: { ...pattern, evidence: evidenceFor(pattern) },
    analysis,
    // The records the analysis was built from, so nothing has to be taken on trust.
    supportingComplaints: samples.map((row) => ({
      id: String(row._id),
      reference: row.reference,
      title: row.title,
      status: row.status,
      location: row.location,
      createdAt: row.createdAt
    }))
  });
});

/**
 * GET /api/ai/summary — Feature 10.
 *
 * Counts the campus state out of the database first, then asks the AI layer to
 * phrase it. The counted figures ship with the response either way.
 */
export const getSummary = asyncHandler(async (_req, res) => {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [
    pendingComplaints,
    criticalComplaints,
    highComplaints,
    filedToday,
    openIncidents,
    activePasses,
    overduePasses,
    unreadCritical,
    departmentLoad,
    recurring
  ] = await Promise.all([
    Complaint.countDocuments({ status: { $ne: "RESOLVED" } }),
    Complaint.countDocuments({ status: { $ne: "RESOLVED" }, priority: "CRITICAL" }),
    Complaint.countDocuments({ status: { $ne: "RESOLVED" }, priority: "HIGH" }),
    Complaint.countDocuments({ createdAt: { $gte: dayStart } }),
    Incident.countDocuments({ status: { $ne: "RESOLVED" } }),
    GatePass.countDocuments({ status: "ACTIVE" }),
    GatePass.countDocuments({ status: "OVERDUE" }),
    Notification.countDocuments({ priority: "CRITICAL", readAt: { $exists: false } }),
    Complaint.aggregate([
      { $match: { status: { $ne: "RESOLVED" }, department: { $ne: null } } },
      { $group: { _id: "$department", pending: { $sum: 1 } } },
      { $sort: { pending: -1 } },
      { $limit: 5 }
    ]),
    findRecurring({ windowDays: 30, limit: 3 })
  ]);

  const leadDepartment = departmentLoad[0] || null;

  // Every line here is a counted figure. Nothing is estimated.
  const lines = [
    `${pendingComplaints} complaints are pending.`,
    `${criticalComplaints} are CRITICAL and ${highComplaints} are HIGH priority.`,
    `${filedToday} complaints were filed today.`,
    `${openIncidents} incidents are open.`,
    leadDepartment
      ? `${leadDepartment._id} carries the largest pending workload at ${leadDepartment.pending} complaints.`
      : "No unresolved complaint currently has a department assigned.",
    recurring.patterns.length
      ? `${recurring.patterns.length} recurring pattern${recurring.patterns.length === 1 ? "" : "s"} detected in the last 30 days, led by ${recurring.patterns[0].occurrences} ${recurring.patterns[0].category} complaints in ${recurring.patterns[0].building.name}.`
      : "No recurring pattern clears the detection threshold in the last 30 days.",
    `${activePasses} gate passes are active and ${overduePasses} are overdue.`,
    `${unreadCritical} critical notifications are unread.`
  ];

  const facts = {
    lines,
    headline: `${pendingComplaints} complaints pending, ${criticalComplaints} critical, ${openIncidents} incidents open.`,
    topPriority: criticalComplaints
      ? `Clear the ${criticalComplaints} critical complaints first.`
      : overduePasses
        ? `${overduePasses} gate passes are overdue — locate those students first.`
        : leadDepartment
          ? `Work down ${leadDepartment._id}'s queue of ${leadDepartment.pending}.`
          : "Nothing is escalated. Hold the routine schedule.",
    counts: {
      pendingComplaints,
      criticalComplaints,
      highComplaints,
      filedToday,
      openIncidents,
      activePasses,
      overduePasses,
      unreadCriticalNotifications: unreadCritical,
      departmentLoad: departmentLoad.map((row) => ({ department: row._id, pending: row.pending })),
      recurringPatterns: recurring.patterns.length
    },
    method: "DATABASE_AGGREGATION"
  };

  const summary = await summarizeCampus(facts);
  return ok(res, { summary, recurring: recurring.patterns });
});

/**
 * GET /api/ai/anomalies — Feature 11.
 *
 * The statistics decide what is an anomaly; the AI layer only explains what was
 * found. A quiet campus returns zero findings and says why, rather than
 * manufacturing one.
 */
export const getAnomalies = asyncHandler(async (req, res) => {
  const detection = await detectVolumeAnomalies({ days: req.query.days ? Number(req.query.days) : 30 });

  // Narrate at most three, so an unconfigured provider costs nothing and a
  // configured one is not called once per building.
  const narrated = await Promise.all(detection.findings.slice(0, 3).map((finding) => detectAnomaly(finding)));

  return ok(res, {
    ...detection,
    narrated,
    note: detection.findings.length
      ? null
      : "No series moved outside its own recent spread by enough to be called an anomaly."
  });
});

/** GET /api/ai/predictions — Feature 8. Returns nothing when history is thin. */
export const getPredictions = asyncHandler(async (req, res) => {
  const prediction = await predictComplaintVolume({ days: req.query.days ? Number(req.query.days) : 30 });
  const narrated = await predictDemand(prediction);
  return ok(res, { prediction, narrated });
});

/**
 * POST /api/ai/copilot — Feature 9.
 *
 * The question is matched to an intent, the intent runs a real aggregation, and
 * the model — when one is configured — is handed those results and nothing
 * else. The rows travel back with the answer so every claim can be checked.
 */
export const copilot = asyncHandler(async (req, res) => {
  const question = req.body.question;
  const grounding = await ground(question);

  const answer = await generateAdminAnswer({
    question,
    facts: grounding.facts,
    records: grounding.records,
    deterministicAnswer: grounding.answer
  });

  return ok(res, {
    question,
    intent: grounding.intent,
    recognised: grounding.recognised,
    matchedKeywords: grounding.matchedKeywords,
    matchStrength: grounding.matchStrength,
    groundingMethod: grounding.method,
    answer,
    supportedQuestions: SUPPORTED_ADMIN_QUESTIONS
  });
});

/** GET /api/ai/copilot/questions — what the grounding layer can actually run. */
export const copilotQuestions = asyncHandler(async (_req, res) =>
  ok(res, {
    questions: SUPPORTED_ADMIN_QUESTIONS,
    method: "RULE_BASED_INTENT_MATCH + DATABASE_AGGREGATION",
    note:
      "Every question above maps to a real database aggregation. Anything else returns the current campus state " +
      "plus a note that the shape was not recognised — never a guessed answer."
  })
);

/** GET /api/ai/audit — Feature 14. Administrators only. */
export const getAudit = asyncHandler(async (req, res) => {
  const result = await auditHistory({
    entityType: req.query.entityType,
    entityId: req.query.entityId,
    limit: req.query.limit ? Math.min(Number(req.query.limit), 200) : 50,
    skip: req.query.skip ? Number(req.query.skip) : 0
  });
  return ok(res, result);
});

/** GET /api/ai/gatepass-risk — Feature 16. Signals for review, never decisions. */
export const getGatePassRisk = asyncHandler(async (req, res) => {
  const board = await gatePassRiskBoard({
    windowDays: req.query.days ? Number(req.query.days) : 90,
    limit: req.query.limit ? Number(req.query.limit) : 10,
    // A warden sees their own hostel; an administrator sees the campus.
    hostelId: req.user.role === ROLES.WARDEN ? req.user.hostel : null
  });

  const narrated = board.rows.length
    ? await assessGatePassRisk(board.rows[0], board.rows[0].student)
    : null;

  return ok(res, { ...board, narrated });
});

/** GET /api/ai/gatepass-risk/:studentId — one student's own history. */
export const getStudentGatePassRisk = asyncHandler(async (req, res) => {
  const student = await User.findById(req.params.studentId).select("name studentId hostel").lean();
  if (!student) throw ApiError.notFound("No student with that id");

  const passes = await GatePass.find({ student: student._id })
    .select("reference status leaveAt expectedReturnAt overdueMinutes createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const assessment = scoreGatePassHistory(passes);
  const narrated = await assessGatePassRisk(assessment, student);

  return ok(res, {
    student: { id: String(student._id), name: student.name, studentId: student.studentId },
    assessment,
    narrated,
    records: passes.map((pass) => ({
      reference: pass.reference,
      status: pass.status,
      leaveAt: pass.leaveAt,
      expectedReturnAt: pass.expectedReturnAt,
      overdueMinutes: pass.overdueMinutes || 0
    }))
  });
});

/**
 * GET /api/ai/timeline/:kind/:id — Feature 13.
 *
 * Projects an existing complaint or gate pass onto one timeline shape. Reads
 * the stored record; creates nothing.
 */
export const getTimeline = asyncHandler(async (req, res) => {
  const { kind, id } = req.params;
  const { record, timeline } = await timelineFor(kind, id);

  // Ownership: a student may only see their own records.
  if (!isStaff(req.user) && String(record.student) !== String(req.user._id)) {
    throw ApiError.forbidden("You can only read your own records");
  }

  return ok(res, { timeline });
});

/** GET /api/ai/notifications — Feature 7. The caller's own graded inbox. */
export const getNotifications = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.priority) filter.priority = String(req.query.priority).toUpperCase();

  const rows = await Notification.find(filter).sort({ createdAt: -1 }).limit(40).lean();

  const byPriority = rows.reduce((counts, row) => {
    const key = row.priority || "MEDIUM";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  return ok(res, {
    notifications: rows.map((row) => ({
      id: String(row._id),
      kind: row.kind,
      title: row.title,
      body: row.body,
      priority: row.priority || "MEDIUM",
      prioritySource: row.prioritySource || "RULE_BASED",
      priorityReason: row.priorityReason || null,
      tone: row.tone,
      gatePass: row.gatePass ? String(row.gatePass) : null,
      meta: row.meta || null,
      readAt: row.readAt || null,
      createdAt: row.createdAt
    })),
    counts: byPriority,
    unread: rows.filter((row) => !row.readAt).length,
    method: "DETERMINISTIC_NOTIFICATION_RULES"
  });
});

// ---------------------------------------------------------------------------
// Operational intelligence — every handler computes from the database first,
// then lets the AI layer phrase the result. The computed figures always ship.
// ---------------------------------------------------------------------------

const windowParam = (value, fallback, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.trunc(parsed), max) : fallback;
};

/** GET /api/ai/sla — Feature 8. BREACHED is measured; the rest is predicted. */
export const getSla = asyncHandler(async (req, res) => {
  const forecast = await slaForecast({ limit: windowParam(req.query.limit, 12, 50) });
  const narrated = await predictSlaBreach(forecast);
  return ok(res, { forecast, narrated });
});

/** GET /api/ai/workload — Feature 9. Recommends; never reassigns. */
export const getWorkload = asyncHandler(async (req, res) => {
  const analysis = await workloadAnalysis({ windowDays: windowParam(req.query.days, 14, 90) });
  const narrated = await analyzeWorkload(analysis);
  return ok(res, { analysis, narrated });
});

/**
 * POST /api/ai/simulate — Feature 12. Administrators only.
 *
 * The baseline is measured; the estimate is arithmetic on it. Both are
 * returned under separate keys and the response is labelled a simulation.
 */
export const runSimulation = asyncHandler(async (req, res) => {
  const input = {
    increasePct: req.body.increasePct,
    windowDays: req.body.windowDays || 30,
    horizonDays: req.body.horizonDays || 14
  };
  const baseline = await simulationBaseline({ windowDays: input.windowDays });
  const result = simulateLoad({ baseline, increasePct: input.increasePct, horizonDays: input.horizonDays });
  const narrated = await explainSimulation(input, result);
  return ok(res, {
    input,
    baseline,
    ...result,
    narrated,
    label: "SIMULATION / ESTIMATE",
    method: "LINEAR_PROJECTION_FROM_MEASURED_BASELINE",
    disclaimer:
      "An estimate, not a forecast of what will happen. The current figures are measured from the database; " +
      "the estimated figures only apply the assumptions listed."
  });
});

/** GET /api/ai/data-quality — Feature 15. Administrators only; read-only. */
export const getDataQuality = asyncHandler(async (_req, res) => {
  const report = await runDataQualityChecks();
  const narrated = await narrateDataQuality(report);
  return ok(res, { report, narrated });
});

/** GET /api/ai/feedback — Feature 17. Built only from ratings students left. */
export const getFeedbackIntel = asyncHandler(async (_req, res) => {
  const analysis = await feedbackAnalysis();
  const narrated = await analyzeFeedback(analysis);
  return ok(res, { analysis, narrated });
});

/** GET /api/ai/digital-twin — Feature 10. */
export const getDigitalTwin = asyncHandler(async (_req, res) => ok(res, await digitalTwin()));

/** GET /api/ai/digital-twin/:code — one block, down to its records. */
export const getDigitalTwinNode = asyncHandler(async (req, res) => {
  const node = await digitalTwinNode(req.params.code);
  if (!node) throw ApiError.notFound(`No building with code ${req.params.code}`);
  return ok(res, node);
});

/** GET /api/ai/correlations — Feature 11. Possible correlations, never causes. */
export const getCorrelations = asyncHandler(async (req, res) => {
  const snapshot = await crossModuleSnapshot({ windowDays: windowParam(req.query.days, 30, 180) });
  const narrated = await explainCorrelations(snapshot);
  return ok(res, { snapshot, narrated });
});
