import jwt from "jsonwebtoken";
import { env, isProduction } from "../config/env.js";

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

// Cookie for browsers, Authorization header for tools — the frontend can use
// either. SameSite=None is only safe alongside Secure, so it is production-only.
export function setAuthCookie(res, token) {
  res.cookie(env.cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(env.cookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/"
  });
}
