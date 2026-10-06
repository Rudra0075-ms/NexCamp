import React from 'react';

export default function EvalKicker({ slide, problem, solution, demoAction, expectedOutput }) {
  return (
    <div style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-divider)',
      borderRadius: 8,
      padding: '16px 20px',
      marginBottom: 24,
      boxShadow: 'var(--shadow-sm)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--color-accent)', fontWeight: 800 }}>
          HACKATHON EVALUATION CONTEXT · {slide || 'PPT EVALUATION'}
        </span>
        <span style={{ fontSize: 9, letterSpacing: '.12em', color: 'var(--color-neutral-700)', fontWeight: 700 }}>
          PROBLEM → SOLUTION → RESULT
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ background: 'rgba(239, 68, 68, 0.08)', borderLeft: '3px solid #ef4444', padding: '8px 12px', borderRadius: '0 4px 4px 0' }}>
          <b style={{ color: '#ef4444', fontSize: 11, letterSpacing: '.08em', display: 'block', marginBottom: 2 }}>THE PROBLEM:</b>
          <span style={{ color: 'var(--color-neutral-900)' }}>{problem}</span>
        </div>

        <div style={{ background: 'rgba(34, 197, 94, 0.08)', borderLeft: '3px solid #22c55e', padding: '8px 12px', borderRadius: '0 4px 4px 0' }}>
          <b style={{ color: '#22c55e', fontSize: 11, letterSpacing: '.08em', display: 'block', marginBottom: 2 }}>OUR SOLUTION:</b>
          <span style={{ color: 'var(--color-neutral-900)' }}>{solution}</span>
        </div>

        <div style={{ background: 'rgba(56, 189, 248, 0.08)', borderLeft: '3px solid #38bdf8', padding: '8px 12px', borderRadius: '0 4px 4px 0' }}>
          <b style={{ color: '#38bdf8', fontSize: 11, letterSpacing: '.08em', display: 'block', marginBottom: 2 }}>WHAT TO TEST:</b>
          <span style={{ color: 'var(--color-neutral-900)' }}>{demoAction}</span>
          {expectedOutput && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-neutral-700)' }}>
              <b>Result:</b> {expectedOutput}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
