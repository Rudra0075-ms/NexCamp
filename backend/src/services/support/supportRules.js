import { SUPPORT_BAND_LABELS, SUPPORT_BANDS } from "../../config/constants.js";

/**
 * Silent Support System — the support-signal rules.
 *
 * Pure functions, no database, no model. They decide the support-routing band
 * (never a diagnosis), the plain-language reasons, which help options to put
 * first, and the recommended action for the human support team. A language
 * model, when one is configured, may only re-phrase the student-facing message
 * (see supportAi.js); it can never change a band.
 *
 * Every answer is on a 1–5 scale where 1 is the hardest end and 5 the easiest:
 *   feeling     how have you been feeling recently        (1 very low … 5 very good)
 *   study       how has studying felt recently            (1 very difficult … 5 easy)
 *   connection  how connected do you feel with people     (1 very alone … 5 very connected)
 *   helpComfort how comfortable is asking for help        (1 very hard … 5 easy)
 */

export const QUESTIONS = ["feeling", "study", "connection", "helpComfort"];

// Points of concern per answer. Asking for help being hard is weighted lightly:
// it changes *how* help is offered more than *whether* it is.
const POINTS = {
  feeling: { 1: 4, 2: 3, 3: 1 },
  study: { 1: 3, 2: 2, 3: 1 },
  connection: { 1: 3, 2: 2, 3: 1 },
  helpComfort: { 1: 2, 2: 1 }
};

export const THRESHOLDS = { couldBenefit: 4, recommended: 8, recommendedIfRepeated: 5, concerning: 4 };
export const REPEAT_WINDOW_DAYS = 21;

const REASON_TEXT = {
  feeling: "You've been feeling low recently.",
  study: "Studying has felt difficult recently.",
  connection: "You feel less connected with people around you.",
  helpComfort: "Asking for help feels hard right now — that's common, and there are quiet ways to do it.",
  repeated: "Your recent check-ins suggest things have felt hard for a while, not just today."
};

/** Cleans one answer to an integer 1–5, or undefined when it was skipped. */
export function cleanAnswer(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Math.trunc(Number(value));
  return n >= 1 && n <= 5 ? n : undefined;
}

export function scoreAnswers(answers = {}) {
  let score = 0;
  const signals = [];
  for (const key of QUESTIONS) {
    const value = cleanAnswer(answers[key]);
    const points = value ? POINTS[key][value] || 0 : 0;
    score += points;
    if (value && value <= 2) signals.push(key);
  }
  return { score, signals };
}

/**
 * Analyses one check-in against the student's own recent check-ins.
 *
 * @param {object} answers   { feeling, study, connection, helpComfort } — each optional
 * @param {object} options
 * @param {boolean} options.unsafe     the student said they do not feel safe right now
 * @param {Array}   options.previous   the student's earlier check-ins within REPEAT_WINDOW_DAYS ({ score })
 */
export function analyseCheckIn(answers = {}, { unsafe = false, previous = [] } = {}) {
  const { score, signals } = scoreAnswers(answers);
  const answered = QUESTIONS.filter((key) => cleanAnswer(answers[key]) !== undefined).length;
  const earlierConcerning = previous.filter((row) => Number(row?.score) >= THRESHOLDS.concerning).length;
  const repeatedDifficulty = score >= THRESHOLDS.concerning && earlierConcerning >= 1;

  let band = "STABLE";
  if (unsafe) band = "IMMEDIATE_ATTENTION";
  else if (score >= THRESHOLDS.recommended || (repeatedDifficulty && score >= THRESHOLDS.recommendedIfRepeated)) band = "SUPPORT_RECOMMENDED";
  else if (score >= THRESHOLDS.couldBenefit || repeatedDifficulty) band = "COULD_BENEFIT";

  const reasons = signals.map((key) => REASON_TEXT[key]);
  if (repeatedDifficulty) reasons.push(REASON_TEXT.repeated);

  return {
    band,
    label: SUPPORT_BAND_LABELS[band],
    score,
    answered,
    signals,
    repeatedDifficulty,
    reasons,
    message: studentMessage(band),
    nextStep: nextStepFor(band),
    suggestHelp: band !== "STABLE",
    options: orderOptions(signals),
    method: "RULE_BASED_SUPPORT_SIGNALS",
    disclaimer: "This is a support suggestion, not a medical assessment."
  };
}

export function studentMessage(band) {
  switch (band) {
    case "IMMEDIATE_ATTENTION":
      return "Thank you for telling us. You don't have to handle this alone — please reach a person right now using the contacts below.";
    case "SUPPORT_RECOMMENDED":
      return "Your recent check-ins suggest that additional support may be helpful. Would you like to talk to someone privately?";
    case "COULD_BENEFIT":
      return "Thanks for being honest. You may benefit from a short conversation with someone — it's completely your choice.";
    default:
      return "Thanks for checking in. Things seem steady right now — the support team is here whenever you need them.";
  }
}

export function nextStepFor(band) {
  switch (band) {
    case "IMMEDIATE_ATTENTION":
      return "Contact someone now using the contacts below. The student support team can also reach out to you.";
    case "SUPPORT_RECOMMENDED":
      return "You can request a private conversation — no explanation needed.";
    case "COULD_BENEFIT":
      return "If it helps, pick a quiet way to reach out, or ask us to check on you later.";
    default:
      return "You can check in again any time.";
  }
}

/** Which help options to show first, given what was hard. Every option is always offered. */
export function orderOptions(signals = []) {
  const all = ["COUNSELLOR", "MENTOR", "PRIVATE_CONVERSATION", "ANONYMOUS", "CHECK_LATER"];
  const first = [];
  if (signals.includes("helpComfort")) first.push("ANONYMOUS", "CHECK_LATER");
  if (signals.includes("study") || signals.includes("connection")) first.push("MENTOR");
  if (signals.includes("feeling")) first.push("COUNSELLOR");
  return [...new Set([...first, ...all])];
}

/**
 * What the system recommends the human support team does next. A
 * recommendation for a person to act on — never a prediction about the student.
 */
export function recommendedAction({ band, repeatedDifficulty, preference, urgent, anonymous } = {}) {
  if (urgent || band === "IMMEDIATE_ATTENTION") {
    return "Reach the student as soon as possible and follow the institution's safety procedure. Involve a qualified professional.";
  }
  if (repeatedDifficulty && preference === "MENTOR") return "Consider a private mentor check-in focused on workload and study planning.";
  if (repeatedDifficulty) return "The student reported difficulty more than once and asked for support — a private mentor or counsellor follow-up is recommended.";
  if (preference === "CHECK_LATER") return "The student asked not to talk yet. A gentle, low-pressure check-in at the agreed time is recommended.";
  if (anonymous) return "The student chose to stay anonymous. Reply through the in-app message; do not try to identify them.";
  if (band === "SUPPORT_RECOMMENDED") return "Offer a private conversation at the student's preferred time.";
  if (preference === "MENTOR") return "Connect the student with a mentor or faculty member they are comfortable with.";
  return "Offer a short, private conversation and ask what would help.";
}

const BANNED = /\b(depress\w*|disorder\w*|diagnos\w*|mental(ly)? ill\w*|illness|clinical\w*|psychiatr\w*|bipolar|ptsd|suicid\w*|patholog\w*|symptom\w*|syndrome|anxiety attack|you have (an? )?(condition|problem))\b/i;

/** True when a piece of student-facing text stays in supportive, non-clinical language. */
export function isSafeLanguage(text) {
  return typeof text === "string" && text.trim().length > 0 && !BANNED.test(text);
}

export const bandRank = (band) => SUPPORT_BANDS.indexOf(band);
