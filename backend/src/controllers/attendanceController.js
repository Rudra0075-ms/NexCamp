import { STAFF_ROLES } from "../config/constants.js";
import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import {
  recomputeStudentPercentage,
  simulate,
  summariseStudent
} from "../services/attendanceService.js";
import { attendanceIntelligence, analyseAttendance } from "../services/attendanceIntelligenceService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/respond.js";

async function resolveStudent(identifier, requester) {
  if (!identifier || identifier === "me") return requester;
  const byId = await User.findById(identifier).catch(() => null);
  if (byId) return byId;
  const byStudentId = await User.findOne({ studentId: identifier });
  if (!byStudentId) throw ApiError.notFound("No student with that id");
  return byStudentId;
}

/** GET /api/attendance/me */
export const myAttendance = asyncHandler(async (req, res) => {
  const summary = await summariseStudent(req.user._id);
  return ok(res, { student: req.user.toPublic(), ...summary });
});

/** GET /api/attendance/:studentId — self or staff. */
export const studentAttendance = asyncHandler(async (req, res) => {
  const student = await resolveStudent(req.params.studentId, req.user);
  const summary = await summariseStudent(student._id);
  return ok(res, { student: student.toPublic(), ...summary });
});

/** POST /api/attendance — staff record a subject's totals. */
export const createAttendance = asyncHandler(async (req, res) => {
  const { student, studentId, subject, ...rest } = req.body;
  const target = await resolveStudent(student || studentId, req.user);

  if (rest.attendedClasses > rest.totalClasses) {
    throw ApiError.badRequest("attendedClasses cannot exceed totalClasses");
  }

  const record = await Attendance.findOneAndUpdate(
    { student: target._id, subject },
    { student: target._id, subject, ...rest },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  // findOneAndUpdate skips the pre-save hook, so derive the percentage here.
  record.attendancePercentage = record.totalClasses
    ? Math.round((record.attendedClasses / record.totalClasses) * 1000) / 10
    : 0;
  await record.save();

  await recomputeStudentPercentage(target._id, User);

  return created(res, { attendance: record }, "Attendance recorded");
});

/** PATCH /api/attendance/:id — correct totals, or mark one session. */
export const updateAttendance = asyncHandler(async (req, res) => {
  const record = await Attendance.findById(req.params.id);
  if (!record) throw ApiError.notFound("No attendance record with that id");

  const isStaff = STAFF_ROLES.includes(req.user.role);
  if (!isStaff && String(record.student) !== String(req.user._id)) {
    throw ApiError.forbidden("You cannot edit another student's attendance");
  }
  if (!isStaff) throw ApiError.forbidden("Only staff can change attendance records");

  const { present, date, slot, ...rest } = req.body;
  Object.assign(record, rest);

  if (present !== undefined) {
    record.sessions.push({ date: date || new Date(), slot, present });
    record.totalClasses += 1;
    if (present) record.attendedClasses += 1;
  }

  if (record.attendedClasses > record.totalClasses) {
    throw ApiError.badRequest("attendedClasses cannot exceed totalClasses");
  }

  await record.save();
  await recomputeStudentPercentage(record.student, User);

  return ok(res, { attendance: record }, "Attendance updated");
});

/**
 * POST /api/attendance/simulate
 * Real arithmetic, not a hard-coded frontend number. With no totals supplied it
 * runs against the signed-in student's actual record.
 */
export const simulateAttendance = asyncHandler(async (req, res) => {
  let { attendedClasses, totalClasses } = req.body;
  const { subject } = req.body;
  let planned = null;
  let recentRate = null;

  if (subject) {
    // One subject: its totals come from the register, never from the client,
    // so a what-if always starts from the student's real record.
    const records = await Attendance.find({ student: req.user._id }).lean();
    const record = records.find((row) => row.subject === subject);
    if (!record) throw ApiError.notFound(`No attendance recorded for ${subject}`);
    attendedClasses = record.attendedClasses;
    totalClasses = record.totalClasses;
    planned = Number.isFinite(record.semesterPlanned) ? record.semesterPlanned : null;
    recentRate = analyseAttendance([record]).subjects[0]?.recentRate ?? null;
  } else if (attendedClasses === undefined || totalClasses === undefined) {
    const records = await Attendance.find({ student: req.user._id }).lean();
    const summary = await summariseStudent(req.user._id);
    attendedClasses = summary.attendedClasses;
    totalClasses = summary.totalClasses;
    if (records.length && records.every((row) => Number.isFinite(row.semesterPlanned))) {
      planned = records.reduce((t, row) => t + row.semesterPlanned, 0);
      recentRate = analyseAttendance(records).classification?.recent?.rate ?? null;
    }
  }

  const result = simulate({ ...req.body, attendedClasses, totalClasses });

  // What the plan leaves at the end of the semester, when the timetable says
  // how many classes remain. Added alongside the original fields.
  if (planned !== null) {
    const afterPlanHeld = totalClasses + result.input.plannedClasses;
    const afterPlanAttended = attendedClasses + result.input.attendPlanned;
    const rest = Math.max(0, planned - afterPlanHeld);
    const at = (rate) => (planned ? Math.round(((afterPlanAttended + Math.round((rest * rate) / 100)) / planned) * 1000) / 10 : null);
    result.endOfSemester = {
      planned,
      remainingAfterPlan: rest,
      ifAttendAll: at(100),
      atRecentRate: recentRate === null ? null : at(recentRate),
      recentRate,
      kind: "PROJECTED STATUS"
    };
  }
  result.subject = subject || null;
  result.kind = "SIMULATED RESULT";
  result.note = "Simulation only — attendance records are not changed.";
  return ok(res, result);
});

/**
 * GET /api/attendance/me/intelligence?window=14
 * Pattern classification, subject analysis, why-analysis, timeline and
 * projections for the signed-in student, all computed from the register.
 */
export const myAttendanceIntelligence = asyncHandler(async (req, res) => {
  const windowDays = [7, 14, 30].includes(Number(req.query.window)) ? Number(req.query.window) : 14;
  const analysis = await attendanceIntelligence(req.user._id, { windowDays });
  return ok(res, analysis);
});
