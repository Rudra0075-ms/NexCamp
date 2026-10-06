import { Complaint } from "../../models/Complaint.js";
import { GatePass } from "../../models/GatePass.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { round } from "../../utils/text.js";

/**
 * Honest ETAs (Phase 4): P50 and P80 completion time per request type and
 * department, from finished requests. Under MIN_SAMPLES finished requests the
 * answer is "Insufficient history" — never a guess.
 */

export const MIN_SAMPLES = 5;
const WINDOW_DAYS = 365;

/** Pure: the q-th percentile (0–1) by linear interpolation. */
export function percentile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Pure: an ETA verdict from finished durations (hours). */
export function etaFrom(hours, { label, scope } = {}) {
  const clean = hours.filter((h) => Number.isFinite(h) && h >= 0);
  if (clean.length < MIN_SAMPLES) {
    return { label, scope, samples: clean.length, p50Hours: null, p80Hours: null, kind: "INSUFFICIENT DATA", text: `Insufficient history — ${clean.length} finished ${clean.length === 1 ? "request" : "requests"} (need ${MIN_SAMPLES}).` };
  }
  const p50 = round(percentile(clean, 0.5), 1);
  const p80 = round(percentile(clean, 0.8), 1);
  return { label, scope, samples: clean.length, p50Hours: p50, p80Hours: p80, kind: "ACTUAL DATA", text: `Typically ${fmt(p50)}; 8 in 10 within ${fmt(p80)} (${clean.length} finished).` };
}

export const fmt = (h) => (h === null || h === undefined ? "—" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${round(h, 1)} h` : `${round(h / 24, 1)} days`);

const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600000;

/** ETA for complaints of a department (and, when there is enough, a category). */
export async function complaintEta({ department, category } = {}) {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const rows = await Complaint.find({ status: "RESOLVED", "resolution.resolvedAt": { $gte: since }, ...(department ? { department } : {}) }).select("category createdAt resolution.resolvedAt").lean();
  const all = rows.map((r) => hoursBetween(r.createdAt, r.resolution.resolvedAt));
  const same = category ? rows.filter((r) => r.category === category).map((r) => hoursBetween(r.createdAt, r.resolution.resolvedAt)) : [];
  if (same.length >= MIN_SAMPLES) return { ...etaFrom(same, { label: `${category} complaints · ${department || "all departments"}`, scope: "CATEGORY_AND_DEPARTMENT" }), method: "PERCENTILES_OF_FINISHED_REQUESTS" };
  return { ...etaFrom(all, { label: `Complaints · ${department || "all departments"}`, scope: department ? "DEPARTMENT" : "CAMPUS" }), method: "PERCENTILES_OF_FINISHED_REQUESTS" };
}

/** ETA for certificates, split by who decides (policy is near-instant; the office is not). */
export async function documentEta({ type = "BONAFIDE" } = {}) {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const rows = await DocumentRequest.find({ type, status: "ISSUED", "certificate.issuedAt": { $gte: since } }).select("decidedBy createdAt certificate.issuedAt").lean();
  const office = rows.filter((r) => r.decidedBy !== "POLICY").map((r) => hoursBetween(r.createdAt, r.certificate.issuedAt));
  const policy = rows.filter((r) => r.decidedBy === "POLICY").map((r) => hoursBetween(r.createdAt, r.certificate.issuedAt));
  return {
    type,
    office: etaFrom(office, { label: `${type.replace("_", " ")} · academic office`, scope: "HUMAN_PATH" }),
    policy: etaFrom(policy, { label: `${type.replace("_", " ")} · written policy`, scope: "POLICY_PATH" }),
    method: "PERCENTILES_OF_FINISHED_REQUESTS"
  };
}

export async function gatePassEta() {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const rows = await GatePass.find({ "approval.decidedAt": { $gte: since } }).select("decidedBy createdAt approval.decidedAt parent.verifiedAt").lean();
  const warden = rows.filter((r) => r.decidedBy !== "POLICY").map((r) => hoursBetween(r.parent?.verifiedAt || r.createdAt, r.approval.decidedAt));
  return { warden: etaFrom(warden, { label: "Gate pass · warden decision after guardian code", scope: "HUMAN_PATH" }), policy: { label: "Gate pass · §7.3 day outing", text: "Decided the moment the guardian code is verified.", kind: "ACTUAL DATA" }, method: "PERCENTILES_OF_FINISHED_REQUESTS" };
}

/** Every ETA a page may show, in one read. */
export async function allEtas() {
  const departments = await Complaint.distinct("department", { status: "RESOLVED" });
  const complaints = [];
  for (const d of departments.filter(Boolean).sort()) complaints.push({ department: d, ...(await complaintEta({ department: d })) });
  const documents = [];
  for (const t of ["BONAFIDE", "NO_DUES", "HOSTEL_RESIDENCE", "CHARACTER"]) documents.push(await documentEta({ type: t }));
  return { complaints, documents, gatePass: await gatePassEta(), minSamples: MIN_SAMPLES, windowDays: WINDOW_DAYS, method: "PERCENTILES_OF_FINISHED_REQUESTS", kind: "ACTUAL DATA" };
}
