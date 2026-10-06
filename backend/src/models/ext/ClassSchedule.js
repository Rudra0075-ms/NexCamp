import mongoose from "mongoose";

/** One weekly class meeting for one branch/year/section. */
const classScheduleSchema = new mongoose.Schema(
  {
    branch: { type: String, required: true, trim: true, uppercase: true },
    year: { type: Number, required: true },
    section: { type: String, required: true, trim: true, uppercase: true },
    subject: { type: String, required: true, trim: true },
    subjectCode: { type: String, trim: true, uppercase: true },
    weekday: { type: Number, min: 0, max: 6, required: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, trim: true },
    room: { type: String, trim: true },
    faculty: { type: String, trim: true }
  },
  { timestamps: true }
);

classScheduleSchema.index({ branch: 1, year: 1, section: 1, weekday: 1 });

export const ClassSchedule = mongoose.model("ClassSchedule", classScheduleSchema);
