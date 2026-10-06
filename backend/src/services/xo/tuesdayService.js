import { STAFF_ROLES } from "../../config/constants.js";
import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { CampusEvent } from "../../models/xo/CampusEvent.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { compare } from "../ext/frictionService.js";
import { flushEvents } from "./eventService.js";
import { REQUEST_TYPES, baselineMap } from "./ledgerService.js";
import { funnel } from "./reachService.js";

/**
 * Phase 10 — the Tuesday Test. The browser runs four real errands against the
 * API with a stopwatch; this service turns the run into the Friction Ledger's
 * old-vs-new comparison. Nothing here is estimated that is not labelled:
 *
 *   time (this run)      MEASURED IN THIS DEMO — the browser's stopwatch
 *   old time / touches   BASELINE ESTIMATE / ASSUMPTION — the Friction Ledger's own old paths
 *   new touches          ACTUAL DATA — staff events on the subject in the Campus Event log
 *   new turnaround       ACTUAL DATA — request → outcome events for the subject, when both exist
 */

const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600000;

export async function tuesdayCompare(steps = []) {
  await flushEvents(); // events from the errands just run are written before they are counted
  const base = await compare(steps);
  const baselines = await baselineMap();
  const ids = steps.map((s) => s.subjectId).filter(Boolean);
  const events = ids.length ? await CampusEvent.find({ subjectId: { $in: ids } }).sort({ at: 1 }).lean() : [];
  const rows = base.rows.map((row, i) => {
    const step = steps[i];
    const old = baselines.get(row.workflow) || {};
    const mine = step.subjectId ? events.filter((e) => String(e.subjectId) === String(step.subjectId)) : [];
    const spec = step.subjectType ? REQUEST_TYPES[step.subjectType] : null;
    const start = spec ? mine.find((e) => spec.start.includes(e.type)) : null;
    const end = spec && start ? mine.find((e) => spec.end.includes(e.type) && new Date(e.at) >= new Date(start.at)) : null;
    const newTouches = step.subjectId ? mine.filter((e) => e.humanTouch).length : null;
    return {
      ...row,
      key: step.key || null,
      touches: {
        old: old.touches ?? null,
        oldKind: old.touches !== undefined ? "ASSUMPTION" : null,
        new: step.noStaffWork ? 0 : newTouches,
        newKind: step.noStaffWork ? "ACTUAL DATA" : newTouches === null ? null : "ACTUAL DATA",
        basis: step.noStaffWork ? "No request was filed for staff to handle (+1 on an open incident)." : step.subjectId ? "Staff events on this request in the Campus Event log (POLICY decisions are not a touch)." : "Nothing was filed — the answer came from records already there."
      },
      turnaround: {
        oldHours: old.hours ?? null,
        newHours: end ? round(hoursBetween(start.at, end.at), 3) : null,
        newKind: end ? "ACTUAL DATA" : null,
        note: end ? `${start.type} → ${end.type}` : step.subjectId ? "not finished yet — waiting on a person" : null
      }
    };
  });
  const touchesOld = rows.reduce((t, r) => t + (r.touches.old || 0), 0);
  const touchesNew = rows.reduce((t, r) => t + (r.touches.new || 0), 0);
  return { ...base, rows, totals: { ...base.totals, touchesOld, touchesNew }, method: "STOPWATCH_AND_EVENT_LOG_VS_BASELINE" };
}

/** A notice's reach funnel in counts only — for staff, or a student the notice was sent to. */
export async function reachSummary(user, noticeId) {
  const notice = await Notice.findById(noticeId).lean();
  if (!notice) throw ApiError.notFound("No notice with that id");
  if (!STAFF_ROLES.includes(user.role) && !(await NoticeReceipt.exists({ notice: notice._id, student: user._id }))) throw ApiError.forbidden("This notice was not sent to you");
  const receipts = await NoticeReceipt.find({ notice: notice._id }).select("deliveredAt readAt actionDoneAt acknowledgedAt channel").lean();
  return {
    notice: { id: String(notice._id), reference: notice.reference, title: notice.title, publishedAt: notice.publishedAt, reachTarget: notice.reachTarget || null },
    funnel: funnel(receipts),
    readVia: { APP: receipts.filter((r) => r.readAt && r.channel === "APP").length, SMS: receipts.filter((r) => r.readAt && r.channel === "SMS").length, KIOSK: receipts.filter((r) => r.readAt && r.channel === "KIOSK").length },
    note: "Counts only; the names of students not yet reached are shown to staff on page 13.",
    method: "NOTICE_RECEIPTS",
    kind: "ACTUAL DATA"
  };
}
