import React from "react";
import { StateBox, Tag } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { ExtSection, Kind, NetLine, PageHead, SignInNote, SourceLine, day, inr, isAdmin, useExt } from "./kit.jsx";
import { ReceiptCopy } from "../xo/TouchlessPanels.jsx"; // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md)

/*
 * 16 — FEES & DUES. Read-only: status, dues and the next due date for a
 * student; outstanding dues by hostel, branch and year for the administration.
 * There is no payment gateway. Reminders go out through the Notice Center.
 */

const STATE_TAG = { PAID: "SAFE", DUE: "WATCH", OVERDUE: "CRITICAL" };

function Mine({ lowBw }) {
  const q = useExt(`fees:${lowBw}`, () => ext.myFees(false));
  return (
    <ExtSection q={q}>
      {(d) => d.empty ? <StateBox title="Insufficient data">{d.note}</StateBox> : (
        <div className="ext-stack">
          {d.accounts.map((a) => (
            <div key={a.academicYear} className="ext-stack">
              <div className="ci-strip" style={{ marginTop: 0 }}>
                <div><div className="ci-label">Status {a.academicYear}</div><div className="ext-row" style={{ marginTop: 8 }}><Tag kind={STATE_TAG[a.status]}>{a.status}</Tag><Kind kind={d.kind} /></div></div>
                <div><div className="ci-label">Outstanding</div><div className="ci-big" style={{ fontSize: 40 }}>{inr(a.totals.outstanding)}</div>{a.totals.overdue ? <span className="ci-meta">{inr(a.totals.overdue)} overdue</span> : null}</div>
                <div><div className="ci-label">Next due</div>{a.nextDue ? <><div className="ci-big" style={{ fontSize: 40 }}>{inr(a.nextDue.amount)}</div><span className="ci-meta">{a.nextDue.label} · {day(a.nextDue.dueDate)} · in {a.nextDue.daysToDue} day{a.nextDue.daysToDue === 1 ? "" : "s"}</span></> : <p className="ci-meta">Nothing upcoming.</p>}</div>
              </div>
              <div className="ext-table-wrap">
                <table className="ci-table">
                  <thead><tr><th>Head</th><th>Amount</th><th>Paid</th><th>Outstanding</th><th>Due</th><th>State</th></tr></thead>
                  <tbody>{a.heads.map((h) => <tr key={h.head}><td>{h.label}</td><td className="ci-num">{inr(h.amount)}</td><td className="ci-num">{inr(h.paid)}{h.payments.length ? <div className="ci-meta">{h.payments.map((p) => p.receipt).join(", ")}</div> : null}</td><td className="ci-num">{inr(h.outstanding)}</td><td>{day(h.dueDate)}</td><td><Tag kind={STATE_TAG[h.state]}>{h.state}</Tag></td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="ci-meta">{d.note} Reminders arrive as notices 7 days before each due date.</p>
          <SourceLine method={d.method} />
        </div>
      )}
    </ExtSection>
  );
}

function Group({ title, rows }) {
  return (
    <div className="ext-card">
      <div className="ci-label">By {title}</div>
      <div className="ext-table-wrap" style={{ marginTop: 8 }}>
        <table className="ci-table" style={{ minWidth: 380 }}>
          <thead><tr><th>{title}</th><th>With dues</th><th>Outstanding</th><th>Overdue</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={String(r.value)}><td>{String(r.value)}</td><td className="ci-num">{r.withDues}/{r.students}</td><td className="ci-num">{inr(r.outstanding)}</td><td className="ci-num">{inr(r.overdue)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

export function FeeSummary({ lowBw }) {
  const q = useExt(`feesum:${lowBw}`, () => ext.feeSummary(lowBw));
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-stack">
          <div className="ci-strip" style={{ marginTop: 0 }}>
            <div><div className="ci-label">Outstanding</div><div className="ci-big" style={{ fontSize: 40 }}>{inr(d.totals.outstanding)}</div><Kind kind={d.kind} /></div>
            <div><div className="ci-label">Overdue</div><div className="ci-big" style={{ fontSize: 40 }}>{inr(d.totals.overdue)}</div></div>
            <div><div className="ci-label">Students with dues</div><div className="ci-big" style={{ fontSize: 40 }}>{d.totals.studentsWithDues}/{d.totals.accounts}</div></div>
          </div>
          <div className="ext-grid">
            <Group title="Hostel" rows={d.byHostel} />
            <Group title="Branch" rows={d.byBranch} />
            <Group title="Year" rows={d.byYear} />
          </div>
          <div className="ext-table-wrap">
            <table className="ci-table"><thead><tr><th>Student</th><th>Hostel</th><th>Outstanding</th><th>Overdue</th><th>Next due</th></tr></thead>
              <tbody>{d.students.map((s) => <tr key={s.studentId}><td>{s.name}<div className="ci-meta">{s.studentId}</div></td><td>{s.hostel}</td><td className="ci-num">{inr(s.outstanding)}</td><td className="ci-num">{inr(s.overdue)}</td><td>{s.nextDue ? `${s.nextDue.label} · ${day(s.nextDue.dueDate)}` : "—"}</td></tr>)}</tbody></table>
          </div>
          <p className="ci-meta">Read-only ledger — no payment gateway. {lowBw ? "Low-bandwidth mode: tables trimmed to 3 rows." : ""}</p>
          <SourceLine method={d.method} />
        </div>
      )}
    </ExtSection>
  );
}

export default function FeesSurface({ user, lowBw, onGo }) {
  return (
    <div className="ci ext">
      <PageHead num="16" kicker="FEES & DUES" title={isAdmin(user) ? "Dues outstanding, by hostel, branch and year." : "What you owe, and when."}>
        A read-only view of the fee ledger: tuition, hostel, mess and fines, with due dates and receipts. Reminder notices go out a week before each due date. Payments are not taken here.
      </PageHead>
      <div style={{ marginTop: 18 }}><NetLine /></div>
      {!user ? <SignInNote what="your fee status" /> : isAdmin(user) ? <FeeSummary lowBw={lowBw} /> : user.role === "STUDENT" ? <Mine lowBw={lowBw} /> : <StateBox title="Fee summary is for administrators">Students see their own ledger; the administration sees the totals.</StateBox>}
      {/* EXCEPTION-ONLY HOOK: a copy of a fee receipt, decided by written policy §9.4 when it is on the ledger. */}
      <ReceiptCopy user={user} onGo={onGo} />
    </div>
  );
}
