import { Router } from "express";
import { getMatches, listMemory } from "../controllers/memoryController.js";

const router = Router();

router.get("/", listMemory);
router.get("/matches", getMatches);

export default router;
