import { env } from "../config/env.js";
import { STAFF_ROLES } from "../config/constants.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyToken } from "../utils/token.js";

function readToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return req.cookies?.[env.cookieName] || null;
}

export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (!token) throw ApiError.unauthorized("No authentication token supplied");

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw ApiError.unauthorized("Session expired or token invalid");
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized("Account no longer exists");

  req.user = user;
  next();
});

// Attaches req.user when a token is present but never rejects. Used by read-only
// intelligence endpoints that tailor their answer to a signed-in student.
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    req.user = await User.findById(payload.sub);
  } catch {
    req.user = undefined;
  }
  next();
});

export function authorize(...roles) {
  const allowed = roles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(ApiError.forbidden(`This endpoint requires: ${allowed.join(", ")}`));
    }
    next();
  };
}

export const authorizeStaff = authorize(STAFF_ROLES);

// A student may read their own record; staff may read anyone's.
export function authorizeSelfOrStaff(paramName = "studentId") {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (STAFF_ROLES.includes(req.user.role)) return next();
    const target = req.params[paramName];
    if (target === String(req.user._id) || target === req.user.studentId || target === "me") {
      return next();
    }
    return next(ApiError.forbidden("You can only read your own records"));
  };
}
