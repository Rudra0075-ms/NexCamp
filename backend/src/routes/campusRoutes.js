import { Router } from "express";
import { getBuilding, getCampus, listBuildings } from "../controllers/campusController.js";

// The campus map is the landing surface, so these reads are public.
const campusRouter = Router();
campusRouter.get("/", getCampus);

const buildingRouter = Router();
buildingRouter.get("/", listBuildings);
buildingRouter.get("/:id", getBuilding);

export { campusRouter, buildingRouter };
