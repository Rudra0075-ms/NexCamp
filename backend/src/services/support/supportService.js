import {
  ROLES,
  SUPPORT_BAND_LABELS,
  SUPPORT_BANDS,
  SUPPORT_CLOSED_STATUS,
  SUPPORT_OUTCOMES,
  SUPPORT_STATUS
} from "../../config/constants.js";
import { Notification } from "../../models/Notification.js";
import { User } from "../../models/User.js";
import { SupportCase } from "../../models/support/SupportCase.js";
import { WellbeingCheckIn } from "../../models/support/WellbeingCheckIn.js";
import { ApiError } from "../../utils/ApiError.js";
import { classifyNotification } from "../notificationPriority.js";
import { phraseSupportMessage } from "./supportAi.js";
import { autoEscalateImmediate, minCellSize, supportResources } from "./supportConfig.js";
import { analyseCheckIn, recommendedAction, REPEAT_WINDOW_DAYS } from "./supportRules.js";

/**
 * Silent Support System — workflow.
 *
 *   Student input → support-signal rules (+ optional model phrasing)
 *     → recommendation → human support team → private contact → follow-up → outcome
 *
 * Every privacy decision lives here, in one place:
 *   - studentView() and teamView() are the only shapes that leave the service;
 *   - a check-in's answers never leave the student's own read;
 *   - an anonymous case never carries the student's identity to the team;
 *   - notification text is generic — no answers, no bands, no names.
 */

const DAY = 86400000;
const MAX_CHECKINS_PER_DAY = 8;

export const PREFERENCE_LABELS = {
  COUNSELLOR: "Talk to a counsellor",
  MENTOR: "Talk to a mentor / faculty member",
  PRIVATE_CONVERSATION: "Private support conversation",
  ANONYMOUS: "Anonymous support",
  CHECK_LATER: "Check on me later",
  URGENT: "Immediate support"
};

const STEP_LABELS = {
  REQUESTED: "Request created",
  ASSIGNED: "Support team assigned",
  CONTACTED: "Contacted",
  FOLLOW_UP: "Follow-up",
  RESOLVED: "Resolved"
};
const STEPS = ["REQUESTED", "ASSIGNED", "CONTACTED", "FOLLOW_UP", "RESOLVED"];

// The moves a support person may make. Closed cases do not move.
export const TRANSITIONS = {
  REQUESTED: ["ASSIGNED"],
  ASSIGNED: ["CONTACTED", "RESOLVED"],
  CONTACTED: ["FOLLOW_UP", "RESOLVED"],
  FOLLOW_UP: ["ASSIGNED", "CONTACTED", "RESOLVED"],
  RESOLVED: [],
  WITHDRAWN: []
};

const isClosed = (status) => SUPPORT_CLOSED_STATUS.includes(status);

// ---- notifications (the existing Notification collection and inbox) ---------

async function supportNotify({ kind, audience, user, title, body, caseId, step, priority }) {
  if (!user) return null;
  const meta = { supportCase: String(caseId), ...(step ? { step } : {}) };
  const existing = await Notification.findOne({ kind, user, "meta.supportCase": meta.supportCase, ...(step ? { "meta.step": step } : {}) });
  if (existing) return existing;
  const graded = classifyNotification({ kind, title, body, explicitPriority: priority });
  return Notification.create({
    kind,
    audience,
    user,
    title,
    body,
    tone: priority === "HIGH" ? "high" : "mid",
    channel: "IN_APP",
    meta,
    priority: graded.priority,
    prioritySource: graded.prioritySource,
    priorityReason: graded.priorityReason
  });
}

async function supportTeam() {
  return User.find({ role: ROLES.COUNSELLOR }).select("_id").lean();
}

async function notifyTeam(supportCase, { kind, title, body, step, priority }) {
  const recipients = supportCase.assignedTo ? [{ _id: supportCase.assignedTo }] : await supportTeam();
  await Promise.all(
    recipients.map((member) =>
      supportNotify({ kind, audience: "SUPPORT_TEAM", user: member._id, title, body, caseId: supportCase._id, step, priority })
    )
  );
}

// ---- views --------------------------------------------------------------------

function steps(supportCase) {
  const reached = new Map(supportCase.history.map((row) => [row.status, row.at]));
  const at = STEPS.indexOf(supportCase.status);
  return STEPS.map((key, index) => ({
    key,
    label: STEP_LABELS[key],
    done: supportCase.status !== "WITHDRAWN" && (index <= at || reached.has(key)),
    current: key === supportCase.status,
    at: reached.get(key) || null
  }));
}

/** What the student sees about their own request. No team note, no assignee name. */
export function studentView(supportCase) {
  return {
    id: String(supportCase._id),
    reference: supportCase.reference,
    status: supportCase.status,
    statusLabel: supportCase.status === "WITHDRAWN" ? "Withdrawn" : STEP_LABELS[supportCase.status],
    preference: supportCase.preference,
    preferenceLabel: PREFERENCE_LABELS[supportCase.preference],
    anonymous: supportCase.anonymous,
    preferredTime: supportCase.preferredTime,
    urgent: supportCase.urgent,
    followUpAt: supportCase.followUpAt || null,
    steps: steps(supportCase),
    createdAt: supportCase.createdAt,
    updatedAt: supportCase.updatedAt,
    closed: isClosed(supportCase.status)
  };
}

/**
 * What the support team sees. Minimum necessary: how to reach the student
 * (unless anonymous), what kind of help they asked for, when, and — only if the
 * student agreed — the support band. Never the check-in answers.
 */
export function teamView(supportCase, { student, viewerId, assignee } = {}) {
  const now = Date.now();
  return {
    id: String(supportCase._id),
    reference: supportCase.reference,
    status: supportCase.status,
    statusLabel: supportCase.status === "WITHDRAWN" ? "Withdrawn by student" : STEP_LABELS[supportCase.status],
    origin: supportCase.origin,
    preference: supportCase.preference,
    preferenceLabel: PREFERENCE_LABELS[supportCase.preference],
    anonymous: supportCase.anonymous,
    preferredTime: supportCase.preferredTime,
    urgent: supportCase.urgent,
    band: supportCase.band || null,
    bandLabel: supportCase.band ? SUPPORT_BAND_LABELS[supportCase.band] : "Not shared",
    repeatedDifficulty: Boolean(supportCase.repeatedDifficulty),
    student: supportCase.anonymous || !student
      ? null
      : { name: student.name, studentId: student.studentId, department: student.department || null, hostelName: student.hostelName || null },
    assignedToMe: Boolean(viewerId && supportCase.assignedTo && String(supportCase.assignedTo) === String(viewerId)),
    assignedName: assignee?.name || null,
    followUpAt: supportCase.followUpAt || null,
    followUpDue: Boolean(supportCase.followUpAt && !isClosed(supportCase.status) && new Date(supportCase.followUpAt).getTime() <= now),
    outcome: supportCase.outcome || null,
    teamNote: supportCase.teamNote || "",
    steps: steps(supportCase),
    next: TRANSITIONS[supportCase.status] || [],
    insight: {
      kind: "RECOMMENDED ACTION",
      text: recommendedAction(supportCase),
      method: "RULE_BASED_SUPPORT_SIGNALS",
      note: "A suggestion for the support team, not a prediction about the student."
    },
    createdAt: supportCase.createdAt,
    updatedAt: supportCase.updatedAt
  };
}

// ---- student side -------------------------------------------------------------

async function recentCheckIns(studentId, now = new Date()) {
  return WellbeingCheckIn.find({ student: studentId, createdAt: { $gte: new Date(now.getTime() - REPEAT_WINDOW_DAYS * DAY) } })
    .sort({ createdAt: -1 })
    .limit(6)
    .select("band score createdAt")
    .lean();
}

/** GET /api/support/me — one read for the dashboard card. */
export async function studentState(student) {
  const [latest, cases] = await Promise.all([
    WellbeingCheckIn.findOne({ student: student._id }).sort({ createdAt: -1 }).select("band createdAt").lean(),
    SupportCase.find({ student: student._id }).sort({ createdAt: -1 }).limit(5)
  ]);
  return {
    latestCheckIn: latest ? { band: latest.band, label: SUPPORT_BAND_LABELS[latest.band], at: latest.createdAt } : null,
    cases: cases.map(studentView),
    openCase: cases.find((row) => !isClosed(row.status)) ? studentView(cases.find((row) => !isClosed(row.status))) : null,
    resources: supportResources(),
    preferences: Object.entries(PREFERENCE_LABELS).filter(([key]) => key !== "URGENT").map(([key, label]) => ({ key, label })),
    privacy: "Only you and the student support team can see this. Your answers are never shown to teachers, wardens or administrators."
  };
}

/** POST /api/support/check-in */
export async function recordCheckIn(student, { answers, unsafe = false }, { now = new Date() } = {}) {
  const today = await WellbeingCheckIn.countDocuments({ student: student._id, createdAt: { $gte: new Date(now.getTime() - DAY) } });
  if (today >= MAX_CHECKINS_PER_DAY) throw new ApiError(429, "You've checked in several times today. You can still request support at any time.");

  const previous = await recentCheckIns(student._id, now);
  const analysis = analyseCheckIn(answers, { unsafe, previous });
  await WellbeingCheckIn.create({ student: student._id, answers, unsafe: Boolean(unsafe), band: analysis.band, score: analysis.score });

  const phrased = await phraseSupportMessage(analysis);

  let escalated = null;
  if (analysis.band === "IMMEDIATE_ATTENTION" && autoEscalateImmediate()) {
    escalated = await createRequest(student, { preference: "URGENT", origin: "SAFETY_SIGNAL", urgent: true, shareCheckIn: true }, { now, analysis });
  }

  return {
    band: analysis.band,
    label: analysis.label,
    message: phrased.message,
    nextStep: phrased.nextStep,
    reasons: analysis.reasons,
    suggestHelp: analysis.suggestHelp,
    options: analysis.options,
    repeatedDifficulty: analysis.repeatedDifficulty,
    disclaimer: analysis.disclaimer,
    ai: { source: phrased.source, provider: phrased.provider, model: phrased.model, method: phrased.method, decidedBy: analysis.method },
    safety: analysis.band === "IMMEDIATE_ATTENTION" ? supportResources() : null,
    escalated: escalated ? escalated.case : null
  };
}

/** POST /api/support/requests (also used for "check on me later" and safety escalation). */
export async function createRequest(student, input, { now = new Date(), analysis } = {}) {
  const { preference, anonymous = false, shareCheckIn = false, preferredTime = "ANY", origin = "STUDENT_REQUEST", urgent = false, followUpDays } = input;
  const checkLater = preference === "CHECK_LATER";

  // One open request at a time keeps the queue honest; asking again returns it,
  // except that an urgent signal always upgrades the open request.
  const open = await SupportCase.findOne({ student: student._id, status: { $nin: SUPPORT_CLOSED_STATUS } }).sort({ createdAt: -1 });
  // A student who asked to be checked on later and now wants to talk upgrades that request.
  const upgradeLater = Boolean(open && open.preference === "CHECK_LATER" && !checkLater);
  if (open && !urgent && !upgradeLater && !(checkLater && open.preference === "CHECK_LATER")) {
    return { case: studentView(open), existing: true };
  }

  let band;
  let repeatedDifficulty = false;
  if (shareCheckIn || urgent) {
    if (analysis) {
      band = analysis.band;
      repeatedDifficulty = analysis.repeatedDifficulty;
    } else {
      const recent = await recentCheckIns(student._id, now);
      if (recent[0]) {
        band = recent[0].band;
        repeatedDifficulty = recent.filter((row) => row.score >= 4).length >= 2;
      }
    }
  }

  const followUpAt = checkLater ? new Date(now.getTime() + Math.min(30, Math.max(1, Number(followUpDays) || 3)) * DAY) : undefined;

  let supportCase;
  if (open && (urgent || checkLater || upgradeLater)) {
    // Upgrade / reschedule the open request rather than opening a second one.
    if (urgent || upgradeLater) {
      if (urgent) open.urgent = true;
      if (open.preference === "CHECK_LATER") {
        open.preference = urgent ? "URGENT" : preference;
        open.anonymous = Boolean(anonymous || preference === "ANONYMOUS");
        open.preferredTime = preferredTime;
      }
      if (open.status === "FOLLOW_UP" && !open.assignedTo) {
        open.status = "REQUESTED";
        open.history.push({ status: "REQUESTED", at: now, byRole: "STUDENT" });
      }
    }
    if (checkLater) {
      open.followUpAt = followUpAt;
      open.followUpNotifiedAt = undefined;
    }
    if (band) open.band = band;
    if (repeatedDifficulty) open.repeatedDifficulty = true;
    supportCase = await open.save();
  } else {
    const status = checkLater ? "FOLLOW_UP" : "REQUESTED";
    supportCase = await SupportCase.create({
      student: student._id,
      origin: checkLater ? "CHECK_ON_ME_LATER" : origin,
      preference,
      anonymous: Boolean(anonymous || preference === "ANONYMOUS"),
      preferredTime,
      urgent: Boolean(urgent),
      band,
      repeatedDifficulty,
      status,
      followUpAt,
      history: [{ status, at: now, byRole: "STUDENT" }]
    });
  }

  if (checkLater) {
    await supportNotify({
      kind: "SUPPORT_REQUEST_RECEIVED",
      audience: "STUDENT",
      user: student._id,
      caseId: supportCase._id,
      step: `LATER-${followUpAt.toISOString().slice(0, 10)}`,
      title: "We'll check on you later.",
      body: `No conversation has been started. We'll check in around ${followUpAt.toDateString()}. You can request support sooner at any time.`,
      priority: "LOW"
    });
  } else {
    await supportNotify({
      kind: "SUPPORT_REQUEST_RECEIVED",
      audience: "STUDENT",
      user: student._id,
      caseId: supportCase._id,
      step: urgent ? "URGENT" : "REQUESTED",
      title: "Your private support request has been received.",
      body: urgent
        ? "The support team has been alerted. If you are in immediate danger, please also use the emergency contacts on your dashboard."
        : "Only the student support team can see it. Someone will reach out — you don't need to explain anything. You can withdraw it at any time.",
      priority: urgent ? "HIGH" : "MEDIUM"
    });
    await notifyTeam(supportCase, {
      kind: "SUPPORT_REQUEST_NEW",
      step: urgent ? "URGENT" : "REQUESTED",
      title: urgent ? "Urgent: a student needs immediate human support." : "A new student support request requires attention.",
      body: `${supportCase.reference} · ${PREFERENCE_LABELS[supportCase.preference]}. Open the Student Support panel in Mission Control.`,
      priority: "HIGH"
    });
  }

  return { case: studentView(supportCase), existing: false };
}

/** POST /api/support/requests/:id/withdraw — the student closes their own request. */
export async function withdrawRequest(student, caseId, { now = new Date() } = {}) {
  const supportCase = await SupportCase.findOne({ _id: caseId, student: student._id });
  if (!supportCase) throw ApiError.notFound("Request not found");
  if (isClosed(supportCase.status)) return studentView(supportCase);
  supportCase.status = "WITHDRAWN";
  supportCase.closedAt = now;
  supportCase.history.push({ status: "WITHDRAWN", at: now, byRole: "STUDENT" });
  await supportCase.save();
  return studentView(supportCase);
}

// ---- support team side ----------------------------------------------------------

async function hydrate(cases, viewerId) {
  const studentIds = cases.filter((row) => !row.anonymous).map((row) => row.student);
  const assigneeIds = cases.map((row) => row.assignedTo).filter(Boolean);
  const [students, assignees] = await Promise.all([
    studentIds.length ? User.find({ _id: { $in: studentIds } }).select("name studentId department hostelName").lean() : [],
    assigneeIds.length ? User.find({ _id: { $in: assigneeIds } }).select("name").lean() : []
  ]);
  const sMap = new Map(students.map((row) => [String(row._id), row]));
  const aMap = new Map(assignees.map((row) => [String(row._id), row]));
  return cases.map((row) =>
    teamView(row, { student: sMap.get(String(row.student)), viewerId, assignee: row.assignedTo ? aMap.get(String(row.assignedTo)) : null })
  );
}

/** GET /api/support/queue — open cases first (urgent, then due follow-ups, then oldest). */
export async function teamQueue(viewer, { includeClosed = false, limit = 40 } = {}) {
  const filter = includeClosed ? {} : { status: { $nin: SUPPORT_CLOSED_STATUS } };
  const rows = await SupportCase.find(filter).sort({ urgent: -1, createdAt: 1 }).limit(Math.min(100, limit));
  const views = await hydrate(rows, viewer._id);
  views.sort((a, b) => Number(b.urgent) - Number(a.urgent) || Number(b.followUpDue) - Number(a.followUpDue) || new Date(a.createdAt) - new Date(b.createdAt));
  return { cases: views, count: views.length };
}

/** POST /api/support/cases/:id/status — a support person moves a case along. */
export async function moveCase(viewer, caseId, { status, outcome, note, message, followUpDays }, { now = new Date() } = {}) {
  const supportCase = await SupportCase.findById(caseId);
  if (!supportCase) throw ApiError.notFound("Support case not found");
  if (!SUPPORT_STATUS.includes(status)) throw ApiError.badRequest("Unknown status");
  const allowed = TRANSITIONS[supportCase.status] || [];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest(`A ${supportCase.status} case can move to: ${allowed.join(", ") || "nothing (it is closed)"}`);
  }
  if (status === "RESOLVED" && !SUPPORT_OUTCOMES.includes(outcome)) {
    throw ApiError.badRequest(`Record the outcome: ${SUPPORT_OUTCOMES.join(", ")}`);
  }

  supportCase.status = status;
  supportCase.history.push({ status, at: now, byRole: viewer.role });
  if (note !== undefined) supportCase.teamNote = note;
  if (status === "ASSIGNED") supportCase.assignedTo = viewer._id;
  if (status === "FOLLOW_UP") {
    supportCase.followUpAt = new Date(now.getTime() + Math.min(30, Math.max(1, Number(followUpDays) || 3)) * DAY);
    supportCase.followUpNotifiedAt = undefined;
  }
  if (status === "RESOLVED") {
    supportCase.outcome = outcome;
    supportCase.closedAt = now;
  }
  await supportCase.save();

  const step = `${status}-${supportCase.history.length}`;
  const studentNotice = {
    ASSIGNED: ["A support person has been assigned to your request.", "They will reach out privately. You don't need to do anything."],
    CONTACTED: ["The support team has reached out.", message || "A support person would like to talk with you privately."],
    FOLLOW_UP: ["A follow-up has been scheduled.", `The support team will check in again around ${supportCase.followUpAt?.toDateString?.() || "soon"}.`],
    RESOLVED: ["Your support request has been completed.", "Thank you for reaching out. You can ask again any time — it never needs a reason."]
  }[status];
  if (studentNotice) {
    await supportNotify({
      kind: "SUPPORT_STATUS_UPDATE",
      audience: "STUDENT",
      user: supportCase.student,
      caseId: supportCase._id,
      step,
      title: studentNotice[0],
      body: studentNotice[1],
      priority: status === "CONTACTED" ? "MEDIUM" : "LOW"
    });
  }

  const [view] = await hydrate([supportCase], viewer._id);
  return view;
}

// ---- follow-ups (rides the existing extension monitor timer) -------------------

/** Raises the "follow-up is due" notices once per scheduled follow-up. */
export async function followUpSweep(now = new Date()) {
  const due = await SupportCase.find({
    status: { $nin: SUPPORT_CLOSED_STATUS },
    followUpAt: { $lte: now },
    followUpNotifiedAt: { $exists: false }
  })
    .limit(100);
  for (const supportCase of due) {
    const step = `DUE-${new Date(supportCase.followUpAt).toISOString()}`;
    await supportNotify({
      kind: "SUPPORT_FOLLOW_UP_DUE",
      audience: "STUDENT",
      user: supportCase.student,
      caseId: supportCase._id,
      step,
      title: "Checking in, as you asked.",
      body: "How are things? You can do a 30-second check-in or request a conversation from your dashboard — or simply ignore this.",
      priority: "MEDIUM"
    });
    await notifyTeam(supportCase, {
      kind: "SUPPORT_FOLLOW_UP_DUE",
      step,
      title: "A scheduled support follow-up is due.",
      body: `${supportCase.reference} · ${PREFERENCE_LABELS[supportCase.preference]}.`,
      priority: "MEDIUM"
    });
    supportCase.followUpNotifiedAt = now;
    await supportCase.save();
  }
  return due.length;
}

// ---- overview (privacy-preserving aggregates) ----------------------------------

/**
 * GET /api/support/overview — counts only. No names, no references, no bands
 * per student. For an ADMIN, any count between 1 and SUPPORT_MIN_CELL_SIZE-1 is
 * withheld (returned as null) so a small number cannot point at a person.
 */
export async function overview(viewer, { days = 30, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * DAY);
  const k = minCellSize();
  const suppress = viewer.role !== ROLES.COUNSELLOR;
  const cell = (n) => (suppress && n > 0 && n < k ? null : n);

  const weeks = 6;
  const weekStart = new Date(now.getTime() - weeks * 7 * DAY);

  const [created, openByStatus, completed, students, pendingFollowUps, dueFollowUps, urgentOpen, checkIns, outcomes, contactTimes, weeklyCreated, weeklyResolved] = await Promise.all([
    SupportCase.countDocuments({ createdAt: { $gte: since } }),
    SupportCase.aggregate([{ $match: { status: { $nin: SUPPORT_CLOSED_STATUS } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    SupportCase.countDocuments({ status: "RESOLVED", closedAt: { $gte: since } }),
    SupportCase.distinct("student", { createdAt: { $gte: since } }),
    SupportCase.countDocuments({ status: { $nin: SUPPORT_CLOSED_STATUS }, followUpAt: { $exists: true } }),
    SupportCase.countDocuments({ status: { $nin: SUPPORT_CLOSED_STATUS }, followUpAt: { $lte: now } }),
    SupportCase.countDocuments({ status: { $nin: SUPPORT_CLOSED_STATUS }, urgent: true }),
    WellbeingCheckIn.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$band", n: { $sum: 1 } } }]),
    SupportCase.aggregate([{ $match: { status: "RESOLVED", closedAt: { $gte: since } } }, { $group: { _id: "$outcome", n: { $sum: 1 } } }]),
    SupportCase.find({ createdAt: { $gte: since }, "history.status": "CONTACTED" }).select("createdAt history").limit(500).lean(),
    SupportCase.aggregate([{ $match: { createdAt: { $gte: weekStart } } }, { $group: { _id: { $floor: { $divide: [{ $subtract: ["$createdAt", weekStart] }, 7 * DAY] } }, n: { $sum: 1 } } }]),
    SupportCase.aggregate([{ $match: { status: "RESOLVED", closedAt: { $gte: weekStart } } }, { $group: { _id: { $floor: { $divide: [{ $subtract: ["$closedAt", weekStart] }, 7 * DAY] } }, n: { $sum: 1 } } }])
  ]);

  const statusCounts = Object.fromEntries(SUPPORT_STATUS.filter((s) => !SUPPORT_CLOSED_STATUS.includes(s)).map((s) => [s, 0]));
  for (const row of openByStatus) statusCounts[row._id] = row.n;
  const bandCounts = Object.fromEntries(SUPPORT_BANDS.map((b) => [b, 0]));
  for (const row of checkIns) bandCounts[row._id] = row.n;

  const hours = contactTimes
    .map((row) => {
      const contacted = row.history.find((h) => h.status === "CONTACTED");
      return contacted ? (new Date(contacted.at) - new Date(row.createdAt)) / 3600000 : null;
    })
    .filter((h) => h !== null && h >= 0)
    .sort((a, b) => a - b);
  const median = hours.length ? Math.round(hours[Math.floor((hours.length - 1) / 2)] * 10) / 10 : null;

  const weekly = Array.from({ length: weeks }, (_, i) => {
    const from = new Date(weekStart.getTime() + i * 7 * DAY);
    return {
      week: from.toISOString().slice(0, 10),
      requests: cell(weeklyCreated.find((row) => row._id === i)?.n || 0),
      resolved: cell(weeklyResolved.find((row) => row._id === i)?.n || 0)
    };
  });

  const openTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const insights = [];
  if (urgentOpen) insights.push("An urgent request is open — urgent requests should reach a person the same day.");
  if (dueFollowUps) insights.push(`${suppress && dueFollowUps < k ? `Fewer than ${k}` : dueFollowUps} follow-up(s) are due — clearing these first keeps the promise made to students who asked us to check on them.`);
  if (statusCounts.REQUESTED) insights.push("Unassigned requests are waiting. Assign each to one named person so the student hears from a single contact.");
  insights.push("If a student repeatedly reports difficulty and requests support, the system recommends a private mentor follow-up.");

  return {
    windowDays: days,
    viewer: viewer.role,
    suppressedBelow: suppress ? k : null,
    kpis: {
      requests: cell(created),
      open: cell(openTotal),
      pendingFollowUps: cell(pendingFollowUps),
      completed: cell(completed),
      studentsRequesting: cell(students.length),
      urgentOpen: cell(urgentOpen),
      medianHoursToContact: hours.length >= (suppress ? k : 1) ? median : null
    },
    byStatus: Object.fromEntries(Object.entries(statusCounts).map(([key, n]) => [key, cell(n)])),
    checkInBands: Object.fromEntries(Object.entries(bandCounts).map(([key, n]) => [key, cell(n)])),
    bandLabels: SUPPORT_BAND_LABELS,
    outcomes: Object.fromEntries(SUPPORT_OUTCOMES.map((key) => [key, cell(outcomes.find((row) => row._id === key)?.n || 0)])),
    weekly,
    insights: insights.slice(0, 4),
    kind: "ACTUAL DATA",
    insightKind: "RECOMMENDED ACTION",
    method: "DATABASE_AGGREGATION",
    privacy: suppress
      ? `Aggregate counts only. Counts between 1 and ${k - 1} are hidden so no individual can be identified. Individual requests are visible only to the student support team.`
      : "Aggregate counts. Individual cases are in the queue below."
  };
}
