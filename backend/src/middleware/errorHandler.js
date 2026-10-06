import mongoose from "mongoose";
import { isProduction } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { fail } from "../utils/respond.js";

export function notFound(req, res) {
  return fail(res, 404, `No route matches ${req.method} ${req.originalUrl}`);
}

// Single place that turns any thrown value into the documented error envelope.
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return fail(res, err.status, err.message, err.details);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.fromEntries(
      Object.entries(err.errors).map(([field, e]) => [field, e.message])
    );
    return fail(res, 400, "Validation failed", details);
  }

  if (err instanceof mongoose.Error.CastError) {
    return fail(res, 400, `Invalid value for ${err.path}`);
  }

  if (err?.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "value";
    return fail(res, 409, `That ${field} is already in use`);
  }

  if (!isProduction) console.error(err);
  return fail(res, err.status || 500, isProduction ? "Something went wrong" : err.message);
}
