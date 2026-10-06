import { PRIORITIES } from "../config/constants.js";
import { AlertState } from "../models/AlertState.js";
import { Complaint } from "../models/Complaint.js";
import { record as recordAudit } from "../services/auditChainService.js";
import { earlyWarning, predictiveInsights, pulse, why } from "../services/earlyWarningService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";

// Mission Control reads these together; a short cache keeps a refresh cheap
// without letting an operator's own action look ignored (every action clears it).
const cache = new Map();
const TTL = 15000;

async function cached(key, compute) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await compute();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export const clearEarlyWarningCache = () => cache.clear();

/** GET /api/ai/early-warning — tiered alerts, cross-module trends, recurring intelligence. */
export const getEarlyWarning = asyncHandler(async (_req, res) => ok(res, await cached("ew", () => earlyWarning())));

/** GET /api/ai/predictive — predictions with data used, horizon, confidence and action. */
export const getPredictive = asyncHandler(async (_req, res) => ok(res, await cached("pi", () => predictiveInsights())));

/** GET /api/ai/pulse — the Campus Pulse indicator with its calculation. */
export const getPulse = asyncHandler(async (_req, res) => ok(res, await cached("pulse", () => pulse())));

/** GET /api/ai/why?metric=… — the evidence behind one graph. */
export const getWhy = asyncHandler(async (req, res) => {
  const answer = await cached(`why:${req.query.metric}`, () => why(req.query.metric));
  if (!answer) throw ApiError.notFound("Unknown metric");
  return ok(res, answer);
});

const STATUS_FOR = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  INVESTIGATE: "INVESTIGATING",
  ASSIGN: "ASSIGNED",
  ESCALATE: "ESCALATED",
  RESOLVE: "RESOLVED"
};

/**
 * POST /api/ai/early-warning/act
 *
 * Acts on an alert through the existing complaint workflow: the linked
 * complaints get the same field changes, complaint-audit lines and hash-chained
 * audit entries a manual update would. RESOLVE closes the alert only — each
 * complaint is still resolved through its own review, never in bulk.
 */
export const actOnAlert = asyncHandler(async (req, res) => {
  const { key, action, department, note, tier, complaintIds = [] } = req.body;
  if (action === "ASSIGN" && !department) throw ApiError.badRequest("Choose a department to assign");

  const complaints = complaintIds.length
    ? await Complaint.find({ _id: { $in: complaintIds }, status: { $ne: "RESOLVED" } })
    : [];

  let touched = 0;
  if (action !== "RESOLVE" && action !== "ACKNOWLEDGE") {
    for (const complaint of complaints) {
      const before = { status: complaint.status, priority: complaint.priority, department: complaint.department };
      let field;
      let from;
      let to;
      if (action === "INVESTIGATE" && complaint.status !== "INVESTIGATING") {
        complaint.status = "INVESTIGATING";
        [field, from, to] = ["status", before.status, "INVESTIGATING"];
      } else if (action === "ASSIGN") {
        complaint.department = department;
        if (["PENDING", "CLASSIFIED"].includes(complaint.status)) complaint.status = "ASSIGNED";
        [field, from, to] = ["department", before.department || "", department];
      } else if (action === "ESCALATE") {
        const next = PRIORITIES[Math.min(PRIORITIES.length - 1, PRIORITIES.indexOf(complaint.priority) + 1)];
        if (next !== complaint.priority) {
          complaint.priority = next;
          [field, from, to] = ["priority", before.priority, next];
        }
      }
      if (!field) continue;
      complaint.audit.push({
        actor: req.user.name,
        message: `${action === "ASSIGN" ? `Assigned to ${department}` : action === "ESCALATE" ? `Escalated to ${to}` : "Moved to INVESTIGATING"} from early-warning alert ${key}${note ? ` — ${note}` : ""}`,
        kind: "ACTUAL DATA"
      });
      await complaint.save();
      touched += 1;
      await recordAudit({
        entityType: "Complaint",
        entityId: complaint._id,
        entityRef: complaint.reference,
        action: `ALERT_${action}`,
        field,
        previousValue: String(from ?? ""),
        newValue: String(to ?? ""),
        actor: req.user,
        note: `Early-warning alert ${key}`.slice(0, 400)
      });
    }
  }

  const state = await AlertState.findOneAndUpdate(
    { key },
    {
      $set: {
        status: STATUS_FOR[action],
        ...(department ? { department } : {}),
        ...(note ? { note } : {}),
        ...(tier ? { tierAtAction: tier } : {}),
        by: req.user._id,
        byName: req.user.name
      },
      $push: { history: { action, byName: req.user.name, note, complaintsTouched: touched } }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  ).lean();

  await recordAudit({
    entityType: "System",
    entityId: String(state._id),
    entityRef: key,
    action: `ALERT_${action}`,
    field: "status",
    previousValue: "",
    newValue: state.status,
    actor: req.user,
    note: `${touched} linked complaint(s) updated${note ? ` · ${note}` : ""}`.slice(0, 400)
  });

  clearEarlyWarningCache();
  return ok(
    res,
    { key, status: state.status, complaintsTouched: touched, history: state.history },
    action === "RESOLVE"
      ? "Alert closed. Linked complaints stay open until each is resolved through its own review."
      : `${STATUS_FOR[action].toLowerCase()} · ${touched} linked complaint(s) updated`
  );
});
