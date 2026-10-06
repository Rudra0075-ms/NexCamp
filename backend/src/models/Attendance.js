import mongoose from "mongoose";

// One document per student per subject. Individual class marks live in
// `sessions` so the heatmap and the trend can both be derived from one read.
const attendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    subject: { type: String, required: true, trim: true },
    subjectCode: { type: String, trim: true, uppercase: true },
    semester: { type: Number, min: 1, max: 12 },

    totalClasses: { type: Number, min: 0, default: 0 },
    attendedClasses: { type: Number, min: 0, default: 0 },
    attendancePercentage: { type: Number, min: 0, max: 100, default: 0 },
    // Classes scheduled for the whole semester. Optional: when it is missing the
    // intelligence layer says the end-of-semester projection is unavailable
    // rather than guessing the rest of the timetable.
    semesterPlanned: { type: Number, min: 0 },

    sessions: [
      new mongoose.Schema(
        {
          date: { type: Date, required: true },
          slot: { type: String, trim: true },
          present: { type: Boolean, default: true },
          // Finer grain than present/absent, where the register records it.
          // LATE still counts as attended; LEAVE still counts as missed. Older
          // records without it are read as PRESENT or ABSENT from `present`.
          status: { type: String, enum: ["PRESENT", "ABSENT", "LATE", "LEAVE"] }
        },
        { _id: false }
      )
    ],

    // Set when an absence lines up with an open incident in the student's block.
    linkedIncident: { type: mongoose.Schema.Types.ObjectId, ref: "Incident" }
  },
  { timestamps: true }
);

attendanceSchema.index({ student: 1, subject: 1 }, { unique: true });

attendanceSchema.pre("save", function computePercentage(next) {
  this.attendancePercentage = this.totalClasses
    ? Math.round((this.attendedClasses / this.totalClasses) * 1000) / 10
    : 0;
  next();
});

export const Attendance = mongoose.model("Attendance", attendanceSchema);
