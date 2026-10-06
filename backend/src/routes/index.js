import { Router } from "express";
import adminRoutes from "./adminRoutes.js";
import aiRoutes from "./aiRoutes.js";
import attendanceRoutes from "./attendanceRoutes.js";
import authRoutes from "./authRoutes.js";
import { buildingRouter, campusRouter } from "./campusRoutes.js";
import complaintRoutes from "./complaintRoutes.js";
import demoRoutes from "./demoRoutes.js";
import gatePassRoutes from "./gatePassRoutes.js";
import incidentRoutes from "./incidentRoutes.js";
import kioskRoutes from "./kioskRoutes.js";
import intelligenceRoutes from "./intelligenceRoutes.js";
import interventionRoutes from "./interventionRoutes.js";
import memoryRoutes from "./memoryRoutes.js";
import messRoutes from "./messRoutes.js";
import riskRoutes from "./riskRoutes.js";
import studentRoutes from "./studentRoutes.js";
// EXTENSION HOOK (see HOOKS.md): routes added by the PS07 extension pack.
import extRoutes from "./ext/index.js";
// EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): routes added by the Exception-Only Campus, all under /xo.
import xoRoutes from "./xo/index.js";
// ROUND-3 HOOK (see CHANGES-ROUND3.md): Prove / Optimise / Audit / Prevent routes.
import proofRoutes from "./proof/index.js";
// SUPPORT HOOK (see CHANGES-SILENT-SUPPORT.md): Silent Support System, all under /support.
import supportRoutes from "./support/index.js";
import resourceRoutes from "./resourceRoutes.js";

const router = Router();

router.get("/", (_req, res) =>
  res.json({
    success: true,
    data: {
      name: "NeX Camp API",
      version: "1.0.0",
      docs: "See backend/README.md for the full endpoint table"
    }
  })
);

router.use("/auth", authRoutes);
router.use("/students", studentRoutes);
router.use("/complaints", complaintRoutes);
router.use("/incidents", incidentRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/mess", messRoutes);
router.use("/campus", campusRouter);
router.use("/buildings", buildingRouter);
router.use("/risk", riskRoutes);
router.use("/interventions", interventionRoutes);
router.use("/memory", memoryRoutes);
router.use("/intelligence", intelligenceRoutes);
router.use("/gatepass", gatePassRoutes);
router.use("/ai", aiRoutes);
router.use("/admin", adminRoutes);
router.use("/kiosk", kioskRoutes);
router.use("/demo", demoRoutes);
// EXTENSION HOOK (see HOOKS.md): mounted after every existing router, on new paths only.
router.use(extRoutes);
// EXCEPTION-ONLY HOOK: mounted last, on the new /xo prefix only.
router.use("/xo", xoRoutes);
// ROUND-3 HOOK: mounted after every existing router; its paths match no existing route.
router.use(proofRoutes);
// SUPPORT HOOK: mounted last, on the new /support prefix only.
router.use("/support", supportRoutes);
// CAMPUS RESOURCE SHARING & HELP HUB: Student <-> Admin only
router.use("/resources", resourceRoutes);

export default router;
