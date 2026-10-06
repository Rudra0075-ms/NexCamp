import { AI_SOURCES } from "../../config/constants.js";
import { aiConfigured } from "../../config/env.js";
import { FaqQuery } from "../../models/ext/FaqQuery.js";
import { PolicySection, POLICY_CATEGORIES } from "../../models/ext/PolicySection.js";
import { ApiError } from "../../utils/ApiError.js";
import { round, tokenize } from "../../utils/text.js";
import { completeJson } from "../ai/providerClient.js";
import { guard } from "../ai/jsonGuard.js";
import { audit } from "./extAudit.js";
import { fileComplaintViaController } from "./smsKeywordService.js";

/**
 * Office FAQ assistant with citations (PS07 extension 2D).
 *
 * Retrieval is deterministic keyword scoring over the policy corpus; the
 * answer is always the retrieved section, shown with its key and source. If a
 * language model is configured it may only rephrase that section into the
 * chosen language. Its output passes jsonGuard, and any rephrasing that
 * introduces a number the section does not contain is discarded.
 */

export const MATCH_THRESHOLD = 0.3;
export const LANGUAGES = { EN: "English", OR: "Odia", HI: "Hindi" };

/** Light suffix stripping so "certificates" and "certificate" meet. */
export function stem(word) {
  let w = String(word).toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (/(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export const terms = (text) => [...new Set(tokenize(text).map(stem).filter((w) => w.length > 2))];

/**
 * Pure: scores each section against a question.
 * Weight 2 for a keyword, 1 for a title word, 0.5 for a body word; the score
 * is that sum over twice the question's term count, so 1.0 means every term
 * hit a keyword.
 */
export function rank(question, sections) {
  const q = terms(question);
  if (!q.length) return [];
  return sections
    .map((section) => {
      const keywords = new Set((section.keywords || []).flatMap((k) => terms(k)));
      const title = new Set(terms(section.title));
      const body = new Set(terms(section.body));
      let weight = 0;
      const matched = [];
      for (const term of q) {
        const w = keywords.has(term) ? 2 : title.has(term) ? 1 : body.has(term) ? 0.5 : 0;
        if (w) matched.push(term);
        weight += w;
      }
      return { section, score: round(weight / (2 * q.length), 3), matched };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}

const numbersIn = (text) => new Set((String(text).match(/\d+(?:[.:]\d+)?/g) || []).map((n) => n.replace(/^0+(?=\d)/, "")));

/** Pure: a rephrasing may not contain a number the section does not. */
export function numbersPreserved(original, rephrased) {
  const allowed = numbersIn(original);
  return [...numbersIn(rephrased)].every((n) => allowed.has(n));
}

const shapeSection = (s) => ({ key: s.key, title: s.title, category: s.category, body: s.body, source: s.source, version: s.version, updatedAt: s.updatedAt, updatedByName: s.updatedByName || null });

async function rephrase(section, lang) {
  const language = LANGUAGES[lang] || "English";
  if (!aiConfigured()) {
    return {
      text: section.body,
      source: AI_SOURCES.NOT_CONFIGURED,
      note: lang === "EN" ? "Showing the policy section as written." : `No AI provider is configured, so the section is shown in its original English rather than ${language}.`
    };
  }
  try {
    const result = await completeJson({
      system:
        `You restate one campus policy section for a student in ${language}. Use only the facts in the section. ` +
        "Do not add rules, numbers, dates, fees or times that are not in it. Reply with JSON: {\"answer\": string}.",
      prompt: `SECTION ${section.key} — ${section.title}\n${section.body}`
    });
    const { value } = guard(result.json, { answer: { type: "text", max: 900 } });
    if (!value.answer || !numbersPreserved(section.body, value.answer)) {
      return { text: section.body, source: AI_SOURCES.FALLBACK, note: "The model's rephrasing was rejected by validation; showing the section as written." };
    }
    return { text: value.answer, source: AI_SOURCES.MODEL, provider: result.provider, model: result.model, note: `Rephrased in ${language} by the model from the cited section only.` };
  } catch (error) {
    return { text: section.body, source: AI_SOURCES.FALLBACK, note: `AI provider unavailable (${error.reason || "error"}); showing the section as written.` };
  }
}

export async function ask(user, { question, lang = "EN" }) {
  const sections = await PolicySection.find().lean();
  const ranked = rank(question, sections);
  const top = ranked[0];
  const answered = Boolean(top && top.score >= MATCH_THRESHOLD);
  const log = await FaqQuery.create({
    question,
    normalised: terms(question).sort().join(" "),
    lang,
    user: user?._id,
    answered,
    sectionKey: top?.section.key,
    score: top?.score
  });
  const base = {
    queryId: String(log._id),
    question,
    lang,
    retrieval: { method: "KEYWORD_OVERLAP_SCORING", threshold: MATCH_THRESHOLD, topScore: top?.score ?? 0, matchedTerms: top?.matched || [] },
    alternatives: ranked.slice(1, 3).map((r) => ({ key: r.section.key, title: r.section.title, score: r.score }))
  };
  if (!answered) {
    return {
      ...base,
      answered: false,
      answer: null,
      message: "No policy section matches this question closely enough to answer it. You can send it to the office as a request.",
      offerRequest: true,
      source: AI_SOURCES.NOT_CONFIGURED,
      kind: "INSUFFICIENT DATA"
    };
  }
  const phrased = await rephrase(top.section, lang);
  return {
    ...base,
    answered: true,
    answer: phrased.text,
    citation: shapeSection(top.section),
    source: phrased.source,
    provider: phrased.provider || null,
    model: phrased.model || null,
    note: phrased.note,
    kind: "EVIDENCE"
  };
}

/** "Create a request": files the question to the office through the existing complaint path. */
export async function createRequest(user, { queryId, question }) {
  const log = queryId ? await FaqQuery.findById(queryId) : null;
  if (log && String(log.user) !== String(user._id)) throw ApiError.forbidden("Not your question");
  const text = log?.question || question;
  if (!text) throw ApiError.badRequest("question is required");
  const data = await fileComplaintViaController(user, {
    title: `Office query: ${text.length > 140 ? `${text.slice(0, 137)}…` : text}`,
    description: `${text}\n\n(Raised from the Office FAQ assistant — no policy section answered it.)`,
    category: "OTHER",
    location: "ADMIN BLOCK"
  });
  if (log) {
    log.requestReference = data.complaint.reference;
    await log.save();
  }
  return { reference: data.complaint.reference, department: data.complaint.department, status: data.complaint.status };
}

export async function listSections() {
  const rows = await PolicySection.find().sort({ category: 1, key: 1 }).lean();
  return { sections: rows.map(shapeSection), categories: POLICY_CATEGORIES };
}

export async function upsertSection(actor, key, input) {
  let section = await PolicySection.findOne({ key });
  const creating = !section;
  if (creating) {
    if (!input.title || !input.body || !input.category) throw ApiError.badRequest("A new section needs title, category and body");
    section = new PolicySection({ key });
  }
  const before = creating ? "" : `v${section.version}`;
  for (const field of ["title", "category", "body", "keywords", "source"]) if (input[field] !== undefined) section[field] = input[field];
  if (!creating) section.version += 1;
  section.updatedByName = actor.name;
  await audit(section, { entityType: "PolicySection", action: creating ? "POLICY_SECTION_CREATED" : "POLICY_SECTION_EDITED", actor, field: key, previousValue: before, newValue: `v${section.version}` });
  await section.save();
  return shapeSection(section);
}

export async function faqStats() {
  const [asked, unanswered, totals] = await Promise.all([
    FaqQuery.aggregate([
      { $group: { _id: "$normalised", n: { $sum: 1 }, example: { $first: "$question" }, answered: { $sum: { $cond: ["$answered", 1, 0] } }, section: { $first: "$sectionKey" } } },
      { $sort: { n: -1 } },
      { $limit: 10 }
    ]),
    FaqQuery.find({ answered: false }).sort({ createdAt: -1 }).limit(15).lean(),
    FaqQuery.aggregate([{ $group: { _id: null, total: { $sum: 1 }, answered: { $sum: { $cond: ["$answered", 1, 0] } }, requests: { $sum: { $cond: [{ $ifNull: ["$requestReference", false] }, 1, 0] } } } }])
  ]);
  const t = totals[0] || { total: 0, answered: 0, requests: 0 };
  return {
    totals: { asked: t.total, answered: t.answered, unanswered: t.total - t.answered, answerRate: t.total ? round((t.answered / t.total) * 100, 1) : null, requestsFiled: t.requests },
    mostAsked: asked.map((r) => ({ question: r.example, count: r.n, answered: r.answered, sectionKey: r.section || null })),
    unanswered: unanswered.map((r) => ({ question: r.question, at: r.createdAt, lang: r.lang, requestReference: r.requestReference || null })),
    method: "DATABASE_AGGREGATION",
    kind: "ACTUAL DATA"
  };
}
