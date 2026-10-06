import {
  ALL_ROLES,
  CATEGORIES,
  COMPLAINT_STATUS,
  DECISIONS,
  DEPARTMENTS,
  DUPLICATE_DECISIONS,
  INCIDENT_STATUS,
  INTERVENTION_STATUS,
  PRIORITIES,
  SEVERITIES,
  TIMELINE_KINDS
} from "../config/constants.js";
import {
  arrayOf,
  boolean,
  digits,
  email,
  integer,
  isoDate,
  number,
  objectId,
  oneOf,
  optional,
  password,
  required,
  schema,
  string
} from "./rules.js";

export const registerSchema = schema({
  name: [required, string(120)],
  email: [required, email],
  password: [required, password],
  role: [optional, oneOf(ALL_ROLES)],
  studentId: [optional, string(40)],
  department: [optional, string(120)],
  course: [optional, string(120)],
  semester: [optional, integer(1, 12)],
  hostelCode: [optional, string(20)],
  room: [optional, string(20)],
  phone: [optional, string(20)]
});

export const loginSchema = schema({
  email: [required, email],
  password: [required, string(200)]
});

export const createComplaintSchema = schema({
  title: [required, string(160)],
  description: [required, string(2000)],
  category: [optional, oneOf(CATEGORIES)],
  subCategory: [optional, string(80)],
  location: [optional, string(160)],
  buildingCode: [optional, string(20)],
  building: [optional, objectId]
});

export const updateComplaintSchema = schema({
  status: [optional, oneOf(COMPLAINT_STATUS)],
  priority: [optional, oneOf(PRIORITIES)],
  severity: [optional, oneOf(SEVERITIES)],
  department: [optional, oneOf(DEPARTMENTS)],
  assignedTo: [optional, objectId],
  resolutionDescription: [optional, string(1000)],
  studentSatisfaction: [optional, number(0, 100)],
  recurrence: [optional, string(200)]
});

export const createIncidentSchema = schema({
  title: [required, string(200)],
  description: [optional, string(2000)],
  category: [required, oneOf(CATEGORIES)],
  buildingCode: [optional, string(20)],
  building: [optional, objectId],
  complaints: [optional, arrayOf(objectId, 200)],
  risk: [optional, number(0, 100)],
  affectedStudents: [optional, integer(0, 100000)]
});

export const updateIncidentSchema = schema({
  status: [optional, oneOf(INCIDENT_STATUS)],
  risk: [optional, number(0, 100)],
  severity: [optional, oneOf(SEVERITIES)],
  confidence: [optional, number(0, 100)],
  predictedImpact: [optional, string(300)],
  affectedStudents: [optional, integer(0, 100000)],
  resolutionDescription: [optional, string(1000)],
  studentSatisfaction: [optional, number(0, 100)],
  recurrence: [optional, string(200)]
});

export const clusterSchema = schema({
  buildingCode: [optional, string(20)],
  category: [optional, oneOf(CATEGORIES)],
  windowDays: [optional, integer(1, 120)],
  threshold: [optional, number(0, 1)],
  commit: [optional, boolean]
});

export const createAttendanceSchema = schema({
  student: [optional, objectId],
  studentId: [optional, string(40)],
  subject: [required, string(120)],
  subjectCode: [optional, string(20)],
  semester: [optional, integer(1, 12)],
  totalClasses: [required, integer(0, 1000)],
  attendedClasses: [required, integer(0, 1000)]
});

export const updateAttendanceSchema = schema({
  totalClasses: [optional, integer(0, 1000)],
  attendedClasses: [optional, integer(0, 1000)],
  present: [optional, boolean],
  date: [optional, isoDate],
  slot: [optional, string(20)]
});

export const simulateAttendanceSchema = schema({
  attendedClasses: [optional, integer(0, 5000)],
  totalClasses: [optional, integer(0, 5000)],
  plannedClasses: [optional, integer(0, 500)],
  attendPlanned: [optional, integer(0, 500)],
  threshold: [optional, number(0, 100)],
  subject: [optional, string(80)]
});

export const createInterventionSchema = schema({
  incident: [required, objectId],
  recommendedAction: [optional, string(400)],
  priority: [optional, oneOf(PRIORITIES)],
  estimatedResolutionHours: [optional, number(0, 720)],
  owner: [optional, oneOf(DEPARTMENTS)]
});

export const updateInterventionSchema = schema({
  status: [optional, oneOf(INTERVENTION_STATUS)],
  recommendedAction: [optional, string(400)],
  priority: [optional, oneOf(PRIORITIES)],
  estimatedResolutionHours: [optional, number(0, 720)],
  owner: [optional, oneOf(DEPARTMENTS)],
  resolutionTimeHours: [optional, number(0, 720)],
  studentSatisfaction: [optional, number(0, 100)],
  recurrence: [optional, string(200)]
});

export const decisionSchema = schema({
  decision: [required, oneOf(DECISIONS)],
  reason: [optional, string(400)],
  modifiedAction: [optional, string(400)],
  modifiedWindowHours: [optional, number(0, 720)]
});

export const simulateInterventionSchema = schema({
  incident: [optional, objectId],
  scenario: [optional, oneOf(["DO_NOTHING", "REPAIR_NOW", "DELAY_24H", "CUSTOM"])],
  delayHours: [optional, number(0, 720)],
  currentRisk: [optional, number(0, 100)],
  affectedStudents: [optional, integer(0, 100000)]
});

export const querySchema = schema({
  question: [required, string(300)]
});

export const studentQuerySchema = schema({
  question: [required, string(300)],
  domain: [optional, oneOf(["ATTENDANCE", "MESS"])]
});

export const createMessSchema = schema({
  date: [optional, isoDate],
  time: [required, string(10)],
  meal: [required, oneOf(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"])],
  crowd: [required, integer(0, 100000)],
  capacity: [optional, integer(1, 100000)],
  waste: [optional, number(0, 100)],
  queueMinutes: [optional, number(0, 600)]
});

const MEALS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];

export const messSimulateSchema = schema({
  meal: [optional, oneOf(MEALS)],
  date: [optional, isoDate],
  expectedDiners: [optional, integer(0, 20000)],
  attendanceChange: [optional, integer(-20000, 20000)],
  attendanceChangePct: [optional, number(-90, 200)],
  preparedCovers: [optional, integer(0, 20000)],
  item: [optional, string(80)],
  selectionShiftPct: [optional, number(-100, 300)]
});

export const messFeedbackSchema = schema({
  meal: [required, oneOf(MEALS)],
  rating: [required, integer(1, 5)],
  comment: [optional, string(500)],
  date: [optional, isoDate]
});

export const idParamSchema = schema({
  id: [required, objectId]
});

// ---- gate pass ------------------------------------------------------------

export const createGatePassSchema = schema({
  date: [optional, isoDate],
  reason: [required, string(500)],
  destination: [optional, string(200)],
  leaveAt: [required, isoDate],
  expectedReturnAt: [required, isoDate],
  parentName: [optional, string(120)],
  parentPhone: [optional, string(20)]
});

export const verifyOtpSchema = schema({
  code: [required, digits(4, 8)]
});

export const gatePassDecisionSchema = schema({
  note: [optional, string(400)],
  expectedReturnAt: [optional, isoDate]
});

export const scanGatePassSchema = schema({
  token: [required, string(300)]
});

// ---- AI layer -------------------------------------------------------------

export const routingDecisionSchema = schema({
  department: [optional, oneOf(DEPARTMENTS)],
  note: [optional, string(400)]
});

export const duplicateReviewSchema = schema({
  decision: [required, oneOf(DUPLICATE_DECISIONS)],
  relatedId: [optional, objectId],
  note: [optional, string(400)]
});

export const copilotSchema = schema({
  question: [required, string(400)]
});

export const aiWindowSchema = schema({
  days: [optional, integer(1, 365)],
  limit: [optional, integer(1, 50)]
});

export const timelineParamSchema = schema({
  kind: [required, oneOf(TIMELINE_KINDS)],
  id: [required, objectId]
});

// ---- operational intelligence ------------------------------------------------

export const feedbackSchema = schema({
  rating: [required, integer(1, 5)],
  comment: [optional, string(500)]
});

export const simulationSchema = schema({
  increasePct: [required, number(-90, 500)],
  windowDays: [optional, integer(7, 120)],
  horizonDays: [optional, integer(1, 90)]
});

// ---- early warning actions and assisted access --------------------------------

export const alertActionSchema = schema({
  key: [required, string(160)],
  action: [required, oneOf(["ACKNOWLEDGE", "INVESTIGATE", "ASSIGN", "ESCALATE", "RESOLVE"])],
  department: [optional, oneOf(DEPARTMENTS)],
  note: [optional, string(400)],
  tier: [optional, oneOf(["CRITICAL", "WARNING", "WATCH", "NORMAL"])],
  complaintIds: [optional, arrayOf(objectId, 100)]
});

export const whyQuerySchema = schema({
  metric: [required, oneOf(["complaints", "maintenance", "messRating", "messWaste", "attendance", "gatePass", "resolution"])]
});

export const kioskLookupSchema = schema({
  studentId: [required, string(40)]
});

export const importPreviewSchema = schema({
  csv: [required, string(200000)]
});
