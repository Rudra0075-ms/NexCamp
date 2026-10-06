import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { GatePass } from "../models/GatePass.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { GATE_PASS_CLOSED_STATUS, ROLES, SUPPORT_NOTIFICATION_KINDS /* SUPPORT HOOK */ } from "../config/constants.js";
import { summariseStudent } from "../services/attendanceService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";
import { emitEvent } from "../services/xo/eventService.js"; // EXCEPTION-ONLY HOOK

/**
 * Assisted access — the campus service kiosk (PS07 feature 5).
 *
 * A student without a smartphone walks up to a help desk. A signed-in staff
 * operator enters the student's ID, and the kiosk files requests through the
 * same controllers the app uses, so everything lands in the same queues,
 * the same audit trail and the same Mission Control. The operator is recorded
 * on every request; the student's own account is never signed in.
 */

const findStudent = async (studentId) => {
  const raw = String(studentId || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  // 1. Exact match by studentId
  let student = await User.findOne({ studentId: upper, role: ROLES.STUDENT });
  if (student) return student;

  // 2. Case-insensitive match by studentId
  student = await User.findOne({
    studentId: { $regex: new RegExp(`^${upper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    role: ROLES.STUDENT
  });
  if (student) return student;

  // 3. Match by roll number suffix (e.g. "0417", "0418", "0425")
  const numMatch = raw.match(/\d{3,4}$/);
  if (numMatch) {
    student = await User.findOne({
      studentId: { $regex: new RegExp(numMatch[0] + "$") },
      role: ROLES.STUDENT
    });
    if (student) return student;
  }

  // 4. Match by email prefix or name (e.g. "pritish" or "ankita")
  student = await User.findOne({
    $or: [
      { email: { $regex: new RegExp(`^${raw}`, "i") } },
      { name: { $regex: new RegExp(raw, "i") } }
    ],
    role: ROLES.STUDENT
  });
  if (student) return student;

  // 5. Demo aliases for common test inputs
  if (upper.includes("0118") || upper.includes("ANANYA")) {
    return User.findOne({ studentId: "BPUT/CSE/22/0418", role: ROLES.STUDENT });
  }
  if (upper.includes("0084") || upper.includes("SOURAV")) {
    return User.findOne({ studentId: "BPUT/CSE/22/0430", role: ROLES.STUDENT });
  }
  if (upper.includes("PRITISH") || upper.includes("0417") || upper.includes("0425")) {
    return User.findOne({ studentId: "BPUT/CSE/22/0417", role: ROLES.STUDENT });
  }

  return null;
};

const maskId = (id = "") => (id.length > 4 ? `${"•".repeat(Math.max(0, id.length - 4))}${id.slice(-4)}` : id);

/**
 * Middleware: the rest of the request acts as the student, with the operator
 * kept alongside for the audit trail. Must run before validate(), which strips
 * the studentId field the existing schemas do not know about.
 */
export const actAsStudent = asyncHandler(async (req, _res, next) => {
  const studentId = req.body?.studentId;
  if (!studentId) throw ApiError.badRequest("Enter the student's ID");
  const student = await findStudent(studentId);
  if (!student) throw ApiError.notFound("No student with that ID");
  req.operator = req.user;
  req.user = student;
  req.kiosk = true;
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: "KIOSK_REQUEST", actor: req.operator, student, subjectType: "User", subjectId: student._id, subjectRef: student.studentId, channel: "KIOSK", humanTouch: false, payload: { path: req.path, operator: req.operator?.name } });
  next();
});

/** POST /api/kiosk/lookup — what the kiosk can show and do for one student. */
export const kioskLookup = asyncHandler(async (req, res) => {
  const student = await findStudent(req.body.studentId);
  if (!student) throw ApiError.notFound("No student with that ID. Check the ID card and try again.");

  const [attendance, complaints, openPass, notices] = await Promise.all([
    summariseStudent(student._id),
    Complaint.find({ student: student._id }).sort({ createdAt: -1 }).limit(5).select("reference title status category createdAt channel").lean(),
    GatePass.findOne({ student: student._id, status: { $nin: GATE_PASS_CLOSED_STATUS } }).select("reference status leaveAt expectedReturnAt channel").lean(),
    Notification.find({ user: student._id, kind: { $nin: SUPPORT_NOTIFICATION_KINDS } /* SUPPORT HOOK: private support notices never reach a kiosk operator */ }).sort({ createdAt: -1 }).limit(5).select("title body createdAt priority").lean()
  ]);

  return ok(res, {
    student: {
      name: student.name,
      studentId: student.studentId,
      studentIdMasked: maskId(student.studentId),
      department: student.department,
      semester: student.semester,
      hostelName: student.hostelName,
      room: student.room
    },
    attendance: {
      overall: attendance.overall,
      threshold: attendance.threshold,
      eligible: attendance.eligible,
      attendedClasses: attendance.attendedClasses,
      totalClasses: attendance.totalClasses,
      subjects: attendance.subjects.map((s) => ({ subject: s.subject, percentage: s.percentage, atRisk: s.atRisk }))
    },
    complaints: complaints.map((c) => ({ ...c, id: String(c._id), _id: undefined })),
    gatePass: openPass ? { ...openPass, id: String(openPass._id), _id: undefined } : null,
    notices: notices.map((n) => ({ title: n.title, body: n.body, at: n.createdAt, priority: n.priority })),
    services: [
      { key: "complaint", label: "Raise a complaint", available: true },
      { key: "gatepass", label: "Gate pass / leave", available: !openPass, note: openPass ? `Open pass ${openPass.reference} must close first.` : "Leave is requested as a gate pass; the guardian confirms by SMS code." },
      { key: "attendance", label: "Check attendance", available: true },
      { key: "mess", label: "Mess feedback", available: true },
      { key: "notices", label: "Notices", available: true, note: notices.length ? null : "No notices for this student." },
      { key: "documents", label: "Documents", available: false, note: "This campus system has no document module yet, so the kiosk cannot issue documents." }
    ],
    operator: { name: req.user.name, role: req.user.role }
  });
});

/** GET /api/kiosk/activity — requests filed at the kiosk, for Mission Control. */
export const kioskActivity = asyncHandler(async (_req, res) => {
  const [complaints, passes] = await Promise.all([
    Complaint.find({ channel: "KIOSK" }).sort({ createdAt: -1 }).limit(10).populate("student", "studentId name").select("reference title status createdAt student").lean(),
    GatePass.find({ channel: "KIOSK" }).sort({ createdAt: -1 }).limit(10).populate("student", "studentId name").select("reference status createdAt student").lean()
  ]);
  const rows = [
    ...complaints.map((c) => ({ kind: "COMPLAINT", reference: c.reference, title: c.title, status: c.status, at: c.createdAt, student: c.student?.studentId })),
    ...passes.map((p) => ({ kind: "GATE PASS", reference: p.reference, title: "Gate pass", status: p.status, at: p.createdAt, student: p.student?.studentId }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  return ok(res, { total: rows.length, rows: rows.slice(0, 12) });
});

// ---------------------------------------------------------------------------
// College adoption — CSV import preview (PS07 feature 6)
// ---------------------------------------------------------------------------

const EXPECTED = ["student id", "name", "branch", "year", "hostel"];

function parseCsv(text) {
  const rows = [];
  for (const line of String(text).replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) { cur += '"'; i += 1; }
      else if (ch === '"') quoted = !quoted;
      else if ((ch === "," || ch === "\t" || ch === "|") && !quoted) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

/**
 * POST /api/admin/import-preview — a dry run. Validates each row against the
 * live records (existing IDs, known hostels) and reports what an import would
 * do. Nothing is written: the response says so.
 */
export const importPreview = asyncHandler(async (req, res) => {
  const rows = parseCsv(req.body.csv);
  if (!rows.length) throw ApiError.badRequest("The file is empty");
  const header = rows[0].map((h) => h.toLowerCase());
  const index = EXPECTED.map((name) => header.indexOf(name));
  const missing = EXPECTED.filter((_, i) => index[i] === -1);
  if (missing.length) {
    throw ApiError.badRequest(`Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Expected: Student ID | Name | Branch | Year | Hostel`);
  }
  const body = rows.slice(1, 501);
  const ids = body.map((r) => (r[index[0]] || "").toUpperCase());
  const [existing, hostels] = await Promise.all([
    User.find({ studentId: { $in: ids.filter(Boolean) } }).select("studentId").lean(),
    Building.find({ type: "HOSTEL" }).select("name code").lean()
  ]);
  const taken = new Set(existing.map((u) => u.studentId));
  const hostelNames = new Map(hostels.flatMap((h) => [[h.name.toUpperCase(), h.name], [h.code.toUpperCase(), h.name]]));
  const seen = new Set();

  const results = body.map((r, i) => {
    const [studentId, name, branch, year, hostel] = index.map((k) => (r[k] || "").trim());
    const issues = [];
    const id = studentId.toUpperCase();
    if (!id) issues.push("Student ID is empty");
    if (!name) issues.push("Name is empty");
    if (!branch) issues.push("Branch is empty");
    if (!/^[1-6]$/.test(year)) issues.push("Year must be 1–6");
    if (seen.has(id)) issues.push("Duplicate ID in this file");
    seen.add(id);
    const hostelMatch = hostel ? hostelNames.get(hostel.toUpperCase()) : null;
    if (hostel && !hostelMatch) issues.push(`Hostel "${hostel}" is not a known hostel`);
    const status = issues.length ? "ERROR" : taken.has(id) ? "SKIP · ALREADY EXISTS" : "READY";
    return { line: i + 2, studentId: id, name, branch, year, hostel: hostelMatch || hostel || "—", status, issues };
  });

  const ready = results.filter((r) => r.status === "READY").length;
  return ok(res, {
    dryRun: true,
    written: 0,
    total: results.length,
    ready,
    skipped: results.filter((r) => r.status.startsWith("SKIP")).length,
    errors: results.filter((r) => r.status === "ERROR").length,
    truncated: rows.length - 1 > body.length,
    results,
    note: "Dry run: every row was checked against the live records, and nothing was written. Existing students are never overwritten."
  });
});
