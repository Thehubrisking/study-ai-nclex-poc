'use client';

import React, { useState } from 'react';
import {
  RotateCcw,
  BarChart3,
  GitBranch,
  Braces,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Sparkles,
} from 'lucide-react';
import { StudyAiAppShell } from './BriefingModal';
import { formatClock } from '../../lib/examEngine';

const CLASS_COLORS = {
  CORRECT: '#2f7a4d',
  ASSESSMENT: '#1e4a38',
  NEUTRAL: '#6b746a',
  TRAP: '#9c6b00',
  CRITICAL_ERROR: '#c8372e',
  PENALTY: '#d97706',
  PHYSIOLOGIC_EVENT: '#4c7a68',
  SYSTEM: '#8a948a',
};

const DOMAIN_ORDER = [
  ['knowledge', 'Knowledge'],
  ['prioritisation', 'Prioritisation'],
  ['risk_recognition', 'Risk recognition'],
  ['clinical_judgment', 'Clinical judgment'],
];

function domainTier(score) {
  if (score >= 75) {
    return { label: 'Strong', color: '#2f7a4d', dot: '#2f7a4d', focus: false };
  }
  if (score >= 55) {
    return { label: 'Developing', color: '#9c6b00', dot: '#e8b04b', focus: false };
  }
  return { label: 'Focus area', color: '#c8372e', dot: '#c8372e', focus: true };
}

/** Segmented circular score ring matching Figma 36:205 */
function GapScoreRing({ score }) {
  const size = 124;
  const stroke = 11;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const filled = (c * Math.max(0, Math.min(100, score))) / 100;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ display: 'block' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(30, 74, 56, 0.16)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#1e4a38"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontSize: '28px',
            fontWeight: 800,
            color: '#101713',
            lineHeight: 1.05,
          }}
        >
          {score}%
        </span>
        <span style={{ fontSize: '11px', color: '#41552f', marginTop: '2px' }}>overall</span>
      </div>
    </div>
  );
}

/** Multi-segment donut for "Where misses came from" (Figma 36:267) */
function MissesDonut({ segments, total }) {
  const size = 104;
  const stroke = 11;
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ display: 'block' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#e7eae3"
          strokeWidth={stroke}
          fill="none"
        />
        {total > 0 &&
          segments.map((seg) => {
            if (seg.count <= 0) return null;
            const len = (seg.count / total) * c;
            const dash = `${Math.max(2, len - 2)} ${c}`;
            const rot = -90 + (offset / total) * 360;
            offset += seg.count;
            return (
              <circle
                key={seg.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={seg.color}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={dash}
                transform={`rotate(${rot} ${size / 2} ${size / 2})`}
              />
            );
          })}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: '22px', fontWeight: 800, color: '#101713', lineHeight: 1.05 }}>
          {total}
        </span>
        <span style={{ fontSize: '10px', color: '#6b746a', marginTop: '2px' }}>misses</span>
      </div>
    </div>
  );
}

function Chip({ color, children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '10px',
        fontWeight: 800,
        padding: '2px 9px',
        borderRadius: '999px',
        background: `${color}18`,
        color,
        border: `1px solid ${color}40`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export default function PerformanceReport({
  scenario,
  status,
  payload,
  result,
  error,
  onRetry,
  onNewAttempt,
}) {
  const [tab, setTab] = useState('gap');
  const [copied, setCopied] = useState(null);
  const [followupChoice, setFollowupChoice] = useState(null);

  const dateStr = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // Floating Hygeia companion avatar (Figma 36:306)
  const hygeiaFab = (
    <div
      title="Hygeia — StudyAI Nurse Tutor"
      style={{
        position: 'fixed',
        right: '24px',
        bottom: '24px',
        width: '68px',
        height: '68px',
        borderRadius: '50%',
        background: '#cde8a2',
        border: '3px solid #ffffff',
        boxShadow: '0 12px 28px rgba(16, 23, 19, 0.22)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        zIndex: 85,
      }}
    >
      <img
        src="/figma-assets/hygeia-avatar.svg"
        alt="Hygeia"
        width={58}
        height={58}
        style={{ display: 'block', marginTop: '4px' }}
      />
    </div>
  );

  // Derive 8 NCLEX Client-Needs Category bars from the 4 real evaluated clinical domains + safety trace
  const buildClientNeedsBars = () => {
    if (!result?.diagnostic_breakdown) return [];
    const db = result.diagnostic_breakdown;
    const k = db.knowledge?.score ?? 60;
    const p = db.prioritisation?.score ?? 60;
    const r = db.risk_recognition?.score ?? 60;
    const c = db.clinical_judgment?.score ?? 60;
    const clamp = (v) => Math.max(15, Math.min(100, Math.round(v)));

    return [
      { label: 'Management of care', score: clamp(p * 0.65 + c * 0.35) },
      { label: 'Safety, infection control', score: clamp(r * 0.55 + k * 0.45) },
      { label: 'Health promotion', score: clamp((k + c) * 0.5) },
      { label: 'Psychosocial integrity', score: clamp(c * 0.6 + p * 0.4) },
      { label: 'Basic care and comfort', score: clamp(p * 0.55 + k * 0.45) },
      { label: 'Pharmacological therapies', score: clamp(r * 0.6 + k * 0.4) },
      { label: 'Reduction of risk potential', score: clamp(r * 0.5 + p * 0.5) },
      { label: 'Physiological adaptation', score: clamp(c * 0.55 + k * 0.45) },
    ];
  };

  // Compute miss counts per domain for "Where misses came from"
  const buildMissBreakdown = () => {
    if (!result?.diagnostic_breakdown) return { segments: [], total: 0, bullets: [] };
    const db = result.diagnostic_breakdown;
    const countNeg = (key) =>
      Math.max(
        0,
        (db[key]?.findings || []).filter((f) => f.points < 0).length +
          (db[key]?.score < 60 ? 1 : 0)
      );

    const segments = [
      { key: 'risk_recognition', label: 'Risk recognition', color: '#c8372e', count: countNeg('risk_recognition') },
      { key: 'prioritisation', label: 'Prioritisation', color: '#e8b04b', count: countNeg('prioritisation') },
      { key: 'clinical_judgment', label: 'Clinical judgment', color: '#4c7a68', count: countNeg('clinical_judgment') },
      { key: 'knowledge', label: 'Knowledge', color: '#c9cfc7', count: countNeg('knowledge') },
    ];
    const total = segments.reduce((acc, s) => acc + s.count, 0);

    const bullets = [];
    (result.traps_triggered || []).slice(0, 2).forEach((t) => {
      bullets.push(t.detail || t.label || t.action);
    });
    (result.missed_critical_actions || []).slice(0, 3 - bullets.length).forEach((m) => {
      bullets.push(m.replace(/_/g, ' ').toLowerCase());
    });

    return { segments, total, bullets };
  };

  const clientNeeds = buildClientNeedsBars();
  const missData = buildMissBreakdown();
  const totalCritical = 5;
  const missedCount = result?.missed_critical_actions?.length ?? 0;
  const caughtCount = Math.max(0, totalCritical - Math.min(totalCritical, missedCount));

  // Pick top 2 lowest client-needs categories for the dark StudyAI CTA card
  const focusTopics = [...clientNeeds]
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((x) => x.label.toLowerCase());

  const fq = result?.adaptive_followup_question;

  return (
    <StudyAiAppShell
      breadcrumb="Entry assessment · Results"
      completed
      planLabel="Premium plan"
      floatingSlot={hygeiaFab}
    >
      {/* Eyebrow + Title + Completed Pill (Figma 36:199..36:203) */}
      <div style={{ fontSize: '14px', fontWeight: 800, color: '#1e4a38' }}>
        Entry assessment · {dateStr}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          flexWrap: 'wrap',
          marginTop: '6px',
        }}
      >
        <h1
          style={{
            fontSize: 'clamp(28px, 4vw, 38px)',
            fontWeight: 800,
            color: '#101713',
            letterSpacing: '-0.76px',
            lineHeight: 1.12,
          }}
        >
          Your gap chart, Chidinma
        </h1>
        <span
          style={{
            background: '#e9f5ec',
            color: '#2f7a4d',
            fontSize: '12px',
            fontWeight: 800,
            padding: '4px 14px',
            borderRadius: '999px',
          }}
        >
          {status === 'submitting' ? 'Scoring…' : 'Completed'}
        </span>
      </div>

      <p style={{ fontSize: '14px', color: '#6b746a', marginTop: '10px', lineHeight: 1.5 }}>
        Built from your entry scenario. It describes your performance here — it doesn&apos;t predict
        your NCLEX result.
      </p>

      {/* LOADING STATE */}
      {status === 'submitting' && (
        <div
          style={{
            marginTop: '28px',
            padding: '56px 24px',
            borderRadius: '28px',
            background: '#f8faf5',
            border: '1px solid #e7eae3',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <Loader2 size={28} color="#1e4a38" style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#101713' }}>
            Scoring your structured trace with the StudyAI Evaluation Engine…
          </div>
          <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
        </div>
      )}

      {/* ERROR STATE */}
      {status === 'error' && (
        <div
          style={{
            marginTop: '28px',
            padding: '26px',
            borderRadius: '24px',
            background: '#fff5f5',
            border: '1px solid #f5c2c0',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: '#c8372e',
              fontWeight: 800,
              fontSize: '14px',
            }}
          >
            <AlertTriangle size={16} /> The evaluation engine could not be reached. Your attempt
            trace is preserved.
          </div>
          <div className="font-mono-clinical" style={{ fontSize: '12px', color: '#6b746a' }}>
            {error}
          </div>
          <div>
            <button
              onClick={onRetry}
              style={{
                padding: '11px 22px',
                borderRadius: '999px',
                background: '#1e4a38',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Retry Evaluation
            </button>
          </div>
        </div>
      )}

      {/* COMPLETED GAP CHART */}
      {status === 'done' && result && (
        <>
          {/* HERO PISTACHIO BANNER (Figma 36:204) */}
          <div
            style={{
              marginTop: '24px',
              background: '#cde8a2',
              borderRadius: '28px',
              padding: '26px clamp(18px, 3vw, 30px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '24px',
              flexWrap: 'wrap',
            }}
          >
            {/* Score Ring + Key Counts */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <GapScoreRing score={result.overall_competency_score} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#101713', lineHeight: 1.1 }}>
                    {result.decision_tree.length}
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#41552f', marginTop: '2px' }}>
                    decisions scored
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '22px',
                      fontWeight: 800,
                      color: caughtCount < totalCritical ? '#9b2c24' : '#1e4a38',
                      lineHeight: 1.1,
                    }}
                  >
                    {caughtCount}/{totalCritical}
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#41552f', marginTop: '2px' }}>
                    critical cues caught
                  </div>
                </div>
              </div>
            </div>

            {/* 2x2 White Domain Status Cards (Figma 36:214..36:227) */}
            <div
              className="exam-grid-2"
              style={{
                flex: '1 1 480px',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '10px',
              }}
            >
              {DOMAIN_ORDER.map(([key, label]) => {
                const d = result.diagnostic_breakdown[key] || { score: 0 };
                const tier = domainTier(d.score);
                return (
                  <div
                    key={key}
                    style={{
                      background: '#ffffff',
                      borderRadius: '18px',
                      padding: '12px 18px',
                      border: tier.focus ? '2px solid #c8372e' : '1px solid rgba(255,255,255,0.8)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        style={{
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: tier.dot,
                          flexShrink: 0,
                        }}
                      />
                      <div>
                        <div style={{ fontSize: '12.5px', color: '#6b746a' }}>{label}</div>
                        <div
                          style={{
                            fontSize: '16px',
                            fontWeight: 800,
                            color: tier.color,
                            marginTop: '1px',
                          }}
                        >
                          {tier.label}
                        </div>
                      </div>
                    </div>
                    <span
                      className="font-mono-clinical"
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: tier.color,
                      }}
                    >
                      {d.score}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* VIEW SWITCHER: Gap Chart Overview | Decision Tree | Raw JSON */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              marginTop: '20px',
            }}
          >
            {[
              { id: 'gap', label: 'Gap chart overview', icon: BarChart3 },
              { id: 'tree', label: `Decision trace (${result.decision_tree.length})`, icon: GitBranch },
              { id: 'json', label: 'Raw JSON telemetry', icon: Braces },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '7px',
                    height: '38px',
                    padding: '0 16px',
                    borderRadius: '999px',
                    background: active ? '#1e4a38' : '#f8faf5',
                    color: active ? '#ffffff' : '#475045',
                    border: active ? '1px solid #1e4a38' : '1px solid #e7eae3',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={14} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* TAB 1: GAP CHART OVERVIEW (Figma 36:228 + 36:265 + Domain Rationales) */}
          {tab === 'gap' && (
            <>
              <div
                className="studyai-gap-grid"
                style={{
                  marginTop: '20px',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1.7fr) minmax(280px, 1fr)',
                  gap: '20px',
                  alignItems: 'stretch',
                }}
              >
                {/* LEFT CARD: By client-needs category (Figma 36:228) */}
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e7eae3',
                    borderRadius: '24px',
                    padding: '26px 28px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap',
                      marginBottom: '20px',
                    }}
                  >
                    <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#101713' }}>
                      By client-needs category
                    </h2>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: '#475045',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#c8372e' }} />
                        Focus
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#e8b04b' }} />
                        Developing
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#2f7a4d' }} />
                        Strong
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
                    {clientNeeds.map((row) => {
                      const isFocus = row.score < 55;
                      const isStrong = row.score >= 70;
                      const barColor = isFocus ? '#c8372e' : isStrong ? '#2f7a4d' : '#e8b04b';
                      return (
                        <div
                          key={row.label}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(145px, 195px) 1fr 34px',
                            alignItems: 'center',
                            gap: '12px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '13.5px',
                              fontWeight: isFocus ? 800 : 400,
                              color: '#101713',
                            }}
                          >
                            {row.label}
                          </span>
                          <div
                            style={{
                              height: '12px',
                              borderRadius: '6px',
                              background: '#f1f3ee',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${row.score}%`,
                                borderRadius: '6px',
                                background: barColor,
                              }}
                            />
                          </div>
                          <span
                            className="font-mono-clinical"
                            style={{
                              fontSize: '12.5px',
                              fontWeight: 600,
                              textAlign: 'right',
                              color: isFocus ? '#c8372e' : '#101713',
                            }}
                          >
                            {row.score}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <p style={{ fontSize: '12.5px', color: '#8a948a', marginTop: '20px' }}>
                    Small samples on one assessment — read bars as direction, not precision.
                  </p>
                </div>

                {/* RIGHT CARD: Where misses came from (Figma 36:265) */}
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e7eae3',
                    borderRadius: '24px',
                    padding: '26px 26px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '18px',
                  }}
                >
                  <div>
                    <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#101713' }}>
                      Where misses came from
                    </h2>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '18px',
                        marginTop: '18px',
                      }}
                    >
                      <MissesDonut segments={missData.segments} total={missData.total} />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        {missData.segments.map((s) => (
                          <div
                            key={s.key}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '13px',
                              color: '#101713',
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                style={{
                                  width: '9px',
                                  height: '9px',
                                  borderRadius: '50%',
                                  background: s.color,
                                }}
                              />
                              {s.label}
                            </span>
                            <span className="font-mono-clinical" style={{ fontWeight: 600 }}>
                              {s.count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #f1f3ee', paddingTop: '14px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 800, color: '#101713', marginBottom: '10px' }}>
                      In the scenario, you missed
                    </div>
                    {missData.bullets.length === 0 ? (
                      <div style={{ fontSize: '13px', color: '#2f7a4d', fontWeight: 700 }}>
                        Zero critical safety cues missed — bedside care met full NCLEX standard.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {missData.bullets.map((b, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '10px',
                              fontSize: '13px',
                              lineHeight: 1.45,
                              color: '#475045',
                            }}
                          >
                            <span
                              style={{
                                width: '9px',
                                height: '9px',
                                borderRadius: '50%',
                                background: '#c8372e',
                                marginTop: '5px',
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ textTransform: 'capitalize' }}>{b}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* EXIT QUESTION RATIONALES & ADAPTIVE FOLLOW-UP ITEM */}
              <div
                style={{
                  marginTop: '20px',
                  background: '#ffffff',
                  border: '1px solid #e7eae3',
                  borderRadius: '24px',
                  padding: '24px 28px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#101713' }}>
                  Nurse-educator rationales & follow-up check
                </h2>

                <div
                  className="exam-grid-2"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '12px',
                  }}
                >
                  {result.exit_questions.map((q) => (
                    <div
                      key={q.question_id}
                      style={{
                        padding: '16px 18px',
                        borderRadius: '18px',
                        background: '#f8faf5',
                        border: '1px solid #e7eae3',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13.5px',
                          fontWeight: 800,
                          color: '#101713',
                        }}
                      >
                        {q.is_correct ? (
                          <CheckCircle2 size={16} color="#2f7a4d" />
                        ) : (
                          <XCircle size={16} color="#c8372e" />
                        )}
                        {q.title}
                      </div>
                      <div style={{ fontSize: '12.5px', color: '#475045', marginTop: '8px', lineHeight: 1.5 }}>
                        <strong>Your answer ({q.selected_option_id || '—'}):</strong>{' '}
                        {q.selected_option_text || 'No response'}
                      </div>
                      {!q.is_correct && (
                        <div style={{ fontSize: '12.5px', color: '#2f7a4d', marginTop: '4px', lineHeight: 1.5 }}>
                          <strong>Approved key ({q.correct_option_id}):</strong> {q.correct_option_text}
                        </div>
                      )}
                      <div style={{ fontSize: '12px', color: '#6b746a', marginTop: '8px', lineHeight: 1.5 }}>
                        {q.rationale}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Adaptive Follow-Up Question targeted at weakest domain */}
                {fq && (
                  <div
                    style={{
                      padding: '18px 20px',
                      borderRadius: '18px',
                      background: '#f3fae6',
                      border: '1.5px solid #cde8a2',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '7px',
                        fontSize: '11.5px',
                        fontWeight: 800,
                        color: '#1e4a38',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <Sparkles size={14} /> Targeted Practice Item ·{' '}
                      {(fq.ncsbn_category || fq.targeted_weakness || 'Clinical Judgment').replace(
                        /_/g,
                        ' '
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: '14.5px',
                        fontWeight: 700,
                        color: '#101713',
                        marginTop: '8px',
                        lineHeight: 1.5,
                      }}
                    >
                      {fq.prompt || fq.stem}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                      {fq.options.map((opt, idx) => {
                        const chosen = followupChoice === idx;
                        const correctIdx = fq.correct_option_index ?? fq.correct_index ?? 0;
                        const isRight = idx === correctIdx;
                        const revealed = followupChoice !== null;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setFollowupChoice(idx)}
                            style={{
                              textAlign: 'left',
                              padding: '11px 14px',
                              borderRadius: '14px',
                              background:
                                revealed && isRight
                                  ? '#e9f5ec'
                                  : chosen && !isRight
                                    ? '#fff5f5'
                                    : '#ffffff',
                              border:
                                revealed && isRight
                                  ? '1.5px solid #2f7a4d'
                                  : chosen && !isRight
                                    ? '1.5px solid #c8372e'
                                    : '1px solid #e7eae3',
                              fontSize: '13px',
                              fontWeight: chosen || (revealed && isRight) ? 700 : 400,
                              color: '#101713',
                              cursor: 'pointer',
                            }}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                    {followupChoice !== null && (
                      <div style={{ fontSize: '12.5px', color: '#1e4a38', marginTop: '10px', lineHeight: 1.5 }}>
                        <strong>Rationale:</strong> {fq.rationale}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: CHRONOLOGICAL DECISION TRACE */}
          {tab === 'tree' && (
            <div
              style={{
                marginTop: '20px',
                background: '#ffffff',
                border: '1px solid #e7eae3',
                borderRadius: '24px',
                padding: '26px 28px',
              }}
            >
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#101713', marginBottom: '16px' }}>
                Chronological bedside decision trace
              </h2>
              <div style={{ position: 'relative', paddingLeft: '24px' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: '7px',
                    top: '6px',
                    bottom: '6px',
                    width: '2px',
                    background: '#e7eae3',
                  }}
                />
                {result.decision_tree.map((n) => {
                  const color = CLASS_COLORS[n.classification] || '#6b746a';
                  return (
                    <div key={n.step} style={{ position: 'relative', marginBottom: '14px' }}>
                      <span
                        style={{
                          position: 'absolute',
                          left: '-22px',
                          top: '4px',
                          width: '12px',
                          height: '12px',
                          borderRadius: '50%',
                          background: color,
                          boxShadow: `0 0 0 3px ${color}26`,
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          className="font-mono-clinical"
                          style={{ fontSize: '11.5px', color: '#6b746a' }}
                        >
                          {formatClock(n.timestamp_sec || 0)}
                        </span>
                        <span style={{ fontSize: '13.5px', fontWeight: 800, color: '#101713' }}>
                          {n.label}
                        </span>
                        <Chip color={color}>{n.classification.replace(/_/g, ' ')}</Chip>
                        {n.score_impact.map((s) => (
                          <Chip key={s} color={s.startsWith('-') ? '#c8372e' : '#2f7a4d'}>
                            {s}
                          </Chip>
                        ))}
                      </div>
                      {n.detail && (
                        <div style={{ fontSize: '12.5px', color: '#475045', marginTop: '3px' }}>
                          {n.detail}
                        </div>
                      )}
                      {n.rationale && (
                        <div style={{ fontSize: '12px', color: '#6b746a', marginTop: '2px', lineHeight: 1.45 }}>
                          {n.rationale}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: RAW JSON TELEMETRY FOR BACKEND HANDOVER */}
          {tab === 'json' && (
            <div
              style={{
                marginTop: '20px',
                background: '#ffffff',
                border: '1px solid #e7eae3',
                borderRadius: '24px',
                padding: '26px 28px',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
              }}
            >
              {[
                ['Payload 1 — Request (POST /api/evaluate)', payload, 'req'],
                ['Payload 2 — Evaluation Engine Response', result, 'res'],
              ].map(([title, data, key]) => {
                const text = JSON.stringify(data, null, 2);
                return (
                  <div key={key}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '8px',
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 800, color: '#1e4a38' }}>
                        {title}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(text);
                          setCopied(key);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '5px 12px',
                          borderRadius: '999px',
                          background: '#f8faf5',
                          border: '1px solid #e7eae3',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          color: '#101713',
                          cursor: 'pointer',
                        }}
                      >
                        <Copy size={12} /> {copied === key ? 'Copied' : 'Copy JSON'}
                      </button>
                    </div>
                    <pre
                      className="font-mono-clinical"
                      style={{
                        maxHeight: '300px',
                        overflow: 'auto',
                        padding: '14px',
                        borderRadius: '16px',
                        background: '#0a1310',
                        color: '#bfe8d6',
                        fontSize: '11.5px',
                        lineHeight: 1.5,
                      }}
                    >
                      {text}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}

          {/* BOTTOM DARK FOREST CTA BANNER (Figma 36:294) */}
          <div
            style={{
              marginTop: '24px',
              background: '#1e4a38',
              borderRadius: '28px',
              padding: '30px clamp(20px, 3vw, 34px)',
              color: '#f2f7ee',
            }}
          >
            <h3 style={{ fontSize: '21px', fontWeight: 800, color: '#f2f7ee' }}>
              Your question bank is now picked for you
            </h3>
            <p
              style={{
                fontSize: '15px',
                lineHeight: '24.8px',
                color: '#c9dcc3',
                marginTop: '10px',
                maxWidth: '720px',
              }}
            >
              Your sets start with{' '}
              <strong style={{ color: '#ffffff' }}>
                {focusTopics[0] || 'pharmacological therapies'}
              </strong>{' '}
              and{' '}
              <strong style={{ color: '#ffffff' }}>
                {focusTopics[1] || 'reduction of risk potential'}
              </strong>
              , weighted by the NCLEX test plan. Practise with instant explanations, or run another
              timed bedside scenario.
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
                marginTop: '20px',
              }}
            >
              <button
                type="button"
                onClick={onNewAttempt}
                style={{
                  height: '52px',
                  padding: '0 28px',
                  borderRadius: '26px',
                  background: '#cde8a2',
                  color: '#14301f',
                  border: 'none',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <RotateCcw size={15} /> Run scenario again
              </button>
              <button
                type="button"
                onClick={() => setTab(tab === 'json' ? 'gap' : 'json')}
                style={{
                  height: '52px',
                  padding: '0 26px',
                  borderRadius: '26px',
                  background: 'transparent',
                  color: '#e4efe0',
                  border: '2px solid #51705b',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {tab === 'json' ? 'Back to gap chart' : 'Inspect JSON trace'}
              </button>
            </div>
          </div>
        </>
      )}
    </StudyAiAppShell>
  );
}
