/**
 * PS07 extension pack — Phase 1 unit tests (no database needed).
 *
 * Covers the pure logic behind the Notice Center, certificates, the
 * timetable, fees and the request tracker.
 */
import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";

const ist = await import("../src/services/ext/istTime.js");
const notices = await import("../src/services/ext/noticeService.js");
const cert = await import("../src/services/ext/certificateService.js");
const pdf = await import("../src/services/ext/pdfWriter.js");
const tt = await import("../src/services/ext/timetableService.js");
const fees = await import("../src/services/ext/feeService.js");
const tracker = await import("../src/services/ext/requestTrackerService.js");
const profiles = await import("../src/services/ext/profileService.js");
const mess = await import("../src/services/ext/messChangeService.js");

// ---- IST clock and quiet hours ---------------------------------------------

test("IST date keys and instants round-trip regardless of the host zone", () => {
  const at = ist.istInstant("2026-09-28", "08:00");
  assert.equal(at.toISOString(), "2026-09-28T02:30:00.000Z");
  assert.equal(ist.istDateKey(at), "2026-09-28");
  assert.equal(ist.weekdayOf("2026-09-28"), 1);
  assert.equal(ist.isValidDateKey("2026-13-40"), false);
  assert.equal(ist.isValidDateKey("2026-02-30"), false);
  assert.equal(ist.isValidDateKey("2026-09-28"), true);
  assert.equal(ist.isValidDateKey("tomorrow"), false);
});

test("quiet hours run 22:00–07:00 IST and the digest is the following 07:30", () => {
  assert.equal(ist.inQuietHours(ist.istInstant("2026-09-28", "22:10")), true);
  assert.equal(ist.inQuietHours(ist.istInstant("2026-09-28", "06:59")), true);
  assert.equal(ist.inQuietHours(ist.istInstant("2026-09-28", "07:00")), false);
  assert.equal(ist.nextDigestAt(ist.istInstant("2026-09-28", "23:30")).toISOString(), ist.istInstant("2026-09-29", "07:30").toISOString());
  assert.equal(ist.nextDigestAt(ist.istInstant("2026-09-29", "02:00")).toISOString(), ist.istInstant("2026-09-29", "07:30").toISOString());
});

test("a non-critical notice at night is held; CRITICAL is never held; future dates are scheduled", () => {
  const night = ist.istInstant("2026-09-28", "23:00");
  const day = ist.istInstant("2026-09-28", "11:00");
  assert.equal(notices.publishDecision({ priority: "NORMAL" }, night).status, "HELD_QUIET_HOURS");
  assert.equal(notices.publishDecision({ priority: "HIGH" }, night).status, "HELD_QUIET_HOURS");
  assert.equal(notices.publishDecision({ priority: "CRITICAL" }, night).status, "PUBLISHED");
  assert.equal(notices.publishDecision({ priority: "NORMAL" }, day).status, "PUBLISHED");
  const later = new Date(day.getTime() + 3 * 3600000);
  assert.equal(notices.publishDecision({ priority: "NORMAL", scheduledFor: later }, day).status, "SCHEDULED");
});

// ---- audience -----------------------------------------------------------------

const student = (over = {}) => ({
  user: { _id: over.id || "a1", role: "STUDENT", hostelName: over.hostel || "HOSTEL B" },
  profile: { branch: "CSE", year: 3, batch: "2022", section: over.section || "A" }
});

test("audience defaults to students and every restricted field must match", () => {
  const a = notices.normaliseAudience({});
  assert.deepEqual(a.roles, ["STUDENT"]);
  assert.equal(notices.matchesAudience(student(), a), true);
  assert.equal(notices.matchesAudience({ user: { _id: "w", role: "WARDEN" }, profile: {} }, a), false);
  const b = notices.normaliseAudience({ hostels: ["hst-b"], sections: ["a"], years: ["3"] });
  assert.equal(notices.matchesAudience(student(), b), true);
  assert.equal(notices.matchesAudience(student({ section: "B" }), b), false);
  assert.equal(notices.matchesAudience(student({ hostel: "HOSTEL C" }), b), false);
});

test("department audiences reach that queue's staff and administrators only", () => {
  const a = notices.normaliseAudience({ departments: ["MAINTENANCE · PLUMBING"] });
  const facility = { user: { _id: "f", role: "FACILITY_MANAGER", managedDepartment: "MAINTENANCE · PLUMBING" }, profile: {} };
  const it = { user: { _id: "i", role: "FACILITY_MANAGER", managedDepartment: "IT · NETWORK" }, profile: {} };
  const admin = { user: { _id: "x", role: "ADMIN" }, profile: {} };
  assert.equal(notices.matchesAudience(facility, a), true);
  assert.equal(notices.matchesAudience(it, a), false);
  assert.equal(notices.matchesAudience(admin, a), true);
  assert.equal(notices.matchesAudience(student(), a), false);
});

test("explicit user lists override every other filter", () => {
  const a = notices.normaliseAudience({ users: ["507f1f77bcf86cd799439011"], hostels: ["HOSTEL C"] });
  assert.equal(notices.matchesAudience(student({ id: "507f1f77bcf86cd799439011" }), a), true);
  assert.equal(notices.matchesAudience(student({ id: "507f1f77bcf86cd799439012" }), a), false);
});

test("delivery summary counts receipts and never divides by zero", () => {
  assert.deepEqual(notices.summarise([]).pct, { delivered: null, read: null, acknowledged: null, actionDone: null });
  const s = notices.summarise([{ deliveredAt: 1, readAt: 1 }, { deliveredAt: 1 }, {}, { deliveredAt: 1, readAt: 1, acknowledgedAt: 1, actionDoneAt: 1, channel: "SMS" }]);
  assert.equal(s.targeted, 4);
  assert.equal(s.delivered, 3);
  assert.equal(s.read, 2);
  assert.equal(s.pct.read, 50);
  assert.equal(s.viaSms, 1);
});

test("the escalation SMS fits in 160 characters", () => {
  const text = notices.smsText({ priority: "CRITICAL", reference: "NTC-2026-0001", title: "x".repeat(300), actionRequired: { label: "Evacuate" } });
  assert.ok(text.length <= 160);
  assert.match(text, /^\[URGENT NTC-2026-0001\]/);
});

// ---- profiles ------------------------------------------------------------------

test("a missing profile is derived from the user record and labelled DERIVED", () => {
  const p = profiles.deriveProfile({ department: "COMPUTER SCIENCE & ENGINEERING", semester: 5, studentId: "BPUT/CSE/22/0417" });
  assert.deepEqual([p.branch, p.year, p.batch, p.section, p.source], ["CSE", 3, "2022", null, "DERIVED"]);
  const merged = profiles.mergeProfile({ department: "COMPUTER SCIENCE & ENGINEERING", semester: 5, hostelName: "HOSTEL B", role: "STUDENT" }, { section: "A" });
  assert.equal(merged.section, "A");
  assert.equal(merged.branch, "CSE");
  assert.equal(merged.source, "RECORDED");
});

// ---- certificates ---------------------------------------------------------------

const issued = () => ({
  _id: "x",
  reference: "DOC-2026-0001",
  type: "BONAFIDE",
  purpose: "Education loan",
  studentSnapshot: { name: "PRITISH RANJAN SAHOO", studentId: "BPUT/CSE/22/0417", course: "B.TECH CSE", department: "CSE", semester: 5, hostelName: "HOSTEL B", room: "B-214" },
  certificate: { verificationCode: "ABCD-EF23", serial: "CERT-2026-0001", issuedAt: new Date("2026-09-20T10:00:00Z"), issuedByName: "Registrar", canonicalVersion: 1 }
});

test("certificates issued before the NeX Camp rename keep their original canonical text, new ones use NEX-CERT", () => {
  assert.match(cert.canonicalContent(issued()), /^CIO-CERT\/v1\n/);
  const v2 = issued();
  v2.certificate.canonicalVersion = 2;
  assert.match(cert.canonicalContent(v2), /^NEX-CERT\/v2\n/);
  assert.notEqual(cert.sha256(cert.canonicalContent(v2)), cert.sha256(cert.canonicalContent(issued())));
});

test("the canonical content is stable and any changed field changes the digest", () => {
  const doc = issued();
  const digest = cert.sha256(cert.canonicalContent(doc));
  assert.equal(cert.sha256(cert.canonicalContent(issued())), digest);
  const tampered = issued();
  tampered.studentSnapshot.name = "PRATIK RANJAN SAHOO";
  assert.notEqual(cert.sha256(cert.canonicalContent(tampered)), digest);
  const tampered2 = issued();
  tampered2.purpose = "Visa";
  assert.notEqual(cert.sha256(cert.canonicalContent(tampered2)), digest);
});

test("verification codes avoid ambiguous characters and normalise user input", () => {
  for (let i = 0; i < 50; i += 1) assert.match(cert.newVerificationCode(), /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.equal(cert.normaliseCode(" abcd ef23 "), "ABCD-EF23");
});

test("names are partially masked on the public verify page", () => {
  assert.equal(cert.maskName("PRITISH RANJAN SAHOO"), "PR***** RA**** SA***");
  assert.equal(cert.maskName("AB"), "A*");
});

test("SLA state distinguishes on track, at risk, breached and met late", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const base = { slaHours: 24, status: "SUBMITTED" };
  const at = (h) => new Date(now.getTime() - h * 3600000);
  assert.equal(cert.slaState({ ...base, createdAt: at(2), dueAt: new Date(at(2).getTime() + 864e5) }, now).state, "ON_TRACK");
  assert.equal(cert.slaState({ ...base, createdAt: at(20), dueAt: new Date(at(20).getTime() + 864e5) }, now).state, "AT_RISK");
  assert.equal(cert.slaState({ ...base, createdAt: at(30), dueAt: new Date(at(30).getTime() + 864e5) }, now).state, "BREACHED");
  assert.equal(cert.slaState({ ...base, status: "ISSUED", createdAt: at(40), dueAt: at(16), certificate: { issuedAt: at(2) } }, now).state, "MET_LATE");
});

test("the PDF writer produces a valid single-page PDF with the canonical block embedded", async () => {
  const canonical = cert.canonicalContent(issued());
  const buffer = await pdf.buildPdf([{ kind: "text", x: 50, y: 700, text: "Hello (world) · test" }, { kind: "qr", x: 50, y: 100, size: 150, value: "http://localhost/verify/ABCD-EF23" }], { canonical, digest: "d" });
  const text = buffer.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.match(text, /\/Count 1/);
  assert.match(text, /Hello \\\(world\\\)/);
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 4), "xref");
  assert.equal(pdf.extractCanonical(text), canonical);
});

test("certificate text wraps inside the page margin", () => {
  const lines = cert.wrap("word ".repeat(60), 74);
  assert.ok(lines.every((l) => l.length <= 74));
});

// ---- timetable -------------------------------------------------------------------

const sched = (id, subject, weekday, startTime, room = "LH-1") => ({ _id: id, branch: "CSE", year: 3, section: "A", subject, weekday, startTime, room });

test("a day's sessions apply cancellations, room changes and reschedules", () => {
  const monday = "2026-09-28";
  const schedules = [sched("s1", "DBMS", 1, "08:00"), sched("s2", "DATA STRUCTURES", 1, "11:00"), sched("s3", "OS", 2, "08:00")];
  const changes = [
    { schedule: "s1", sessionDate: monday, type: "CANCEL", reference: "CLS-1" },
    { schedule: "s2", sessionDate: monday, type: "ROOM", newRoom: "SEM-2", reference: "CLS-2" },
    { schedule: "s3", sessionDate: "2026-09-29", type: "RESCHEDULE", newDate: monday, newStartTime: "14:00", reference: "CLS-3" }
  ];
  const rows = tt.applyChanges(monday, schedules, changes);
  assert.deepEqual(rows.map((r) => [r.subject, r.status]), [["DBMS", "CANCELLED"], ["DATA STRUCTURES", "ROOM_CHANGED"], ["OS", "RESCHEDULED_HERE"]]);
  assert.equal(rows[1].room, "SEM-2");
  const answer = tt.answerFor(monday, rows, { label: "tomorrow" });
  assert.match(answer.answer, /^Yes — DBMS 08:00 is cancelled/);
  assert.equal(answer.cancelled.length, 1);
});

test("the answer says No when nothing is cancelled, and handles empty days and absent subjects", () => {
  const monday = "2026-09-28";
  const rows = tt.applyChanges(monday, [sched("s1", "DBMS", 1, "08:00")], []);
  assert.match(tt.answerFor(monday, rows).answer, /^No — none of your 1 class is cancelled/);
  assert.match(tt.answerFor("2026-09-27", []).answer, /^No classes are scheduled/);
  assert.match(tt.answerFor(monday, rows, { subject: "physics" }).answer, /not on your timetable/);
});

test("the question parser reads the day and the subject deterministically", () => {
  assert.deepEqual(tt.parseQuestion("Is tomorrow's DBMS class cancelled?", ["DBMS", "DATA STRUCTURES"]), { day: "tomorrow", subject: "DBMS" });
  assert.deepEqual(tt.parseQuestion("any class today?", ["DBMS"]), { day: "today", subject: null });
});

test("adjusted attendance removes register sessions on cancelled dates without touching the record", () => {
  const record = {
    subject: "DBMS",
    totalClasses: 4,
    attendedClasses: 2,
    attendancePercentage: 50,
    sessions: [
      { date: ist.istInstant("2026-09-14", "08:00"), present: true },
      { date: ist.istInstant("2026-09-21", "08:00"), present: false },
      { date: ist.istInstant("2026-09-22", "14:00"), present: true },
      { date: ist.istInstant("2026-09-24", "08:00"), present: false }
    ]
  };
  const frozen = JSON.stringify(record);
  const row = tt.adjustRecord(record, new Set(["2026-09-21"]));
  assert.deepEqual(row.adjusted, { attended: 2, total: 3, percentage: 66.7 });
  assert.deepEqual(row.recorded, { attended: 2, total: 4, percentage: 50 });
  assert.equal(row.cancelledInRegister.length, 1);
  assert.equal(JSON.stringify(record), frozen);
});

// ---- mess -----------------------------------------------------------------------

test("the next meal is the one being served, else the next window, else tomorrow's first", () => {
  const windows = [
    { meal: "BREAKFAST", start: "07:30", end: "09:30" },
    { meal: "LUNCH", start: "11:30", end: "14:30" },
    { meal: "DINNER", start: "19:30", end: "21:30" }
  ];
  assert.equal(mess.pickNextMeal(windows, ist.istInstant("2026-09-28", "12:00")).meal, "LUNCH");
  assert.equal(mess.pickNextMeal(windows, ist.istInstant("2026-09-28", "12:00")).serving, true);
  assert.equal(mess.pickNextMeal(windows, ist.istInstant("2026-09-28", "15:00")).meal, "DINNER");
  const late = mess.pickNextMeal(windows, ist.istInstant("2026-09-28", "22:00"));
  assert.deepEqual([late.meal, late.date], ["BREAKFAST", "2026-09-29"]);
});

// ---- fees ------------------------------------------------------------------------

test("fee status totals heads, finds the next due date and flags overdue dues", () => {
  const now = new Date("2026-09-26T00:00:00Z");
  const s = fees.accountStatus(
    {
      academicYear: "2026-27",
      heads: [
        { head: "TUITION", amount: 1000, paid: 1000, dueDate: new Date("2026-08-01") },
        { head: "MESS", amount: 500, paid: 100, dueDate: new Date("2026-10-01") },
        { head: "FINES", amount: 200, paid: 0, dueDate: new Date("2026-09-20") }
      ]
    },
    now
  );
  assert.deepEqual(s.totals, { total: 1700, paid: 1100, outstanding: 600, overdue: 200 });
  assert.equal(s.status, "OVERDUE");
  assert.equal(s.nextDue.head, "MESS");
  assert.equal(s.nextDue.amount, 400);
  assert.equal(s.heads[0].state, "PAID");
});

// ---- tracker ---------------------------------------------------------------------

test("age buckets follow the brief: <24h, 1–3d, 3–7d, >7d", () => {
  assert.deepEqual([1, 30, 100, 200].map(tracker.ageBucket), ["<24h", "1–3d", "3–7d", ">7d"]);
});

test("document timelines share the complaint timeline shape and show rejection honestly", () => {
  const t = tracker.documentTimeline({ _id: "d", reference: "DOC-1", type: "NO_DUES", purpose: "x", status: "REJECTED", createdAt: new Date(), reviewedAt: new Date(), history: [] });
  assert.equal(t.kind, "document");
  assert.equal(t.stages.at(-1).id, "REJECTED");
  assert.ok(t.stages.some((s) => s.state === "SKIPPED"));
  const issuedT = tracker.documentTimeline({ _id: "d", reference: "DOC-2", type: "BONAFIDE", purpose: "x", status: "ISSUED", createdAt: new Date(), certificate: { issuedAt: new Date() }, history: [] });
  assert.ok(issuedT.stages.every((s) => s.state === "DONE"));
  for (const key of ["kind", "id", "reference", "title", "status", "stages", "events", "method"]) assert.ok(key in issuedT);
});
