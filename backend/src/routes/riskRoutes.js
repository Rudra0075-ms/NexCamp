import { Router } from "express";
import { buildingRisk, campusRisk, listAnomalies, listRisk } from "../controllers/riskController.js";

const router = Router();

router.get("/", listRisk);
router.get("/campus", campusRisk);
router.get("/anomalies", listAnomalies);
router.get("/building/:id", buildingRisk);

export default router;
