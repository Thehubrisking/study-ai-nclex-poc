'use client';

import React from 'react';
import { DoorClosed, Send } from 'lucide-react';
import { ExamOverlay, examTokens } from './BriefingModal';
import { formatClock } from '../../lib/examEngine';

/**
 * Step 1 of the exit flow. The room is frozen and all HUD is hidden; the candidate must answer
 * every question before the attempt can be submitted. No feedback is shown here.
 */
export default function ExitQuestionsModal({
  scenario,
  darkMode,
  endReason,
  timeUsedSec,
  answers,
  onAnswer,
  onSubmit,
}) {
  const ex = scenario.exam_config;
  const tk = examTokens(darkMode);
  const questions = ex.exit_questions;
  const allAnswered = questions.every((q) => answers[q.question_id]);

  return (
    <ExamOverlay darkMode={darkMode} width={860}>
      <div style={{ padding: '24px 28px 16px', borderBottom: `1px solid ${tk.border}` }}>
        <div style={{ fontSize: '10.5px', fontWeight: 900, letterSpacing: '0.2em', color: tk.accent }}>
          BEDSIDE PHASE COMPLETE • EXIT ASSESSMENT
        </div>
        <h2
          style={{
            fontSize: '22px',
            fontWeight: 900,
            marginTop: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <DoorClosed size={22} color={tk.accent} />
          SBAR Escalation & Follow-Up
        </h2>
        <div style={{ fontSize: '12.5px', color: tk.muted, marginTop: '6px', lineHeight: 1.5 }}>
          {ex.end_reasons[endReason] || endReason} • Bedside time used:{' '}
          <strong style={{ fontFamily: 'monospace' }}>{formatClock(timeUsedSec)}</strong> of{' '}
          {formatClock(ex.duration_sec)}
        </div>
      </div>

      <div style={{ padding: '18px 28px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {questions.map((q) => (
          <div
            key={q.question_id}
            style={{
              padding: '16px 18px',
              borderRadius: '18px',
              background: tk.subtle,
              border: `1px solid ${tk.border}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 900, letterSpacing: '0.06em', color: tk.accent }}>
                {q.title.toUpperCase()}
              </span>
              <span style={{ fontSize: '10.5px', color: tk.muted, fontWeight: 700 }}>{q.ncsbn_category}</span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.55, margin: '8px 0 12px' }}>
              {q.prompt}
            </div>
            <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {q.options.map((opt) => {
                const selected = answers[q.question_id] === opt.id;
                return (
                  <button
                    key={opt.id}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onAnswer(q.question_id, opt.id)}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'flex-start',
                      textAlign: 'left',
                      padding: '11px 14px',
                      borderRadius: '14px',
                      border: selected ? '1.5px solid #2563eb' : `1px solid ${tk.border}`,
                      background: selected
                        ? darkMode
                          ? 'rgba(37, 99, 235, 0.22)'
                          : 'rgba(37, 99, 235, 0.1)'
                        : 'transparent',
                      color: tk.text,
                      cursor: 'pointer',
                      fontSize: '12.5px',
                      lineHeight: 1.5,
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: '11px',
                        background: selected ? '#2563eb' : 'transparent',
                        color: selected ? '#ffffff' : tk.muted,
                        border: selected ? 'none' : `1.5px solid ${tk.border}`,
                      }}
                    >
                      {opt.id}
                    </span>
                    <span>{opt.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div
        className="exam-actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '14px 28px 22px',
          borderTop: `1px solid ${tk.border}`,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '11.5px', color: tk.muted }}>
          Responses are final once submitted. Answered{' '}
          {questions.filter((q) => answers[q.question_id]).length} of {questions.length}.
        </span>
        <button
          onClick={onSubmit}
          disabled={!allAnswered}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 20px',
            borderRadius: '999px',
            background: allAnswered ? tk.primary : darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
            color: allAnswered ? '#ffffff' : tk.muted,
            border: '1px solid rgba(255,255,255,0.35)',
            fontWeight: 900,
            fontSize: '13px',
            cursor: allAnswered ? 'pointer' : 'not-allowed',
          }}
        >
          <Send size={15} />
          Submit Responses & Generate Performance Report
        </button>
      </div>
    </ExamOverlay>
  );
}
