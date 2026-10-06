import { MessRecord } from "../../models/MessRecord.js";
import { MenuChange } from "../../models/ext/MenuChange.js";
import { nextReference } from "../../models/ext/common.js";
import { ApiError } from "../../utils/ApiError.js";
import { audit } from "./extAudit.js";
import { istDateKey, istInstant, istParts, isValidDateKey, weekdayOf } from "./istTime.js";
import { createNotice } from "./noticeService.js";
import { prettyDate } from "./timetableService.js";
import { emitEvent } from "../xo/eventService.js"; // EXCEPTION-ONLY HOOK

/**
 * Mess menu changes and "what is the next meal?".
 *
 * The planned menu is read from the existing mess register (MessRecord) — the
 * most recent record for the same meal on the same weekday, which is how the
 * weekly rotation is stored. A MenuChange replaces it for one date and is
 * announced through the Notice Center. The register itself is never written.
 */

export const MEALS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];

/** Serving windows, derived from the slot times the register holds. */
export async function mealWindows() {
  const rows = await MessRecord.aggregate([{ $group: { _id: "$meal", first: { $min: "$time" }, last: { $max: "$time" } } }]);
  const add30 = (t) => {
    const [h, m] = t.split(":").map(Number);
    const total = h * 60 + m + 30;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  return MEALS.map((meal) => {
    const row = rows.find((r) => r._id === meal);
    return row ? { meal, start: row.first, end: add30(row.last) } : null;
  }).filter(Boolean);
}

/** Pure: which meal is next (or being served) at IST time `now`. */
export function pickNextMeal(windows, now = new Date()) {
  const { hour, minute } = istParts(now);
  const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const today = istDateKey(now);
  const current = windows.find((w) => w.start <= hhmm && hhmm < w.end);
  if (current) return { ...current, date: today, serving: true };
  const later = windows.filter((w) => w.start > hhmm).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (later) return { ...later, date: today, serving: false };
  const first = [...windows].sort((a, b) => a.start.localeCompare(b.start))[0];
  return first ? { ...first, date: istDateKey(now, 1), serving: false } : null;
}

async function plannedMenu(dateKey, meal) {
  const weekday = weekdayOf(dateKey);
  const candidates = await MessRecord.find({ meal }).sort({ date: -1 }).limit(80).lean();
  const hit = candidates.find((r) => new Date(r.date).getDay() === weekday && r.menu?.length);
  if (!hit) return null;
  return { items: hit.menu.map((m) => m.item), fromDate: new Date(hit.date).toISOString().slice(0, 10), slot: hit.time };
}

export async function menuFor(dateKey, meal) {
  const [planned, change] = await Promise.all([plannedMenu(dateKey, meal), MenuChange.findOne({ date: dateKey, meal }).sort({ createdAt: -1 }).lean()]);
  return {
    date: dateKey,
    dateLabel: prettyDate(dateKey),
    meal,
    items: change ? change.items : planned?.items || [],
    changed: Boolean(change),
    change: change
      ? { reference: change.reference, replaces: change.replaces, reason: change.reason, byName: change.byName, noticeReference: change.noticeReference, at: change.createdAt }
      : null,
    planned: planned
      ? { items: planned.items, basis: `Weekly rotation from the mess register (same weekday, served ${planned.fromDate})`, kind: "ACTUAL DATA" }
      : { items: [], basis: "Insufficient data — no register record for this meal and weekday", kind: "INSUFFICIENT DATA" }
  };
}

export async function nextMeal(now = new Date()) {
  const windows = await mealWindows();
  const next = pickNextMeal(windows, now);
  if (!next) return { next: null, answer: "Insufficient data — the mess register has no meal slots.", method: "MESS_REGISTER_LOOKUP" };
  const menu = await menuFor(next.date, next.meal);
  return {
    next: { ...next, startsAt: istInstant(next.date, next.start) },
    menu,
    answer: `${next.serving ? "Now serving" : "Next"}: ${next.meal} ${next.date === istDateKey(now) ? "today" : "tomorrow"} ${next.start}–${next.end}${menu.items.length ? ` — ${menu.items.join(", ")}` : ""}${menu.changed ? ` (CHANGED: ${menu.change.reason || "see notice"})` : ""}.`,
    windows,
    method: "MESS_REGISTER_LOOKUP",
    source: "DETERMINISTIC",
    kind: "ACTUAL DATA"
  };
}

export async function upcomingMenus(now = new Date()) {
  const out = [];
  for (const offset of [0, 1]) for (const meal of MEALS) out.push(await menuFor(istDateKey(now, offset), meal));
  const changes = await MenuChange.find().sort({ createdAt: -1 }).limit(20).lean();
  return {
    menus: out,
    changes: changes.map((c) => ({ id: String(c._id), reference: c.reference, date: c.date, meal: c.meal, items: c.items, replaces: c.replaces, reason: c.reason, byName: c.byName, noticeReference: c.noticeReference, createdAt: c.createdAt })),
    method: "MESS_REGISTER_LOOKUP",
    kind: "ACTUAL DATA"
  };
}

export async function createMenuChange(actor, input, { now = new Date() } = {}) {
  if (!isValidDateKey(input.date)) throw ApiError.badRequest("date must be YYYY-MM-DD");
  if (!MEALS.includes(input.meal)) throw ApiError.badRequest(`meal must be one of ${MEALS.join(", ")}`);
  const current = await menuFor(input.date, input.meal);
  const change = new MenuChange({
    reference: await nextReference("MNU"),
    date: input.date,
    meal: input.meal,
    items: input.items,
    replaces: current.items,
    reason: input.reason,
    by: actor._id,
    byName: actor.name
  });
  const title = `${input.meal} menu changed — ${prettyDate(input.date)}`;
  const notice = await createNotice(
    {
      title,
      body: `${input.meal} on ${prettyDate(input.date)}: ${input.items.join(", ")}${current.items.length ? ` (was ${current.items.join(", ")})` : ""}.${input.reason ? ` Reason: ${input.reason}.` : ""}`,
      priority: "NORMAL",
      audience: { hostels: input.hostels || [], roles: ["STUDENT"] }
    },
    actor,
    { now, kind: "MENU_CHANGE", related: { kind: "MenuChange", id: String(change._id), reference: change.reference } }
  );
  change.notice = notice._id;
  change.noticeReference = notice.reference;
  await audit(change, { entityType: "MenuChange", action: "MENU_CHANGED", actor, note: `${input.meal} ${input.date} · notice ${notice.reference} → ${notice.reach} students` });
  await change.save();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: "MENU_CHANGED", actor, subjectType: "MenuChange", subjectId: change._id, subjectRef: change.reference, channel: "APP", department: "MESS ADMINISTRATION", payload: { date: input.date, meal: input.meal, items: input.items, replaces: current.items, hostels: input.hostels || [], notice: notice.reference, reach: notice.reach } });
  // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): propagate the change to everyone it affects.
  // Never fails the change itself: a propagation error is logged and the change stands.
  try {
    await (await import("../xo/changeService.js")).propagateMenuChange(change._id, actor);
  } catch (error) {
    console.error("changeService: propagation failed —", error.message);
  }
  return { change: { reference: change.reference, date: change.date, meal: change.meal, items: change.items, replaces: change.replaces }, notice: { reference: notice.reference, status: notice.status, reach: notice.reach } };
}
