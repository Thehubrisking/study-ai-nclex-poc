'use client';

import React from 'react';
import { ClipboardList, Clock, PlayCircle, ShieldAlert, Keyboard } from 'lucide-react';
import { formatClock } from '../../lib/examEngine';
import useViewport from '../../lib/useViewport';

/** Shared full-screen exam overlay (backdrop + centered glass card; bottom sheet on phones). */
export function ExamOverlay({ darkMode, width = 760, children }) {
  return (
    <div
      className="exam-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: darkMode ? 'rgba(2, 6, 23, 0.55)' : 'rgba(15, 23, 42, 0.28)',
      }}
    >
      <div
        className={`exam-card ${darkMode ? 'liquid-glass-dark' : 'liquid-glass-light'}`}
        style={{
          width: `min(${width}px, 100%)`,
          maxHeight: 'calc(100dvh - 48px)',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          borderRadius: '24px',
          color: darkMode ? '#f8fafc' : '#0f172a',
          userSelect: 'text',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function examTokens(darkMode) {
  return {
    text: darkMode ? '#f8fafc' : '#0f172a',
    muted: darkMode ? '#94a3b8' : '#64748b',
    border: darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)',
    subtle: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.65)',
    accent: '#38bdf8',
    primary: 'linear-gradient(135deg, #0066ff, #2563eb)',
  };
}

export default function BriefingModal({ scenario, darkMode, onBegin }) {
  const ex = scenario.exam_config;
  const b = ex.briefing;
  const p = scenario.patient;
  const tk = examTokens(darkMode);
  const { isTouch } = useViewport();

  const facts = [
    ['Patient', p.name],
    ['Age / Sex', `${p.age} • ${p.gender}`],
    ['MRN', p.mrn],
    ['DOB', p.dob],
    ['Procedure', p.surgical_history],
    ['Arriving from', 'PACU → Medical-Surgical floor'],
  ];

  return (
    <ExamOverlay darkMode={darkMode} width={780}>
      <div style={{ padding: '26px 30px 0' }}>
        <div
          style={{
            fontSize: '10.5px',
            fontWeight: 900,
            letterSpacing: '0.2em',
            color: tk.accent,
          }}
        >
          NGN EXAM READINESS ASSESSMENT
        </div>
        <h1
          style={{
            fontSize: '26px',
            fontWeight: 900,
            letterSpacing: '-0.02em',
            marginTop: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <ClipboardList size={24} color={tk.accent} />
          {b.exam_title}
        </h1>
        <div style={{ fontSize: '12px', color: tk.muted, marginTop: '4px' }}>
          {b.exam_subtitle}
        </div>
      </div>

      <div style={{ padding: '18px 30px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Patient handoff card */}
        <div
          className="exam-grid-3"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '10px 18px',
            padding: '14px 16px',
            borderRadius: '16px',
            background: tk.subtle,
            border: `1px solid ${tk.border}`,
          }}
        >
          {facts.map(([k, v]) => (
            <div key={k} style={{ minWidth: 0 }}>
              <div style={{ fontSize: '9.5px', fontWeight: 800, letterSpacing: '0.08em', color: tk.muted }}>
                {k.toUpperCase()}
              </div>
              <div style={{ fontSize: '12.5px', fontWeight: 700, marginTop: '2px' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Candidate instructions */}
        <div
          style={{
            padding: '14px 18px',
            borderRadius: '16px',
            borderLeft: `4px solid ${tk.accent}`,
            background: darkMode ? 'rgba(56, 189, 248, 0.08)' : 'rgba(0, 102, 255, 0.06)',
          }}
        >
          <div style={{ fontSize: '10px', fontWeight: 900, letterSpacing: '0.12em', color: tk.accent, marginBottom: '6px' }}>
            CANDIDATE INSTRUCTIONS
          </div>
          <div style={{ fontSize: '14px', lineHeight: 1.6, fontWeight: 500 }}>
            {b.candidate_instructions}
          </div>
        </div>

        {/* Exam rules */}
        <div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 900,
              letterSpacing: '0.12em',
              color: tk.muted,
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <ShieldAlert size={13} /> EXAM CONDITIONS
          </div>
          <ol style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {b.exam_rules.map((r) => (
              <li key={r} style={{ fontSize: '12.5px', lineHeight: 1.5 }}>
                {r}
              </li>
            ))}
          </ol>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11.5px',
            color: tk.muted,
          }}
        >
          <Keyboard size={14} style={{ flexShrink: 0 }} />
          {isTouch && b.controls_hint_touch ? b.controls_hint_touch : b.controls_hint}
        </div>
      </div>

      {/* Start gate */}
      <div
        className="exam-actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '16px 30px 24px',
          borderTop: `1px solid ${tk.border}`,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Clock size={20} color={tk.accent} />
          <div>
            <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: tk.muted }}>
              TIME LIMIT
            </div>
            <div style={{ fontSize: '22px', fontWeight: 900, fontFamily: 'monospace' }}>
              {formatClock(ex.duration_sec)}
            </div>
          </div>
        </div>
        <button
          onClick={onBegin}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 24px',
            borderRadius: '999px',
            background: tk.primary,
            color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.45)',
            fontSize: '14px',
            fontWeight: 900,
            cursor: 'pointer',
            boxShadow: '0 10px 28px rgba(0, 102, 255, 0.45)',
          }}
        >
          <PlayCircle size={18} />
          {b.start_button_label}
        </button>
      </div>
    </ExamOverlay>
  );
}
