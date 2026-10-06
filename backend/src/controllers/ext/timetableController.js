import { asyncHandler } from "../../utils/asyncHandler.js";
import { created, ok } from "../../utils/respond.js";
import { Attendance } from "../../models/Attendance.js";
import {
  adjustedAttendance,
  answerDay,
  createChange,
  listChanges,
  listSchedules,
  parseQuestion,
  weekFor
} from "../../services/ext/timetableService.js";
import { createMenuChange, nextMeal, upcomingMenus } from "../../services/ext/messChangeService.js";

/** Timetable, class changes and mess menu changes (PS07 extension 1C). */

export const myWeek = asyncHandler(async (req, res) => ok(res, await weekFor(req.user)));

export const dayAnswer = asyncHandler(async (req, res) => ok(res, await answerDay(req.user, { day: req.query.day || "tomorrow", subject: req.query.subject })));

export const ask = asyncHandler(async (req, res) => {
  const subjects = await Attendance.distinct("subject", { student: req.user._id });
  const parsed = parseQuestion(req.body.question, subjects);
  const answer = await answerDay(req.user, { day: parsed.day, subject: parsed.subject || undefined });
  return ok(res, { ...answer, question: req.body.question, parsed, matcher: "KEYWORD_DAY_AND_SUBJECT" });
});

export const myAdjustedAttendance = asyncHandler(async (req, res) => ok(res, await adjustedAttendance(req.user)));

export const schedules = asyncHandler(async (_req, res) => ok(res, { schedules: await listSchedules() }));

export const changes = asyncHandler(async (_req, res) => ok(res, { changes: await listChanges() }));

export const createClassChange = asyncHandler(async (req, res) => created(res, await createChange(req.user, req.body), "Class change recorded and notified"));

export const menus = asyncHandler(async (_req, res) => ok(res, await upcomingMenus()));

export const next = asyncHandler(async (_req, res) => ok(res, await nextMeal()));

export const createMenu = asyncHandler(async (req, res) => created(res, await createMenuChange(req.user, req.body), "Menu change recorded and notified"));
