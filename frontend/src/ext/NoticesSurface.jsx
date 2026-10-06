import React, { useEffect, useMemo, useState } from "react";
import { StateBox, Tag, useDebounced } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { ExtSection, Kind, NetLine, Outcome, PageHead, SignInNote, SourceLine, attempt, dt, isAdmin, isStaff, useExt } from "./kit.jsx";
import { xo } from "../xo/api.js"; // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md)
import { PfSlot } from "../proof/ProofEntry.jsx"; // ROUND-3 HOOK (see CHANGES-ROUND3.md)
import { ClassRepList, ReachFunnel, ReachOptions, SupersededNote, needsReachEndpoint, reachPayload } from "../xo/ReachPanels.jsx"; // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md)

/*
 * 13 — NOTICE CENTER. Targeted notices by batch, branch, hostel or year, with
 * delivery, read and action tracking. Runs beside the existing notification
 * inbox, which is untouched.
 */

const PRIORITIES = ["CRITICAL", "HIGH", "NORMAL", "INFO"];

function NoticeCard({ n, onStep, busy }) {
  const unread = !n.readAt;
  return (
    <article className={`ext-card ext-pri-${n.priority} ${unread ? "ext-unread" : ""}`}>
      <div className="ext-row" style={{ justifyContent: "space-between" }}>
        <div className="ext-row">
          <Tag kind={n.priority === "CRITICAL" ? "CRITICAL" : n.priority === "HIGH" ? "HIGH" : "STABLE"}>{n.priority}</Tag>
          {unread ? <Tag kind="CRITICAL">UNREAD</Tag> : null}
          {n.digestBatch ? <Tag kind="muted">{n.digestBatch}</Tag> : null}
          {n.channel === "SMS" ? <Tag kind="WATCH">ALSO SENT BY SMS</Tag> : null}
        </div>
        <span className="ci-meta">{n.reference} · {dt(n.publishedAt)}</span>
      </div>
      <h3>{n.title}</h3>
      <p className="ci-body" style={{ margin: 0 }}>{n.body}</p>
      {/* EXCEPTION-ONLY HOOK: replaced by a newer notice, or replaces one. */}
      <SupersededNote n={n} />
      {n.actionRequired?.label ? (
        <div className="ext-row" style={{ marginTop: 10 }}>
          <Tag kind="RECOMMENDED ACTION">ACTION REQUIRED</Tag>
          <b style={{ fontSize: 13 }}>{n.actionRequired.label}</b>
          {n.actionRequired.deadline ? <span className="ci-meta">by {dt(n.actionRequired.deadline)}</span> : null}
          {n.actionDoneAt ? <Tag kind="SAFE">DONE {dt(n.actionDoneAt)}</Tag> : null}
        </div>
      ) : null}
      <div className="ext-actions">
        {unread ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onStep(n, "read")}>READ</button> : <span className="ci-meta">Read {dt(n.readAt)}</span>}
        {!n.acknowledgedAt ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onStep(n, "ack")}>ACKNOWLEDGE</button> : null}
        {n.actionRequired?.label && !n.actionDoneAt ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onStep(n, "done")}>MARK DONE</button> : null}
        <span className="ci-meta">From {n.authorName}</span>
      </div>
    </article>
  );
}

export function NoticeFeed({ user, lowBw, onUnread }) {
  const q = useExt(`feed:${lowBw}:${user?.id}`, () => ext.noticeFeed(lowBw), { enabled: Boolean(user) });
  const [filter, setFilter] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [local, setLocal] = useState({});
  useEffect(() => {
    if (q.data && onUnread) onUnread(q.data.unread);
  }, [q.data, onUnread]);
  if (!user) return <SignInNote what="your notices" />;
  const step = async (n, s) => {
    setBusy(true);
    const r = await attempt(() => ext.noticeStep(n.id, s), "Recorded.");
    setResult(r);
    if (!r.error) {
      const at = new Date().toISOString();
      // Optimistic: an offline tap shows at once and is replayed later.
      setLocal((m) => ({ ...m, [n.id]: { ...(m[n.id] || {}), readAt: at, ...(s !== "read" ? { acknowledgedAt: at } : {}), ...(s === "done" ? { actionDoneAt: at } : {}) } }));
    }
    setBusy(false);
  };
  return (
    <ExtSection q={q}>
      {(data) => {
        const list = data.notices.map((n) => ({ ...n, ...(local[n.id] || {}) }));
        const unread = list.filter((n) => !n.readAt).length;
        const shown = list.filter((n) => (filter === "UNREAD" ? !n.readAt : filter === "ACTION" ? n.actionRequired?.label && !n.actionDoneAt : true));
        return (
          <div className="ext-stack">
            <div className="ext-row" style={{ justifyContent: "space-between" }}>
              <div className="ext-tabs" role="group" aria-label="Filter notices">
                {[["ALL", `ALL ${list.length}`], ["UNREAD", `UNREAD ${unread}`], ["ACTION", "ACTION REQUIRED"]].map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
                ))}
              </div>
              <Kind kind={data.kind} />
            </div>
            <Outcome result={result} />
            {shown.length ? shown.map((n) => <NoticeCard key={n.id} n={n} onStep={step} busy={busy} />) : <StateBox title="Nothing here">No notices match this filter.</StateBox>}
            {lowBw ? <p className="ci-meta">Low-bandwidth mode: the newest 3 notices are shown.</p> : null}
            <SourceLine method={data.method} note="Delivered = this device fetched it. Read and done are your own taps." />
          </div>
        );
      }}
    </ExtSection>
  );
}

// ---- staff: composer ----------------------------------------------------------------

function Chips({ label, options = [], value = [], onChange }) {
  if (!options.length) return null;
  const toggle = (o) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  return (
    <div className="ext-field">
      <span className="ci-label">{label}</span>
      <div className="ext-chips">
        {options.map((o) => (
          <button key={String(o)} type="button" className="ci-chip" aria-pressed={value.includes(o)} onClick={() => toggle(o)}>{String(o)}</button>
        ))}
      </div>
    </div>
  );
}

function Composer({ onSent, user, lowBw }) {
  const [form, setForm] = useState({ title: "", body: "", priority: "NORMAL", actionLabel: "", deadline: "", scheduledFor: "", escalateAfterHours: 6 });
  const [aud, setAud] = useState({ branches: [], years: [], hostels: [], batches: [], sections: [], roles: [] });
  const [preview, setPreview] = useState(null);
  const [perr, setPerr] = useState(null);
  const [result, setResult] = useState(null);
  const [dups, setDups] = useState(null);
  const [busy, setBusy] = useState(false);
  const [xoOpts, setXoOpts] = useState({}); // EXCEPTION-ONLY HOOK: reach target, supersession, quiet-hours override
  const probe = useDebounced({ aud, title: form.title, body: form.body }, 350);
  useEffect(() => {
    let alive = true;
    ext
      .noticePreview({ audience: probe.aud, title: probe.title || undefined, body: probe.body || undefined })
      .then((p) => alive && (setPreview(p), setPerr(null)))
      .catch((e) => alive && setPerr(e.message));
    return () => {
      alive = false;
    };
  }, [JSON.stringify(probe)]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setA = (k) => (v) => setAud((a) => ({ ...a, [k]: v }));
  const payload = (confirmDuplicate) => ({
    title: form.title,
    body: form.body,
    priority: form.priority,
    audience: Object.fromEntries(Object.entries(aud).filter(([, v]) => v.length)),
    actionRequired: form.actionLabel ? { label: form.actionLabel, deadline: form.deadline ? new Date(form.deadline).toISOString() : undefined } : undefined,
    scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : undefined,
    escalateAfterHours: Number(form.escalateAfterHours) || 6,
    confirmDuplicate: confirmDuplicate || undefined
  });
  const send = async (confirmDuplicate) => {
    setBusy(true);
    setDups(null);
    const r = await attempt(() => (needsReachEndpoint(xoOpts) ? xo.noticeCreate({ ...payload(confirmDuplicate), ...reachPayload(xoOpts) }) : ext.noticeCreate(payload(confirmDuplicate))), (d) => `${d.reference}: ${d.status === "HELD_QUIET_HOURS" ? `held for quiet hours — goes out in the 07:30 digest (${dt(d.releaseAt)})` : d.status === "SCHEDULED" ? `scheduled for ${dt(d.scheduledFor)}` : `published to ${d.reach} ${d.reach === 1 ? "person" : "people"}`}.`);
    if (r.details?.duplicates) setDups(r.details.duplicates);
    setResult(r.details?.duplicates ? null : r);
    if (!r.error && !r.queued) {
      setForm((f) => ({ ...f, title: "", body: "", actionLabel: "", deadline: "", scheduledFor: "" }));
      onSent?.();
    }
    setBusy(false);
  };
  const o = preview?.options || {};
  const liveDups = preview?.duplicateCheck?.duplicates || [];
  return (
    <div className="ext-grid">
      <form className="ext-stack" onSubmit={(e) => { e.preventDefault(); send(false); }}>
        <label className="ext-field"><span className="ci-label">Title</span><input className="ci-input" required maxLength={160} value={form.title} onChange={set("title")} placeholder="Water supply off in Hostel B, 10:00–13:00" /></label>
        <label className="ext-field"><span className="ci-label">Message</span><textarea required maxLength={2000} value={form.body} onChange={set("body")} /></label>
        <div className="ext-field">
          <span className="ci-label">Priority</span>
          <div className="ci-seg" role="group" aria-label="Priority">
            {PRIORITIES.map((p) => <button key={p} type="button" aria-pressed={form.priority === p} onClick={() => setForm((f) => ({ ...f, priority: p }))}>{p}</button>)}
          </div>
        </div>
        <div className="ext-card">
          <div className="ci-label" style={{ marginBottom: 8 }}>Audience — leave a group empty to include everyone in it</div>
          <div className="ext-stack">
            <Chips label="Hostel" options={o.hostels} value={aud.hostels} onChange={setA("hostels")} />
            <Chips label="Branch" options={o.branches} value={aud.branches} onChange={setA("branches")} />
            <Chips label="Year" options={o.years} value={aud.years} onChange={setA("years")} />
            <Chips label="Batch" options={o.batches} value={aud.batches} onChange={setA("batches")} />
            <Chips label="Section" options={o.sections} value={aud.sections} onChange={setA("sections")} />
            <Chips label="Role" options={o.roles} value={aud.roles} onChange={setA("roles")} />
          </div>
        </div>
        <div className="ext-grid-3">
          <label className="ext-field"><span className="ci-label">Action required (optional)</span><input className="ci-input" maxLength={80} value={form.actionLabel} onChange={set("actionLabel")} placeholder="Submit exam form" /></label>
          <label className="ext-field"><span className="ci-label">Action deadline</span><input className="ci-input" type="datetime-local" value={form.deadline} onChange={set("deadline")} /></label>
          <label className="ext-field"><span className="ci-label">Schedule for later</span><input className="ci-input" type="datetime-local" value={form.scheduledFor} onChange={set("scheduledFor")} /></label>
          <label className="ext-field"><span className="ci-label">SMS if unread after (hours)</span><input className="ci-input" type="number" min="0.1" max="168" step="0.5" value={form.escalateAfterHours} onChange={set("escalateAfterHours")} /></label>
        </div>
        <p className="ci-meta" style={{ margin: 0 }}>SMS escalation applies to CRITICAL and action-required notices only, through the campus SMS provider.</p>
        {/* EXCEPTION-ONLY HOOK: guaranteed reach and notice hygiene. */}
        <ReachOptions value={xoOpts} onChange={setXoOpts} draft={{ title: form.title, body: form.body, priority: form.priority, scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : undefined, audience: Object.fromEntries(Object.entries(aud).filter(([, v]) => v.length)) }} />
        {/* ROUND-3 HOOK: the notice linter, collision guard, attention budget and predicted reach (writes nothing). */}
        <PfSlot name="noticeLint" live user={user} lowBw={lowBw} draft={{ title: form.title, body: form.body, priority: form.priority, scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : undefined, audience: Object.fromEntries(Object.entries(aud).filter(([, v]) => v.length)) }} />
        {dups?.length ? (
          <div className="ci-result ci-result-warn" role="alert">
            Similar notice already sent to an overlapping audience: {dups.map((d) => `${d.reference} “${d.title}” (${d.similarity}% word overlap, ${d.overlappingRecipients} shared recipients)`).join("; ")}.
            <div className="ext-actions"><button type="button" className="btn btn-primary" onClick={() => send(true)} disabled={busy}>PUBLISH ANYWAY</button><button type="button" className="btn btn-secondary" onClick={() => setDups(null)}>EDIT FIRST</button></div>
          </div>
        ) : null}
        <div className="ext-actions"><button type="submit" className="btn btn-primary" disabled={busy || !form.title || !form.body}>{busy ? "SENDING…" : form.scheduledFor ? "SCHEDULE" : "PUBLISH"}</button></div>
        <Outcome result={result} />
      </form>
      <div className="ext-stack">
        <div className="ext-card ext-card-strong" aria-live="polite">
          <div className="ci-label">Reach — computed by the server</div>
          {perr ? <p className="ci-body">{perr}</p> : (
            <>
              <div className="ci-big" style={{ fontSize: "clamp(40px, 6vw, 64px)", marginTop: 6 }}>{preview ? preview.count : "…"}</div>
              <div className="ext-row"><span className="ci-meta">{preview?.count === 1 ? "person" : "people"} will receive this</span><Kind kind="ACTUAL DATA" /></div>
              {preview?.byHostel?.length ? <p className="ci-meta" style={{ marginTop: 8 }}>{preview.byHostel.map((h) => `${h.value} ${h.count}`).join(" · ")}</p> : null}
              {preview?.bySection?.length ? <p className="ci-meta">Sections: {preview.bySection.map((h) => `${h.value} ${h.count}`).join(" · ")}</p> : null}
            </>
          )}
        </div>
        {liveDups.length ? <div className="ci-result ci-result-warn">Possible duplicate: {liveDups[0].reference} “{liveDups[0].title}” — {liveDups[0].similarity}% word overlap (not a semantic model), {liveDups[0].overlappingRecipients} shared recipients.</div> : null}
        <div className="ext-card">
          <div className="ci-label">Quiet hours rule</div>
          <p className="ci-body" style={{ margin: "6px 0 0" }}>{preview?.quietHours?.text || "Non-critical notices published between 22:00 and 07:00 IST are held for the 07:30 morning digest. CRITICAL notices are never held."}</p>
        </div>
        <div className={`ext-card ext-pri-${form.priority}`}>
          <div className="ci-label">Preview</div>
          <h3>{form.title || "Title"}</h3>
          <p className="ci-body" style={{ margin: 0 }}>{form.body || "Message"}</p>
          {form.actionLabel ? <div className="ext-row" style={{ marginTop: 8 }}><Tag kind="RECOMMENDED ACTION">ACTION REQUIRED</Tag><b style={{ fontSize: 13 }}>{form.actionLabel}</b></div> : null}
        </div>
      </div>
    </div>
  );
}

// ---- staff: delivery dashboard --------------------------------------------------------

function Breakdown({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="ext-table-wrap">
      <table className="ci-table">
        <thead><tr><th>{title}</th><th>Targeted</th><th>Delivered</th><th>Read</th><th>Ack</th><th>Done</th><th>Read %</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={String(r.value)}><td>{String(r.value)}</td><td>{r.targeted}</td><td>{r.delivered}</td><td>{r.read}</td><td>{r.acknowledged}</td><td>{r.actionDone}</td><td>{r.readPct ?? "—"}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Dashboard({ id, lowBw }) {
  const q = useExt(`dash:${id}:${lowBw}`, () => ext.noticeDashboard(id, lowBw));
  return (
    <ExtSection q={q}>
      {(d) => {
        const s = d.summary;
        const bar = (label, n, p) => (
          <div key={label}>
            <div className="ext-row" style={{ justifyContent: "space-between" }}><span className="ci-label">{label}</span><b className="ci-num">{n} · {p === null ? "—" : `${p}%`}</b></div>
            <div className="ext-meter"><i style={{ width: `${p || 0}%` }} /></div>
          </div>
        );
        return (
          <div className="ext-stack">
            <div className="ext-row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{d.notice.reference} · {d.notice.title}</h3>
              <div className="ext-row"><Tag kind={d.notice.status === "PUBLISHED" ? "SAFE" : "WATCH"}>{d.notice.status}</Tag><Kind kind={d.kind} /></div>
            </div>
            {lowBw ? <p className="ci-meta">Low-bandwidth mode: lists below are trimmed to 3 rows by the server (?lite=1).</p> : null}
            <div className="ext-grid-3">
              {bar("Targeted", s.targeted, 100)}
              {bar("Delivered", s.delivered, s.pct.delivered)}
              {bar("Read", s.read, s.pct.read)}
              {bar("Acknowledged", s.acknowledged, s.pct.acknowledged)}
              {d.notice.actionRequired ? bar("Action done", s.actionDone, s.pct.actionDone) : null}
            </div>
            {s.viaSms ? <p className="ci-meta">{s.viaSms} escalated by SMS. {d.smsNote}</p> : null}
            {/* EXCEPTION-ONLY HOOK: reach funnel and the escalation ladder. */}
            <ReachFunnel id={id} />
            <Breakdown title="Hostel" rows={d.byHostel} />
            <Breakdown title="Branch" rows={d.byBranch} />
            <Breakdown title="Year" rows={d.byYear} />
            <div className="ext-grid">
              <div className="ext-card"><div className="ci-label">Not read yet ({d.notRead.length}{lowBw ? "+" : ""})</div><ul className="ext-list" style={{ marginTop: 8 }}>{d.notRead.map((p, i) => <li key={i} className="ci-meta">{p.name} · {p.studentId || p.hostel || "staff"}{p.smsSentAt ? ` · SMS ${p.smsMode}` : ""}</li>)}</ul></div>
              {d.notice.actionRequired ? <div className="ext-card"><div className="ci-label">Action not done ({d.notActed.length}{lowBw ? "+" : ""})</div><ul className="ext-list" style={{ marginTop: 8 }}>{d.notActed.map((p, i) => <li key={i} className="ci-meta">{p.name} · {p.studentId || p.hostel}</li>)}</ul></div> : null}
            </div>
            <details><summary className="ci-meta">Definitions and audit trail</summary><ul className="ext-list" style={{ marginTop: 8 }}>{Object.entries(d.definitions).map(([k, v]) => <li key={k} className="ci-meta"><b>{k}</b>: {v}</li>)}{d.history.map((h, i) => <li key={`h${i}`} className="ci-meta">{dt(h.at)} · {h.action} · {h.actorName}{h.note ? ` · ${h.note}` : ""}</li>)}</ul></details>
          </div>
        );
      }}
    </ExtSection>
  );
}

function Sent({ lowBw, user, nonce }) {
  const q = useExt(`notices:${lowBw}:${nonce}`, () => ext.notices(lowBw));
  const [open, setOpen] = useState(null);
  const [sweep, setSweep] = useState(null);
  return (
    <ExtSection q={q}>
      {(d) => (
        <div className="ext-stack">
          <div className="ext-row" style={{ justifyContent: "space-between" }}>
            <p className="ci-meta" style={{ margin: 0 }}>{d.quietHours.text}</p>
            {isAdmin(user) ? <button type="button" className="btn btn-secondary" onClick={async () => { setSweep(await attempt(() => ext.noticeSweep(), (r) => `Sweep: ${r.digestReleased} released in digest, ${r.scheduledReleased} scheduled published, ${r.smsEscalations} SMS escalations, ${r.feeReminders} fee reminders, ${r.noResponse} fix questions closed as NO RESPONSE.`)); q.reload(); }}>RUN SWEEP NOW</button> : null}
          </div>
          <Outcome result={sweep} />
          <div className="ext-table-wrap">
            <table className="ci-table">
              <thead><tr><th>Notice</th><th>Priority</th><th>Status</th><th>Reach</th><th>Read</th><th>Done</th><th></th></tr></thead>
              <tbody>
                {d.notices.map((n) => (
                  <tr key={n.id}>
                    <td><b>{n.reference}</b> {n.title}<div className="ci-meta">{n.kind !== "GENERAL" ? `${n.kind} · ` : ""}{n.authorName} · {dt(n.publishedAt || n.releaseAt || n.scheduledFor || n.createdAt)}</div></td>
                    <td>{n.priority}</td>
                    <td>{n.status === "HELD_QUIET_HOURS" ? `HELD → ${dt(n.releaseAt)}` : n.status === "SCHEDULED" ? `SCHEDULED ${dt(n.scheduledFor)}` : n.status}</td>
                    <td className="ci-num">{n.counts.targeted}</td>
                    <td className="ci-num">{n.counts.read}{n.counts.readPct !== null ? ` (${n.counts.readPct}%)` : ""}</td>
                    <td className="ci-num">{n.actionRequired ? n.counts.actionDone : "—"}</td>
                    <td><button type="button" className="ci-link" onClick={() => setOpen(open === n.id ? null : n.id)}>{open === n.id ? "CLOSE" : "DELIVERY"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open ? <div className="ext-card ext-card-strong"><Dashboard id={open} lowBw={lowBw} /></div> : null}
        </div>
      )}
    </ExtSection>
  );
}

export default function NoticesSurface({ user, lowBw }) {
  const staff = isStaff(user);
  const [tab, setTab] = useState(staff ? "COMPOSE" : "FEED");
  const [nonce, setNonce] = useState(0);
  const [unread, setUnread] = useState(null);
  useEffect(() => setTab(staff ? "COMPOSE" : "FEED"), [staff]);
  const tabs = useMemo(() => (staff ? [["COMPOSE", "COMPOSE"], ["SENT", "SENT & DELIVERY"], ["FEED", "MY FEED"]] : [["FEED", "MY NOTICES"]]), [staff]);
  return (
    <div className="ci ext">
      <PageHead
        num="13"
        kicker="NOTICE CENTER"
        title={staff ? "Targeted notices, tracked to the last reader." : "Notices meant for you."}
        right={unread ? <span className="ext-row"><span className="ext-badge">{unread}</span><span className="ci-meta">unread</span></span> : null}
      >
        {staff
          ? "Send to a hostel, branch, year, batch or section instead of a broadcast group. The server counts who it reaches, holds non-urgent notices overnight, flags duplicates, and shows who has read and acted."
          : "Only notices for your hostel, branch, year and section arrive here. Tap Read, Acknowledge or Mark done — those taps work offline and are sent when you reconnect."}
      </PageHead>
      <div style={{ marginTop: 18 }}><NetLine /></div>
      {tabs.length > 1 ? (
        <div className="ext-tabs" role="group" aria-label="Notice Center" style={{ margin: "4px 0 18px" }}>
          {tabs.map(([k, label]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
        </div>
      ) : <div style={{ height: 14 }} />}
      {!user ? <SignInNote what="the Notice Center" /> : tab === "COMPOSE" ? <Composer onSent={() => setNonce((n) => n + 1)} user={user} lowBw={lowBw} /> : tab === "SENT" ? <Sent lowBw={lowBw} user={user} nonce={nonce} /> : <>{/* EXCEPTION-ONLY HOOK */}<ClassRepList /><NoticeFeed user={user} lowBw={lowBw} onUnread={setUnread} /></>}
    </div>
  );
}
