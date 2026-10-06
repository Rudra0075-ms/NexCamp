import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/respond.js";
import { myPointOfNoReturn, sectionAttendance } from "../../services/proof/attendanceProof.js";
import { serviceEquity } from "../../services/proof/equity.js";
import { interventionImpact, proofBadges } from "../../services/proof/impactProof.js";
import { lintNotice } from "../../services/proof/noticeLint.js";
import { portfolio } from "../../services/proof/portfolio.js";
import { previewChange } from "../../services/proof/preflight.js";
import { acceptSlot, myBestSlot, nudgeEffect, presenceForecast } from "../../services/proof/presenceForecast.js";
import { processMining } from "../../services/proof/processMining.js";
import { assetReliability } from "../../services/proof/reliability.js";
import { unblockPath } from "../../services/proof/unblock.js";

/**
 * Round 3 — Prove / Optimise / Audit / Prevent. Thin handlers: every number
 * comes from services/proof/*. Preview, lint, portfolio and forecast handlers
 * write nothing.
 */

// F1 — page 10
export const mining = asyncHandler(async (req, res) => ok(res, await processMining({ workflow: req.query.workflow || "complaint", days: req.query.days || 30 })));
// F2 — pages 09 and 20
export const impact = asyncHandler(async (req, res) => ok(res, await interventionImpact(req.params.id, { windowDays: req.query.window || 14 })));
export const badges = asyncHandler(async (_req, res) => ok(res, await proofBadges()));
// F3 — page 15
export const preflight = asyncHandler(async (req, res) => ok(res, await previewChange(req.body)));
// F4 — page 13
export const lint = asyncHandler(async (req, res) => ok(res, await lintNotice(req.body)));
// F5 — pages 04 and 02
export const presence = asyncHandler(async (req, res) => ok(res, { ...(await presenceForecast({ meal: req.query.meal, date: req.query.date })), nudges: await nudgeEffect() }));
export const bestSlot = asyncHandler(async (req, res) => ok(res, await myBestSlot(req.user, { meal: req.query.meal, date: req.query.date })));
export const acceptBestSlot = asyncHandler(async (req, res) => ok(res, await acceptSlot(req.user, req.body), "Noted — thank you"));
// F6 — page 03
export const pointOfNoReturn = asyncHandler(async (req, res) => ok(res, await myPointOfNoReturn(req.user)));
export const sections = asyncHandler(async (req, res) => ok(res, await sectionAttendance(req.user)));
// F7 — page 09
export const optimise = asyncHandler(async (req, res) => ok(res, await portfolio({ hours: req.body.hours ?? 24, trade: req.body.trade })));
// F8 — pages 21 and 10
export const equity = asyncHandler(async (req, res) => ok(res, await serviceEquity({ days: req.query.days || 365 })));
// F9 — page 17
export const unblock = asyncHandler(async (req, res) => ok(res, await unblockPath(req.user)));
// F10 — page 08
export const reliability = asyncHandler(async (req, res) => ok(res, await assetReliability({ buildingCode: req.query.building })));
