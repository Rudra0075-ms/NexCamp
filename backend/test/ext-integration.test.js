/**
 * PS07 extension pack — end-to-end service tests against a real MongoDB.
 *
 * Uses its own throwaway database (EXT_TEST_MONGO_URI, default
 * mongodb://127.0.0.1:27017/nex_ext_integration_test) and drops it at the end.
 * When no MongoDB is reachable every test here is skipped, so `npm test`
 * still runs anywhere, as the original suite does.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";

process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
const URI = process.env.EXT_TEST_MONGO_URI || "mongodb://127.0.0.1:27017/nex_ext_integration_test";

let available = false;
try {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 1500 });
  available = true;
} catch {
  available = false;
}
const itest = (name, fn) => test(name, { skip: available ? false : "no MongoDB reachable" }, fn);

const { Building, User, Complaint, AuditEntry, Attendance } = await import("../src/models/index.js");
const ext = await import("../src/models/ext/index.js");
const notices = await import("../src/services/ext/noticeService.js");
const certs = await import("../src/services/ext/certificateService.js");
const tt = await import("../src/services/ext/timetableService.js");
const sms = await import("../src/services/ext/smsKeywordService.js");
const fix = await import("../src/services/ext/fixService.js");
const faq = await import("../src/services/ext/faqService.js");
const tracker = await import("../src/services/ext/requestTrackerService.js");
const friction = await import("../src/services/ext/frictionService.js");
const { verifyChain } = await import("../src/services/auditChainService.js");
const { istDateKey, istInstant, weekdayOf } = await import("../src/services/ext/istTime.js");

let admin;
let warden;
let alice;
let bob;

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  const hostelB = await Building.create({ code: "HST-B", mapId: "hostb", name: "HOSTEL B", type: "HOSTEL" });
  const hostelC = await Building.create({ code: "HST-C", mapId: "hostc", name: "HOSTEL C", type: "HOSTEL" });
  admin = await User.create({ name: "ADMIN ONE", email: "admin@test.in", password: "Passw0rd1", role: "ADMIN", managedDepartment: "GENERAL ADMINISTRATION" });
  warden = await User.create({ name: "WARDEN B", email: "warden@test.in", password: "Passw0rd1", role: "WARDEN", hostel: hostelB._id, hostelName: "HOSTEL B", managedDepartment: "MAINTENANCE · PLUMBING" });
  alice = await User.create({ name: "ALICE KUMARI DAS", email: "alice@test.in", password: "Passw0rd1", role: "STUDENT", studentId: "BPUT/CSE/22/0001", department: "COMPUTER SCIENCE & ENGINEERING", course: "B.TECH CSE", semester: 5, hostel: hostelB._id, hostelName: "HOSTEL B", room: "B-101" });
  bob = await User.create({ name: "BOB NAYAK", email: "bob@test.in", password: "Passw0rd1", role: "STUDENT", studentId: "BPUT/CSE/22/0002", department: "COMPUTER SCIENCE & ENGINEERING", course: "B.TECH CSE", semester: 5, hostel: hostelC._id, hostelName: "HOSTEL C", room: "C-201" });
  await ext.StudentProfile.create([
    { student: alice._id, branch: "CSE", year: 3, batch: "2022", section: "A", registeredPhone: "+919000011111" },
    { student: bob._id, branch: "CSE", year: 3, batch: "2022", section: "B", registeredPhone: "+919000022222" }
  ]);
});

after(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const daytime = () => istInstant(istDateKey(new Date()), "11:00");

itest("a hostel-targeted notice reaches only that hostel, and delivery is recorded on fetch", async () => {
  const preview = await notices.reachPreview({ hostels: ["HOSTEL B"] });
  assert.equal(preview.count, 1);
  const n = await notices.createNotice({ title: "Pump work", body: "Water off 10–13", priority: "HIGH", audience: { hostels: ["HOSTEL B"] }, actionRequired: { label: "Store water" } }, warden, { now: daytime() });
  assert.equal(n.status, "PUBLISHED");
  assert.equal(n.reach, 1);
  assert.equal((await notices.feedFor(bob)).notices.length, 0);
  const feed = await notices.feedFor(alice);
  assert.equal(feed.unread, 1);
  assert.ok(feed.notices[0].deliveredAt);
  await notices.markReceipt(alice, n._id, "done");
  const dash = await notices.dashboard(n._id);
  assert.deepEqual([dash.summary.targeted, dash.summary.read, dash.summary.actionDone], [1, 1, 1]);
  assert.equal(dash.notActed.length, 0);
  await assert.rejects(() => notices.markReceipt(bob, n._id, "read"), /not sent to you/);
});

itest("a night-time notice is held and released in the 07:30 digest; CRITICAL is not held", async () => {
  const night = istInstant(istDateKey(new Date(), -1), "23:00");
  const held = await notices.createNotice({ title: "Lab record reminder", body: "Bring records", audience: {} }, admin, { now: night });
  assert.equal(held.status, "HELD_QUIET_HOURS");
  assert.equal(held.reach, 0);
  const critical = await notices.createNotice({ title: "Gas leak drill", body: "Evacuate block", priority: "CRITICAL", audience: {} }, admin, { now: night });
  assert.equal(critical.status, "PUBLISHED");
  const released = await notices.releaseDigest(new Date(held.releaseAt.getTime() + 60000));
  assert.ok(released >= 1);
  const after = await ext.Notice.findById(held._id);
  assert.equal(after.status, "PUBLISHED");
  assert.match(after.digestBatch, /^DIGEST \d{4}-\d{2}-\d{2} 07:30$/);
  assert.equal(after.reach, 2);
});

itest("unread CRITICAL notices escalate over SMS after their window, once", async () => {
  const n = await notices.createNotice({ title: "Kitchen closed", body: "LPG inspection", priority: "CRITICAL", audience: { hostels: ["HOSTEL C"] }, escalateAfterHours: 1 }, admin, { now: new Date(Date.now() - 2 * 3600000) });
  const phoneFor = async (id) => (await ext.StudentProfile.findOne({ student: id }))?.registeredPhone;
  const sent = await notices.escalateUnread(new Date(), { phoneFor });
  assert.ok(sent >= 1);
  const receipt = await ext.NoticeReceipt.findOne({ notice: n._id, student: bob._id });
  assert.equal(receipt.channel, "SMS");
  assert.ok(receipt.smsSentAt);
  assert.equal(await notices.escalateUnread(new Date(), { phoneFor }), 0, "not sent twice");
});

itest("the duplicate check finds a similar notice to an overlapping audience", async () => {
  const check = await notices.duplicateCheck({ title: "Pump work water off", body: "Water off 10–13 for pump work", audience: { hostels: ["HOSTEL B"] } });
  assert.ok(check.duplicates.length >= 1);
  const none = await notices.duplicateCheck({ title: "Pump work water off", body: "Water off 10–13 for pump work", audience: { hostels: ["HOSTEL C"] } });
  assert.equal(none.duplicates.filter((d) => d.title === "Pump work").length, 0);
});

itest("a certificate goes SUBMITTED → UNDER_REVIEW → APPROVED → ISSUED and verifies; tampering and revocation are detected", async () => {
  const doc = await certs.requestDocument(alice, { type: "BONAFIDE", purpose: "Bank loan" });
  await assert.rejects(() => certs.requestDocument(alice, { type: "BONAFIDE", purpose: "Again" }), /open/);
  await certs.reviewDocument(doc._id, admin, { decision: "START_REVIEW" });
  await assert.rejects(() => certs.reviewDocument(doc._id, admin, { decision: "REJECT" }), /reason/);
  await certs.reviewDocument(doc._id, admin, { decision: "APPROVE" });
  const issued = await certs.issueDocument(doc._id, admin);
  const code = issued.certificate.verificationCode;
  assert.equal((await certs.verifyCode(code)).status, "VALID");
  assert.equal((await certs.verifyCode(code)).nameMasked, "AL*** KU**** DA*");
  const { buffer } = await certs.certificatePdf(doc._id, alice);
  const canonical = (await import("../src/services/ext/pdfWriter.js")).extractCanonical(buffer.toString("latin1"));
  assert.equal((await certs.verifyCopy(code, canonical)).copyMatches, true);
  assert.equal((await certs.verifyCopy(code, canonical.replace("Bank loan", "Visa"))).copyMatches, false);
  await assert.rejects(() => certs.certificatePdf(doc._id, bob), /Not your document/);
  // Someone edits the stored record directly.
  await ext.DocumentRequest.collection.updateOne({ _id: doc._id }, { $set: { "studentSnapshot.name": "MALLORY" } });
  assert.equal((await certs.verifyCode(code)).status, "TAMPERED");
  await ext.DocumentRequest.collection.updateOne({ _id: doc._id }, { $set: { "studentSnapshot.name": "ALICE KUMARI DAS" } });
  await certs.revokeDocument(doc._id, admin, "Issued in error for testing");
  assert.equal((await certs.verifyCode(code)).status, "REVOKED");
  assert.equal((await certs.verifyCode("ZZZZ-ZZZZ")).status, "NOT_FOUND");
});

itest("a class cancellation notifies exactly the affected section and shows in the day answer", async () => {
  const monday = (() => {
    for (let i = 1; i <= 7; i += 1) if (weekdayOf(istDateKey(new Date(), i)) === 1) return istDateKey(new Date(), i);
    return null;
  })();
  const a = await ext.ClassSchedule.create({ branch: "CSE", year: 3, section: "A", subject: "DBMS", weekday: 1, startTime: "08:00", room: "LH-1" });
  await ext.ClassSchedule.create({ branch: "CSE", year: 3, section: "B", subject: "DBMS", weekday: 1, startTime: "08:00", room: "LH-2" });
  const result = await tt.createChange(admin, { scheduleId: String(a._id), sessionDate: monday, type: "CANCEL", reason: "Faculty away" }, { now: daytime() });
  assert.equal(result.notice.reach, 1);
  const answer = await tt.answerDay(alice, { day: monday });
  assert.match(answer.answer, /^Yes — DBMS 08:00 is cancelled/);
  assert.equal(answer.evidence.length, 1);
  const bobAnswer = await tt.answerDay(bob, { day: monday });
  assert.match(bobAnswer.answer, /^No/);
  await assert.rejects(() => tt.createChange(admin, { scheduleId: String(a._id), sessionDate: monday, type: "CANCEL" }), /already has a change/);
});

itest("adjusted attendance reads the register without writing to it", async () => {
  const past = istDateKey(new Date(), -7);
  const sched = await ext.ClassSchedule.create({ branch: "CSE", year: 3, section: "A", subject: "OPERATING SYSTEMS", weekday: weekdayOf(past), startTime: "11:00" });
  await Attendance.create({ student: alice._id, subject: "OPERATING SYSTEMS", totalClasses: 2, attendedClasses: 1, sessions: [{ date: istInstant(past, "11:00"), present: false }, { date: istInstant(istDateKey(new Date(), -14), "11:00"), present: true }] });
  await tt.createChange(admin, { scheduleId: String(sched._id), sessionDate: past, type: "CANCEL" }, { now: daytime() });
  const before = await Attendance.findOne({ student: alice._id }).lean();
  const view = await tt.adjustedAttendance(alice);
  const os = view.subjects.find((s) => s.subject === "OPERATING SYSTEMS");
  assert.deepEqual(os.adjusted, { attended: 1, total: 1, percentage: 100 });
  assert.equal(os.recorded.percentage, before.attendancePercentage);
  const afterRow = await Attendance.findOne({ student: alice._id }).lean();
  assert.deepEqual(afterRow, before);
});

itest("SMS: registered numbers get answers, a complaint is filed through the existing controller, strangers and floods are refused", async () => {
  const help = await sms.handleInbound({ from: "+919000011111", text: "HELP", simulated: true });
  assert.equal(help.outcome, "OK");
  const stranger = await sms.handleInbound({ from: "+919999999999", text: "ATT", simulated: true });
  assert.equal(stranger.outcome, "UNREGISTERED");
  const filed = await sms.handleInbound({ from: "+919000011111", text: "WATER B-101 tap leaking badly since night", simulated: true });
  assert.equal(filed.outcome, "OK");
  assert.ok(filed.reply.length <= 160);
  const ref = /Filed (CMP-\d+)/.exec(filed.reply)[1];
  const complaint = await Complaint.findOne({ reference: ref }).lean();
  assert.equal(complaint.channel, "SMS");
  assert.equal(complaint.category, "WATER");
  assert.ok(complaint.audit.some((a) => /SMS keyword channel/.test(a.message)));
  const status = await sms.handleInbound({ from: "+919000011111", text: `STATUS ${ref}`, simulated: true });
  assert.match(status.reply, new RegExp(ref));
  for (let i = 0; i < sms.RATE_LIMIT.max; i += 1) await sms.handleInbound({ from: "+919000022222", text: "HELP", simulated: true });
  const limited = await sms.handleInbound({ from: "+919000022222", text: "ATT", simulated: true });
  assert.equal(limited.outcome, "RATE_LIMITED");
});

itest("proof of fix, NOT FIXED and the reopen request leave the original complaint RESOLVED", async () => {
  const c = await Complaint.create({ reference: "CMP-9001", student: alice._id, title: "Fan broken", description: "Ceiling fan not working", category: "ELECTRICITY", department: "MAINTENANCE · ELECTRICAL", status: "RESOLVED", resolution: { resolvedAt: new Date(), resolutionDescription: "Capacitor replaced" } });
  await assert.rejects(() => fix.attachProof(c._id, warden, { photo: "data:image/gif;base64,AAAA" }), /JPEG, PNG or WebP/);
  await fix.attachProof(c._id, warden, { note: "Replaced", photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGM4gQMwDC0JAJwulgGh6TLjAAAAAElFTkSuQmCC" });
  await assert.rejects(() => fix.confirmFix(c._id, bob, { response: "YES" }), /Only the person/);
  const out = await fix.confirmFix(c._id, alice, { response: "NOT_FIXED", comment: "Still stops" });
  assert.match(out.reopen.reference, /^RPN-/);
  assert.equal((await Complaint.findById(c._id).lean()).status, "RESOLVED");
  const metrics = await fix.fixMetrics();
  const row = metrics.departments.find((d) => d.department === "MAINTENANCE · ELECTRICAL");
  assert.equal(row.reopenRate, 100);
  assert.equal(row.proofRate, 100);
  const queue = await tracker.pendingQueue({ kind: "reopen" });
  assert.equal(queue.items[0].reference, out.reopen.reference);
  // 48 hours without an answer becomes NO_RESPONSE.
  const old = await Complaint.create({ reference: "CMP-9002", student: bob._id, title: "Tap", description: "Leaking tap", category: "WATER", status: "RESOLVED", resolution: { resolvedAt: new Date(Date.now() - 50 * 3600000) } });
  await fix.expireConfirmations(new Date());
  assert.equal((await ext.FixConfirmation.findOne({ complaint: old._id })).response, "NO_RESPONSE");
});

itest("the FAQ cites a section, logs the question, and offers a request when nothing matches", async () => {
  await ext.PolicySection.create({ key: "MESS-TIMINGS", category: "MESS", title: "Mess timings", body: "Dinner is served 19:30 to 21:30.", keywords: ["mess", "dinner", "meal"], source: "test" });
  const hit = await faq.ask(alice, { question: "When is dinner served?", lang: "EN" });
  assert.equal(hit.answered, true);
  assert.equal(hit.citation.key, "MESS-TIMINGS");
  assert.equal(hit.source, "AI_NOT_CONFIGURED");
  const miss = await faq.ask(alice, { question: "Who is the vice chancellor?", lang: "EN" });
  assert.equal(miss.answered, false);
  assert.equal(miss.offerRequest, true);
  const stats = await faq.faqStats();
  assert.equal(stats.totals.asked, 2);
  assert.equal(stats.unanswered[0].question, "Who is the vice chancellor?");
});

itest("the student's request tracker and the Friction Ledger read the same records", async () => {
  const mine = await tracker.myRequests(alice);
  const kinds = new Set(mine.items.map((i) => i.kind));
  for (const k of ["complaint", "document", "notice", "reopen"]) assert.ok(kinds.has(k), `missing ${k}`);
  const ledger = await friction.ledger({ days: 7 });
  const docRow = ledger.rows.find((r) => r.workflow === "DOCUMENT");
  assert.equal(docRow.completed, 1);
  assert.equal(docRow.baseline.kind, "BASELINE ESTIMATE");
});

itest("every extension write is in the hash chain and the chain still verifies", async () => {
  const rows = await AuditEntry.find().sort({ sequence: 1 }).lean();
  const types = new Set(rows.map((r) => r.entityType));
  for (const t of ["Notice", "DocumentRequest", "ClassChange", "FixProof", "ReopenRequest", "SmsMessage", "Complaint"]) assert.ok(types.has(t), `no ${t} entries`);
  assert.equal(verifyChain(rows).intact, true);
});
