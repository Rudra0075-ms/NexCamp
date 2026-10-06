import { asyncHandler } from "../../utils/asyncHandler.js";
import { created, ok } from "../../utils/respond.js";
import { assetHistory } from "../../services/xo/assetService.js";
import { falseClosures, incidentReopenSignals } from "../../services/xo/closureService.js";
import { followIncident, incidentFollowers, myFollows, similarOpenIncident } from "../../services/xo/deflectionService.js";
import { allEtas, complaintEta, documentEta, gatePassEta } from "../../services/xo/etaService.js";
import { boardImpact } from "../../services/xo/impactService.js";
import { frictionLedger, mySavings, publicFrictionMap } from "../../services/xo/ledgerService.js";

const clampDays = (v, d = 30, max = 365) => Math.min(max, Math.max(1, Number(v) || d));

// Phase 3 — Friction Ledger
export const ledger = asyncHandler(async (req, res) => ok(res, await frictionLedger({ days: clampDays(req.query.days) })));
export const ledgerPublic = asyncHandler(async (req, res) => ok(res, await publicFrictionMap({ days: clampDays(req.query.days) })));
export const ledgerMine = asyncHandler(async (req, res) => ok(res, await mySavings(req.user)));
export const impact = asyncHandler(async (req, res) => ok(res, await boardImpact({ hostel: req.query.hostel })));

// Phase 4 — report smarter
export const similar = asyncHandler(async (req, res) => ok(res, await similarOpenIncident(req.user, req.body)));
export const follow = asyncHandler(async (req, res) => created(res, await followIncident(req.user, req.params.id, req.body), "You are following this incident"));
export const follows = asyncHandler(async (req, res) => ok(res, await myFollows(req.user)));
export const eta = asyncHandler(async (req, res) => {
  const type = String(req.query.type || "all");
  if (type === "complaint") return ok(res, await complaintEta({ department: req.query.department, category: req.query.category }));
  if (type === "document") return ok(res, await documentEta({ type: String(req.query.docType || "BONAFIDE").toUpperCase() }));
  if (type === "gatepass") return ok(res, await gatePassEta());
  return ok(res, await allEtas());
});
export const closures = asyncHandler(async (req, res) => ok(res, await falseClosures({ days: clampDays(req.query.days, 180) })));
export const incidentSignals = asyncHandler(async (_req, res) => ok(res, { ...(await incidentReopenSignals()), followers: await incidentFollowers() }));
export const assets = asyncHandler(async (req, res) => ok(res, await assetHistory({ buildingCode: req.query.building })));
