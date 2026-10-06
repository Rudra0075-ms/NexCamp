import { ATTENDANCE_THRESHOLD } from "../config/constants.js";
import { Attendance } from "../models/Attendance.js";
import { clamp, round } from "../utils/text.js";

/**
 * Real arithmetic behind the eligibility what-if simulator. Nothing here is
 * hard-coded in the frontend: it sends the plan, this returns the projection.
 */
export function simulate({
  attendedClasses,
  totalClasses,
  plannedClasses = 0,
  attendPlanned,
  threshold = ATTENDANCE_THRESHOLD
}) {
  const attended = Math.max(0, Number(attendedClasses) || 0);
  const total = Math.max(0, Number(totalClasses) || 0);
  const planned = Math.max(0, Number(plannedClasses) || 0);
  // Default assumption: the student attends every class they plan to.
  const willAttend = clamp(attendPlanned === undefined ? planned : Number(attendPlanned), 0, planned);

  const current = total ? (attended / total) * 100 : 0;
  const projectedTotal = total + planned;
  const projected = projectedTotal ? ((attended + willAttend) / projectedTotal) * 100 : 0;

  // How many more consecutive attended classes clear the bar from where we are?
  let classesToThreshold = null;
  if (current < threshold) {
    for (let extra = 1; extra <= 400; extra += 1) {
      if (((attended + extra) / (total + extra)) * 100 >= threshold) {
        classesToThreshold = extra;
        break;
      }
    }
  }

  // How many can still be missed before dropping below the bar.
  let classesCanMiss = 0;
  if (current >= threshold) {
    while ((attended / (total + classesCanMiss + 1)) * 100 >= threshold && classesCanMiss < 400) {
      classesCanMiss += 1;
    }
  }

  return {
    current: round(current, 1),
    projected: round(projected, 1),
    delta: round(projected - current, 1),
    threshold,
    eligibleNow: current >= threshold,
    eligibleAfterPlan: projected >= threshold,
    classesToThreshold,
    classesCanMiss,
    input: { attendedClasses: attended, totalClasses: total, plannedClasses: planned, attendPlanned: willAttend },
    method: "ARITHMETIC_PROJECTION",
    explanation: projectedTotal
      ? `(${attended} + ${willAttend}) / (${total} + ${planned}) = ${round(projected, 1)}%`
      : "no classes recorded"
  };
}

/** The full attendance picture for one student, as the dashboard needs it. */
export async function summariseStudent(studentId) {
  const records = await Attendance.find({ student: studentId })
    .populate("linkedIncident", "reference title risk")
    .sort({ subject: 1 })
    .lean();

  const totals = records.reduce(
    (acc, record) => {
      acc.attended += record.attendedClasses;
      acc.total += record.totalClasses;
      return acc;
    },
    { attended: 0, total: 0 }
  );

  const overall = totals.total ? (totals.attended / totals.total) * 100 : 0;

  // Daily attended/held counts across every subject, oldest first — the trend line.
  const byDay = new Map();
  for (const record of records) {
    for (const session of record.sessions || []) {
      const key = new Date(session.date).toISOString().slice(0, 10);
      const entry = byDay.get(key) || { date: key, held: 0, attended: 0 };
      entry.held += 1;
      if (session.present) entry.attended += 1;
      byDay.set(key, entry);
    }
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Running cumulative percentage, which is what "the trend" actually means here.
  let runningHeld = 0;
  let runningAttended = 0;
  const trend = days.map((day) => {
    runningHeld += day.held;
    runningAttended += day.attended;
    return {
      date: day.date,
      percentage: round((runningAttended / runningHeld) * 100, 1),
      held: day.held,
      attended: day.attended
    };
  });

  const heatmap = records.map((record) => ({
    subject: record.subject,
    cells: (record.sessions || [])
      .slice(-14)
      .map((session) => ({
        date: new Date(session.date).toISOString().slice(0, 10),
        slot: session.slot,
        present: session.present
      }))
  }));

  return {
    overall: round(overall, 1),
    threshold: ATTENDANCE_THRESHOLD,
    eligible: overall >= ATTENDANCE_THRESHOLD,
    attendedClasses: totals.attended,
    totalClasses: totals.total,
    classesRemaining: records.reduce((sum, r) => sum + Math.max(0, (r.semesterPlanned || 0) - r.totalClasses), 0),
    subjects: records.map((record) => ({
      id: String(record._id),
      subject: record.subject,
      subjectCode: record.subjectCode,
      attendedClasses: record.attendedClasses,
      totalClasses: record.totalClasses,
      percentage: record.attendancePercentage,
      atRisk: record.attendancePercentage < ATTENDANCE_THRESHOLD,
      linkedIncident: record.linkedIncident
        ? {
            id: String(record.linkedIncident._id),
            reference: record.linkedIncident.reference,
            title: record.linkedIncident.title
          }
        : null
    })),
    trend,
    heatmap,
    simulation: simulate({ attendedClasses: totals.attended, totalClasses: totals.total, plannedClasses: 0 })
  };
}

/** Keeps the denormalised percentage on the user document in step. */
export async function recomputeStudentPercentage(studentId, UserModel) {
  const rows = await Attendance.find({ student: studentId }).select("attendedClasses totalClasses").lean();
  const totals = rows.reduce(
    (acc, row) => ({ attended: acc.attended + row.attendedClasses, total: acc.total + row.totalClasses }),
    { attended: 0, total: 0 }
  );
  const percentage = totals.total ? round((totals.attended / totals.total) * 100, 1) : 0;
  await UserModel.findByIdAndUpdate(studentId, { attendancePercentage: percentage });
  return percentage;
}
