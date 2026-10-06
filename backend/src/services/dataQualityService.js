import mongoose from "mongoose";
import { COMPLAINT_STATUS, GATE_PASS_STATUS } from "../config/constants.js";
import { Attendance } from "../models/Attendance.js";
import { Complaint } from "../models/Complaint.js";
import { GatePass } from "../models/GatePass.js";
import { Incident } from "../models/Incident.js";
import { User } from "../models/User.js";

/**
 * Feature 15 · the data quality guardian.
 *
 * A fixed list of integrity checks over the stored records. Every check is a
 * database query; every finding names the actual records that failed it.
 *
 * Read-only by design. Nothing here modifies, repairs or deletes a record —
 * the report tells an administrator where to look, and the fix is theirs.
 *
 * Checks read the raw collections (lean, no schema defaults) so a record
 * written outside the application — a script, a manual edit — is judged as it
 * actually is, including values the schema enum would not allow.
 */

const SAMPLE = 8;
const DUPLICATE_WINDOW_MINUTES = 10;

const complaintRef = (row) => ({
  id: String(row._id),
  reference: row.reference || null,
  status: row.status,
  createdAt: row.createdAt || null
});

const passRef = (row) => ({
  id: String(row._id),
  reference: row.reference || null,
  status: row.status,
  exitAt: row.exitAt || null,
  returnAt: row.returnAt || null
});

/** Records that point at an id which no longer exists. */
async function danglingRefs(model, field, target, select) {
  const rows = await model.find({ [field]: { $ne: null } }).select(`${select} ${field}`).lean();
  const ids = [...new Set(rows.map((row) => String(row[field])))].filter(mongoose.isValidObjectId);
  const found = await target.find({ _id: { $in: ids } }).select("_id").lean();
  const live = new Set(found.map((row) => String(row._id)));
  return rows.filter((row) => !live.has(String(row[field])));
}

/** Exact re-submissions: same student, same text, minutes apart. */
async function duplicateSubmissions() {
  const groups = await Complaint.aggregate([
    { $group: { _id: { student: "$student", description: "$description" }, rows: { $push: { _id: "$_id", reference: "$reference", status: "$status", createdAt: "$createdAt" } }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }
  ]);
  const flagged = [];
  for (const group of groups) {
    const rows = group.rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (let i = 1; i < rows.length; i += 1) {
      const gapMinutes = (new Date(rows[i].createdAt) - new Date(rows[i - 1].createdAt)) / 6e4;
      if (gapMinutes <= DUPLICATE_WINDOW_MINUTES) flagged.push({ ...rows[i], duplicateOf: rows[i - 1].reference });
    }
  }
  return flagged;
}

export async function runDataQualityChecks() {
  const checks = [
    {
      id: "GATEPASS_RETURNED_NO_RETURN_TIME",
      entity: "GatePass",
      category: "MISSING_REQUIRED_DATA",
      severity: "HIGH",
      title: "Gate passes marked returned with no return time",
      detail: "Status is RETURNED or RETURNED_LATE but returnAt is empty.",
      run: () => GatePass.find({ status: { $in: ["RETURNED", "RETURNED_LATE"] }, returnAt: null }).lean(),
      shape: passRef
    },
    {
      id: "GATEPASS_OUT_NO_EXIT_TIME",
      entity: "GatePass",
      category: "MISSING_REQUIRED_DATA",
      severity: "HIGH",
      title: "Gate passes that left the gate with no exit time",
      detail: "Status is ACTIVE, OVERDUE or returned, but exitAt is empty.",
      run: () => GatePass.find({ status: { $in: ["ACTIVE", "OVERDUE", "RETURNED", "RETURNED_LATE"] }, exitAt: null }).lean(),
      shape: passRef
    },
    {
      id: "GATEPASS_RETURN_BEFORE_EXIT",
      entity: "GatePass",
      category: "INCONSISTENT_TIMESTAMPS",
      severity: "HIGH",
      title: "Gate passes returned before they left",
      detail: "returnAt is earlier than exitAt.",
      run: () => GatePass.find({ exitAt: { $ne: null }, returnAt: { $ne: null }, $expr: { $lt: ["$returnAt", "$exitAt"] } }).lean(),
      shape: passRef
    },
    {
      id: "GATEPASS_WINDOW_INVERTED",
      entity: "GatePass",
      category: "INCONSISTENT_TIMESTAMPS",
      severity: "MEDIUM",
      title: "Gate passes whose return is not after their leave time",
      detail: "expectedReturnAt is not later than leaveAt.",
      run: () => GatePass.find({ $expr: { $lte: ["$expectedReturnAt", "$leaveAt"] } }).lean(),
      shape: passRef
    },
    {
      id: "GATEPASS_INVALID_STATUS",
      entity: "GatePass",
      category: "INVALID_STATUS",
      severity: "HIGH",
      title: "Gate passes with a status the system does not recognise",
      detail: `Status is outside ${GATE_PASS_STATUS.join(", ")}.`,
      run: () => GatePass.collection.find({ status: { $nin: GATE_PASS_STATUS } }).toArray(),
      shape: passRef
    },
    {
      id: "GATEPASS_MISSING_STUDENT",
      entity: "GatePass",
      category: "BROKEN_RELATIONSHIP",
      severity: "HIGH",
      title: "Gate passes whose student no longer exists",
      detail: "The student id on the pass matches no user.",
      run: () => danglingRefs(GatePass, "student", User, "reference status exitAt returnAt"),
      shape: passRef
    },
    {
      id: "COMPLAINT_RESOLVED_NO_RESOLUTION",
      entity: "Complaint",
      category: "MISSING_REQUIRED_DATA",
      severity: "MEDIUM",
      title: "Complaints marked resolved with no resolution record",
      detail: "Status is RESOLVED but resolution.resolvedAt is empty.",
      run: () => Complaint.find({ status: "RESOLVED", "resolution.resolvedAt": null }).lean(),
      shape: complaintRef
    },
    {
      id: "COMPLAINT_RESOLVED_BEFORE_FILED",
      entity: "Complaint",
      category: "INCONSISTENT_TIMESTAMPS",
      severity: "HIGH",
      title: "Complaints resolved before they were filed",
      detail: "resolution.resolvedAt is earlier than createdAt.",
      run: () => Complaint.find({ "resolution.resolvedAt": { $ne: null }, $expr: { $lt: ["$resolution.resolvedAt", "$createdAt"] } }).lean(),
      shape: complaintRef
    },
    {
      id: "COMPLAINT_ASSIGNED_NO_DEPARTMENT",
      entity: "Complaint",
      category: "MISSING_REQUIRED_DATA",
      severity: "MEDIUM",
      title: "Complaints in progress with no department",
      detail: "Status is ASSIGNED or INVESTIGATING but no department is set.",
      run: () => Complaint.find({ status: { $in: ["ASSIGNED", "INVESTIGATING"] }, department: null }).lean(),
      shape: complaintRef
    },
    {
      id: "COMPLAINT_INVALID_STATUS",
      entity: "Complaint",
      category: "INVALID_STATUS",
      severity: "HIGH",
      title: "Complaints with a status the system does not recognise",
      detail: `Status is outside ${COMPLAINT_STATUS.join(", ")}.`,
      run: () => Complaint.collection.find({ status: { $nin: COMPLAINT_STATUS } }).toArray(),
      shape: complaintRef
    },
    {
      id: "COMPLAINT_MISSING_INCIDENT",
      entity: "Complaint",
      category: "BROKEN_RELATIONSHIP",
      severity: "MEDIUM",
      title: "Complaints linked to an incident that no longer exists",
      detail: "relatedIncident matches no incident.",
      run: () => danglingRefs(Complaint, "relatedIncident", Incident, "reference status createdAt"),
      shape: complaintRef
    },
    {
      id: "COMPLAINT_MISSING_DUPLICATE_TARGET",
      entity: "Complaint",
      category: "BROKEN_RELATIONSHIP",
      severity: "LOW",
      title: "Complaints marked as a duplicate of a complaint that no longer exists",
      detail: "duplicateOf matches no complaint.",
      run: () => danglingRefs(Complaint, "duplicateOf", Complaint, "reference status createdAt"),
      shape: complaintRef
    },
    {
      id: "COMPLAINT_MISSING_STUDENT",
      entity: "Complaint",
      category: "BROKEN_RELATIONSHIP",
      severity: "MEDIUM",
      title: "Complaints whose author no longer exists",
      detail: "The student id on the complaint matches no user.",
      run: () => danglingRefs(Complaint, "student", User, "reference status createdAt"),
      shape: complaintRef
    },
    {
      id: "COMPLAINT_DUPLICATE_SUBMISSION",
      entity: "Complaint",
      category: "DUPLICATE_RECORDS",
      severity: "LOW",
      title: "The same complaint submitted twice within minutes",
      detail: `Same student, identical description, filed within ${DUPLICATE_WINDOW_MINUTES} minutes of each other.`,
      run: duplicateSubmissions,
      shape: (row) => ({ ...complaintRef(row), duplicateOf: row.duplicateOf })
    },
    {
      id: "INCIDENT_MISSING_COMPLAINTS",
      entity: "Incident",
      category: "BROKEN_RELATIONSHIP",
      severity: "MEDIUM",
      title: "Incidents that list complaints which no longer exist",
      detail: "At least one id in the incident's complaints array matches no complaint.",
      run: async () => {
        const incidents = await Incident.find({ "complaints.0": { $exists: true } }).select("reference status complaints").lean();
        const ids = [...new Set(incidents.flatMap((row) => row.complaints.map(String)))];
        const live = new Set((await Complaint.find({ _id: { $in: ids } }).select("_id").lean()).map((row) => String(row._id)));
        return incidents
          .map((row) => ({ ...row, missing: row.complaints.filter((id) => !live.has(String(id))).length }))
          .filter((row) => row.missing > 0);
      },
      shape: (row) => ({ id: String(row._id), reference: row.reference, status: row.status, missingComplaints: row.missing })
    },
    {
      id: "ATTENDANCE_ATTENDED_EXCEEDS_HELD",
      entity: "Attendance",
      category: "DATA_INCONSISTENCY",
      severity: "HIGH",
      title: "Attendance records with more classes attended than held",
      detail: "attendedClasses is greater than totalClasses.",
      run: () => Attendance.find({ $expr: { $gt: ["$attendedClasses", "$totalClasses"] } }).select("subject subjectCode attendedClasses totalClasses").lean(),
      shape: (row) => ({ id: String(row._id), reference: row.subjectCode || row.subject, attended: row.attendedClasses, held: row.totalClasses })
    }
  ];

  const results = [];
  for (const check of checks) {
    try {
      const rows = await check.run();
      results.push({
        id: check.id,
        entity: check.entity,
        category: check.category,
        severity: check.severity,
        title: check.title,
        detail: check.detail,
        count: rows.length,
        records: rows.slice(0, SAMPLE).map(check.shape),
        truncated: rows.length > SAMPLE
      });
    } catch (error) {
      // One failing query never hides the rest of the report.
      results.push({ id: check.id, entity: check.entity, title: check.title, error: error.message, count: null, records: [] });
    }
  }

  const failing = results.filter((row) => row.count > 0);
  return {
    checksRun: results.length,
    checksFailing: failing.length,
    issuesFound: failing.reduce((sum, row) => sum + row.count, 0),
    findings: failing,
    passed: results.filter((row) => row.count === 0).map((row) => ({ id: row.id, title: row.title })),
    errored: results.filter((row) => row.error),
    method: "RULE_BASED_INTEGRITY_CHECKS",
    governance: "Read-only. The guardian reports; it never modifies, repairs or deletes a record."
  };
}
