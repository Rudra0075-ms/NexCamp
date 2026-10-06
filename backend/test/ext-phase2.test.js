/**
 * PS07 extension pack — Phase 2 unit tests (no database needed).
 * Friction Ledger arithmetic, SMS parsing and 160-character replies, the
 * proof-of-fix photo cap, FAQ retrieval and its number guard, the board and
 * the adoption validators.
 */
import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";

const friction = await import("../src/services/ext/frictionService.js");
const sms = await import("../src/services/ext/smsKeywordService.js");
const fix = await import("../src/services/ext/fixService.js");
const faq = await import("../src/services/ext/faqService.js");
const boardSvc = await import("../src/services/ext/boardService.js");
const adoption = await import("../src/services/ext/adoptionExtService.js");

// ---- 2A --------------------------------------------------------------------------

test("a ledger row separates ACTUAL DATA, BASELINE ESTIMATE and the derived ESTIMATE", () => {
  const baseline = { task: "Get a certificate", hours: 48, studentActions: 3, studentMinutes: 120, source: "estimate" };
  const row = friction.ledgerRow("DOCUMENT", [{ hours: 10, actions: 1, student: "a" }, { hours: 20, actions: 1, student: "b" }, { hours: 60, actions: 2, student: "a" }], baseline);
  assert.equal(row.actual.kind, "ACTUAL DATA");
  assert.equal(row.actual.medianHours, 20);
  assert.equal(row.baseline.kind, "BASELINE ESTIMATE");
  assert.equal(row.saved.kind, "ESTIMATE");
  // (48−10) + (48−20) + max(0, 48−60) = 66
  assert.equal(row.saved.hours, 66);
  assert.equal(row.students, 2);
  assert.equal(row.saved.perStudentHours, 33);
  assert.equal(row.saved.reductionPct, 58.3);
  assert.equal(row.saved.meetsTarget, true);
});

test("an empty window says Insufficient data instead of inventing a figure", () => {
  const row = friction.ledgerRow("COMPLAINT", [], { hours: 72 });
  assert.equal(row.actual.kind, "INSUFFICIENT DATA");
  assert.equal(row.saved, null);
});

test("every default baseline is present and labelled with a stated source", () => {
  const ids = friction.DEFAULT_BASELINES.map((b) => b.workflow);
  for (const w of ["COMPLAINT", "GATE_PASS", "DOCUMENT", "NOTICE", "CLASS_CHECK", "MENU_CHECK"]) assert.ok(ids.includes(w));
  assert.match(friction.BASELINE_SOURCE, /not a measurement/);
});

// ---- 2B --------------------------------------------------------------------------

test("SMS commands parse deterministically", () => {
  assert.equal(sms.parseCommand("att").command, "ATT");
  assert.equal(sms.parseCommand(" help ").command, "HELP");
  assert.equal(sms.parseCommand("GP").command, "GP");
  assert.equal(sms.parseCommand("menu").command, "MENU");
  assert.equal(sms.parseCommand("notice").command, "NOTICE");
  assert.deepEqual(sms.parseCommand("STATUS cmp-2131"), { command: "STATUS", reference: "CMP-2131" });
  assert.ok(sms.parseCommand("STATUS 2131").error);
  assert.equal(sms.parseCommand("hello there").command, "UNKNOWN");
});

test("a category command files with location and text, and aliases map to real categories", () => {
  assert.deepEqual(sms.parseCommand("WATER B-214 no water since morning"), { command: "COMPLAINT", category: "WATER", location: "B-214", description: "no water since morning" });
  assert.equal(sms.parseCommand("wifi lib-1 keeps dropping out").category, "WI-FI");
  assert.equal(sms.parseCommand("power c-201 no light").category, "ELECTRICITY");
  assert.ok(sms.parseCommand("WATER B-214").error, "too short to file");
});

test("every SMS reply fits in 160 characters", () => {
  assert.ok(sms.HELP_TEXT.length <= 160);
  assert.equal(sms.fit("x".repeat(400)).length, 160);
  assert.equal(sms.fit("short"), "short");
});

test("phone numbers are stored as a hash, never in the clear", () => {
  assert.match(sms.phoneHash("+919000000001"), /^[a-f0-9]{64}$/);
  assert.equal(sms.phoneHash("+91 90000 00001"), sms.phoneHash("+919000000001"));
});

// ---- 2C --------------------------------------------------------------------------

test("proof-of-fix photos must be small image data URLs", () => {
  assert.equal(fix.validatePhoto(undefined), null);
  const ok = fix.validatePhoto(`data:image/jpeg;base64,/9j/4AAQ${"A".repeat(120)}`);
  assert.ok(ok.bytes > 0);
  assert.throws(() => fix.validatePhoto("data:image/png;base64,iVBORw0KGgo="), /not a readable image/);
  assert.throws(() => fix.validatePhoto(`data:image/png;base64,/9j/4AAQ${"A".repeat(120)}`), /not a readable image/);
  assert.throws(() => fix.validatePhoto("data:image/svg+xml;base64,AAAA"), /JPEG, PNG or WebP/);
  assert.throws(() => fix.validatePhoto("https://example.com/a.jpg"), /JPEG, PNG or WebP/);
  assert.throws(() => fix.validatePhoto(`data:image/png;base64,${"A".repeat(fix.MAX_PHOTO_CHARS)}`), /too large/);
});

test("the confirmation window is 48 hours", () => {
  assert.equal(fix.CONFIRM_WINDOW_HOURS, 48);
});

// ---- 2D --------------------------------------------------------------------------

const sections = [
  { key: "HOSTEL-IN-TIME", title: "Hostel in-time and late entry", body: "Residents must be inside the hostel by 21:30.", keywords: ["curfew", "in-time", "late", "night"] },
  { key: "MESS-TIMINGS", title: "Mess timings", body: "Breakfast 07:30–09:30, dinner 19:30–21:30.", keywords: ["mess", "breakfast", "dinner", "meal"] },
  { key: "FEES-DEADLINES", title: "Fee payment deadlines", body: "Mess advance by 1 October.", keywords: ["fee", "payment", "deadline", "due"] }
];

test("retrieval ranks the section whose keywords the question hits", () => {
  const [top] = faq.rank("What time is dinner in the mess?", sections);
  assert.equal(top.section.key, "MESS-TIMINGS");
  assert.ok(top.score >= faq.MATCH_THRESHOLD);
  assert.ok(top.matched.includes("dinner"));
  assert.equal(faq.rank("fees due date", sections)[0].section.key, "FEES-DEADLINES");
});

test("an unrelated question scores below the threshold", () => {
  const ranked = faq.rank("Who won the cricket match yesterday?", sections);
  assert.ok(!ranked.length || ranked[0].score < faq.MATCH_THRESHOLD);
});

test("a model rephrasing may not introduce numbers that the section lacks", () => {
  assert.equal(faq.numbersPreserved("Back by 21:30.", "छात्र 21:30 तक लौटें।"), true);
  assert.equal(faq.numbersPreserved("Back by 21:30.", "Back by 22:30, fine 500."), false);
});

test("stemming lets singular and plural meet", () => {
  assert.equal(faq.stem("certificates"), faq.stem("certificate"));
  assert.equal(faq.stem("fees"), faq.stem("fee"));
  assert.equal(faq.stem("timings"), faq.stem("timing"));
  assert.equal(faq.stem("charges"), faq.stem("charge"));
});

// ---- 2E --------------------------------------------------------------------------

test("board cards carry counts and fixes but no personal information", () => {
  const card = boardSvc.cardFromMemory({ buildingName: "HOSTEL B", category: "WATER", incidentType: "Water failure", resolution: "Booster pump replaced", resolutionTimeHours: 9, signatures: ["17-complaint cluster"], occurredOn: new Date() });
  assert.equal(card.reports, 17);
  assert.equal(card.headline, "HOSTEL B WATER — 17 reports → Booster pump replaced in 9h");
  assert.equal(card.kind, "ACTUAL DATA");
  for (const key of Object.keys(card)) assert.ok(!/student|name|room/i.test(key));
});

// ---- 2H --------------------------------------------------------------------------

const ctx = { hostels: new Map([["HOSTEL B", "HOSTEL B"], ["HST-B", "HOSTEL B"]]), studentIds: new Set(["BPUT/CSE/22/0417"]), emails: new Set(["control@bput.ac.in"]), phones: new Set(), policyKeys: new Set(["MESS-TIMINGS"]) };

test("every dataset has a template whose header matches its validator's columns", () => {
  for (const [key, spec] of Object.entries(adoption.DATASETS)) {
    const csv = adoption.template(key);
    assert.deepEqual(adoption.parseCsv(csv)[0], spec.columns, key);
  }
});

test("dataset validators flag real problems row by row", () => {
  const seen = new Set();
  assert.equal(adoption.checkRow("rooms", { hostel: "HOSTEL B", room: "B-214", floor: "2", capacity: "2" }, ctx, seen).status, "READY");
  assert.ok(adoption.checkRow("rooms", { hostel: "HOSTEL B", room: "B-214", floor: "2", capacity: "2" }, ctx, seen).issues.includes("Room repeated in this file"));
  assert.ok(adoption.checkRow("fees", { "student id": "BPUT/CSE/22/0417", "academic year": "2026-27", head: "MESS", amount: "100", paid: "200", "due date": "2026-10-01" }, ctx, new Set()).issues.includes("Paid is more than the amount"));
  assert.ok(adoption.checkRow("staff", { name: "X", email: "control@bput.ac.in", role: "ADMIN" }, ctx, new Set()).issues.includes("An account with this email already exists"));
  assert.ok(adoption.checkRow("staff", { name: "X", email: "x@y.in", role: "STUDENT" }, ctx, new Set()).issues.length);
  assert.equal(adoption.checkRow("policy", { key: "MESS-TIMINGS", category: "MESS", title: "t", body: "b".repeat(30), source: "s" }, ctx, new Set()).status, "READY · WITH WARNINGS");
  assert.ok(adoption.checkRow("students", { "student id": "NOPE", branch: "CSE", year: "3" }, ctx, new Set()).issues.some((i) => /No student/.test(i)));
});

test("the CSV parser handles quoted commas and escaped quotes", () => {
  assert.deepEqual(adoption.parseCsv('a,"b, c","say ""hi"""\n'), [["a", "b, c", 'say "hi"']]);
});
