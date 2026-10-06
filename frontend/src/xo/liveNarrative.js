// Live figures for the landing story (page 01) and the incident page (06).
//
// The seven story chapters were written with fixed figures (6,240 students,
// 12 active incidents, a 23% drop…). These helpers rebuild each chapter's
// title and body from the public API's live values, and fall back to the
// original text, unchanged, for any chapter whose data is missing — which is
// always the case while the API is unreachable.

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];

/** 17 → "Seventeen"; numbers above twenty stay as digits. */
export const numberWord = (n) => (Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const titleCase = (text = "") => String(text).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** The incident the story is about: the highest-risk open one. */
export function leadIncident(live) {
  const list = live?.incidents?.incidents || [];
  return [...list].filter((i) => i.status !== "RESOLVED").sort((a, b) => (b.risk || 0) - (a.risk || 0))[0] || null;
}

const daysSince = (at) => (at ? Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 864e5)) : null);

/**
 * Pure: the chapter's [title, body] with live figures, or the original pair.
 * `chapter` is the NexCamp.chapters row; `live` is NexCamp.state.live.
 */
export function narrateChapter(chapter, live) {
  const [key, title, body] = chapter;
  const campus = live?.campus?.campus;
  const anomalies = live?.campus?.anomalies || [];
  const lead = leadIncident(live);
  if (!campus) return [title, body];
  switch (key) {
    case "CAMPUS":
      return [title, `${numberWord(campus.blocks)} blocks, ${Number(campus.students).toLocaleString("en-IN")} students, and thousands of small signals a day. The map below is assembled from live data, not drawn as a picture.`];
    case "PROBLEMS":
      return [title, `Water, Wi-Fi, electricity, cleanliness, mess load, attendance. Today the campus is carrying ${plural(campus.activeIncidents, "active incident")} and ${plural(campus.pendingComplaints, "pending complaint")}.`];
    case "PATTERNS": {
      const att = anomalies.find((a) => a.metric === "ATTENDANCE_0800");
      if (!att) return [title, body];
      return [`Attendance is falling in ${titleCase(att.building?.name || "one block")}.`, `${att.signal} over ${plural(att.daysObserved, "day")} — not evenly, only in the 8:00 AM slots. That is a pattern, not a number.`];
    }
    case "INCIDENTS": {
      if (!lead) return [title, body];
      const days = daysSince(lead.firstComplaintAt || lead.detectedAt);
      const where = titleCase(lead.building?.name || "One block");
      return [`${where} rises out of the campus.`, `${numberWord(lead.complaintCount)} complaint${lead.complaintCount === 1 ? "" : "s"}${days !== null ? ` in ${numberWord(days).toLowerCase()} day${days === 1 ? "" : "s"}` : ""}, all within one building, all describing the same thing in different words.`];
    }
    case "PREDICTION": {
      const silent = anomalies.filter((a) => a.complaintsSoFar === 0).sort((a, b) => b.predictedRisk - a.predictedRisk)[0];
      if (!silent) return [title, body];
      return [title, `${titleCase(silent.building?.name || "One block")}: ${silent.signal}. Predicted risk ${silent.predictedRisk}%, zero complaints so far. The system flags it before anyone reports it.`];
    }
    case "INVESTIGATION": {
      if (!lead) return [title, body];
      const history = (lead.evidence || []).find((e) => e.label === "HISTORY");
      const matches = history?.value && !/no matching/i.test(history.value) ? history.value.split(" · ").filter((part) => /^\d{4}-/.test(part)).length : 0;
      return [title, `${numberWord(lead.complaintCount)} complaint${lead.complaintCount === 1 ? "" : "s"} + same location + similar descriptions${matches ? ` + ${numberWord(matches).toLowerCase()} historical incident${matches === 1 ? "" : "s"}` : ""} + a maintenance delay pattern = ${lead.confidence}% confidence in ${String(lead.possibleCauses?.[0]?.cause || "the leading cause").split(" — ")[0].toLowerCase()}.`];
    }
    case "RESOLUTION": {
      const intervention = (live?.interventions || []).find((i) => i.projection?.riskBefore !== undefined && i.projection?.riskAfter !== undefined);
      if (!intervention) return [title, body];
      return [`Risk ${intervention.projection.riskBefore}% → ${intervention.projection.riskAfter}% in ${intervention.estimatedResolutionHours} hours.`, "The intervention simulator compared doing nothing with repairing now. The projection is recorded against a named decision, not measured yet. The campus zooms back out, one problem lighter."];
    }
    default:
      return [title, body];
  }
}

/** Page 06 headline: "Seventeen complaints. One problem." from the lead incident. */
export function incidentHeadline(live, fallback) {
  const lead = leadIncident(live);
  if (!lead || !Number.isInteger(lead.complaintCount)) return fallback;
  return `${numberWord(lead.complaintCount)} complaint${lead.complaintCount === 1 ? "" : "s"}. One problem.`;
}

/** Page 06 core caption: counts, wording overlap and memory matches from live data. */
export function incidentCaption(live, clusterRun, fallback) {
  const lead = leadIncident(live);
  if (!lead) return fallback;
  const language = (lead.evidence || []).find((e) => e.label === "LANGUAGE")?.value || "";
  const overlap = clusterRun?.clusters?.[0]?.averageOverlap ?? Number(/(\d+(?:\.\d+)?)% average keyword overlap/.exec(language)?.[1]);
  const history = (lead.evidence || []).find((e) => e.label === "HISTORY")?.value || "";
  const matches = /no matching/i.test(history) ? 0 : history.split(" · ").filter((part) => /^\d{4}-/.test(part)).length;
  return `${plural(lead.complaintCount, "complaint")} · ${Number.isFinite(overlap) ? `${overlap}% wording overlap` : "wording overlap not measured"} · ${plural(matches, "historical match", "historical matches")}`;
}
