import { FeeAccount } from "../../models/ext/FeeAccount.js";
import { round } from "../../utils/text.js";
import { audit } from "./extAudit.js";
import { istDateKey } from "./istTime.js";
import { createNotice } from "./noticeService.js";
import { everyoneWithProfiles } from "./profileService.js";
import { emitEvent } from "../xo/eventService.js"; // EXCEPTION-ONLY HOOK

/**
 * Fee & dues status. Read-only: there is no payment gateway, and nothing here
 * writes a payment. Reminders go out through the Notice Center.
 */

export const REMINDER_WINDOW_DAYS = 7;
const HEAD_LABEL = { TUITION: "Tuition", HOSTEL: "Hostel", MESS: "Mess", FINES: "Fines" };
const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Pure: the status of one fee account at `now`. */
export function accountStatus(account, now = new Date()) {
  const heads = (account.heads || []).map((h) => {
    const outstanding = Math.max(0, round(h.amount - h.paid, 2));
    const due = h.dueDate ? new Date(h.dueDate) : null;
    const overdue = outstanding > 0 && due && due < now;
    return {
      head: h.head,
      label: h.label || HEAD_LABEL[h.head],
      amount: h.amount,
      paid: h.paid,
      outstanding,
      dueDate: due,
      daysToDue: due ? Math.ceil((due - now) / 864e5) : null,
      state: outstanding === 0 ? "PAID" : overdue ? "OVERDUE" : "DUE",
      payments: h.payments || []
    };
  });
  const total = heads.reduce((t, h) => t + h.amount, 0);
  const paid = heads.reduce((t, h) => t + h.paid, 0);
  const outstanding = heads.reduce((t, h) => t + h.outstanding, 0);
  const overdue = heads.filter((h) => h.state === "OVERDUE").reduce((t, h) => t + h.outstanding, 0);
  const next = heads.filter((h) => h.outstanding > 0 && h.dueDate && h.dueDate >= now).sort((a, b) => a.dueDate - b.dueDate)[0] || null;
  return {
    academicYear: account.academicYear,
    heads,
    totals: { total, paid, outstanding, overdue },
    status: outstanding === 0 ? "PAID" : overdue > 0 ? "OVERDUE" : "DUE",
    nextDue: next ? { head: next.head, label: next.label, amount: next.outstanding, dueDate: next.dueDate, daysToDue: next.daysToDue } : null
  };
}

export async function myFees(student, { now = new Date() } = {}) {
  const accounts = await FeeAccount.find({ student: student._id }).sort({ academicYear: -1 }).lean();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  const outstanding = accounts.reduce((t, a) => t + (a.heads || []).reduce((s, h) => s + Math.max(0, h.amount - h.paid), 0), 0);
  emitEvent({ type: outstanding === 0 && accounts.length ? "FEES_CLEARED" : "FEE_STATUS_VIEWED", actor: student, student, subjectType: "FeeAccount", subjectId: accounts[0]?._id || student._id, channel: "APP", payload: { outstanding, accounts: accounts.length } });
  return {
    accounts: accounts.map((a) => accountStatus(a, now)),
    empty: !accounts.length,
    note: accounts.length ? "Read-only ledger. Payments are made at the accounts office; this app has no payment gateway." : "Insufficient data — no fee ledger on record for you.",
    method: "DATABASE_RECORDS",
    kind: "ACTUAL DATA"
  };
}

/** Outstanding dues by hostel, branch and year. */
export async function duesSummary({ now = new Date() } = {}) {
  const [accounts, people] = await Promise.all([FeeAccount.find().lean(), everyoneWithProfiles({ roles: ["STUDENT"] })]);
  const byId = new Map(people.map((p) => [String(p.user._id), p]));
  const groups = { hostel: new Map(), branch: new Map(), year: new Map() };
  const students = [];
  let outstanding = 0;
  let overdue = 0;
  for (const account of accounts) {
    const s = accountStatus(account, now);
    const who = byId.get(String(account.student));
    if (!who) continue;
    outstanding += s.totals.outstanding;
    overdue += s.totals.overdue;
    const keys = { hostel: who.user.hostelName || "—", branch: who.profile.branch || "—", year: who.profile.year || "—" };
    for (const [dim, key] of Object.entries(keys)) {
      if (!groups[dim].has(key)) groups[dim].set(key, { value: key, students: 0, withDues: 0, outstanding: 0, overdue: 0 });
      const g = groups[dim].get(key);
      g.students += 1;
      if (s.totals.outstanding > 0) g.withDues += 1;
      g.outstanding += s.totals.outstanding;
      g.overdue += s.totals.overdue;
    }
    if (s.totals.outstanding > 0) {
      students.push({ name: who.user.name, studentId: who.user.studentId, hostel: who.user.hostelName, outstanding: s.totals.outstanding, overdue: s.totals.overdue, status: s.status, nextDue: s.nextDue });
    }
  }
  const list = (m) => [...m.values()].sort((a, b) => b.outstanding - a.outstanding);
  return {
    totals: { accounts: accounts.length, outstanding, overdue, studentsWithDues: students.length },
    byHostel: list(groups.hostel),
    byBranch: list(groups.branch),
    byYear: list(groups.year),
    students: students.sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding),
    readOnly: true,
    method: "DATABASE_AGGREGATION",
    kind: "ACTUAL DATA"
  };
}

/** Reminder notices for dues falling inside the window. Idempotent per head and due date. */
export async function sendFeeReminders({ now = new Date(), actor, windowDays = REMINDER_WINDOW_DAYS } = {}) {
  const horizon = new Date(now.getTime() + windowDays * 864e5);
  const accounts = await FeeAccount.find({ "heads.dueDate": { $gte: now, $lte: horizon } });
  let sent = 0;
  for (const account of accounts) {
    let touched = false;
    for (const head of account.heads) {
      const outstanding = head.amount - head.paid;
      if (outstanding <= 0 || !head.dueDate || head.dueDate < now || head.dueDate > horizon) continue;
      const key = istDateKey(head.dueDate);
      if (head.remindedFor.includes(key)) continue;
      const days = Math.ceil((head.dueDate - now) / 864e5);
      await createNotice(
        {
          title: `${head.label || HEAD_LABEL[head.head]} fee due in ${days} day${days === 1 ? "" : "s"}`,
          body: `${inr(outstanding)} of your ${(head.label || HEAD_LABEL[head.head]).toLowerCase()} fee is due on ${key}. Pay at the accounts office or through the university portal.`,
          priority: days <= 2 ? "HIGH" : "NORMAL",
          audience: { users: [String(account.student)] },
          actionRequired: { label: `Pay ${inr(outstanding)}`, deadline: head.dueDate }
        },
        actor,
        { now, kind: "FEE_REMINDER", related: { kind: "FeeAccount", id: String(account._id), reference: `${account.academicYear}/${head.head}` } }
      );
      head.remindedFor.push(key);
      touched = true;
      sent += 1;
    }
    if (touched) {
      account.markModified("heads");
      await audit(account, { entityType: "FeeAccount", action: "FEE_REMINDER_SENT", actor, note: `reminder window ${windowDays} days` });
      await account.save();
    }
  }
  return sent;
}
