'use client';

import React, { useState } from 'react';
import { formatClock } from '../../lib/examEngine';

/**
 * Exit Assessment Question Screen — Matches Figma node 36:603 ("Timed test")
 *  - Dark #101713 63px top bar with lime StudyAI star mark, question counter & Spline Sans Mono clock pill
 *  - 4px #1e4a38 progress bar
 *  - Clean white question workspace with #f3fae6 / #1e4a38 selected option cards, Flag for review,
 *    Previous/Next navigation, and right-hand #f8faf5 Questions navigator card
 */
export default function ExitQuestionsModal({
  scenario,
  endReason,
  timeUsedSec,
  answers,
  onAnswer,
  onSubmit,
}) {
  const ex = scenario.exam_config;
  const questions = ex.exit_questions;
  const [activeIdx, setActiveIdx] = useState(0);
  const [flagged, setFlagged] = useState({});

  const answeredCount = questions.filter((q) => answers[q.question_id]).length;
  const flaggedCount = Object.values(flagged).filter(Boolean).length;
  const allAnswered = answeredCount === questions.length;
  const progressPct = questions.length ? (answeredCount / questions.length) * 100 : 0;

  const q = questions[activeIdx] || questions[0];
  const isFlagged = Boolean(flagged[q.question_id]);

  return (
    <div
      className="studyai-shell"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        color: '#101713',
        userSelect: 'text',
      }}
    >
      {/* TOP DARK BAR (63px — Figma 36:605) */}
      <header
        style={{
          height: '63px',
          flexShrink: 0,
          background: '#101713',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 clamp(16px, 3vw, 40px)',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
          <img
            src="/figma-assets/logo-mark-lime.svg"
            alt="StudyAI"
            width={26}
            height={23}
            style={{ display: 'block', flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: '15.5px',
              fontWeight: 800,
              color: '#ffffff',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Exit assessment · Clinical Escalation
          </span>
          <span
            style={{
              fontSize: '12.5px',
              color: '#a9b6ac',
              whiteSpace: 'nowrap',
              display: 'inline-block',
            }}
          >
            {questions.length} questions
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
          <span
            className="font-mono-clinical"
            style={{ fontSize: '13px', color: '#a9b6ac' }}
          >
            {activeIdx + 1}/{questions.length}
          </span>
          <div
            style={{
              height: '35px',
              padding: '0 16px',
              borderRadius: '17.5px',
              background: '#2a352e',
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
            }}
            title="Bedside scenario time used"
          >
            <img
              src="/figma-assets/icon-clock-mint.svg"
              alt=""
              width={17}
              height={17}
              style={{ display: 'block' }}
            />
            <span
              className="font-mono-clinical"
              style={{ fontSize: '17px', fontWeight: 600, color: '#ffffff' }}
            >
              {formatClock(timeUsedSec)}
            </span>
          </div>
        </div>
      </header>

      {/* 4px PROGRESS BAR (Figma 36:617) */}
      <div style={{ height: '4px', width: '100%', background: '#e7eae3', flexShrink: 0 }}>
        <div
          style={{
            height: '100%',
            width: `${Math.max(8, progressPct)}%`,
            background: '#1e4a38',
            transition: 'width 0.25s ease',
          }}
        />
      </div>

      {/* SCROLLABLE EXAM BODY */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: 'clamp(22px, 3.5vw, 38px) clamp(16px, 3.5vw, 40px) calc(40px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div
          className="studyai-exam-grid"
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 300px',
            gap: '36px',
            alignItems: 'start',
          }}
        >
          {/* LEFT COLUMN: Active Question & Options (Figma 36:619..36:642) */}
          <div>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 800,
                letterSpacing: '0.04em',
                color: '#6b746a',
                textTransform: 'uppercase',
              }}
            >
              QUESTION {activeIdx + 1} · {q.ncsbn_category}
            </div>

            <h2
              style={{
                fontSize: 'clamp(17px, 2.2vw, 19.5px)',
                fontWeight: 600,
                lineHeight: 1.58,
                color: '#101713',
                marginTop: '14px',
                marginBottom: '24px',
                maxWidth: '760px',
              }}
            >
              {q.prompt}
            </h2>

            {/* Option Cards */}
            <div
              role="radiogroup"
              aria-label={q.title}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
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
                      alignItems: 'flex-start',
                      gap: '16px',
                      textAlign: 'left',
                      padding: '16px 22px',
                      borderRadius: '18px',
                      background: selected ? '#f3fae6' : '#ffffff',
                      border: selected ? '2px solid #1e4a38' : '1px solid #e7eae3',
                      color: '#101713',
                      cursor: 'pointer',
                      transition: 'border-color 0.14s ease, background 0.14s ease',
                    }}
                  >
                    {/* Radio Indicator (Figma 36:622 / 36:627) */}
                    <span
                      style={{
                        width: '19px',
                        height: '19px',
                        borderRadius: '50%',
                        marginTop: '2px',
                        flexShrink: 0,
                        background: selected ? '#1e4a38' : '#ffffff',
                        border: selected ? '1.5px solid #1e4a38' : '1.5px solid #8a948a',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {selected && (
                        <img
                          src="/figma-assets/icon-radio-dot.svg"
                          alt=""
                          width={19}
                          height={19}
                          style={{ display: 'block' }}
                        />
                      )}
                    </span>

                    <span
                      style={{
                        fontSize: '15px',
                        fontWeight: selected ? 700 : 400,
                        lineHeight: 1.52,
                        color: '#101713',
                      }}
                    >
                      <strong style={{ marginRight: '6px', color: '#1e4a38' }}>{opt.id}.</strong>
                      {opt.text}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Bottom Controls Row: Flag for review + Previous / Next (Figma 36:635) */}
            <div
              style={{
                marginTop: '22px',
                paddingTop: '18px',
                borderTop: '1px solid #e7eae3',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '14px',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setFlagged((prev) => ({
                    ...prev,
                    [q.question_id]: !prev[q.question_id],
                  }))
                }
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '6px 4px',
                  color: '#101713',
                  fontSize: '14.5px',
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: '17px',
                    height: '17px',
                    borderRadius: '4px',
                    border: isFlagged ? '1.5px solid #9c6b00' : '1.5px solid #8a948a',
                    background: isFlagged ? '#f6e7c0' : '#ffffff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#9c6b00',
                    fontWeight: 800,
                  }}
                >
                  {isFlagged ? '✓' : ''}
                </span>
                <span>Flag for review</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  type="button"
                  disabled={activeIdx === 0}
                  onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
                  style={{
                    height: '48px',
                    padding: '0 26px',
                    borderRadius: '24px',
                    background: '#ffffff',
                    border: '2px solid #101713',
                    color: '#101713',
                    fontSize: '15px',
                    fontWeight: 700,
                    cursor: activeIdx === 0 ? 'not-allowed' : 'pointer',
                    opacity: activeIdx === 0 ? 0.35 : 1,
                  }}
                >
                  Previous
                </button>

                {activeIdx < questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setActiveIdx((i) => Math.min(questions.length - 1, i + 1))}
                    style={{
                      height: '48px',
                      padding: '0 30px',
                      borderRadius: '24px',
                      background: '#1e4a38',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!allAnswered}
                    onClick={onSubmit}
                    style={{
                      height: '48px',
                      padding: '0 28px',
                      borderRadius: '24px',
                      background: allAnswered ? '#1e4a38' : '#e7eae3',
                      border: 'none',
                      color: allAnswered ? '#ffffff' : '#8a948a',
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: allAnswered ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Finish & see gap chart
                  </button>
                )}
              </div>
            </div>

            <p style={{ fontSize: '13px', color: '#8a948a', marginTop: '18px', lineHeight: 1.5 }}>
              {String(ex.end_reasons[endReason] || endReason).replace(/\.+$/, '')}. No explanations
              are shown until you submit — all bedside telemetry and follow-up responses are scored
              together on the server.
            </p>
          </div>

          {/* RIGHT COLUMN: Questions Navigator Card + Submit Button (Figma 36:643 + 36:692) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                background: '#f8faf5',
                border: '1px solid #e7eae3',
                borderRadius: '24px',
                padding: '22px 24px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '14.5px', fontWeight: 800, color: '#101713' }}>
                  Questions
                </span>
                <span
                  className="font-mono-clinical"
                  style={{ fontSize: '12px', color: '#6b746a' }}
                >
                  {answeredCount} done · {flaggedCount} flagged
                </span>
              </div>

              {/* Pill Grid */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginTop: '18px',
                }}
              >
                {questions.map((item, idx) => {
                  const isCurrent = idx === activeIdx;
                  const isDone = Boolean(answers[item.question_id]);
                  const isItemFlagged = Boolean(flagged[item.question_id]);

                  let bg = 'transparent';
                  let border = '1px dashed #c9cfc7';
                  let color = '#8a948a';

                  if (isCurrent) {
                    bg = '#101713';
                    border = '1px solid #101713';
                    color = '#ffffff';
                  } else if (isItemFlagged) {
                    bg = '#f6e7c0';
                    border = '1px solid #f6e7c0';
                    color = '#9c6b00';
                  } else if (isDone) {
                    bg = '#cde8a2';
                    border = '1px solid #cde8a2';
                    color = '#101713';
                  }

                  return (
                    <button
                      key={item.question_id}
                      type="button"
                      onClick={() => setActiveIdx(idx)}
                      className="font-mono-clinical"
                      style={{
                        width: '46px',
                        height: '38px',
                        borderRadius: '19px',
                        background: bg,
                        border,
                        color,
                        fontSize: '12.5px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  flexWrap: 'wrap',
                  marginTop: '20px',
                  paddingTop: '14px',
                  borderTop: '1px solid #e7eae3',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#475045',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: '#cde8a2',
                    }}
                  />
                  Answered
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: '#f6e7c0',
                    }}
                  />
                  Flagged
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: '#e7eae3',
                    }}
                  />
                  To do
                </span>
              </div>
            </div>

            {/* Submit Assessment Button (Figma 36:692) */}
            <button
              type="button"
              disabled={!allAnswered}
              onClick={onSubmit}
              style={{
                height: '52px',
                width: '100%',
                borderRadius: '26px',
                background: allAnswered ? '#ffffff' : '#f8faf5',
                border: allAnswered ? '2px solid #c8372e' : '1.5px solid #e7eae3',
                color: allAnswered ? '#c8372e' : '#8a948a',
                fontSize: '15px',
                fontWeight: 700,
                cursor: allAnswered ? 'pointer' : 'not-allowed',
              }}
            >
              {allAnswered
                ? 'Submit & see my gap chart'
                : `Answer all ${questions.length} to submit`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
