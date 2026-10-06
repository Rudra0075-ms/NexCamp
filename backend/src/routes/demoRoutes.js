import { Router } from "express";
import { demoState, incidentStory } from "../controllers/demoController.js";

const router = Router();

router.get("/incident-story", incidentStory);
router.get("/state", demoState);

export default router;
