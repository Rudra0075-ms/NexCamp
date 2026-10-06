import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { ALL_ROLES, ROLES } from "../config/constants.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    // select:false so no query can leak the hash by accident.
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ALL_ROLES, default: ROLES.STUDENT, index: true },

    // Student-only profile. Left empty for staff accounts.
    studentId: { type: String, trim: true, sparse: true, index: true },
    department: { type: String, trim: true },
    course: { type: String, trim: true },
    semester: { type: Number, min: 1, max: 12 },
    hostel: { type: mongoose.Schema.Types.ObjectId, ref: "Building" },
    hostelName: { type: String, trim: true },
    room: { type: String, trim: true },
    phone: { type: String, trim: true },

    // Guardian contact, used by the gate-pass parent OTP. The number is never
    // returned by toPublic(); only a masked form ever reaches the browser.
    parentName: { type: String, trim: true },
    parentPhone: { type: String, trim: true, select: false },

    // Denormalised for the dashboard header; recomputed by the attendance service.
    attendancePercentage: { type: Number, min: 0, max: 100, default: 0 },

    // Staff-only: which department's queue this account owns.
    managedDepartment: { type: String, trim: true }
  },
  { timestamps: true }
);

userSchema.index({ role: 1, hostel: 1 });

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Single definition of what a user object looks like on the wire.
userSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    role: this.role,
    studentId: this.studentId,
    department: this.department,
    course: this.course,
    semester: this.semester,
    hostel: this.hostel ? String(this.hostel) : null,
    hostelName: this.hostelName,
    room: this.room,
    parentName: this.parentName,
    attendancePercentage: this.attendancePercentage,
    managedDepartment: this.managedDepartment,
    createdAt: this.createdAt
  };
};

export const User = mongoose.model("User", userSchema);
