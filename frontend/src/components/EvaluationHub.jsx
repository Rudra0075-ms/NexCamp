import React from 'react';

export default function EvaluationHub({ onGo, onTuesday, onProof }) {
  const cards = [
    {
      slide: 'SLIDE 01 & 07',
      kicker: 'THE TUESDAY TEST & FRICTION LEDGER',
      problem: 'One Tuesday. Four errands. Four queues. Students waste afternoons in lines; staff waste hours on routine approvals.',
      solution: 'Written rules decide routine requests instantly (§4.2 bonafide, routing, timetable check). Live stopwatch measures real time.',
      input: 'Student profile, room change request, tap leak report, bonafide certificate request.',
      output: '4 errands done in seconds, 0 human touches, measured hours returned recorded in Friction Ledger.',
      primaryBtn: { label: 'RUN TUESDAY TEST ⏱', action: onTuesday },
      secondaryBtn: { label: 'VIEW FRICTION LEDGER →', action: () => onGo('admin') }
    },
    {
      slide: 'SLIDE 02 & 05',
      kicker: 'RULE §4.2 BONAFIDE & QR VERIFICATION',
      problem: 'Office queues for routine certificates; paper slips and editable PDFs invite tampering and fraud.',
      solution: 'Rule §4.2 evaluates 3 conditions (enrolled, dues ≤ ₹1,000, < 5 requests/month). If all pass: instant issuance in 0 touches with public QR code.',
      input: 'Student ID, request type, fee ledger clearance.',
      output: 'Tamper-proof PDF issued with public verification page: VALID, COPY ALTERED (tamper-detected), or REVOKED.',
      primaryBtn: { label: 'REQUEST BONAFIDE →', action: () => onGo('documents') },
      secondaryBtn: { label: 'PUBLIC VERIFY DEMO →', action: () => window.open('/verify/DOC-2026-0001', '_blank') }
    },
    {
      slide: 'SLIDE 03 & 05',
      kicker: 'NO DUPLICATES (+1 & FOLLOW) & SAFETY FLOOR',
      problem: '17 students report the same leaking tap, flooding queues; electrical arcing and gas leaks get lost in the backlog.',
      solution: 'Real-time semantic similarity detects existing incidents while typing. Safety floor forces 7 hazard groups directly to CRITICAL.',
      input: 'Complaint text: "tap leaking B-214" or hazard phrase "sparks from socket".',
      output: 'Matched to open incident INC-0051 (0 duplicate tickets filed); hazard phrase triggers ELECTRICAL_ARC rule -> CRITICAL.',
      primaryBtn: { label: 'REPORT PROBLEM DEMO →', action: () => onGo('report') }
    },
    {
      slide: 'SLIDE 03 & 05',
      kicker: '\'IS IT FIXED?\' & FALSE CLOSURES AUDIT',
      problem: 'Staff mark complaints "Resolved" to clear queues, but the tap is still broken ("Closed problems that come back").',
      solution: 'The system asks the student: "Is it fixed?". If "NOT FIXED", a reopen record is created and audited in Mission Control.',
      input: 'Student answers YES or NO after repair; recurring reports in same block within 7 days.',
      output: 'Reopen RPN-2026-0001 created; Mission Control reveals real 10 of 110 flagged false closures with audited failure reasons.',
      primaryBtn: { label: 'CHECK MY REQUESTS →', action: () => onGo('requests') },
      secondaryBtn: { label: 'FALSE CLOSURES AUDIT →', action: () => onGo('admin') }
    },
    {
      slide: 'SLIDE 04 & 05',
      kicker: 'INCLUSIVE CHANNELS: KIOSK & BASIC PHONE SMS',
      problem: 'Students without smartphones, on low-end phones, or with dropped network connections are excluded from digital campus life.',
      solution: 'Basic phone SMS simulator handles keyword complaints; staff-assisted Kiosk lets operators file requests for students by ID card.',
      input: 'SMS text "WATER B-214 no water" or Student ID "BPUT/CSE/22/0425".',
      output: 'Exact same complaint recorded into live database, operator attributed, 160-char SMS confirmation sent.',
      primaryBtn: { label: 'OPEN CAMPUS KIOSK →', action: () => onGo('kiosk') },
      secondaryBtn: { label: 'SMS SIMULATOR →', action: () => onGo('sms') }
    },
    {
      slide: 'SLIDE 04 & 05',
      kicker: 'SILENT SUPPORT SYSTEM (STUDENT WELLBEING)',
      problem: 'Struggling students don\'t know how to ask for help; universities only notice students during an academic or mental crisis.',
      solution: '30-second private check-in with non-clinical wording. Optional anonymous mode, dedicated counsellor queue, admin privacy suppression (<3 hidden).',
      input: 'Private check-in, preference: Anonymous or In-person.',
      output: 'Counsellor queue receives case in state Received with zero diagnosis labels; admin aggregates with privacy suppression.',
      primaryBtn: { label: 'STUDENT CHECK-IN →', action: () => onGo('student') },
      secondaryBtn: { label: 'COUNSELLOR QUEUE →', action: () => onGo('admin') }
    }
  ];

  return (
    <section className="ext-eval-hub" style={{ maxWidth: 1560, margin: '0 auto', padding: '24px clamp(14px, 3.2vw, 56px)' }}>
      {/* Top Banner */}
      <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-divider)', borderRadius: 8, padding: '20px 24px', marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ background: 'var(--color-accent)', color: '#ffffff', fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 4, letterSpacing: '.12em' }}>
                PS07 CAMPUS LIFE
              </span>
              <span style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--color-neutral-700)', fontWeight: 700 }}>
                TEAM CODEXFLOW · BH26PS07T057
              </span>
            </div>
            <h2 style={{ fontSize: 'clamp(20px, 2.4vw, 30px)', fontWeight: 800, margin: 0, letterSpacing: '-.02em', color: 'var(--color-text)' }}>
              Evaluation Hub: Problem → Solution → Live Result
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-neutral-800)', maxWidth: '85ch', lineHeight: 1.5 }}>
              Strictly mapped to the 7-Slide Evaluation Presentation. Every workflow is live against our real backend and database.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={onTuesday} style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700 }}>
              ⏱ RUN TUESDAY TEST
            </button>
            <button type="button" className="btn btn-secondary" onClick={onProof} style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700 }}>
              ▶ 30-SECOND PROOF
            </button>
          </div>
        </div>
      </div>

      {/* 6 Problem -> Solution Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-neutral-500)', borderRadius: 8, padding: 22, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: 'var(--shadow-sm)' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 10, letterSpacing: '.16em', color: 'var(--color-accent)', fontWeight: 800 }}>
                  {c.slide}
                </span>
                <span style={{ fontSize: 9, letterSpacing: '.12em', color: 'var(--color-neutral-700)', fontWeight: 700 }}>
                  DEMO #{i + 1}
                </span>
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 14px', letterSpacing: '.04em', color: 'var(--color-text)' }}>
                {c.kicker}
              </h3>

              <div style={{ display: 'grid', gap: 10, fontSize: 13, lineHeight: 1.55 }}>
                <div style={{ background: 'rgba(239, 68, 68, 0.08)', borderLeft: '3px solid #ef4444', padding: '8px 12px', borderRadius: '0 4px 4px 0' }}>
                  <b style={{ color: '#ef4444', fontSize: 11, letterSpacing: '.08em', display: 'block', marginBottom: 2 }}>1. THE PROBLEM:</b>
                  <span style={{ color: 'var(--color-neutral-900)' }}>{c.problem}</span>
                </div>

                <div style={{ background: 'rgba(34, 197, 94, 0.08)', borderLeft: '3px solid #22c55e', padding: '8px 12px', borderRadius: '0 4px 4px 0' }}>
                  <b style={{ color: '#22c55e', fontSize: 11, letterSpacing: '.08em', display: 'block', marginBottom: 2 }}>2. OUR SOLUTION:</b>
                  <span style={{ color: 'var(--color-neutral-900)' }}>{c.solution}</span>
                </div>

                <div style={{ background: 'rgba(56, 189, 248, 0.08)', borderLeft: '3px solid #38bdf8', padding: '8px 12px', borderRadius: '0 4px 4px 0' }}>
                  <b style={{ color: '#38bdf8', fontSize: 11, letterSpacing: '.08em', display: 'block', marginBottom: 2 }}>3. WORKING RESULT / OUTPUT:</b>
                  <span style={{ color: 'var(--color-neutral-900)' }}>{c.output}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--color-divider)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={c.primaryBtn.action} style={{ fontSize: 12, padding: '8px 14px', fontWeight: 700 }}>
                {c.primaryBtn.label}
              </button>
              {c.secondaryBtn && (
                <button type="button" className="btn btn-secondary" onClick={c.secondaryBtn.action} style={{ fontSize: 12, padding: '8px 14px', fontWeight: 600 }}>
                  {c.secondaryBtn.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
