import { attendanceIntelligence } from "./attendanceIntelligenceService.js";
import { simulate } from "./attendanceService.js";
import { MEAL_ORDER, currentMeal, messIntelligence, predictMeal, simulateMeal, loadMealDays } from "./messIntelligenceService.js";
import { classifyIntentWithModel, narrate } from "./ai/narrate.js";
import { round } from "../utils/text.js";

/**
 * The student-facing intelligence layer: the dashboard summary and the
 * natural-language question box on the Dashboard, Attendance and Mess pages.
 *
 * How a question is answered:
 *   1. intent — keyword rules, or the configured model when rules are unsure
 *   2. domain + entities — subject, meal, a number of classes, a percentage
 *   3. data — the student's attendance register and/or the mess records
 *   4. answer — computed by the same services the pages use
 *   5. evidence — what data was read, the rows behind the answer
 *   6. action — the page and panel that shows it in full
 * A model, when configured, may only reword step 4. It never supplies a number.
 */

const INTENTS = [
  { id: "ATT_WHY_CHANGE", domain: "ATTENDANCE", description: "why attendance fell, dropped or changed", words: ["why", "fall", "fell", "falling", "drop", "dropped", "decrease", "decreased", "declin", "lower", "change", "changed", "down"] },
  { id: "ATT_WHAT_IF", domain: "ATTENDANCE", description: "what happens if the student misses or attends some classes", words: ["what if", "happens", "happen", "miss", "skip", "bunk", "attend next"] },
  { id: "ATT_LOWEST", domain: "ATTENDANCE", description: "which days or time slots have the lowest attendance", words: ["lowest", "worst", "which day", "which days", "weakest", "slot", "time of day"] },
  { id: "ATT_RISK", domain: "ATTENDANCE", description: "what is causing attendance risk, or the risk level", words: ["risk", "causing", "cause", "danger", "detained", "detention", "eligib"] },
  { id: "ATT_CAN_MISS", domain: "ATTENDANCE", description: "how many classes can still be missed or must be attended", words: ["how many", "can i miss", "safe", "need to attend", "must attend", "allowed"] },
  { id: "ATT_NEXT", domain: "ATTENDANCE", description: "when the next class is", words: ["next class", "next lecture", "timetable", "schedule", "when is my"] },
  { id: "ATT_STATUS", domain: "ATTENDANCE", description: "current attendance percentage overall or for a subject", words: ["attendance", "percentage", "how am i", "status", "doing"] },
  { id: "MESS_POPULAR", domain: "MESS", description: "which dish or meal is most popular or has the highest demand", words: ["popular", "favourite", "favorite", "most liked", "highest demand", "most demand", "best"] },
  { id: "MESS_UNAVAILABLE", domain: "MESS", description: "which meals or dishes run out or are unavailable", words: ["unavailable", "run out", "ran out", "runs out", "sold out", "finish", "finished", "availability"] },
  { id: "MESS_WHY_DEMAND", domain: "MESS", description: "why demand for a meal is rising or falling", words: ["demand increasing", "demand rising", "demand falling", "why is", "demand"] },
  { id: "MESS_FEEDBACK", domain: "MESS", description: "which meals get the most negative feedback or complaints", words: ["feedback", "negative", "complain", "complaint", "rating", "worst meal", "bad"] },
  { id: "MESS_WHAT_IF", domain: "MESS", description: "what happens if more or fewer students choose a meal", words: ["what if", "more students", "fewer students", "choose", "percent", "%"] },
  { id: "MESS_PEAK", domain: "MESS", description: "when the mess is busy, queue times, best time to go", words: ["queue", "crowd", "crowded", "peak", "busy", "when should", "best time", "rush"] },
  { id: "MESS_MENU", domain: "MESS", description: "today's menu", words: ["menu", "today's", "what is for", "serving", "food today"] }
];

const MESS_WORDS = ["mess", "meal", "meals", "food", "breakfast", "lunch", "dinner", "snack", "snacks", "menu", "dish", "eat", "diners", "kitchen", "curry", "paneer", "egg", "rice"];
const ATT_WORDS = ["attendance", "class", "classes", "lecture", "subject", "absent", "present", "bunk", "semester", "threshold", "75"];

const SUBJECT_ALIASES = [
  [/\b(discrete|maths?|mathematics)\b/, "DISCRETE MATHS"],
  [/\b(operating systems?|os)\b/, "OPERATING SYSTEMS"],
  [/\b(dbms|database)\b/, "DBMS"],
  [/\b(data structures?|dsa?)\b/, "DATA STRUCTURES"],
  [/\b(digital|electronics|de)\b/, "DIGITAL ELECTRONICS"],
  [/\b(communication|english)\b/, "COMMUNICATION SKILLS"]
];

export function extractEntities(question) {
  const q = ` ${String(question || "").toLowerCase()} `;
  let subject = null;
  for (const [pattern, name] of SUBJECT_ALIASES) {
    if (pattern.test(q)) {
      subject = name;
      break;
    }
  }
  const meal = MEAL_ORDER.find((m) => q.includes(m.toLowerCase().replace(/s$/, ""))) || null;
  const percentMatch = /(-?\d+(?:\.\d+)?)\s*(%|percent)/.exec(q);
  const countMatch = /\b(\d{1,2})\s*(more\s+)?(classes|class|lectures|lecture|sessions|session|periods)\b/.exec(q) || /\bmiss(?:ing)?\s+(\d{1,2})\b/.exec(q);
  const wordNumbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const wordMatch = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(more\s+)?(classes|class|lectures|sessions)\b/.exec(q);
  const count = countMatch ? Number(countMatch[1]) : wordMatch ? wordNumbers[wordMatch[1]] : null;
  const attend = /\battend(ing)?\b/.test(q) && !/\bmiss|skip|bunk/.test(q);
  const fewer = /\bfewer|less|drop|decrease|reduce/.test(q);
  return {
    subject,
    meal,
    percent: percentMatch ? Math.abs(Number(percentMatch[1])) * (fewer ? -1 : 1) : null,
    count,
    attend
  };
}

/** Keyword intent match. Returns the best intent, its domain and a rule confidence. */
export function detectIntent(question, { domainHint = null } = {}) {
  const q = ` ${String(question || "").toLowerCase()} `;
  const messHits = MESS_WORDS.filter((w) => q.includes(` ${w}`)).length;
  const attHits = ATT_WORDS.filter((w) => q.includes(w)).length;
  let domain = messHits > attHits ? "MESS" : attHits > messHits ? "ATTENDANCE" : domainHint || null;
  if (!domain && extractEntities(question).subject) domain = "ATTENDANCE";

  let best = null;
  for (const intent of INTENTS) {
    let score = intent.words.reduce((t, w) => (q.includes(w) ? t + (w.includes(" ") ? 2 : 1) : t), 0);
    if (domain && intent.domain === domain) score += 1.5;
    if (domain && intent.domain !== domain) score -= 2;
    if (!best || score > best.score) best = { intent, score };
  }
  if (!best || best.score < 1.5) return { intent: null, domain, confidence: 25, score: best?.score || 0 };
  return { intent: best.intent.id, domain: best.intent.domain, confidence: Math.round(Math.min(92, 45 + best.score * 9)), score: best.score };
}

const pctText = (value) => (value === null || value === undefined ? "—" : `${round(value, 1)}%`);
const ACRONYMS = new Set(["DBMS", "OS", "DS", "DE"]);
const DAY_NAMES = { SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" };
const titleCase = (value) =>
  String(value || "")
    .split(/(\s+)/)
    .map((word) => (ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())))
    .join("");
const dayName = (short) => DAY_NAMES[short] || titleCase(short);

function insufficient(domain, text, extra = {}) {
  return {
    domain,
    insufficient: true,
    kind: "INSUFFICIENT DATA",
    answer: text,
    points: [],
    confidence: null,
    evidence: { dataConsidered: [], rows: [] },
    visualization: null,
    recommendation: null,
    action: null,
    ...extra
  };
}

// ---- attendance answers -------------------------------------------------------

function answerAttendance(intent, A, entities, question) {
  if (A.empty) return insufficient("ATTENDANCE", A.message);
  const subj = entities.subject ? A.subjects.find((s) => s.subject === entities.subject) : null;
  const dataConsidered = [
    `Attendance register · ${A.totalClasses} classes across ${A.subjects.length} subjects`,
    A.dataRange ? `${A.dataRange.from} → ${A.dataRange.to}` : null,
    `Comparison window · last ${A.windowDays} days vs the ${A.windowDays} before`
  ].filter(Boolean);

  if (intent === "ATT_WHY_CHANGE") {
    const w = A.why;
    if (w.insufficient) return insufficient("ATTENDANCE", `There are only ${w.held} classes in the last ${w.windowDays} days — not enough to explain a change.`);
    if (w.change === null) return insufficient("ATTENDANCE", `Your register starts on ${A.dataRange?.from}, so there is no attendance before the last ${w.windowDays} days to compare against.`);
    const top = w.bySubject.slice(0, 3);
    const slot = w.bySlot[0];
    const slotShare = slot && w.missed ? slot.missed / w.missed : 0;
    const points = top.map((row) => `${titleCase(row.subject)} — ${row.missed} missed class${row.missed === 1 ? "" : "es"}`);
    if (slot && slotShare >= 0.5) points.push(`${slot.missed} of the ${w.missed} missed classes were in the ${slot.slot} slot`);
    const fell = w.change < 0;
    return {
      domain: "ATTENDANCE",
      kind: "AI ANALYSIS",
      answer: fell
        ? `Your attendance fell from ${pctText(w.from)} to ${pctText(w.to)} over the last ${w.windowDays} days (${w.change} points). You missed ${w.missed} of ${w.held} classes in that time, mainly in ${top.map((r) => titleCase(r.subject)).slice(0, 2).join(" and ")}.`
        : `Your attendance did not fall over the last ${w.windowDays} days — it moved from ${pctText(w.from)} to ${pctText(w.to)} (${w.change >= 0 ? "+" : ""}${w.change} points).`,
      points,
      confidence: A.classification.confidence,
      confidenceBasis: A.classification.confidenceBasis,
      evidence: {
        dataConsidered,
        rows: w.bySubject.flatMap((row) => row.sessions.map((s) => ({ label: `${s.date} · ${s.slot}`, value: `${titleCase(row.subject)} · ${s.status}` }))).slice(0, 12)
      },
      visualization: { type: "bars", title: `Missed classes by subject · last ${w.windowDays} days`, unit: "missed", data: w.bySubject.map((row) => ({ label: titleCase(row.subject), value: row.missed })) },
      recommendation: slot && slotShare >= 0.5 ? `Protect the ${slot.slot} slot — it accounts for ${Math.round(slotShare * 100)}% of the classes you missed.` : null,
      action: { label: "Open the why-analysis", page: "attendance", focus: { panel: "why" } }
    };
  }

  if (intent === "ATT_WHAT_IF") {
    const n = entities.count ?? 3;
    const base = subj || { attendedClasses: A.attendedClasses, totalClasses: A.totalClasses, subject: null };
    const miss = !entities.attend;
    const sim = simulate({ attendedClasses: base.attendedClasses, totalClasses: base.totalClasses, plannedClasses: n, attendPlanned: miss ? 0 : n, threshold: A.threshold });
    const scope = subj ? titleCase(subj.subject) : "overall";
    return {
      domain: "ATTENDANCE",
      kind: "SIMULATED RESULT",
      answer: `${miss ? "Missing" : "Attending"} the next ${n} class${n === 1 ? "" : "es"}${subj ? ` of ${titleCase(subj.subject)}` : ""} takes your ${scope} attendance from ${pctText(sim.current)} to ${pctText(sim.projected)} — ${sim.eligibleAfterPlan ? "still at or above" : "below"} the ${A.threshold}% requirement.`,
      points: [
        `Calculation: ${sim.explanation}`,
        sim.eligibleAfterPlan
          ? `After that you could miss ${simulate({ attendedClasses: sim.input.attendedClasses + sim.input.attendPlanned, totalClasses: sim.input.totalClasses + sim.input.plannedClasses }).classesCanMiss} more and stay eligible.`
          : `You would then need ${simulate({ attendedClasses: sim.input.attendedClasses + sim.input.attendPlanned, totalClasses: sim.input.totalClasses + sim.input.plannedClasses }).classesToThreshold ?? "many"} consecutive attended classes to get back to ${A.threshold}%.`
      ],
      confidence: null,
      confidenceBasis: "Exact arithmetic on your register — no estimate involved.",
      evidence: { dataConsidered: [`${subj ? titleCase(subj.subject) : "All subjects"} · ${base.attendedClasses} of ${base.totalClasses} attended`], rows: [{ label: "Formula", value: sim.explanation }] },
      visualization: { type: "compare", title: "Current vs simulated", threshold: A.threshold, data: [{ label: "Current", value: sim.current }, { label: "Simulated", value: sim.projected, highlight: true }] },
      recommendation: null,
      action: { label: "Try it in the simulator", page: "attendance", focus: { panel: "simulator", subject: subj?.subject || null, miss: miss ? n : 0, attend: miss ? 0 : n } }
    };
  }

  if (intent === "ATT_LOWEST") {
    const days = A.weekdayRates.filter((d) => d.held).sort((a, b) => a.rate - b.rate);
    const slots = A.slotRates.slice().sort((a, b) => a.rate - b.rate);
    if (!days.length) return insufficient("ATTENDANCE", "No classes are recorded yet to compare days.");
    return {
      domain: "ATTENDANCE",
      kind: "AI ANALYSIS",
      answer: `Your lowest attendance is on ${dayName(days[0].weekday)}s (${pctText(days[0].rate)} of ${days[0].held} classes) and in the ${slots[0].slot} slot (${pctText(slots[0].rate)}).`,
      points: [
        ...days.slice(0, 3).map((d) => `${dayName(d.weekday)} · ${pctText(d.rate)} of ${d.held}`),
        `${slots[0].slot} slot in the last ${A.windowDays} days: ${pctText(slots[0].recentRate)} of ${slots[0].recentHeld}`
      ],
      confidence: null,
      confidenceBasis: "Direct counts from your register.",
      evidence: { dataConsidered, rows: A.slotRates.map((s) => ({ label: `${s.slot} slot`, value: `${pctText(s.rate)} of ${s.held}` })) },
      visualization: { type: "bars", title: "Attendance by weekday", unit: "%", threshold: A.threshold, data: A.weekdayRates.filter((d) => d.held).map((d) => ({ label: d.weekday, value: d.rate, highlight: d.weekday === days[0].weekday })) },
      recommendation: `Most absences cluster on ${dayName(days[0].weekday)} and at ${slots[0].slot} — a reminder before those classes targets the gap directly.`,
      action: { label: "See the attendance timeline", page: "attendance", focus: { panel: "timeline" } }
    };
  }

  if (intent === "ATT_RISK" || (intent === "ATT_STATUS" && !subj)) {
    const drivers = [];
    if (!A.eligible) drivers.push(`Overall attendance ${pctText(A.overall)} is ${round(A.threshold - A.overall, 1)} points below the ${A.threshold}% requirement.`);
    else drivers.push(`Overall attendance ${pctText(A.overall)} is ${round(A.overall - A.threshold, 1)} points above the ${A.threshold}% requirement.`);
    if (A.classification.pattern === "DECLINING") drivers.push(A.classification.reasons[0]);
    const weak = A.subjects.filter((s) => s.risk === "CRITICAL" || s.risk === "HIGH");
    if (weak.length) drivers.push(`${weak.length} subject${weak.length === 1 ? "" : "s"} below the bar: ${weak.map((s) => `${titleCase(s.subject)} ${pctText(s.percentage)}`).join(", ")}.`);
    const slot = A.slotRates.slice().sort((a, b) => a.rate - b.rate)[0];
    if (slot && slot.rate < A.threshold - 10) drivers.push(`${slot.slot} classes are attended ${pctText(slot.rate)} of the time.`);
    const worst = weak[0];
    return {
      domain: "ATTENDANCE",
      kind: "AI ANALYSIS",
      answer: `Your attendance risk is ${A.risk} (${A.status.toLowerCase()}) and the pattern is ${A.classification.pattern.toLowerCase()}. ${A.eligible ? "" : `Attending the next ${A.classesToThreshold} classes without a miss brings you back to ${A.threshold}%.`}`.trim(),
      points: drivers,
      confidence: A.classification.confidence,
      confidenceBasis: A.classification.confidenceBasis,
      evidence: { dataConsidered, rows: A.subjects.map((s) => ({ label: titleCase(s.subject), value: `${pctText(s.percentage)} · ${s.risk} · ${s.pattern}` })) },
      visualization: { type: "bars", title: "Attendance by subject", unit: "%", threshold: A.threshold, data: A.subjects.map((s) => ({ label: titleCase(s.subject), value: s.percentage, highlight: s.risk === "CRITICAL" || s.risk === "HIGH" })) },
      recommendation: worst
        ? `Attend the next ${worst.classesToThreshold ?? "few"} ${titleCase(worst.subject)} classes — it is your furthest subject from ${A.threshold}%.`
        : null,
      action: { label: "Open the subject analysis", page: "attendance", focus: { panel: "subjects", subject: worst?.subject || null } }
    };
  }

  if (intent === "ATT_CAN_MISS" || (intent === "ATT_STATUS" && subj)) {
    const s = subj || null;
    const target = s || { subject: "all subjects", percentage: A.overall, classesCanMiss: A.classesCanMiss, classesToThreshold: A.classesToThreshold, attendedClasses: A.attendedClasses, totalClasses: A.totalClasses, pattern: A.classification.pattern };
    const ok = target.percentage >= A.threshold;
    return {
      domain: "ATTENDANCE",
      kind: "AI ANALYSIS",
      answer: ok
        ? `${titleCase(target.subject)} is at ${pctText(target.percentage)}. You can miss ${target.classesCanMiss} more class${target.classesCanMiss === 1 ? "" : "es"} and stay at or above ${A.threshold}%.`
        : `${titleCase(target.subject)} is at ${pctText(target.percentage)}, below ${A.threshold}%. You cannot miss any more — you need ${target.classesToThreshold} consecutive attended classes to get back to ${A.threshold}%.`,
      points: [`${target.attendedClasses} of ${target.totalClasses} attended`, `Pattern: ${String(target.pattern).toLowerCase()}`],
      confidence: null,
      confidenceBasis: "Exact arithmetic on your register.",
      evidence: { dataConsidered, rows: [{ label: "Attended", value: `${target.attendedClasses} of ${target.totalClasses}` }] },
      visualization: { type: "compare", title: titleCase(target.subject), threshold: A.threshold, data: [{ label: "Now", value: target.percentage, highlight: true }] },
      recommendation: null,
      action: { label: "Open the simulator", page: "attendance", focus: { panel: "simulator", subject: s?.subject || null } }
    };
  }

  if (intent === "ATT_NEXT") {
    const next = A.upcoming[0];
    if (!next) return insufficient("ATTENDANCE", "No regular timetable can be inferred from your register yet.");
    return {
      domain: "ATTENDANCE",
      kind: "AI ANALYSIS",
      answer: `Your next class is likely ${titleCase(next.subject)} on ${dayName(next.day)} ${next.date} at ${next.slot}.`,
      points: A.upcoming.slice(1, 4).map((u) => `${dayName(u.day)} ${u.slot} · ${titleCase(u.subject)}`),
      confidence: null,
      confidenceBasis: "Inferred from the weekday and slot your classes have repeated on. The campus timetable itself is not in this system, so check it for changes.",
      evidence: { dataConsidered: ["Your register's repeating weekday + slot combinations"], rows: A.upcoming.map((u) => ({ label: `${u.day} ${u.date} ${u.slot}`, value: titleCase(u.subject) })) },
      visualization: null,
      recommendation: null,
      action: { label: "Open attendance", page: "attendance", focus: { panel: "subjects", subject: next.subject } }
    };
  }
  return null;
}

// ---- mess answers ----------------------------------------------------------------

async function answerMess(intent, M, entities) {
  const dataConsidered = [
    M.dataRange ? `Mess log · ${M.dataRange.mealDays} meal services, ${M.dataRange.from} → ${M.dataRange.to}` : "Mess log",
    `Student ratings · ${M.feedback.responses} in the last ${M.windowDays} days`
  ];

  if (intent === "MESS_POPULAR") {
    if (/meal|demand|highest/.test(String(entities._q))) {
      const meals = M.patterns.byWeekday
        .map((row) => ({ meal: row.meal, average: Math.round(row.days.filter((d) => d.average !== null).reduce((t, d) => t + d.average, 0) / row.days.filter((d) => d.average !== null).length) }))
        .sort((a, b) => b.average - a.average);
      if (meals.length && !/dish|item|food/.test(String(entities._q))) {
        return {
          domain: "MESS",
          kind: "AI ANALYSIS",
          answer: `${titleCase(meals[0].meal)} has the highest demand — about ${meals[0].average.toLocaleString("en-IN")} covers a day on average, against ${meals[1] ? `${meals[1].average.toLocaleString("en-IN")} for ${titleCase(meals[1].meal).toLowerCase()}` : "the other meals"}.`,
          points: meals.map((m) => `${titleCase(m.meal)} · ${m.average.toLocaleString("en-IN")} covers/day`),
          confidence: null,
          confidenceBasis: "Averages of recorded covers.",
          evidence: { dataConsidered, rows: meals.map((m) => ({ label: titleCase(m.meal), value: `${m.average} covers/day` })) },
          visualization: { type: "bars", title: "Average covers per day", unit: "covers", data: meals.map((m, i) => ({ label: titleCase(m.meal), value: m.average, highlight: i === 0 })) },
          recommendation: null,
          action: { label: "Open demand patterns", page: "mess", focus: { panel: "patterns", meal: meals[0].meal } }
        };
      }
    }
    const items = M.menu.filter((row) => row.averageTaken !== null).slice(0, 5);
    if (!items.length) return insufficient("MESS", "No dish uptake has been recorded in this window.");
    return {
      domain: "MESS",
      kind: "AI ANALYSIS",
      answer: `${titleCase(items[0].item)} is the most popular dish — on average ${items[0].averageTaken}% of what is prepared is taken, across ${items[0].timesServed} servings.`,
      points: items.slice(1, 4).map((row) => `${titleCase(row.item)} · ${row.averageTaken}% taken`),
      confidence: null,
      confidenceBasis: "Uptake is recorded per serving; this is a ranking of those records.",
      evidence: { dataConsidered, rows: items.map((row) => ({ label: titleCase(row.item), value: `${row.averageTaken}% taken · ${row.timesServed} servings` })) },
      visualization: { type: "bars", title: "Share of prepared servings taken", unit: "%", data: items.map((row, i) => ({ label: titleCase(row.item), value: row.averageTaken, highlight: i === 0 })) },
      recommendation: items[0].soldOutCount ? `${titleCase(items[0].item)} also ran out ${items[0].soldOutCount} times — preparing more of it would meet the demand.` : null,
      action: { label: "Open meal popularity", page: "mess", focus: { panel: "menu" } }
    };
  }

  if (intent === "MESS_UNAVAILABLE") {
    const out = M.menu.filter((row) => row.soldOutCount).sort((a, b) => b.soldOutCount - a.soldOutCount);
    const complaints = M.feedback.complaints.items.filter((row) => row.themes.includes("AVAILABILITY"));
    if (!out.length) return insufficient("MESS", "No dish has been recorded as running out in this window.");
    return {
      domain: "MESS",
      kind: "AI ANALYSIS",
      answer: `${titleCase(out[0].item)} runs out most often — ${out[0].soldOutCount} of ${out[0].timesServed} servings sold out, usually around ${out[0].soldOut[out[0].soldOut.length - 1]?.at}.`,
      points: [
        ...out.slice(1, 4).map((row) => `${titleCase(row.item)} · sold out ${row.soldOutCount} of ${row.timesServed} times`),
        ...(complaints.length ? [`${complaints.length} mess complaint${complaints.length === 1 ? " mentions" : "s mention"} food running out (${complaints.map((c) => c.reference).join(", ")})`] : [])
      ],
      confidence: null,
      confidenceBasis: "Sell-out times are recorded by the mess counter.",
      evidence: { dataConsidered, rows: out.flatMap((row) => row.soldOut.map((s) => ({ label: `${s.date} · ${titleCase(s.meal)}`, value: `${titleCase(row.item)} out at ${s.at}` }))).slice(0, 10) },
      visualization: { type: "bars", title: "Times sold out", unit: "times", data: out.slice(0, 6).map((row, i) => ({ label: titleCase(row.item), value: row.soldOutCount, highlight: i === 0 })) },
      recommendation: `Prepare more ${titleCase(out[0].item).toLowerCase()} on the days it is served, or stagger its release across the service window.`,
      action: { label: "Open availability", page: "mess", focus: { panel: "menu" } }
    };
  }

  if (intent === "MESS_WHY_DEMAND" || (intent === "MESS_PEAK" && /demand/.test(String(entities._q)))) {
    const meal = entities.meal || M.today.slice().sort((a, b) => Math.abs(b.trend.perWeekPct || 0) - Math.abs(a.trend.perWeekPct || 0))[0]?.meal || "DINNER";
    const t = M.today.find((row) => row.meal === meal)?.trend;
    if (!t || t.label === "INSUFFICIENT DATA") return insufficient("MESS", `There is not enough ${titleCase(meal).toLowerCase()} history to judge a demand trend.`);
    const series = t.series || [];
    const fb = M.feedback.byMeal.find((row) => row.meal === meal);
    const weekdays = M.patterns.byWeekday.find((row) => row.meal === meal)?.days.filter((d) => d.average !== null) || [];
    const topDay = weekdays.slice().sort((a, b) => b.average - a.average)[0];
    return {
      domain: "MESS",
      kind: "AI ANALYSIS",
      answer: `${titleCase(meal)} demand is ${t.label.replace("DEMAND ", "").toLowerCase()} — about ${t.perWeekPct >= 0 ? "+" : ""}${t.perWeekPct}% a week over the last 14 days (${series[0]?.covers.toLocaleString("en-IN")} → ${series[series.length - 1]?.covers.toLocaleString("en-IN")} covers). The mess log records how many ate, not why, so the cause is not in the data.`,
      points: [
        topDay ? `${dayName(topDay.weekday)} is the busiest ${titleCase(meal).toLowerCase()} (${topDay.average.toLocaleString("en-IN")} covers on average)` : null,
        fb ? `${titleCase(meal)} ratings: ${fb.averageRating} average, ${fb.negativeShare}% negative` : null
      ].filter(Boolean),
      confidence: null,
      confidenceBasis: `Linear trend over ${t.samples} recorded services.`,
      evidence: { dataConsidered, rows: series.map((s) => ({ label: s.date, value: `${s.covers} covers` })) },
      visualization: { type: "line", title: `${titleCase(meal)} covers · last 14 days`, unit: "covers", data: series.map((s) => ({ label: s.date.slice(5), value: s.covers })) },
      recommendation: t.perWeekPct > 0 ? `Plan ${titleCase(meal).toLowerCase()} preparation on the rising level, not the monthly average.` : null,
      action: { label: "Open the demand prediction", page: "mess", focus: { panel: "prediction", meal } }
    };
  }

  if (intent === "MESS_FEEDBACK") {
    const byMeal = M.feedback.byMeal.slice().sort((a, b) => b.negativeShare - a.negativeShare);
    if (!byMeal.length) return insufficient("MESS", "No meal ratings have been submitted in this window.");
    const pattern = M.feedback.patterns[0];
    const negThemes = M.feedback.distribution.filter((row) => row.negative).sort((a, b) => b.negative - a.negative).slice(0, 3);
    return {
      domain: "MESS",
      kind: "AI ANALYSIS",
      answer: `${titleCase(byMeal[0].meal)} gets the most negative feedback — ${byMeal[0].negativeShare}% of its ${byMeal[0].responses} ratings in the last ${M.windowDays} days. ${pattern ? pattern.headline : ""}`.trim(),
      points: [
        ...negThemes.map((row) => `${titleCase(row.theme)} · ${row.negative} negative mentions`),
        ...byMeal.slice(1, 3).map((row) => `${titleCase(row.meal)} · ${row.negativeShare}% negative`)
      ],
      confidence: pattern ? pattern.confidence : null,
      confidenceBasis: pattern ? "Week-over-week theme counts; grows with the number of mentions." : "Counts of rated meals.",
      evidence: { dataConsidered, rows: (pattern?.samples || M.feedback.recent.slice(0, 5)).map((row) => ({ label: `${row.date} · ${row.rating}★`, value: row.comment })) },
      visualization: { type: "bars", title: "Share of ratings that are negative", unit: "%", data: byMeal.map((row, i) => ({ label: titleCase(row.meal), value: row.negativeShare, highlight: i === 0 })) },
      recommendation: pattern ? `Review ${pattern.theme.toLowerCase()} at ${pattern.meal.toLowerCase()} with the mess committee — it is the fastest-rising complaint.` : null,
      action: { label: "Open feedback intelligence", page: "mess", focus: { panel: "feedback", meal: byMeal[0].meal } }
    };
  }

  if (intent === "MESS_WHAT_IF") {
    const meal = entities.meal || currentMeal();
    const change = entities.percent ?? 10;
    const { days } = await loadMealDays({ days: 35 });
    const prediction = predictMeal(days, meal, new Date());
    const sim = simulateMeal({ prediction, scenario: { attendanceChangePct: change } });
    if (sim.insufficient) return insufficient("MESS", sim.reason);
    return {
      domain: "MESS",
      kind: "SIMULATED RESULT",
      answer: `If ${Math.abs(change)}% ${change >= 0 ? "more" : "fewer"} students choose ${titleCase(meal).toLowerCase()}, demand goes from about ${sim.baseline.toLocaleString("en-IN")} to ${sim.expected.toLocaleString("en-IN")} covers. With the usual preparation (${sim.prepared.toLocaleString("en-IN")}) that is ${sim.shortage ? `a shortage of ${sim.shortage}` : `a surplus of ${sim.surplus} (≈${sim.surplusKg} kg)`}, and the busiest slot would be ${sim.capacityStatus.toLowerCase()} at ${sim.peakUtilisation}% of seats.`,
      points: sim.assumptions,
      confidence: prediction.confidence,
      confidenceBasis: `Confidence of the baseline prediction; the scenario itself is arithmetic. ${prediction.confidenceBasis}`,
      evidence: { dataConsidered, rows: prediction.samples.map((s) => ({ label: s.date, value: `${s.covers} covers` })) },
      visualization: { type: "compare", title: `${titleCase(meal)} covers`, data: [{ label: "Predicted", value: sim.baseline }, { label: "Scenario", value: sim.expected, highlight: true }, { label: "Prepared", value: sim.prepared }] },
      recommendation: sim.shortage ? `Prepare about ${sim.expected + Math.round(sim.expected * 0.03)} covers to absorb the change.` : null,
      action: { label: "Open the simulator", page: "mess", focus: { panel: "simulator", meal, attendanceChangePct: change } }
    };
  }

  if (intent === "MESS_PEAK") {
    const meal = entities.meal || currentMeal();
    const slots = M.patterns.bySlot.filter((row) => row.meal === meal);
    if (!slots.length) return insufficient("MESS", `No ${titleCase(meal).toLowerCase()} slots are recorded.`);
    const peak = slots.slice().sort((a, b) => b.averageCrowd - a.averageCrowd)[0];
    const quiet = slots.slice().sort((a, b) => a.averageQueue - b.averageQueue || a.averageCrowd - b.averageCrowd)[0];
    return {
      domain: "MESS",
      kind: "AI ANALYSIS",
      answer: `${titleCase(meal)} is busiest at ${peak.time} (about ${peak.averageCrowd} diners, ${peak.averageQueue}-minute queue). The quietest slot is ${quiet.time} (${quiet.averageQueue}-minute queue).`,
      points: slots.map((row) => `${row.time} · ${row.averageCrowd} diners · ${row.averageQueue} min queue`),
      confidence: null,
      confidenceBasis: `Averages over ${slots[0].samples} days of recorded slots.`,
      evidence: { dataConsidered, rows: slots.map((row) => ({ label: row.time, value: `${row.averageCrowd} diners · ${row.averageQueue} min` })) },
      visualization: { type: "bars", title: `${titleCase(meal)} · average diners by slot`, unit: "diners", data: slots.map((row) => ({ label: row.time, value: row.averageCrowd, highlight: row.time === peak.time })) },
      recommendation: `Go at ${quiet.time} to avoid the queue.`,
      action: { label: "Open today's meals", page: "mess", focus: { panel: "today", meal } }
    };
  }

  if (intent === "MESS_MENU") {
    const served = M.today.filter((row) => row.menu.length);
    if (!served.length) return insufficient("MESS", "Today's menu has not been recorded.");
    return {
      domain: "MESS",
      kind: "ACTUAL DATA",
      answer: served.map((row) => `${titleCase(row.meal)}: ${row.menu.map((m) => titleCase(m.item)).join(", ")}`).join(" · "),
      points: served.flatMap((row) => row.menu.filter((m) => m.soldOutAt).map((m) => `${titleCase(m.item)} ran out at ${m.soldOutAt}`)),
      confidence: null,
      confidenceBasis: "As recorded by the mess.",
      evidence: { dataConsidered: ["Today's mess log"], rows: served.map((row) => ({ label: titleCase(row.meal), value: row.menu.map((m) => titleCase(m.item)).join(", ") })) },
      visualization: null,
      recommendation: null,
      action: { label: "Open today's meals", page: "mess", focus: { panel: "today" } }
    };
  }
  return null;
}

const SUGGESTIONS = {
  ATTENDANCE: ["Why did my attendance fall this month?", "What happens if I miss 3 classes?", "Which days did I have the lowest attendance?", "What is causing my attendance risk?"],
  MESS: ["Which meal is most popular?", "Why is dinner demand increasing?", "What meals receive the most negative feedback?", "What happens if 15% more students choose dinner?"]
};

/** POST /api/students/me/query */
export async function answerQuestion(user, question, { domainHint = null } = {}) {
  const started = Date.now();
  const entities = { ...extractEntities(question), _q: String(question || "").toLowerCase() };
  let detected = detectIntent(question, { domainHint });
  let intentSource = "RULES";

  // Rules unsure? A configured model gets one chance to classify the intent.
  if (!detected.intent || detected.score < 2.5) {
    const model = await classifyIntentWithModel(question, INTENTS.map(({ id, description }) => ({ id, description })));
    if (model) {
      const spec = INTENTS.find((row) => row.id === model.intent);
      detected = { intent: spec.id, domain: spec.domain, confidence: model.confidence ?? detected.confidence, score: detected.score };
      intentSource = "AI_MODEL";
    }
  }

  const base = {
    question,
    intent: detected.intent || "UNKNOWN",
    domain: detected.domain || domainHint || "GENERAL",
    intentConfidence: detected.confidence,
    intentSource,
    entities: { subject: entities.subject, meal: entities.meal, count: entities.count, percent: entities.percent },
    method: "INTENT_MATCH → DATABASE QUERY → RULE-BASED ANALYSIS"
  };

  if (!detected.intent) {
    const domain = detected.domain || domainHint;
    return {
      ...base,
      insufficient: true,
      kind: "NOT UNDERSTOOD",
      answer: "I could not match that question to the attendance or mess data this system holds. Try one of these:",
      points: [],
      suggestions: domain ? SUGGESTIONS[domain] : [...SUGGESTIONS.ATTENDANCE.slice(0, 2), ...SUGGESTIONS.MESS.slice(0, 2)],
      evidence: { dataConsidered: [], rows: [] },
      visualization: null,
      action: null,
      provenance: { source: "RULES", note: "No intent matched." },
      latencyMs: Date.now() - started
    };
  }

  let result;
  if (detected.domain === "ATTENDANCE") {
    const asked = /month|30 days/.test(entities._q) ? 30 : /week|7 days/.test(entities._q) ? 7 : 14;
    let A = await attendanceIntelligence(user._id, { windowDays: asked });
    let windowNote = null;
    // "This month" on a register younger than two months has nothing to
    // compare against; say so and compare the halves that do exist.
    if (!A.empty && A.why.change === null && asked > 14) {
      A = await attendanceIntelligence(user._id, { windowDays: 14 });
      windowNote = `Your register starts on ${A.dataRange?.from}, so this compares the last 14 days with the 14 before instead of a full month.`;
    }
    result = answerAttendance(detected.intent, A, entities, question);
    if (result && windowNote) result.points = [windowNote, ...(result.points || [])];
  } else {
    const M = await messIntelligence({ days: 28 });
    result = await answerMess(detected.intent, M, entities);
  }
  if (!result) result = insufficient(detected.domain, "That question is recognised but this system does not hold the data to answer it.");

  const worded = result.insufficient
    ? { answer: result.answer, points: result.points, provenance: { source: "RULES", note: "Not enough data — nothing was sent to a model." } }
    : await narrate({ question, answer: result.answer, points: result.points, facts: (result.evidence?.rows || []).slice(0, 8).map((row) => `${row.label}: ${row.value}`) });

  return {
    ...base,
    ...result,
    answer: worded.answer,
    points: worded.points,
    ruleAnswer: result.answer,
    provenance: worded.provenance,
    suggestions: SUGGESTIONS[result.domain] || [],
    latencyMs: Date.now() - started
  };
}

// ---- dashboard summary ---------------------------------------------------------

/**
 * GET /api/students/me/intelligence — the dashboard's top section. Built from
 * the same analyses as the Attendance and Mess pages, so a number on the
 * dashboard always matches the page it links to.
 */
export async function studentSummary(user, { windowDays = 14 } = {}) {
  const [A, M] = await Promise.all([attendanceIntelligence(user._id, { windowDays }), messIntelligence({ days: 28 })]);

  const nextMeal = currentMeal();
  const mealToday = M.today.find((row) => row.meal === nextMeal) || M.today[0] || null;
  const tomorrowDinner = M.tomorrow.find((row) => row.meal === "DINNER") || null;

  const changes = [];
  const recommendations = [];
  const signals = [];

  if (!A.empty) {
    const w = A.why;
    if (w.change !== null) {
      changes.push({
        domain: "ATTENDANCE",
        direction: w.change < 0 ? "DOWN" : w.change > 0 ? "UP" : "FLAT",
        title: `Attendance ${w.change < 0 ? "down" : w.change > 0 ? "up" : "unchanged"} ${Math.abs(w.change)} points`,
        detail: `${pctText(w.from)} → ${pctText(w.to)} over the last ${windowDays} days · ${w.missed} of ${w.held} classes missed`,
        action: { page: "attendance", focus: { panel: "why" } }
      });
    }
    A.subjects.filter((s) => s.pattern === "DECLINING").slice(0, 3).forEach((s) => changes.push({
      domain: "ATTENDANCE",
      direction: "DOWN",
      title: `${titleCase(s.subject)} declining`,
      detail: `${s.recentRate}% recently vs ${s.priorRate}% before · now ${pctText(s.percentage)}`,
      action: { page: "attendance", focus: { panel: "subjects", subject: s.subject } }
    }));
    const slot = A.slotRates.slice().sort((a, b) => (a.recentRate ?? a.rate) - (b.recentRate ?? b.rate))[0];
    if (slot && slot.recentRate !== null && slot.recentRate < A.threshold - 15) {
      signals.push({
        kind: "AI ANALYSIS",
        tone: "high",
        title: `${slot.slot} classes are where attendance is lost`,
        body: `${pctText(slot.recentRate)} attended in the last ${windowDays} days, against ${pctText(A.slotRates.filter((s) => s.slot !== slot.slot).reduce((t, s) => t + (s.recentRate ?? 0), 0) / Math.max(1, A.slotRates.length - 1))} in other slots.`,
        action: { label: "See the timeline", page: "attendance", focus: { panel: "timeline" } }
      });
    }
    if (!A.eligible) {
      recommendations.push({
        kind: "AI RECOMMENDATION",
        text: `Attend the next ${A.classesToThreshold} classes without a miss to get back to ${A.threshold}%.`,
        action: { label: "Simulate it", page: "attendance", focus: { panel: "simulator", attend: A.classesToThreshold } }
      });
    }
    const worst = A.subjects.find((s) => s.risk === "CRITICAL" || s.risk === "HIGH");
    if (worst) {
      recommendations.push({
        kind: "AI RECOMMENDATION",
        text: `${titleCase(worst.subject)} is furthest behind at ${pctText(worst.percentage)} — ${worst.classesToThreshold} consecutive classes clears it.`,
        action: { label: "Open subject", page: "attendance", focus: { panel: "subjects", subject: worst.subject } }
      });
    }
    if (A.eligible && A.classesCanMiss <= 2) {
      recommendations.push({ kind: "AI RECOMMENDATION", text: `Your margin is thin — only ${A.classesCanMiss} more absence${A.classesCanMiss === 1 ? "" : "s"} before ${A.threshold}%.`, action: { label: "Simulate", page: "attendance", focus: { panel: "simulator" } } });
    }
  }

  const risingMeal = M.today
    .filter((row) => row.trend?.label === "DEMAND RISING")
    .sort((a, b) => b.trend.perWeekPct - a.trend.perWeekPct)[0];
  if (risingMeal) {
    changes.push({
      domain: "MESS",
      direction: "UP",
      title: `${titleCase(risingMeal.meal)} demand rising`,
      detail: `+${risingMeal.trend.perWeekPct}% a week over the last 14 days`,
      action: { page: "mess", focus: { panel: "prediction", meal: risingMeal.meal } }
    });
  }
  const pattern = M.feedback.patterns[0];
  if (pattern) {
    signals.push({
      kind: "AI DETECTED PATTERN",
      tone: "mid",
      title: `${titleCase(pattern.theme)} complaints at ${pattern.meal.toLowerCase()}`,
      body: pattern.headline,
      action: { label: "Open feedback", page: "mess", focus: { panel: "feedback", meal: pattern.meal } }
    });
  }
  if (mealToday?.peak) {
    const slots = M.patterns.bySlot.filter((row) => row.meal === mealToday.meal);
    const quiet = slots.slice().sort((a, b) => a.averageQueue - b.averageQueue || a.averageCrowd - b.averageCrowd)[0];
    if (quiet) {
      recommendations.push({
        kind: "AI RECOMMENDATION",
        text: `${titleCase(mealToday.meal)} peaks at ${mealToday.peak.time}; ${quiet.time} usually has the shortest queue (${quiet.averageQueue} min).`,
        action: { label: "Open mess", page: "mess", focus: { panel: "today", meal: mealToday.meal } }
      });
    }
  }

  // The one-paragraph insight: rule-written, optionally reworded by a model.
  let insight = null;
  if (!A.empty) {
    const first =
      A.why.change !== null && A.why.change < 0
        ? `Your attendance has fallen ${Math.abs(A.why.change)} points over the last ${windowDays} days, to ${pctText(A.overall)}.`
        : A.why.change !== null && A.why.change > 0
          ? `Your attendance has improved ${A.why.change} points over the last ${windowDays} days, to ${pctText(A.overall)}.`
          : `Your attendance is ${pctText(A.overall)}.`;
    const second = A.eligible
      ? `That keeps you ${round(A.overall - A.threshold, 1)} points above the ${A.threshold}% requirement${A.classesCanMiss <= 2 ? ", with little margin left" : ""}.`
      : `That is ${round(A.threshold - A.overall, 1)} points below the ${A.threshold}% requirement; ${A.classesToThreshold} consecutive attended classes clears it.`;
    const slot = A.slotRates.slice().sort((a, b) => a.rate - b.rate)[0];
    const third = slot && slot.rate < A.threshold - 10 ? `Most of the loss is in ${slot.slot} classes (${pctText(slot.rate)} attended).` : "";
    const text = [first, second, third].filter(Boolean).join(" ");
    const worded = await narrate({ question: "Summarise my attendance situation in two sentences.", answer: text, points: [], facts: A.classification.reasons });
    insight = {
      kind: "AI INSIGHT",
      text: worded.answer,
      ruleText: text,
      provenance: worded.provenance,
      confidence: A.classification.confidence,
      evidence: {
        dataConsidered: [`Attendance register · ${A.totalClasses} classes`, `Last ${windowDays} days vs the ${windowDays} before`],
        pattern: A.classification.pattern,
        reasons: A.classification.reasons,
        rule: A.classification.rule,
        confidenceBasis: A.classification.confidenceBasis
      }
    };
  }

  return {
    generatedAt: new Date(),
    windowDays,
    student: { name: user.name, studentId: user.studentId, hostelName: user.hostelName, room: user.room },
    attendance: A.empty
      ? { empty: true, message: A.message }
      : {
          overall: A.overall,
          threshold: A.threshold,
          change: A.why.change,
          status: A.status,
          risk: A.risk,
          pattern: A.classification.pattern,
          patternConfidence: A.classification.confidence,
          eligible: A.eligible,
          classesCanMiss: A.classesCanMiss,
          classesToThreshold: A.classesToThreshold,
          attendedClasses: A.attendedClasses,
          totalClasses: A.totalClasses,
          trend: A.trend.map((row) => ({ date: row.date, value: row.cumulative })),
          semester: A.semester,
          subjects: A.subjects.map((s) => ({ subject: s.subject, percentage: s.percentage, risk: s.risk, trend: s.trend }))
        },
    mess: mealToday
      ? {
          meal: mealToday.meal,
          window: mealToday.window,
          status: mealToday.demand?.label || (mealToday.prediction && !mealToday.prediction.insufficient ? "PREDICTED" : "NO DATA"),
          labels: mealToday.labels,
          peak: mealToday.peak,
          prediction: mealToday.prediction?.insufficient ? null : { predicted: mealToday.prediction.predicted, confidence: mealToday.prediction.confidence },
          tomorrowDinner: tomorrowDinner ? { predicted: tomorrowDinner.predicted, confidence: tomorrowDinner.confidence, low: tomorrowDinner.low, high: tomorrowDinner.high } : null,
          feedbackAlert: M.today.some((row) => row.labels.some((l) => l.label === "FEEDBACK ALERT"))
        }
      : null,
    risk: A.empty
      ? null
      : { level: A.risk, status: A.status, drivers: [A.classification.reasons[0], ...A.subjects.filter((s) => s.risk === "CRITICAL" || s.risk === "HIGH").map((s) => `${titleCase(s.subject)} ${pctText(s.percentage)}`)].filter(Boolean).slice(0, 4) },
    insight,
    changes,
    signals,
    recommendations: recommendations.slice(0, 4),
    upcoming: {
      classes: A.empty ? [] : A.upcoming.slice(0, 4),
      classesBasis: "Inferred from the weekday and slot your classes repeat on — not the official timetable.",
      meal: mealToday ? { meal: mealToday.meal, window: mealToday.window, menu: mealToday.menu.map((m) => m.item) } : null
    },
    suggestions: [...SUGGESTIONS.ATTENDANCE.slice(0, 3), ...SUGGESTIONS.MESS.slice(0, 2)]
  };
}
