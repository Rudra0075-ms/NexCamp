import { Resource } from "../models/Resource.js";
import { similarity } from "../utils/text.js";

const ACADEMIC_KEYWORDS = [
  "notes", "syllabus", "question", "questions", "pyq", "paper", "exam", "midsem", "endsem",
  "assignment", "lab", "manual", "solution", "solutions", "lecture", "module", "unit",
  "dsa", "data structures", "algorithm", "dbms", "database", "sql", "operating systems", "os",
  "networks", "computer network", "ai", "machine learning", "ml", "python", "java", "c++", "c prog",
  "discrete mathematics", "math", "calculus", "physics", "chemistry", "electronics", "circuits",
  "bput", "engineering", "btech", "mca", "bca", "code", "coding", "theory", "formula"
];

const CAMPUS_HELP_KEYWORDS = [
  "club", "society", "event", "fest", "hackathon", "orientation", "guidelines", "handbook",
  "placement", "internship", "resume", "interview", "scholarship", "library", "form",
  "registration", "schedule", "timetable", "academic calendar", "hostel", "bus", "transport",
  "help", "resource", "portal", "drive", "github", "tutorial", "cheatsheet", "guide"
];

const SPAM_PATTERNS = [
  /\b(casino|poker|betting|lottery|gambling)\b/i,
  /\b(earn \$|make money fast|crypto|bitcoin|forex trading|invest now)\b/i,
  /\b(free cash|click here to win|adult|porn|xxx|viagra)\b/i,
  /\b(telegram bot for money|whatsapp group link to earn)\b/i,
  /\b(hack password|ddos tool|crack software|keygen)\b/i
];

function isGibberish(text) {
  if (!text || text.trim().length < 6) return true;
  const clean = text.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length < 4) return true;

  // Excessive consecutive identical characters (e.g., aaaaaaa, zzzzzzzz)
  if (/(.)\1{4,}/.test(clean)) return true;

  // Check vowel ratio in words longer than 4 chars
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
  if (words.length > 0) {
    let unvoweledCount = 0;
    for (const w of words) {
      const letters = w.replace(/[^a-z]/g, "");
      if (letters.length >= 5 && !/[aeiouy]/.test(letters)) {
        unvoweledCount++;
      }
    }
    if (unvoweledCount / words.length > 0.4) return true;
  }

  return false;
}

/**
 * Evaluates a shared resource for academic / campus relevance and filters spam.
 * Deterministic and transparent, matching NeX Camp's AI/Rule-based transparency standards.
 */
export async function evaluateResource({ title, description, category, tags = [], linkUrl = "" }) {
  const combinedText = `${title} ${description} ${(tags || []).join(" ")} ${linkUrl}`.toLowerCase();
  const reasons = [];
  let isAppropriate = true;
  let relevanceScore = 0;

  // 1. Spam & malicious pattern check
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(combinedText)) {
      isAppropriate = false;
      reasons.push("Content contains restricted spam, promotional, or high-risk keywords.");
      break;
    }
  }

  // 2. Gibberish & length check
  if (isGibberish(title) || (description && isGibberish(description))) {
    isAppropriate = false;
    reasons.push("Content appears to be random text, excessive repetition, or lacks coherent description.");
  }

  // 3. Keyword matching for academic & campus domains
  let matchedAcademic = 0;
  for (const kw of ACADEMIC_KEYWORDS) {
    if (combinedText.includes(kw)) matchedAcademic++;
  }

  let matchedCampus = 0;
  for (const kw of CAMPUS_HELP_KEYWORDS) {
    if (combinedText.includes(kw)) matchedCampus++;
  }

  // Calculate base score
  if (matchedAcademic > 0) {
    relevanceScore += Math.min(60, matchedAcademic * 20);
  }
  if (matchedCampus > 0) {
    relevanceScore += Math.min(40, matchedCampus * 15);
  }

  // Known categories boost
  if (["ACADEMIC", "QUESTIONS", "STUDY_MATERIAL", "DOCUMENTS", "EVENTS", "CLUBS", "CAMPUS_HELP", "OPEN_RESOURCES"].includes(category)) {
    relevanceScore += 20;
  }

  relevanceScore = Math.min(100, relevanceScore);

  // If score is too low and no academic/campus relevance found
  if (relevanceScore < 25) {
    isAppropriate = false;
    reasons.push("Content lacks clear academic, study, or campus life relevance for NeX Camp.");
  }

  // 4. Duplicate check against active approved resources
  try {
    const recentResources = await Resource.find({ status: "APPROVED" })
      .sort({ createdAt: -1 })
      .limit(30)
      .select("title description");

    for (const res of recentResources) {
      const titleSim = similarity(title.toLowerCase(), res.title.toLowerCase());
      if (titleSim > 0.88) {
        isAppropriate = false;
        reasons.push(`Duplicate notice or resource detected (matches existing entry "${res.title}").`);
        break;
      }
    }
  } catch (err) {
    // Non-fatal if DB check fails
  }

  const status = isAppropriate ? "APPROVED" : "REJECTED";

  return {
    status,
    isAppropriate,
    relevanceScore,
    method: "HYBRID_CAMPUS_MODERATION_ENGINE",
    reasons: reasons.length > 0 ? reasons : ["Verified relevant for campus study & resource sharing."]
  };
}
