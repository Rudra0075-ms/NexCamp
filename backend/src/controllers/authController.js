import { ROLES } from "../config/constants.js";
import { Building } from "../models/Building.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/respond.js";
import { clearAuthCookie, setAuthCookie, signToken } from "../utils/token.js";

export const register = asyncHandler(async (req, res) => {
  const { email, hostelCode, role, ...rest } = req.body;

  if (await User.exists({ email })) throw ApiError.conflict("That email is already registered");

  // Self-service registration only ever creates students. Staff accounts are
  // created by the seed script or by an existing admin.
  const requestedRole = role && role !== ROLES.STUDENT ? role : ROLES.STUDENT;
  const grantedRole =
    requestedRole !== ROLES.STUDENT && req.user?.role === ROLES.ADMIN ? requestedRole : ROLES.STUDENT;

  let hostel = null;
  if (hostelCode) {
    hostel = await Building.findOne({ code: hostelCode.toUpperCase() }).lean();
    if (!hostel) throw ApiError.badRequest(`No building with code ${hostelCode}`);
  }

  const user = await User.create({
    ...rest,
    email,
    role: grantedRole,
    hostel: hostel?._id,
    hostelName: hostel?.name
  });

  const token = signToken(user);
  setAuthCookie(res, token);

  return created(res, { user: user.toPublic(), token }, "Account created");
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select("+password");
  // Same message either way so the endpoint cannot be used to enumerate emails.
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized("Email or password is incorrect");
  }

  const token = signToken(user);
  setAuthCookie(res, token);

  return ok(res, { user: user.toPublic(), token }, "Signed in");
});

export const logout = asyncHandler(async (_req, res) => {
  clearAuthCookie(res);
  return ok(res, null, "Signed out");
});

export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate("hostel", "code name type");
  return ok(res, {
    user: {
      ...user.toPublic(),
      hostel: user.hostel ? { id: String(user.hostel._id), code: user.hostel.code, name: user.hostel.name } : null
    }
  });
});
