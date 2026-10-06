import { Resource } from "../models/Resource.js";
import { User } from "../models/User.js";

export async function seedResources() {
  const existingCount = await Resource.countDocuments();
  if (existingCount > 0) {
    return;
  }

  const admin = await User.findOne({ role: "ADMIN" });
  const student = await User.findOne({ role: "STUDENT" });

  if (!admin || !student) {
    console.log("[Seed] Admin or Student user not found, skipping resource seed.");
    return;
  }

  const demoResources = [
    {
      reference: "RES-101",
      title: "BPUT End-Term Examination Regulations & Guidelines 2026",
      description: "Official notifications regarding semester end examination timetable, admit card download instructions, hall rules, and evaluation criteria.",
      category: "DOCUMENTS",
      resourceType: "NOTICE",
      fileUrl: "https://bput.ac.in/notices/exam-guidelines-2026.pdf",
      attachmentName: "BPUT_Exam_Regulations_2026.pdf",
      attachmentSize: "2.1 MB",
      linkUrl: "https://bput.ac.in/exam-notices",
      author: admin._id,
      authorName: admin.name || "Academic Administration",
      authorRole: "ADMIN",
      isOfficial: true,
      status: "APPROVED",
      moderation: {
        method: "ADMIN_OFFICIAL_BROADCAST",
        isAppropriate: true,
        relevanceScore: 100,
        reasons: ["Official College Administration publication"]
      },
      downloadsCount: 142,
      viewsCount: 380,
      tags: ["exam", "guidelines", "bput", "official", "regulations"]
    },
    {
      reference: "RES-102",
      title: "Campus Placement Portal Registration & Internship Drive 2026-27",
      description: "Official recruitment announcement for pre-final and final year engineering students. Includes list of visiting tech companies, eligibility percentages, and registration deadlines.",
      category: "CAMPUS_HELP",
      resourceType: "LINK",
      linkUrl: "https://placements.bput.ac.in/portal/2026-drive",
      author: admin._id,
      authorName: admin.name || "Training & Placement Cell",
      authorRole: "ADMIN",
      isOfficial: true,
      status: "APPROVED",
      moderation: {
        method: "ADMIN_OFFICIAL_BROADCAST",
        isAppropriate: true,
        relevanceScore: 100,
        reasons: ["Verified Placement Cell broadcast"]
      },
      downloadsCount: 215,
      viewsCount: 520,
      tags: ["placement", "internship", "campus", "jobs", "official"]
    },
    {
      reference: "RES-103",
      title: "Design & Analysis of Algorithms (DAA) - Solved 5-Year PYQs (2020-2025)",
      description: "Compiled previous year question papers with detailed step-by-step solutions for Dynamic Programming, Greedy Methods, Graph Algorithms, and NP-Completeness.",
      category: "QUESTIONS",
      resourceType: "FILE",
      fileUrl: "https://bput.ac.in/resources/daa-solved-pyqs.pdf",
      attachmentName: "DAA_Solved_PYQs_2020_2025.pdf",
      attachmentSize: "4.8 MB",
      author: student._id,
      authorName: student.name || "Priya Patel",
      authorRole: "STUDENT",
      isOfficial: false,
      status: "APPROVED",
      moderation: {
        method: "HYBRID_CAMPUS_MODERATION_ENGINE",
        isAppropriate: true,
        relevanceScore: 98,
        reasons: ["High academic relevance: DAA algorithms, past exam solutions."]
      },
      downloadsCount: 312,
      viewsCount: 640,
      tags: ["daa", "pyq", "algorithms", "questions", "solutions"]
    },
    {
      reference: "RES-104",
      title: "Database Management Systems (DBMS) - Complete Handwritten Lecture Notes",
      description: "Comprehensive handwritten notes covering Relational Algebra, SQL queries, Normalization (1NF to BCNF), Transaction Processing, and Concurrency Control.",
      category: "STUDY_MATERIAL",
      resourceType: "FILE",
      fileUrl: "https://bput.ac.in/resources/dbms-complete-notes.pdf",
      attachmentName: "DBMS_Unit1_to_Unit5_Notes.pdf",
      attachmentSize: "6.2 MB",
      author: student._id,
      authorName: student.name || "Rahul Verma",
      authorRole: "STUDENT",
      isOfficial: false,
      status: "APPROVED",
      moderation: {
        method: "HYBRID_CAMPUS_MODERATION_ENGINE",
        isAppropriate: true,
        relevanceScore: 95,
        reasons: ["Verified peer study material: DBMS syllabus notes."]
      },
      downloadsCount: 285,
      viewsCount: 580,
      tags: ["dbms", "sql", "database", "notes", "cse"]
    },
    {
      reference: "RES-105",
      title: "Operating Systems (OS) Quick Revision Cheatsheet for Midsem",
      description: "Compact 6-page summary for CPU scheduling algorithms, Banker's Deadlock avoidance algorithm, paging, segmentation, and virtual memory.",
      category: "ACADEMIC",
      resourceType: "FILE",
      fileUrl: "https://bput.ac.in/resources/os-quick-revision.pdf",
      attachmentName: "OS_Midsem_Cheatsheet.pdf",
      attachmentSize: "1.4 MB",
      author: student._id,
      authorName: student.name || "Ananya Sen",
      authorRole: "STUDENT",
      isOfficial: false,
      status: "APPROVED",
      moderation: {
        method: "HYBRID_CAMPUS_MODERATION_ENGINE",
        isAppropriate: true,
        relevanceScore: 92,
        reasons: ["Relevant academic summary: Operating Systems course material."]
      },
      downloadsCount: 198,
      viewsCount: 420,
      tags: ["os", "operating systems", "cheatsheet", "revision", "midsem"]
    },
    {
      reference: "RES-106",
      title: "Annual Campus TechFest 2026: Hackathon Problem Statements & Team Portal",
      description: "Direct link to the 24-hour hackathon portal. Register your 4-person team, view domain problem statements, and submit project abstract.",
      category: "EVENTS",
      resourceType: "LINK",
      linkUrl: "https://techfest.bput.ac.in/hackathon-2026",
      author: student._id,
      authorName: student.name || "Campus Coding Society",
      authorRole: "STUDENT",
      isOfficial: false,
      status: "APPROVED",
      moderation: {
        method: "HYBRID_CAMPUS_MODERATION_ENGINE",
        isAppropriate: true,
        relevanceScore: 90,
        reasons: ["Verified student club event: Annual Campus Hackathon."]
      },
      downloadsCount: 164,
      viewsCount: 490,
      tags: ["techfest", "hackathon", "events", "coding club"]
    }
  ];

  await Resource.insertMany(demoResources);
  console.log(`[Seed] Seeded ${demoResources.length} campus resources successfully.`);
}
