import React, { useEffect, useRef, useState } from "react";
import EvalKicker from "../components/EvalKicker.jsx";
import { StateBox } from "../components/intel/kit.jsx";
import { ext } from "./api.js";
import { ExtSection, PageHead, isStaff, useExt } from "./kit.jsx";
// EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): the two-phone SMS work loop, its own lazy chunk.
const SmsWorkDemo = React.lazy(() => import("../xo/AccessPanels.jsx").then((m) => ({ default: m.SmsWorkDemo })));

/*
 * 18 — SMS PHONE. A basic phone on screen that sends real commands to the SMS
 * keyword channel's simulator endpoint. Everything here is labelled SIMULATED:
 * no mobile network is involved. A real gateway posts to /api/sms/inbound.
 */

const KEYS = ["HELP", "ATT", "GP", "MENU", "NOTICE", "WATER B-214 tap leaking since night"];

export function Phone({ phone, name, compact = false }) {
  const [log, setLog] = useState([
    { dir: "in", text: `CAMPUS 2G SMS ACTIVE\nTo: ${name || "STUDENT"}\nSend HELP for commands or tap keys below.`, at: new Date() }
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const screen = useRef(null);
  useEffect(() => {
    if (screen.current) screen.current.scrollTop = screen.current.scrollHeight;
  }, [log]);
  const send = async (body) => {
    const msg = String(body || "").trim();
    if (!msg || busy) return null;
    setBusy(true);
    setText("");
    setLog((l) => [...l, { dir: "out", text: msg, at: new Date() }]);
    try {
      const r = await ext.smsSimulate(phone, msg);
      setLog((l) => [...l, { dir: "in", text: r.reply, at: new Date(), chars: r.chars, outcome: r.outcome }]);
      return r;
    } catch (e) {
      setLog((l) => [...l, { dir: "in", text: e.status === 0 ? "(no network — message not sent)" : `(${e.message})`, at: new Date(), outcome: "ERROR" }]);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ext-phone" aria-label="Simulated basic phone">
      <div className="ext-phone-screen" ref={screen} role="log" aria-live="polite">
        <div className="ext-phone-bar"><span>{phone}</span><span>SIMULATED</span></div>
        {!log.length ? <div className="ext-sms ext-sms-in">To: CAMPUS{"\n"}Send HELP for commands.<small>{name}</small></div> : null}
        {log.map((m, i) => (
          <div key={i} className={`ext-sms ext-sms-${m.dir}`}>
            {m.text}
            <small>{m.dir === "out" ? "sent" : `reply${m.chars ? ` · ${m.chars}/160` : ""}${m.outcome && m.outcome !== "OK" ? ` · ${m.outcome}` : ""}`} · {m.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>
          </div>
        ))}
        {busy ? <div className="ext-sms ext-sms-in">…</div> : null}
      </div>
      <form className="ext-phone-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input aria-label="SMS text" value={text} onChange={(e) => setText(e.target.value)} maxLength={160} placeholder="Type a command" />
        <button type="submit" disabled={busy}>SEND</button>
      </form>
      {!compact ? (
        <div className="ext-phone-keys">
          {KEYS.map((k) => <button key={k} type="button" onClick={() => send(k)} title={k}>{k.length > 8 ? "WATER…" : k}</button>)}
        </div>
      ) : null}
    </div>
  );
}

export default function SmsSurface({ user }) {
  const q = useExt("sms:phones", () => ext.smsPhones());
  const [pick, setPick] = useState("");

  const defaultPhones = [
    { phone: "+919000000001", masked: "+91XXXXXX0001", name: "PRITISH RANJAN SAHOO", studentId: "BPUT/CSE/22/0417", hostel: "BPUT Hall-1" }
  ];

  const phonesList = q.data?.phones?.length ? q.data.phones : defaultPhones;
  const current = phonesList.find((p) => p.phone === pick) || phonesList[0];

  return (
    <div className="ci ext">
      <PageHead num="18" kicker="SMS KEYWORD CHANNEL" title="Campus services from a basic phone, with no staff in the loop." right={<span className="ext-simulated">SIMULATED INBOUND SMS</span>}>
        Commands are accepted only from a registered number, are rate-limited, and every reply fits in one 160-character SMS. A complaint sent by SMS goes through the same complaint logic as the app and is marked channel SMS.
      </PageHead>

      <div style={{ marginTop: 18 }}>
        <EvalKicker
          slide="SLIDE 18 · SMS KEYWORD CHANNEL (2G ACCESSIBILITY)"
          problem="Students without smartphones or in remote campus areas without 4G/5G mobile data cannot check attendance, mess menus, gate passes, or report urgent hostel breakdowns."
          solution="Autonomous 2G SMS Keyword Gateway: accepts standardized keywords (ATT, GP, MENU, NOTICE, WATER) from registered numbers, executes real services, and replies within 160 characters in milliseconds with zero staff overhead."
          demoAction="Tap the quick command buttons on the basic phone (ATT, GP, MENU, NOTICE, WATER) or type any keyword to receive instant 160-char SMS responses."
          expectedOutput="Instant SMS response: live attendance % and needed classes, current mess meal, gate pass timing, or complaint ticket CMP-xxxx."
        />
      </div>

      <div className="ext-grid" style={{ marginTop: 18 }}>
        <div className="ext-stack">
          {phonesList.length > 1 ? (
            <label className="ext-field"><span className="ci-label">Send as (registered demo student number)</span>
              <select className="ci-select" value={current.phone} onChange={(e) => setPick(e.target.value)}>
                {phonesList.map((p) => (
                  <option key={p.phone} value={p.phone}>
                    {p.masked} · {p.name} {p.hostel ? `· ${p.hostel}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="ci-meta">Sending from registered student number {current.masked} ({current.name}).</p>
          )}

          <Phone key={current.phone} phone={current.phone} name={current.name} />
        </div>

        <div className="ext-stack">
          <div className="ext-card">
            <div className="ci-label">Available Commands</div>
            <ul className="ext-list" style={{ marginTop: 8 }}>
              <li><b className="ext-code">ATT</b> <span className="ci-meta">attendance % and classes needed for 75% threshold</span></li>
              <li><b className="ext-code">STATUS CMP-2101</b> <span className="ci-meta">live lifecycle stage and SLA of your complaint</span></li>
              <li><b className="ext-code">GP</b> <span className="ci-meta">active gate pass status and mandatory return curfew</span></li>
              <li><b className="ext-code">MENU</b> <span className="ci-meta">next mess meal timing and dynamic menu changes</span></li>
              <li><b className="ext-code">NOTICE</b> <span className="ci-meta">latest unread notices (marked delivered via SMS)</span></li>
              <li><b className="ext-code">WATER B-214 tap leaking</b> <span className="ci-meta">files a real complaint: TYPE place problem</span></li>
              <li><b className="ext-code">HELP</b> <span className="ci-meta">returns quick command guide</span></li>
            </ul>
          </div>

          <div className="ext-card">
            <div className="ci-label">Production SMS Gateway Integration</div>
            <p className="ci-body" style={{ margin: "6px 0 0" }}>
              In production, a telecom gateway (MSG91, Twilio, or national SMS aggregator) posts inbound webhooks to <span className="ext-code">POST /api/sms/inbound</span> verified with <span className="ext-code">x-sms-webhook-secret</span>.
            </p>
            <p className="ci-meta" style={{ marginTop: 6 }}>
              {q.data?.note || "Demo numbers in an unallocated placeholder range; replies fit in strict 160-character single GSM frames."}
            </p>
          </div>
        </div>
      </div>

      {/* EXCEPTION-ONLY HOOK: staff DONE / NEED PART and the student's "Is it fixed?" — below the existing phone. */}
      <div style={{ marginTop: 28 }}>
        <React.Suspense fallback={null}>
          <SmsWorkDemo user={user || { role: "ADMIN", name: "Demo Evaluator" }} />
        </React.Suspense>
      </div>
    </div>
  );
}
