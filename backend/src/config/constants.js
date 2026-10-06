export const ROLES = {
  STUDENT: "STUDENT",
  ADMIN: "ADMIN",
  WARDEN: "WARDEN",
  FACILITY_MANAGER: "FACILITY_MANAGER",
  MESS_MANAGER: "MESS_MANAGER",
  COUNSELLOR: "COUNSELLOR"
};

export const ALL_ROLES = Object.values(ROLES);

// Anything that may act on campus-wide intelligence, not just their own records.
export const STAFF_ROLES = [
  ROLES.ADMIN,
  ROLES.WARDEN,
  ROLES.FACILITY_MANAGER,
  ROLES.MESS_MANAGER,
  ROLES.COUNSELLOR
];

export const COMPLAINT_STATUS = [
  "PENDING",
  "CLASSIFIED",
  "ASSIGNED",
  "INVESTIGATING",
  "RESOLVED",
  "REJECTED"
];

export const INCIDENT_STATUS = [
  "DETECTED",
  "CLUSTERED",
  "INVESTIGATING",
  "PREDICTED",
  "INTERVENTION",
  "RESOLVED"
];

export const RISK_LEVELS = [
  "LOW",
  "EMERGING",
  "ELEVATED",
  "HIGH",
  "CRITICAL",
  "MITIGATED"
];

export const CATEGORIES = [
  "WATER",
  "ELECTRICITY",
  "WI-FI",
  "CLEANLINESS",
  "MESS",
  "SAFETY",
  "ATTENDANCE",
  "HEALTH",
  "OTHER"
];

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const SEVERITIES = ["MINOR", "MODERATE", "MAJOR", "CRITICAL"];

export const DEPARTMENTS = [
  "MAINTENANCE · PLUMBING",
  "MAINTENANCE · ELECTRICAL",
  "IT · NETWORK",
  "HOUSEKEEPING",
  "MESS ADMINISTRATION",
  "SECURITY",
  "ACADEMIC OFFICE",
  "MEDICAL CENTRE",
  "GENERAL ADMINISTRATION"
];

export const INTERVENTION_STATUS = [
  "RECOMMENDED",
  "ACCEPTED",
  "MODIFIED",
  "REJECTED",
  "IN_PROGRESS",
  "COMPLETED"
];

export const DECISIONS = ["ACCEPT", "MODIFY", "REJECT"];

// The frontend labels every figure with its provenance; the backend decides it.
export const PROVENANCE = {
  ACTUAL: "ACTUAL DATA",
  PREDICTION: "AI PREDICTION",
  RECOMMENDATION: "AI RECOMMENDATION",
  EVIDENCE: "EVIDENCE"
};

export const ATTENDANCE_THRESHOLD = 75;

// ---- gate pass ------------------------------------------------------------
// The lifecycle a hostel gate pass moves through. Every transition is decided
// by the backend; the frontend only ever renders whichever value it is given.
export const GATE_PASS_STATUS = [
  "PENDING_PARENT_VERIFICATION",
  "PARENT_VERIFIED",
  "PENDING_WARDEN_APPROVAL",
  "APPROVED",
  "REJECTED",
  "ACTIVE",
  "RETURNED",
  "RETURNED_LATE",
  "OVERDUE",
  "CANCELLED"
];

// Terminal states: nothing sweeps or re-scans a pass once it reaches one.
export const GATE_PASS_CLOSED_STATUS = ["RETURNED", "RETURNED_LATE", "REJECTED", "CANCELLED"];

// Only these may approve or reject a pass. A student never can — not even
// their own, which is enforced in the route layer as well as the controller.
export const GATE_PASS_APPROVER_ROLES = [ROLES.WARDEN, ROLES.ADMIN];

export const NOTIFICATION_AUDIENCES = ["STUDENT", "PARENT", "WARDEN", "ADMIN"];
export const NOTIFICATION_CHANNELS = ["IN_APP", "SMS"];
export const NOTIFICATION_KINDS = [
  "GATE_PASS_OTP",
  "GATE_PASS_SUBMITTED",
  "GATE_PASS_APPROVED",
  "GATE_PASS_REJECTED",
  "GATE_PASS_ACTIVE",
  "GATE_PASS_EXPIRY_WARNING",
  "GATE_PASS_OVERDUE",
  "GATE_PASS_RETURNED",
  // Raised by the complaint escalation path. Added to the existing enum rather
  // than given their own collection, so the notification surfaces that already
  // exist pick them up with no change.
  "COMPLAINT_ESCALATED",
  "COMPLAINT_ASSIGNED",
  // Tells the author their complaint was closed, and invites a rating.
  "COMPLAINT_RESOLVED"
];

// How long before the approved return time the "please head back" warning fires.
export const GATE_PASS_WARNING_MINUTES = 5;

// ---- AI layer -------------------------------------------------------------
// How a value in an AI response was actually produced. The frontend renders
// this verbatim so a rule-based answer is never dressed up as a model output.
export const AI_SOURCES = {
  // A configured provider answered and its output passed validation.
  MODEL: "AI_MODEL",
  // A provider is configured but the call failed, timed out, or returned
  // something that did not validate. The deterministic services answered.
  FALLBACK: "DETERMINISTIC_FALLBACK",
  // No AI_PROVIDER / AI_API_KEY / AI_MODEL is configured at all.
  NOT_CONFIGURED: "AI_NOT_CONFIGURED"
};

export const AI_SOURCE_VALUES = Object.values(AI_SOURCES);

// The deterministic method label the pre-existing services already return. Kept
// here so the AI layer can echo the same vocabulary.
export const AI_FALLBACK_METHOD = "RULE_BASED_KEYWORD_MATCH";

export const NOTIFICATION_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"];

// Where a notification's priority came from. Same honesty rule as AI_SOURCES.
export const NOTIFICATION_PRIORITY_SOURCES = ["SAFETY_RULE", "RULE_BASED", "AI_MODEL"];

// Complaint wording that must never depend on a model to be taken seriously.
// Matching any of these forces CRITICAL and immediate escalation, whether or
// not an AI provider is configured or agrees.
export const SAFETY_CRITICAL_PATTERNS = [
  { id: "FIRE", terms: ["fire", "burning", "smoke", "flames"], label: "fire or smoke reported" },
  { id: "ELECTRICAL_ARC", terms: ["spark", "sparks", "sparking", "short circuit", "shock", "electrocut"], label: "live electrical hazard reported" },
  { id: "GAS", terms: ["gas leak", "lpg leak", "gas smell", "smell of gas"], label: "gas leak reported" },
  { id: "STRUCTURAL", terms: ["collapse", "collapsed", "ceiling fell", "wall crack", "falling"], label: "structural failure reported" },
  { id: "MEDICAL", terms: ["unconscious", "bleeding", "ambulance", "emergency", "fainted", "chest pain"], label: "medical emergency reported" },
  { id: "VIOLENCE", terms: ["ragging", "assault", "harassment", "threat", "molest", "beaten"], label: "personal-safety incident reported" },
  { id: "DROWN_FLOOD", terms: ["flooded", "flooding", "knee deep", "submerged"], label: "flooding reported" }
];

// A complaint's route may be changed by a human. Both the recommendation and
// the final value are kept, so the audit answers "who overrode the AI, and when".
export const ROUTING_DECISIONS = ["ACCEPTED", "MODIFIED"];

// What an administrator decided about a suspected duplicate. Nothing is ever
// deleted automatically — these are the only two outcomes.
export const DUPLICATE_DECISIONS = ["LINKED", "SEPARATE"];

// Entities the tamper-evident audit chain records actions against.
export const AUDIT_ENTITIES = ["Complaint", "GatePass", "Incident", "Intervention", "User", "System"];
// EXTENSION HOOK (see HOOKS.md): entity types written by the PS07 extension pack.
AUDIT_ENTITIES.push("Notice", "DocumentRequest", "ClassChange", "MenuChange", "FeeAccount", "FrictionBaseline", "SmsMessage", "FixProof", "ReopenRequest", "PolicySection");
// EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): entity types written by the Exception-Only Campus.
AUDIT_ENTITIES.push("CampusEvent", "PolicyRule", "ServiceBooking", "ChangeEvent", "ImportBatch", "Asset", "PolicySimulation", "StaffPhone", "SmsOutbox");

// The universal request timeline (see services/timelineService.js) understands
// these record kinds.
export const TIMELINE_KINDS = ["complaint", "gatepass"];

// ---- Silent Support System (see CHANGES-SILENT-SUPPORT.md) -----------------
// SUPPORT HOOK: one narrow role for the student support team. Deliberately NOT
// added to STAFF_ROLES, so a counsellor gains no campus-wide staff access, and
// no existing staff role (admin included) can read an individual support case.
ROLES.COUNSELLOR = "COUNSELLOR";
ALL_ROLES.push(ROLES.COUNSELLOR);
// Who may open individual support cases. Admins see only the aggregate overview.
export const SUPPORT_TEAM_ROLES = [ROLES.COUNSELLOR];
export const SUPPORT_OVERVIEW_ROLES = [ROLES.COUNSELLOR, ROLES.ADMIN];

// Support-routing categories. These are NOT diagnoses: they decide who is
// offered to the student and how soon a person reaches out.
export const SUPPORT_BANDS = ["STABLE", "COULD_BENEFIT", "SUPPORT_RECOMMENDED", "IMMEDIATE_ATTENTION"];
export const SUPPORT_BAND_LABELS = {
  STABLE: "Stable",
  COULD_BENEFIT: "Could benefit from support",
  SUPPORT_RECOMMENDED: "Support recommended",
  IMMEDIATE_ATTENTION: "Immediate human attention required"
};
// Request Created → Support Team Assigned → Contacted → Follow-up → Resolved.
export const SUPPORT_STATUS = ["REQUESTED", "ASSIGNED", "CONTACTED", "FOLLOW_UP", "RESOLVED", "WITHDRAWN"];
export const SUPPORT_CLOSED_STATUS = ["RESOLVED", "WITHDRAWN"];
export const SUPPORT_PREFERENCES = ["COUNSELLOR", "MENTOR", "PRIVATE_CONVERSATION", "ANONYMOUS", "CHECK_LATER", "URGENT"];
export const SUPPORT_ORIGINS = ["STUDENT_REQUEST", "CHECK_ON_ME_LATER", "SAFETY_SIGNAL"];
export const SUPPORT_OUTCOMES = ["SUPPORT_COMPLETED", "REFERRED_TO_PROFESSIONAL", "STUDENT_DECLINED", "NO_RESPONSE"];
export const SUPPORT_CONTACT_TIMES = ["ANY", "MORNING", "AFTERNOON", "EVENING"];
export const SUPPORT_NOTIFICATION_KINDS = ["SUPPORT_REQUEST_RECEIVED", "SUPPORT_REQUEST_NEW", "SUPPORT_STATUS_UPDATE", "SUPPORT_FOLLOW_UP_DUE"];
NOTIFICATION_AUDIENCES.push("SUPPORT_TEAM");
NOTIFICATION_KINDS.push(...SUPPORT_NOTIFICATION_KINDS);

// ---- Campus Resource Sharing & Help Hub (Student <-> Admin Only) ----
export const RESOURCE_CATEGORIES = [
  "ACADEMIC",
  "QUESTIONS",
  "STUDY_MATERIAL",
  "DOCUMENTS",
  "EVENTS",
  "CLUBS",
  "CAMPUS_HELP",
  "OPEN_RESOURCES",
  "OTHER"
];
export const RESOURCE_TYPES = ["FILE", "LINK", "NOTICE"];
export const RESOURCE_STATUS = ["APPROVED", "REJECTED", "FLAGGED"];
AUDIT_ENTITIES.push("Resource");

