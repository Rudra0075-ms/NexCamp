/**
 * Schema tests for the model changes the AI layer added.
 *
 * Mongoose validates a document without a database connection, so these run
 * anywhere and cover the real risk in a schema change: a new enum that rejects
 * a legitimate value, a default that breaks an existing row, or a field that
 * silently drops what was assigned to it.
 *
 * The backward-compatibility cases matter most. Every document in the existing
 * database predates these fields, so a document without them must still
 * validate.
 */
import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";

const { Complaint } = await import("../src/models/Complaint.js");
const { Notification } = await import("../src/models/Notification.js");
const { AuditEntry } = await import("../src/models/AuditEntry.js");
const { GENESIS_HASH, hashEntry } = await import("../src/services/auditChainService.js");
const { AI_SOURCES, DEPARTMENTS, NOTIFICATION_PRIORITIES } = await import("../src/config/constants.js");

const objectId = "507f1f77bcf86cd799439011";

/** A complaint exactly as the original code would have written it. */
const legacyComplaint = () =>
  new Complaint({
    reference: "CMP-2101",
    student: objectId,
    title: "No water",
    description: "No water in the bathroom since morning",
    category: "WATER",
    aiClassification: {
      category: "WATER",
      priority: "HIGH",
      severity: "CRITICAL",
      confidence: 88,
      method: "RULE_BASED_KEYWORD_MATCH",
      reasons: ["2 water keywords matched"],
      classifiedAt: new Date()
    }
  });

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

test("a complaint written before the AI layer existed still validates", () => {
  const error = legacyComplaint().validateSync();
  assert.equal(error, undefined, error?.message);
});

test("the new complaint fields are optional and default to absent", () => {
  const complaint = legacyComplaint();
  assert.equal(complaint.aiRouting, undefined);
  assert.equal(complaint.duplicateReview, undefined);
  // No default on `source`: a row that predates the field reports "not
  // recorded" rather than claiming a provenance it never had.
  assert.equal(complaint.aiClassification.source, undefined);
});

test("a notification written before the priority fields existed still validates, and sorts", () => {
  const notification = new Notification({
    kind: "GATE_PASS_APPROVED",
    audience: "STUDENT",
    user: objectId,
    title: "Pass approved"
  });
  assert.equal(notification.validateSync(), undefined);
  // Defaulted rather than left empty, so an old row does not vanish from a
  // priority-ordered list.
  assert.equal(notification.priority, "MEDIUM");
  assert.equal(notification.prioritySource, "RULE_BASED");
});

// ---------------------------------------------------------------------------
// The new fields actually persist what is assigned to them
// ---------------------------------------------------------------------------

test("AI provenance is stored on the classification", () => {
  const complaint = legacyComplaint();
  complaint.aiClassification.source = AI_SOURCES.MODEL;
  complaint.aiClassification.provider = "anthropic";
  complaint.aiClassification.model = "claude-sonnet-5";
  complaint.aiClassification.confidenceBasis = "MODEL_REPORTED";
  complaint.aiClassification.escalated = true;
  complaint.aiClassification.safetyRule = "ELECTRICAL_ARC";

  assert.equal(complaint.validateSync(), undefined);
  assert.equal(complaint.aiClassification.provider, "anthropic");
  assert.equal(complaint.aiClassification.model, "claude-sonnet-5");
  assert.equal(complaint.aiClassification.escalated, true);
});

test("an invented AI source is rejected by the schema", () => {
  const complaint = legacyComplaint();
  complaint.aiClassification.source = "TOTALLY_REAL_AI";
  const error = complaint.validateSync();
  assert.ok(error, "expected the enum to reject an unknown source");
  assert.match(String(error.message), /source/);
});

test("routing keeps the recommendation and the override side by side", () => {
  const complaint = legacyComplaint();
  complaint.aiRouting = {
    recommendedDepartment: DEPARTMENTS[0],
    recommendedBy: "anthropic/claude-sonnet-5",
    recommendedAt: new Date(),
    finalDepartment: DEPARTMENTS[3],
    decision: "MODIFIED",
    decidedBy: objectId,
    decidedByName: "Warden Rao",
    decidedByRole: "WARDEN",
    decidedAt: new Date(),
    note: "Handled by housekeeping this week"
  };

  assert.equal(complaint.validateSync(), undefined);
  assert.equal(complaint.aiRouting.recommendedDepartment, DEPARTMENTS[0]);
  assert.equal(complaint.aiRouting.finalDepartment, DEPARTMENTS[3]);
  assert.notEqual(complaint.aiRouting.recommendedDepartment, complaint.aiRouting.finalDepartment);
});

test("a department that does not exist cannot be routed to", () => {
  const complaint = legacyComplaint();
  complaint.aiRouting = { finalDepartment: "THE DEPARTMENT OF MADE UP THINGS" };
  assert.ok(complaint.validateSync(), "expected the department enum to reject it");
});

test("a routing decision outside ACCEPTED/MODIFIED is rejected", () => {
  const complaint = legacyComplaint();
  complaint.aiRouting = { decision: "IGNORED" };
  assert.ok(complaint.validateSync());
});

test("a duplicate review records the verdict without deleting anything", () => {
  const complaint = legacyComplaint();
  complaint.duplicateReview = {
    decision: "SEPARATE",
    similarity: 74,
    decidedBy: objectId,
    decidedByName: "Admin",
    decidedAt: new Date(),
    note: "Different riser"
  };
  assert.equal(complaint.validateSync(), undefined);
  // The complaint itself is untouched by the verdict.
  assert.equal(complaint.title, "No water");
  assert.equal(complaint.status, "PENDING");
});

test("only LINKED or SEPARATE are valid duplicate verdicts", () => {
  const complaint = legacyComplaint();
  complaint.duplicateReview = { decision: "DELETED" };
  assert.ok(complaint.validateSync());
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test("every priority band the classifier can emit is accepted by the schema", () => {
  for (const priority of NOTIFICATION_PRIORITIES) {
    const notification = new Notification({
      kind: "GATE_PASS_OVERDUE",
      audience: "ADMIN",
      user: objectId,
      title: "Overdue",
      priority
    });
    assert.equal(notification.validateSync(), undefined, `${priority} was rejected`);
  }
});

test("the complaint escalation kinds are valid notification kinds", () => {
  for (const kind of ["COMPLAINT_ESCALATED", "COMPLAINT_ASSIGNED"]) {
    const notification = new Notification({ kind, audience: "ADMIN", user: objectId, title: "x" });
    assert.equal(notification.validateSync(), undefined, `${kind} was rejected`);
  }
});

test("an invented priority band is rejected", () => {
  const notification = new Notification({
    kind: "GATE_PASS_OVERDUE",
    audience: "ADMIN",
    user: objectId,
    title: "x",
    priority: "APOCALYPTIC"
  });
  assert.ok(notification.validateSync());
});

// ---------------------------------------------------------------------------
// Audit entries
// ---------------------------------------------------------------------------

test("an audit entry validates and re-hashes to its stored digest", () => {
  const draft = {
    sequence: 1,
    entityType: "Complaint",
    entityId: objectId,
    entityRef: "CMP-2101",
    action: "COMPLAINT_FILED",
    field: "status",
    previousValue: "",
    newValue: "CLASSIFIED",
    actorName: "Pritish",
    actorRole: "STUDENT",
    note: "",
    at: new Date(),
    previousHash: GENESIS_HASH
  };
  draft.hash = hashEntry(draft);

  const entry = new AuditEntry(draft);
  assert.equal(entry.validateSync(), undefined);
  assert.equal(hashEntry(entry), draft.hash, "the stored document must re-hash identically");
});

test("an audit entry cannot be written without its chain links", () => {
  const entry = new AuditEntry({ sequence: 1, entityType: "Complaint", entityId: objectId, action: "X" });
  const error = entry.validateSync();
  assert.ok(error);
  assert.match(String(error.message), /previousHash|hash/);
});

test("an audit entry against an unknown entity type is rejected", () => {
  const entry = new AuditEntry({
    sequence: 1,
    entityType: "Spaceship",
    entityId: objectId,
    action: "X",
    previousHash: GENESIS_HASH,
    hash: "x"
  });
  assert.ok(entry.validateSync());
});
