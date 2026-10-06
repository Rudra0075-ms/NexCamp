import { ATTENDANCE_THRESHOLD, ROLES } from "../config/constants.js";
import { Attendance } from "../models/Attendance.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { GatePass } from "../models/GatePass.js";
import { Incident } from "../models/Incident.js";
import { User } from "../models/User.js";
import { round } from "../utils/text.js";
import { SLA_BY_PRIORITY } from "./classificationService.js";
import { findRecurring } from "./recurrenceService.js";

/**
 * Operational intelligence over the complaint, incident, gate-pass and
 * attendance collections: SLA breach prediction, workload, the what-if
 * simulator, the campus digital twin and cross-module correlations.
 *
 * Everything here is counted or computed from stored records. Nothing is a
 * model output — aiService only ever phrases what these functions return, and
 * every response carries a `method` saying how its figures were produced.
 *
 * The pure scoring functions are exported separately so they can be tested
 * without a database.
 */

const DAY = 864e5;
const HOUR = 36e5;

// Resolved complaints needed in a category before its history is trusted to
// say anything about how long the next one will take.
export const MIN_HISTORY = 3;

// ---------------------------------------------------------------------------
// Shared statistics
// ---------------------------------------------------------------------------

export function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Median and 75th percentile resolution time per key, from resolved rows. */
export function resolutionHistory(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const hours = row.resolution?.resolutionTimeHours;
    if (!Number.isFinite(hours)) continue;
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hours);
  }
  const out = new Map();
  for (const [key, hours] of groups) {
    out.set(key, {
      samples: hours.length,
      medianHours: round(quantile(hours, 0.5), 1),
      p75Hours: round(quantile(hours, 0.75), 1)
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feature 8 · SLA breach prediction
// ---------------------------------------------------------------------------

const RISK_ORDER = { BREACHED: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Scores one open complaint against its SLA clock and, where there is enough
 * of it, the resolution history of its category.
 *
 * BREACHED is a fact (the clock has already run out). HIGH / MEDIUM / LOW are
 * predictions, and every one comes with the reasons that produced it.
 */
export function scoreSlaRisk({ ageHours, slaHours, history }) {
  const reasons = [];
  if (ageHours > slaHours) {
    reasons.push(`Open ${round(ageHours, 1)}h against a ${slaHours}h SLA — already past it.`);
    return { risk: "BREACHED", consumedPct: round((ageHours / slaHours) * 100), reasons, isPrediction: false };
  }

  const consumed = ageHours / slaHours;
  const trusted = history && history.samples >= MIN_HISTORY;
  let points = 0;

  if (consumed >= 0.75) {
    points += 2;
    reasons.push(`${round(consumed * 100)}% of the ${slaHours}h SLA has already elapsed.`);
  } else if (consumed >= 0.5) {
    points += 1;
    reasons.push(`${round(consumed * 100)}% of the ${slaHours}h SLA has elapsed.`);
  }

  if (trusted) {
    if (history.medianHours > slaHours) {
      points += 2;
      reasons.push(
        `Similar resolved complaints took a median ${history.medianHours}h (${history.samples} records) — longer than this SLA.`
      );
    } else if (history.p75Hours > slaHours) {
      points += 1;
      reasons.push(
        `One in four similar resolved complaints took over ${history.p75Hours}h (${history.samples} records), past this SLA.`
      );
    }
  }

  const risk = points >= 3 ? "HIGH" : points >= 1 ? "MEDIUM" : "LOW";
  if (!reasons.length) reasons.push(`${round(consumed * 100)}% of the ${slaHours}h SLA has elapsed; nothing points to a breach.`);
  if (!trusted) {
    reasons.push(
      `Fewer than ${MIN_HISTORY} resolved complaints in this category, so the prediction uses the SLA clock alone.`
    );
  }
  return { risk, consumedPct: round(consumed * 100), reasons, isPrediction: true };
}

export async function slaForecast({ limit = 12 } = {}) {
  const [open, resolved] = await Promise.all([
    Complaint.find({ status: { $ne: "RESOLVED" } })
      .select("reference title category department priority status createdAt aiClassification.slaHours building")
      .populate("building", "code name")
      .lean(),
    Complaint.find({ status: "RESOLVED", "resolution.resolutionTimeHours": { $exists: true } })
      .select("category resolution.resolutionTimeHours")
      .lean()
  ]);

  const history = resolutionHistory(resolved, (row) => row.category);
  const now = Date.now();

  const rows = open
    .map((row) => {
      const slaHours = row.aiClassification?.slaHours ?? SLA_BY_PRIORITY[row.priority] ?? SLA_BY_PRIORITY.MEDIUM;
      const ageHours = (now - new Date(row.createdAt)) / HOUR;
      const categoryHistory = history.get(row.category) || null;
      const score = scoreSlaRisk({ ageHours, slaHours, history: categoryHistory });
      return {
        id: String(row._id),
        reference: row.reference,
        title: row.title,
        category: row.category,
        department: row.department || null,
        priority: row.priority,
        status: row.status,
        building: row.building?.name || null,
        ageHours: round(ageHours, 1),
        slaHours,
        slaSource: row.aiClassification?.slaHours !== undefined ? "SET_AT_CLASSIFICATION" : "PRIORITY_POLICY_DEFAULT",
        history: categoryHistory,
        ...score
      };
    })
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.consumedPct - a.consumedPct);

  const counts = rows.reduce((acc, row) => ({ ...acc, [row.risk]: (acc[row.risk] || 0) + 1 }), {});

  return {
    openExamined: open.length,
    resolvedHistory: resolved.length,
    counts: { BREACHED: 0, HIGH: 0, MEDIUM: 0, LOW: 0, ...counts },
    rows: rows.slice(0, limit),
    historyByCategory: [...history.entries()].map(([category, stats]) => ({ category, ...stats })),
    method: "SLA_CLOCK + HISTORICAL_RESOLUTION_TIMES",
    label: "PREDICTION",
    disclaimer:
      "BREACHED is measured. HIGH, MEDIUM and LOW are predictions from the SLA clock and past resolution times — " +
      "not a guarantee. SLA hours come from the complaint's own classification, or the priority policy where none was stored."
  };
}

// ---------------------------------------------------------------------------
// Feature 9 · workload
// ---------------------------------------------------------------------------

/**
 * Whether a department's queue deserves attention, and why. Pure, so the
 * thresholds are testable. `resolvedPerDay` is measured throughput; a queue
 * with no measured throughput is flagged as such rather than given a guess.
 */
export function workloadFlags({ pending, critical, high, oldestAgeDays, resolvedPerDay }, averagePending) {
  const flags = [];
  if (critical > 0) flags.push(`${critical} CRITICAL complaint${critical === 1 ? "" : "s"} in the queue.`);
  if (averagePending > 0 && pending >= averagePending * 1.5 && pending >= 3) {
    flags.push(`${pending} pending — ${round(pending / averagePending, 1)}× the average department queue.`);
  }
  if (oldestAgeDays >= 7) flags.push(`Oldest open complaint is ${round(oldestAgeDays, 1)} days old.`);
  if (pending > 0 && !resolvedPerDay) flags.push("No complaint resolved here in the window — throughput cannot be measured.");
  const attention = flags.length === 0 ? "NORMAL" : critical > 0 || flags.length >= 2 ? "HIGH" : "WATCH";
  return { attention, flags, high };
}

export async function workloadAnalysis({ windowDays = 14 } = {}) {
  const since = new Date(Date.now() - windowDays * DAY);
  const [pendingRows, resolvedRows] = await Promise.all([
    Complaint.aggregate([
      { $match: { status: { $ne: "RESOLVED" } } },
      {
        $group: {
          _id: { $ifNull: ["$department", "UNASSIGNED"] },
          pending: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ["$priority", "CRITICAL"] }, 1, 0] } },
          high: { $sum: { $cond: [{ $eq: ["$priority", "HIGH"] }, 1, 0] } },
          oldest: { $min: "$createdAt" },
          statuses: { $push: "$status" }
        }
      }
    ]),
    Complaint.aggregate([
      { $match: { status: "RESOLVED", "resolution.resolvedAt": { $gte: since } } },
      {
        $group: {
          _id: { $ifNull: ["$department", "UNASSIGNED"] },
          resolved: { $sum: 1 },
          meanHours: { $avg: "$resolution.resolutionTimeHours" }
        }
      }
    ])
  ]);

  const resolvedBy = new Map(resolvedRows.map((row) => [row._id, row]));
  const totalPending = pendingRows.reduce((sum, row) => sum + row.pending, 0);
  const averagePending = pendingRows.length ? totalPending / pendingRows.length : 0;

  const departments = pendingRows
    .map((row) => {
      const done = resolvedBy.get(row._id);
      const resolvedPerDay = done ? round(done.resolved / windowDays, 2) : 0;
      const oldestAgeDays = (Date.now() - new Date(row.oldest)) / DAY;
      const byStatus = row.statuses.reduce((acc, status) => ({ ...acc, [status]: (acc[status] || 0) + 1 }), {});
      const judged = workloadFlags(
        { pending: row.pending, critical: row.critical, high: row.high, oldestAgeDays, resolvedPerDay },
        averagePending
      );
      return {
        department: row._id,
        pending: row.pending,
        critical: row.critical,
        high: row.high,
        byStatus,
        oldestAgeDays: round(oldestAgeDays, 1),
        resolvedInWindow: done?.resolved || 0,
        resolvedPerDay,
        meanResolutionHours: done?.meanHours ? round(done.meanHours, 1) : null,
        // Pending divided by measured throughput. Null, never a guess, when
        // nothing was resolved in the window.
        daysToClear: resolvedPerDay ? round(row.pending / resolvedPerDay, 1) : null,
        ...judged
      };
    })
    .sort((a, b) => b.pending - a.pending);

  return {
    windowDays,
    totalPending,
    averagePending: round(averagePending, 1),
    // Stated separately so a trimmed (?lite=1) list still reports the true count.
    departmentCount: departments.length,
    departments,
    method: "DATABASE_AGGREGATION",
    governance:
      "Recommendations only. Nothing is reassigned or re-prioritised automatically — an administrator decides."
  };
}

// ---------------------------------------------------------------------------
// Feature 12 · what-if simulation
// ---------------------------------------------------------------------------

/**
 * Projects a complaint-volume change onto the measured baseline. Pure: the
 * baseline comes in, the estimate goes out, and both are returned side by side
 * so the interface can never show one as the other.
 */
export function simulateLoad({ baseline, increasePct, horizonDays }) {
  const factor = 1 + increasePct / 100;
  const perDay = baseline.filedInWindow / baseline.windowDays;
  const simulatedPerDay = perDay * factor;
  const throughput = baseline.resolvedInWindow / baseline.windowDays;

  const netPerDay = simulatedPerDay - throughput;
  const projectedBacklog = Math.max(0, baseline.pendingNow + netPerDay * horizonDays);

  const departments = baseline.departments.map((row) => {
    const deptThroughput = row.resolvedInWindow / baseline.windowDays;
    const deptInflow = (row.filedInWindow / baseline.windowDays) * factor;
    const projected = Math.max(0, row.pendingNow + (deptInflow - deptThroughput) * horizonDays);
    return {
      department: row.department,
      pendingNow: row.pendingNow,
      filedInWindow: row.filedInWindow,
      estimatedFiled: round(row.filedInWindow * factor, 1),
      estimatedPendingAfterHorizon: round(projected, 1),
      change: round(projected - row.pendingNow, 1)
    };
  });

  return {
    current: {
      filedInWindow: baseline.filedInWindow,
      filedPerDay: round(perDay, 2),
      resolvedPerDay: round(throughput, 2),
      pendingNow: baseline.pendingNow
    },
    estimated: {
      filedInWindow: round(baseline.filedInWindow * factor, 1),
      filedPerDay: round(simulatedPerDay, 2),
      additionalComplaints: round(baseline.filedInWindow * factor - baseline.filedInWindow, 1),
      pendingAfterHorizon: round(projectedBacklog, 1),
      backlogChange: round(projectedBacklog - baseline.pendingNow, 1),
      // Only meaningful when throughput outpaces the simulated inflow.
      daysToClearBacklog: netPerDay < 0 && baseline.pendingNow > 0 ? round(baseline.pendingNow / -netPerDay, 1) : null
    },
    departments: departments.sort((a, b) => b.estimatedPendingAfterHorizon - a.estimatedPendingAfterHorizon),
    assumptions: [
      `Inflow scales by ${increasePct >= 0 ? "+" : ""}${increasePct}% across every department equally.`,
      `Resolution throughput stays at the rate measured over the last ${baseline.windowDays} days (${round(throughput, 2)}/day).`,
      `Projection horizon: ${horizonDays} days. Nothing else about the campus changes.`
    ]
  };
}

export async function simulationBaseline({ windowDays = 30 } = {}) {
  const since = new Date(Date.now() - windowDays * DAY);
  const [filed, resolved, pending] = await Promise.all([
    Complaint.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $ifNull: ["$department", "UNASSIGNED"] }, n: { $sum: 1 } } }
    ]),
    Complaint.aggregate([
      { $match: { status: "RESOLVED", "resolution.resolvedAt": { $gte: since } } },
      { $group: { _id: { $ifNull: ["$department", "UNASSIGNED"] }, n: { $sum: 1 } } }
    ]),
    Complaint.aggregate([
      { $match: { status: { $ne: "RESOLVED" } } },
      { $group: { _id: { $ifNull: ["$department", "UNASSIGNED"] }, n: { $sum: 1 } } }
    ])
  ]);

  const names = new Set([...filed, ...resolved, ...pending].map((row) => row._id));
  const find = (rows, key) => rows.find((row) => row._id === key)?.n || 0;
  const departments = [...names].map((department) => ({
    department,
    filedInWindow: find(filed, department),
    resolvedInWindow: find(resolved, department),
    pendingNow: find(pending, department)
  }));

  return {
    windowDays,
    filedInWindow: departments.reduce((sum, row) => sum + row.filedInWindow, 0),
    resolvedInWindow: departments.reduce((sum, row) => sum + row.resolvedInWindow, 0),
    pendingNow: departments.reduce((sum, row) => sum + row.pendingNow, 0),
    departments
  };
}

// ---------------------------------------------------------------------------
// Feature 10 · campus digital twin
// ---------------------------------------------------------------------------

const TWIN_GROUPS = [
  { id: "HOSTELS", label: "Hostels", types: ["HOSTEL"] },
  { id: "ACADEMIC", label: "Academic", types: ["ACADEMIC", "LIBRARY"] },
  { id: "FACILITIES", label: "Facilities", types: ["MESS", "MEDICAL", "SPORTS", "ADMIN", "OTHER"] }
];

/**
 * Health of one block, from its own counts. Pure. The thresholds are simple on
 * purpose: they decide which blocks the interface highlights, and the reason
 * is shown beside the highlight.
 */
export function nodeStatus({ openComplaints, critical, openIncidents, recurring, overduePasses }) {
  const reasons = [];
  if (critical) reasons.push(`${critical} critical complaint${critical === 1 ? "" : "s"} open`);
  if (recurring) reasons.push(`${recurring} recurring pattern${recurring === 1 ? "" : "s"}`);
  if (openIncidents) reasons.push(`${openIncidents} open incident${openIncidents === 1 ? "" : "s"}`);
  if (overduePasses) reasons.push(`${overduePasses} overdue gate pass${overduePasses === 1 ? "" : "es"}`);
  if (openComplaints >= 5) reasons.push(`${openComplaints} open complaints`);
  const status =
    critical || (recurring && openComplaints >= 5) ? "PROBLEM" : reasons.length ? "WATCH" : "NORMAL";
  return { status, reasons };
}

export async function digitalTwin() {
  const [buildings, complaintAgg, incidentAgg, passAgg, recurring] = await Promise.all([
    Building.find().select("code name type occupancy capacity currentRisk riskLevel").sort({ code: 1 }).lean(),
    Complaint.aggregate([
      { $match: { status: { $ne: "RESOLVED" }, building: { $ne: null } } },
      {
        $group: {
          _id: { building: "$building", category: "$category" },
          n: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ["$priority", "CRITICAL"] }, 1, 0] } }
        }
      }
    ]),
    Incident.aggregate([
      { $match: { status: { $ne: "RESOLVED" }, building: { $ne: null } } },
      { $group: { _id: "$building", n: { $sum: 1 } } }
    ]),
    GatePass.aggregate([
      { $match: { status: { $in: ["ACTIVE", "OVERDUE"] }, hostel: { $ne: null } } },
      { $group: { _id: { hostel: "$hostel", status: "$status" }, n: { $sum: 1 } } }
    ]),
    findRecurring({ windowDays: 30, limit: 50 })
  ]);

  const nodes = buildings.map((building) => {
    const id = String(building._id);
    const categories = complaintAgg.filter((row) => String(row._id.building) === id);
    const openComplaints = categories.reduce((sum, row) => sum + row.n, 0);
    const critical = categories.reduce((sum, row) => sum + row.critical, 0);
    const openIncidents = incidentAgg.find((row) => String(row._id) === id)?.n || 0;
    const passes = passAgg.filter((row) => String(row._id.hostel) === id);
    const activePasses = passes.find((row) => row._id.status === "ACTIVE")?.n || 0;
    const overduePasses = passes.find((row) => row._id.status === "OVERDUE")?.n || 0;
    const patterns = recurring.patterns.filter((row) => row.building.code === building.code);
    const status = nodeStatus({ openComplaints, critical, openIncidents, recurring: patterns.length, overduePasses });

    return {
      code: building.code,
      name: building.name,
      type: building.type,
      occupancy: building.occupancy,
      capacity: building.capacity,
      risk: building.currentRisk,
      riskLevel: building.riskLevel,
      openComplaints,
      critical,
      openIncidents,
      activePasses,
      overduePasses,
      categories: categories
        .map((row) => ({ category: row._id.category, open: row.n }))
        .sort((a, b) => b.open - a.open),
      recurring: patterns.map((row) => ({ category: row.category, occurrences: row.occurrences })),
      ...status
    };
  });

  return {
    campus: {
      buildings: nodes.length,
      openComplaints: nodes.reduce((sum, node) => sum + node.openComplaints, 0),
      openIncidents: nodes.reduce((sum, node) => sum + node.openIncidents, 0),
      problemAreas: nodes.filter((node) => node.status === "PROBLEM").length
    },
    groups: TWIN_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      nodes: nodes.filter((node) => group.types.includes(node.type))
    })).filter((group) => group.nodes.length),
    method: "DATABASE_AGGREGATION",
    note: "A logical model of the campus built from live records. Highlighted blocks are flagged by counted thresholds, shown beside each one."
  };
}

/** One block of the twin, drilled down to the records behind its counts. */
export async function digitalTwinNode(code) {
  const building = await Building.findOne({ code: String(code).toUpperCase() }).lean();
  if (!building) return null;

  const [complaints, incidents, passes, recurring] = await Promise.all([
    Complaint.find({ building: building._id, status: { $ne: "RESOLVED" } })
      .select("reference title category priority status department createdAt")
      .sort({ createdAt: -1 })
      .limit(25)
      .lean(),
    Incident.find({ building: building._id, status: { $ne: "RESOLVED" } })
      .select("reference title category status risk riskLevel createdAt")
      .sort({ risk: -1 })
      .limit(10)
      .lean(),
    building.type === "HOSTEL"
      ? GatePass.find({ hostel: building._id, status: { $in: ["ACTIVE", "OVERDUE", "PENDING_WARDEN_APPROVAL"] } })
          .select("reference status leaveAt expectedReturnAt")
          .sort({ expectedReturnAt: 1 })
          .limit(15)
          .lean()
      : Promise.resolve([]),
    findRecurring({ windowDays: 30, limit: 50, buildingId: building._id })
  ]);

  // Maintenance status: how many of the open complaints each department holds,
  // and how far along they are.
  const maintenance = Object.values(
    complaints.reduce((acc, row) => {
      const key = row.department || "UNASSIGNED";
      acc[key] ||= { department: key, open: 0, investigating: 0 };
      acc[key].open += 1;
      if (row.status === "INVESTIGATING") acc[key].investigating += 1;
      return acc;
    }, {})
  );

  return {
    building: { code: building.code, name: building.name, type: building.type, occupancy: building.occupancy },
    complaints: complaints.map((row) => ({ ...row, id: String(row._id), _id: undefined })),
    incidents: incidents.map((row) => ({ ...row, id: String(row._id), _id: undefined })),
    gatePasses: passes.map((row) => ({ ...row, id: String(row._id), _id: undefined })),
    maintenance,
    recurring: recurring.patterns.map((row) => ({
      category: row.category,
      occurrences: row.occurrences,
      unresolved: row.unresolved,
      periodDays: row.periodDays
    })),
    method: "DATABASE_AGGREGATION"
  };
}

// ---------------------------------------------------------------------------
// Feature 11 · cross-module intelligence
// ---------------------------------------------------------------------------

/**
 * Finds hostels where two or more modules are elevated at once. Pure: takes
 * the per-hostel counts and returns the co-occurrences with their evidence.
 *
 * A module is "elevated" in a hostel when its per-resident rate is at least
 * 1.5× the campus-wide hostel rate and at least two records are involved.
 * Co-occurrence is reported as a possible correlation, never a cause.
 */
export function correlate(hostels) {
  const MODULES = [
    { key: "complaints", label: "maintenance complaints" },
    { key: "incidents", label: "open incidents" },
    { key: "latePasses", label: "late or overdue gate passes" },
    { key: "lowAttendance", label: "residents below the attendance threshold" }
  ];
  const totalResidents = hostels.reduce((sum, row) => sum + row.residents, 0);
  const campusRate = Object.fromEntries(
    MODULES.map(({ key }) => [key, totalResidents ? hostels.reduce((sum, row) => sum + row[key], 0) / totalResidents : 0])
  );

  const findings = [];
  for (const hostel of hostels) {
    if (!hostel.residents) continue;
    const elevated = MODULES.filter(({ key }) => {
      const rate = hostel[key] / hostel.residents;
      return hostel[key] >= 2 && campusRate[key] > 0 && rate >= campusRate[key] * 1.5;
    });
    if (elevated.length < 2) continue;
    findings.push({
      hostel: hostel.name,
      code: hostel.code,
      residents: hostel.residents,
      modules: elevated.map(({ key, label }) => ({
        module: key,
        label,
        count: hostel[key],
        perResident: round(hostel[key] / hostel.residents, 2),
        campusPerResident: round(campusRate[key], 2)
      })),
      statement:
        `${elevated.map(({ key, label }) => `${hostel[key]} ${label}`).join(", ")} are all associated with ${hostel.name}, ` +
        "each well above the campus hostel average per resident.",
      label: "POSSIBLE CORRELATION"
    });
  }
  return findings;
}

export async function crossModuleSnapshot({ windowDays = 30 } = {}) {
  const since = new Date(Date.now() - windowDays * DAY);
  const hostels = await Building.find({ type: "HOSTEL" }).select("code name").lean();
  const ids = hostels.map((row) => row._id);

  const [residents, complaints, incidents, passes, attendance] = await Promise.all([
    User.aggregate([
      { $match: { role: ROLES.STUDENT, hostel: { $in: ids } } },
      { $group: { _id: "$hostel", n: { $sum: 1 }, students: { $push: "$_id" } } }
    ]),
    Complaint.aggregate([
      { $match: { building: { $in: ids }, createdAt: { $gte: since } } },
      { $group: { _id: "$building", n: { $sum: 1 } } }
    ]),
    Incident.aggregate([
      { $match: { building: { $in: ids }, status: { $ne: "RESOLVED" } } },
      { $group: { _id: "$building", n: { $sum: 1 } } }
    ]),
    GatePass.aggregate([
      { $match: { hostel: { $in: ids }, createdAt: { $gte: since }, status: { $in: ["OVERDUE", "RETURNED_LATE"] } } },
      { $group: { _id: "$hostel", n: { $sum: 1 } } }
    ]),
    Attendance.aggregate([
      { $group: { _id: "$student", held: { $sum: "$totalClasses" }, attended: { $sum: "$attendedClasses" } } }
    ])
  ]);

  const lowStudents = new Set(
    attendance
      .filter((row) => row.held > 0 && (row.attended / row.held) * 100 < ATTENDANCE_THRESHOLD)
      .map((row) => String(row._id))
  );
  const count = (rows, id) => rows.find((row) => String(row._id) === String(id))?.n || 0;

  const rows = hostels.map((hostel) => {
    const resident = residents.find((row) => String(row._id) === String(hostel._id));
    return {
      code: hostel.code,
      name: hostel.name,
      residents: resident?.n || 0,
      complaints: count(complaints, hostel._id),
      incidents: count(incidents, hostel._id),
      latePasses: count(passes, hostel._id),
      lowAttendance: (resident?.students || []).filter((id) => lowStudents.has(String(id))).length
    };
  });

  return {
    windowDays,
    attendanceThreshold: ATTENDANCE_THRESHOLD,
    hostels: rows,
    findings: correlate(rows),
    method: "CROSS_MODULE_RATE_COMPARISON",
    disclaimer:
      "A possible correlation means these signals occur together in the same hostel more than elsewhere on campus. " +
      "It is not evidence that one causes another."
  };
}
