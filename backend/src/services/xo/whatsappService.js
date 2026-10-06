import { aiConfigured } from "../../config/env.js";
import { AI_SOURCES } from "../../config/constants.js";
import { User } from "../../models/User.js";
import { nextReference } from "../../models/ext/common.js";
import { ImportBatch } from "../../models/xo/ImportBatch.js";
import { FaqDraft } from "../../models/xo/FaqDraft.js";
import { ApiError } from "../../utils/ApiError.js";
import { round, similarity, tokenize } from "../../utils/text.js";
import { completeJson } from "../ai/providerClient.js";
import { guard } from "../ai/jsonGuard.js";
import { record } from "../auditChainService.js";
import { parseCsv } from "../ext/adoptionExtService.js";
import { createNotice } from "../ext/noticeService.js";
import { fileComplaintViaController } from "../ext/smsKeywordService.js";
import { emitEvent } from "./eventService.js";

/**
 * Chaos import (Phase 7): a college's WhatsApp group, read into the system.
 *
 *   parse     Android ("26/09/2026, 22:14 - Name: text") and iOS
 *             ("[26/09/26, 10:14:05 PM] Name: text") exports; continuation
 *             lines join the message above; system lines are dropped
 *   classify  NOTICE | COMPLAINT | QUESTION | REQUEST | NOISE by keyword rules
 *             first; an optional model may relabel only what the rules could
 *             not decide, through jsonGuard, and every label says its source
 *   report    notices posted 23:00–06:00, superseded notices, complaints never
 *             acknowledged, repeated questions — each with its evidence lines
 *   convert   dry run by default; "convert" files complaints and notices
 *             through the existing services and FAQ drafts for page 19, all
 *             tagged channel IMPORT and audited
 */

export const LABELS = ["NOTICE", "COMPLAINT", "QUESTION", "REQUEST", "NOISE"];
const MAX_LINES = 20000;

const ANDROID = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?:\s*([ap]\.?\s?m\.?))?\s+[-–]\s+(.*)$/i;
const IOS = /^‎?\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?\]\s+(.*)$/i;

/** Pure: a date from export parts, read as IST wall-clock time. */
export function exportDate(d, m, y, h, min, ampm) {
  let year = Number(y);
  if (year < 100) year += 2000;
  let hour = Number(h);
  const mer = String(ampm || "").toLowerCase().replace(/[.\s]/g, "");
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  return new Date(Date.UTC(year, Number(m) - 1, Number(d), hour, Number(min)) - 330 * 60000);
}

/** Pure: export text → messages { at, sender, text, line, format }. */
export function parseExport(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").slice(0, MAX_LINES);
  const out = [];
  let format = null;
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/^﻿/, "");
    if (!line.trim()) continue;
    let m = ANDROID.exec(line);
    let body;
    let at;
    if (m) {
      format ||= "ANDROID";
      at = exportDate(m[1], m[2], m[3], m[4], m[5], m[6]);
      body = m[7];
    } else if ((m = IOS.exec(line))) {
      format ||= "IOS";
      at = exportDate(m[1], m[2], m[3], m[4], m[5], m[7]);
      body = m[8];
    }
    if (body !== undefined) {
      const colon = body.indexOf(": ");
      if (colon < 1) continue; // system line: "X joined", "Messages are end-to-end encrypted"
      out.push({ at, sender: body.slice(0, colon).trim(), text: body.slice(colon + 2).trim(), line: i + 1 });
    } else if (out.length) {
      out[out.length - 1].text += `\n${line.trim()}`;
    }
  }
  return { messages: out, format: format || "UNKNOWN", lines: lines.length };
}

const STAFFISH = /\b(sir|madam|ma'am|office|warden|hod|dean|admin|faculty|prof|dr\.?|cr|class rep|mess manager|registrar)\b/i;
const NOISE = /^(ok+|okay|k|thanks?|thank you|ty|tq|👍+|🙏+|😂+|yes|no|hmm+|lol|good (morning|night)|gm|gn|done|noted sir|<media omitted>|image omitted|sticker omitted|this message was deleted)[.!\s]*$/i;
const NOTICE_WORDS = /\b(notice|attention|all students|kindly|hereby|is informed|are informed|will be|last date|deadline|cancelled|canceled|postponed|rescheduled|shifted|holiday|circular|mandatory|compulsory|submit|timings?|schedule)\b/i;
const COMPLAINT_WORDS = /\b(no water|not working|broken|leak(ing)?|dirty|smell(s|ing)?|power cut|no power|no electricity|wifi (is )?(down|not)|not clean|stuck|blocked|fused|tripped|cold food|insects?|cockroach|garbage|overflow(ing)?)\b/i;
const QUESTION_START = /^(who|what|when|where|which|why|how|is|are|any|does|do|can|could|will|kab|kya|kaun|kahan|anyone)\b/i;
const REQUEST_WORDS = /\b(please (send|share|give|provide|issue|allow|approve)|need (a|the)|requesting|request for|bonafide|certificate|gate pass|permission|leave application|noc|no dues)\b/i;
const ACK_WORDS = /\b(noted|will (check|look|send|fix|do)|done|fixed|resolved|sending (someone|plumber|electrician)|on it|looking into|plumber|electrician|attended)\b/i;
const SUPERSEDE_WORDS = /\b(revised|updated|correction|corrected|postponed|rescheduled|changed|cancelled|canceled|instead|new time|ignore (the )?(previous|earlier))\b/i;

/** Pure: the rule label for one message, with the rule that fired. */
export function classifyMessage({ sender, text }) {
  const t = String(text || "").trim();
  if (!t || NOISE.test(t)) return { label: "NOISE", rule: "short acknowledgement or media placeholder" };
  if (COMPLAINT_WORDS.test(t) && !STAFFISH.test(sender)) return { label: "COMPLAINT", rule: `problem words: ${COMPLAINT_WORDS.exec(t)[0]}` };
  if (STAFFISH.test(sender) && ACK_WORDS.test(t) && t.length < 80) return { label: "NOISE", rule: "staff acknowledgement (a reply, used by the acknowledgement check)" };
  if (REQUEST_WORDS.test(t)) return { label: "REQUEST", rule: `request words: ${REQUEST_WORDS.exec(t)[0]}` };
  if (/\?\s*$/.test(t) || QUESTION_START.test(t)) return { label: "QUESTION", rule: /\?\s*$/.test(t) ? "ends with a question mark" : "starts like a question" };
  if (STAFFISH.test(sender) && (NOTICE_WORDS.test(t) || t.length > 80)) return { label: "NOTICE", rule: `from ${sender.match(STAFFISH)[0]} with notice wording` };
  if (/^(notice|attention|important|urgent)\b/i.test(t)) return { label: "NOTICE", rule: "starts like a notice" };
  if (COMPLAINT_WORDS.test(t)) return { label: "COMPLAINT", rule: `problem words: ${COMPLAINT_WORDS.exec(t)[0]}` };
  if (t.length < 25) return { label: "NOISE", rule: "short chat" };
  return { label: null, rule: "no rule matched" };
}

const IST_HOUR = (d) => (new Date(d).getUTCHours() + 5 + (new Date(d).getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
const evidence = (m) => ({ line: m.line, at: m.at, sender: m.sender, text: m.text.slice(0, 280) });

/** Pure: the report from classified messages. */
export function analyse(messages) {
  const notices = messages.filter((m) => m.label === "NOTICE");
  const night = notices.filter((m) => {
    const h = IST_HOUR(m.at);
    return h >= 23 || h < 6;
  });
  const superseded = [];
  for (const [i, a] of notices.entries()) {
    const b = notices.slice(i + 1).find((n) => new Date(n.at) - new Date(a.at) <= 7 * 864e5 && SUPERSEDE_WORDS.test(n.text) && similarity(a.text, n.text) >= 0.2);
    if (b) superseded.push({ original: evidence(a), replacement: evidence(b), overlapPct: round(similarity(a.text, b.text) * 100) });
  }
  const complaints = messages.filter((m) => m.label === "COMPLAINT");
  // Acknowledged = a staff reply with acknowledgement words within 24 h that either shares
  // wording with the complaint, or is the first staff reply within 3 h with no other
  // complaint in between. A generic "noted" to someone else does not count.
  const unacknowledged = complaints.filter((c) => {
    const t0 = new Date(c.at).getTime();
    const after = messages.filter((m) => new Date(m.at).getTime() > t0 && new Date(m.at).getTime() <= t0 + 24 * 3600000);
    const shared = (m) => tokenize(m.text).some((w) => w.length > 2 && tokenize(c.text).includes(w));
    const direct = after.find((m) => STAFFISH.test(m.sender) && ACK_WORDS.test(m.text) && shared(m));
    const firstStaff = after.find((m) => STAFFISH.test(m.sender));
    const between = firstStaff ? after.filter((m) => new Date(m.at) < new Date(firstStaff.at) && m.label === "COMPLAINT").length : 1;
    const next = firstStaff && ACK_WORDS.test(firstStaff.text) && new Date(firstStaff.at).getTime() - t0 <= 3 * 3600000 && between === 0;
    return !direct && !next;
  });
  const questions = messages.filter((m) => m.label === "QUESTION");
  const clusters = [];
  for (const q of questions) {
    const hit = clusters.find((c) => similarity(c.questions[0].text, q.text) >= 0.3);
    if (hit) hit.questions.push(q);
    else clusters.push({ questions: [q] });
  }
  const repeated = clusters
    .filter((c) => c.questions.length >= 2)
    .map((c) => ({ question: c.questions[0].text.replace(/\n/g, " ").slice(0, 200), times: c.questions.length, askers: new Set(c.questions.map((q) => q.sender)).size, terms: [...new Set(tokenize(c.questions.map((q) => q.text).join(" ")))].slice(0, 6), evidence: c.questions.slice(0, 5).map(evidence) }))
    .sort((a, b) => b.times - a.times);
  const counts = Object.fromEntries(LABELS.map((l) => [l, messages.filter((m) => m.label === l).length]));
  return {
    counts,
    findings: {
      nightNotices: { count: night.length, text: `${night.length} of ${notices.length} notices were posted between 23:00 and 06:00.`, evidence: night.slice(0, 12).map(evidence) },
      superseded: { count: superseded.length, text: `${superseded.length} notice${superseded.length === 1 ? " was" : "s were"} later corrected or replaced in the group — students had to spot the correction themselves.`, pairs: superseded.slice(0, 10) },
      unacknowledged: { count: unacknowledged.length, text: `${unacknowledged.length} of ${complaints.length} complaints got no acknowledgement from staff within 24 hours.`, evidence: unacknowledged.slice(0, 15).map(evidence) },
      repeatedQuestions: { count: repeated.length, text: `${repeated.length} question${repeated.length === 1 ? " was" : "s were"} asked more than once — candidates for the Office FAQ.`, clusters: repeated.slice(0, 12) }
    }
  };
}

/** Optional: a model relabels only the messages the rules left undecided. */
async function modelLabels(undecided) {
  if (!undecided.length) return { source: AI_SOURCES.NOT_CONFIGURED, labels: new Map(), note: "Every message was labelled by the keyword rules." };
  if (!aiConfigured()) return { source: AI_SOURCES.NOT_CONFIGURED, labels: new Map(), note: `${undecided.length} messages matched no rule and are labelled NOISE; no AI provider is configured.` };
  const batch = undecided.slice(0, 40);
  try {
    const result = await completeJson({
      system: `Label each campus WhatsApp message as one of ${LABELS.join(", ")}. Reply with JSON {"labels": [..]} — one label per message, in order, nothing else.`,
      prompt: batch.map((m, i) => `${i + 1}. ${m.sender}: ${m.text.slice(0, 200)}`).join("\n")
    });
    const { value } = guard(result.json, { labels: { type: "list", limit: batch.length, max: 12 } });
    const labels = new Map();
    (value.labels || []).forEach((l, i) => {
      const clean = String(l).toUpperCase().trim();
      if (LABELS.includes(clean) && batch[i]) labels.set(batch[i], clean);
    });
    return { source: AI_SOURCES.MODEL, provider: result.provider, model: result.model, labels, note: `${labels.size} of ${undecided.length} undecided messages labelled by the model (validated to the five labels); the rest are NOISE.` };
  } catch (error) {
    return { source: AI_SOURCES.FALLBACK, labels: new Map(), note: `AI provider unavailable (${error.reason || "error"}); undecided messages are labelled NOISE.` };
  }
}

/** Optional CSV: a gate register or a complaint diary, summarised and (diary) converted. */
export function readCsv(csvText) {
  if (!csvText) return null;
  const all = parseCsv(csvText);
  const headers = all[0] || [];
  const rows = all.slice(1).map((cells) => Object.fromEntries(headers.map((head, i) => [head, cells[i] ?? ""])));
  const h = headers.map((x) => String(x).toLowerCase());
  const diary = h.some((x) => /complaint|problem|issue/.test(x));
  const gate = h.some((x) => /out|exit|return|in time|in_time/.test(x));
  if (diary) {
    const col = headers[h.findIndex((x) => /complaint|problem|issue/.test(x))];
    const who = headers[h.findIndex((x) => /name|student|by/.test(x))];
    const room = headers[h.findIndex((x) => /room|location|place/.test(x))];
    return { kind: "COMPLAINT_DIARY", rows: rows.length, complaints: rows.map((r, i) => ({ line: i + 2, sender: r[who] || "diary", text: r[col] || "", room: r[room] || null, label: "COMPLAINT" })).filter((r) => r.text) };
  }
  if (gate) {
    const late = rows.filter((r) => Object.entries(r).some(([k, v]) => /late|remark/i.test(k) && /late|yes/i.test(String(v)))).length;
    return { kind: "GATE_REGISTER", rows: rows.length, late, text: `${rows.length} outings in the paper register, ${late} marked late — the gate-pass page (11) replaces this register.` };
  }
  return { kind: "UNKNOWN", rows: rows.length, text: "The CSV headers were not recognised as a gate register or a complaint diary." };
}

/** Dry run (default) or convert. */
export async function importChat(actor, { text, csv, name = "WhatsApp group", convert = false }) {
  const parsed = parseExport(text);
  if (!parsed.messages.length) throw ApiError.badRequest("No messages found — upload a WhatsApp chat export (.txt) in the Android or iOS format");
  const messages = parsed.messages.map((m) => {
    const c = classifyMessage(m);
    return { ...m, label: c.label, rule: c.rule, labelSource: c.label ? "RULE" : null };
  });
  const undecided = messages.filter((m) => !m.label);
  const model = await modelLabels(undecided);
  for (const m of undecided) {
    const l = model.labels.get(m);
    m.label = l || "NOISE";
    m.labelSource = l ? "AI_MODEL" : "RULE_DEFAULT";
  }
  const report = analyse(messages);
  const csvReport = readCsv(csv);
  const span = { from: messages[0].at, to: messages[messages.length - 1].at };
  const summary = {
    name,
    format: parsed.format,
    lines: parsed.lines,
    messages: messages.length,
    senders: new Set(messages.map((m) => m.sender)).size,
    span,
    classification: { method: "KEYWORD_RULES_FIRST", source: model.source, provider: model.provider || null, model: model.model || null, note: model.note, ruleLabelled: messages.filter((m) => m.labelSource === "RULE").length },
    ...report,
    csv: csvReport,
    sample: messages.slice(0, 40).map((m) => ({ line: m.line, at: m.at, sender: m.sender, text: m.text.slice(0, 200), label: m.label, rule: m.rule, labelSource: m.labelSource })),
    kind: "ACTUAL DATA"
  };
  if (!convert) return { dryRun: true, written: 0, ...summary, note: "Dry run — nothing was written. Convert to file the complaints and notices through the normal services." };

  // ---- convert --------------------------------------------------------------------------
  const batch = await ImportBatch.create({ reference: await nextReference("IMP"), name, format: parsed.format, messages: messages.length, byName: actor.name, counts: report.counts });
  const students = await User.find({ role: "STUDENT" }).select("name studentId hostelName room department course semester role").lean();
  const byName = (sender) => students.find((s) => s.name.toLowerCase() === String(sender).toLowerCase()) || students.find((s) => s.name.split(" ")[0].toLowerCase() === String(sender).split(" ")[0].toLowerCase());
  const created = { complaints: [], notices: [], faqDrafts: [], skipped: [] };
  const toFile = [...messages.filter((m) => m.label === "COMPLAINT"), ...(csvReport?.complaints || [])].slice(0, 60);
  for (const m of toFile) {
    const student = byName(m.sender);
    if (!student) {
      created.skipped.push({ line: m.line, reason: `sender "${m.sender}" is not a registered student — not filed` });
      continue;
    }
    try {
      const data = await fileComplaintViaController(student, { title: m.text.replace(/\n/g, " ").slice(0, 80), description: `${m.text.slice(0, 1800)} (imported from ${name}, line ${m.line})`, category: "OTHER", location: [student.hostelName, m.room].filter(Boolean).join(" · ") || undefined });
      created.complaints.push({ reference: data.complaint.reference, line: m.line });
      emitEvent({ type: "COMPLAINT_CREATED", actor, student, subjectType: "Complaint", subjectId: data.complaint.id, subjectRef: data.complaint.reference, channel: "IMPORT", humanTouch: false, payload: { batch: batch.reference, line: m.line } });
    } catch (error) {
      created.skipped.push({ line: m.line, reason: error.message });
    }
  }
  for (const m of messages.filter((x) => x.label === "NOTICE").slice(-10)) {
    const notice = await createNotice({ title: m.text.replace(/\n/g, " ").slice(0, 150), body: `${m.text.slice(0, 1800)}\n\n(Imported from ${name}; originally posted by ${m.sender} on ${new Date(m.at).toISOString().slice(0, 10)}.)`, priority: "INFO", audience: { roles: ["STUDENT"] }, scheduledFor: new Date(Date.now() + 365 * 864e5).toISOString() }, actor, { kind: "GENERAL" });
    created.notices.push({ reference: notice.reference, line: m.line, status: notice.status });
  }
  for (const c of report.findings.repeatedQuestions.clusters) {
    const draft = await FaqDraft.create({ question: c.question, times: c.times, askers: c.askers, terms: c.terms, source: `${batch.reference} · ${name}`, evidence: c.evidence.map((e) => `line ${e.line}: ${e.text}`).slice(0, 5) });
    created.faqDrafts.push({ id: String(draft._id), question: c.question });
  }
  batch.result = { complaints: created.complaints.length, notices: created.notices.length, faqDrafts: created.faqDrafts.length, skipped: created.skipped.length };
  await batch.save();
  await record({ entityType: "ImportBatch", entityId: batch._id, entityRef: batch.reference, action: "WHATSAPP_IMPORTED", actor, note: `${messages.length} messages · ${created.complaints.length} complaints, ${created.notices.length} notices (scheduled, not sent), ${created.faqDrafts.length} FAQ drafts · channel IMPORT` });
  return { dryRun: false, batch: batch.reference, written: created.complaints.length + created.notices.length + created.faqDrafts.length, created, ...summary, note: "Imported notices are saved as SCHEDULED a year ahead so nobody is re-notified; publish or cancel them on page 13." };
}

export async function faqDrafts() {
  const rows = await FaqDraft.find().sort({ times: -1, createdAt: -1 }).limit(40).lean();
  return { drafts: rows.map((r) => ({ id: String(r._id), question: r.question, times: r.times, askers: r.askers, terms: r.terms, status: r.status, source: r.source, evidence: r.evidence })), kind: "ACTUAL DATA" };
}
