import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import mongoose from "mongoose";
import { env, isProduction } from "./config/env.js";
import { ApiError } from "./utils/ApiError.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { sanitizeRequest } from "./middleware/sanitize.js";
import routes from "./routes/index.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // This API serves JSON to a separate origin; it renders no HTML of its own.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));

  // An explicit allow-list, never "*", because the frontend sends credentials.
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: curl, Postman, server-to-server. Not a browser, so
        // the cookie policy is not what is protecting us here.
        if (!origin) return callback(null, true);
        if (env.clientUrls.includes(origin)) return callback(null, true);
        return callback(ApiError.forbidden(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
    })
  );

  app.use(express.json({ limit: "200kb" }));
  app.use(express.urlencoded({ extended: true, limit: "200kb" }));
  app.use(cookieParser());
  app.use(sanitizeRequest);

  if (!isProduction) app.use(morgan("dev"));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 50000,
      skip: () => !isProduction,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { success: false, message: "Too many requests — slow down for a moment" }
    })
  );

  app.get("/", (_req, res) =>
    res.json({ success: true, message: "NeX Camp API is running", health: "/health" })
  );

  app.get("/health", (_req, res) =>
    res.json({
      success: true,
      data: {
        status: "ok",
        uptimeSeconds: Math.round(process.uptime()),
        database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        environment: env.nodeEnv
      }
    })
  );

  app.use("/api", routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}


// Vercel serverless entrypoint.
// Vercel invokes the default export as the HTTP handler.
let vercelApp;
export default async function handler(req, res) {
  if (!vercelApp) vercelApp = createApp();
  if (mongoose.connection.readyState !== 1) await (await import("./config/db.js")).connectDB();
  return vercelApp(req, res);
}
