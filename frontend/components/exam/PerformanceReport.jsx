'use client';

import React, { useState } from 'react';
import {
  Lock,
  RotateCcw,
  BarChart3,
  GitBranch,
  Braces,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
} from 'lucide-react';
import { ExamOverlay, examTokens } from './BriefingModal';
import { formatClock } from '../../lib/examEngine';

const CLASS_COLORS = {
  CORRECT: '#10b981',
  ASSESSMENT: '#38bdf8',
  NEUTRAL: '#94a3b8',
  TRAP: '#f59e0b',
  CRITICAL_ERROR: '#ef4444',
  PENALTY: '#f97316',
  PHYSIOLOGIC_EVENT: '#a78bfa',
  SYSTEM: '#64748b',
};
const BAND_COLORS = { HIGH: '#10b981', NEAR: '#f59e0b', BELOW_STANDARD: '#ef4444' };
const DOMAIN_LABELS = {
  knowledge: 'Knowledge',
  prioritisation: 'Prioritisation',
  risk_recognition: 'Risk Recognition',
  clinical_judgment: 'Clinical Judgment',
};

function ScoreRing({ score, color, size = 108 }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(148,163,184,0.2)" strokeWidth="10" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fontSize="26" fontWeight="900" fill="currentColor">
        {score}
      </text>
      <text x="50%" y="68%" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="currentColor" opacity="0.6">
        / 100
      </text>
    </svg>
  );
}

function Chip({ color, children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '9.5px',
        fontWeight: 900,
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: '999px',
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function SectionTitle({ children, tk }) {
  return (
    <div style={{ fontSize: '10.5px', fontWeight: 900, letterSpacing: '0.12em', color: tk.muted, margin: '4px 0 8px' }}>
      {children}
    </div>
  );
}

function DiagnosticTab({ result, tk }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="exam-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
        {Object.entries(result.diagnostic_breakdown).map(([key, d]) => {
          const color = d.score >= 80 ? '#10b981' : d.score >= 60 ? '#f59e0b' : '#ef4444';
          return (
            <div key={key} style={{ padding: '14px', borderRadius: '16px', background: tk.subtle, border: `1px solid ${tk.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '14px', fontWeight: 900 }}>{DOMAIN_LABELS[key] || key}</span>
                <span style={{ fontSize: '20px', fontWeight: 900, color }}>{d.score}</span>
              </div>
              <div style={{ height: '6px', borderRadius: '999px', background: 'rgba(148,163,184,0.2)', margin: '6px 0' }}>
                <div style={{ width: `${d.score}%`, height: '100%', borderRadius: '999px', background: color }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', fontSize: '10px', color: tk.muted }}>
                <span>{d.ncsbn_domain}</span>
                <Chip color={color}>{d.status.replace(/_/g, ' ')}</Chip>
              </div>
              <ul style={{ listStyle: 'none', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {d.findings.map((f, i) => (
                  <li key={i} style={{ display: 'flex', gap: '8px', fontSize: '11.5px', lineHeight: 1.4 }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: '36px',
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        color: f.points > 0 ? '#10b981' : f.points < 0 ? '#ef4444' : tk.muted,
                      }}
                    >
                      {f.points > 0 ? `+${f.points}` : f.points}
                    </span>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div>
        <SectionTitle tk={tk}>NCJMM LAYERS DEMONSTRATED</SectionTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {['RECOGNIZE_CUES', 'ANALYZE_CUES', 'PRIORITIZE_HYPOTHESES', 'GENERATE_SOLUTIONS', 'TAKE_ACTION', 'EVALUATE_OUTCOMES'].map((l) => (
            <Chip key={l} color={result.ncjmm_layers_demonstrated.includes(l) ? '#10b981' : '#64748b'}>
              {result.ncjmm_layers_demonstrated.includes(l) ? '✓' : '○'} {l.replace(/_/g, ' ')}
            </Chip>
          ))}
        </div>
      </div>

      {result.missed_critical_actions.length > 0 && (
        <div>
          <SectionTitle tk={tk}>MISSED CRITICAL ACTIONS</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {result.missed_critical_actions.map((m) => (
              <Chip key={m} color="#ef4444">{m.replace(/_/g, ' ')}</Chip>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionTitle tk={tk}>EXIT QUESTIONS</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {result.exit_questions.map((q) => (
            <div key={q.question_id} style={{ padding: '12px 14px', borderRadius: '14px', background: tk.subtle, border: `1px solid ${tk.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 900 }}>
                {q.is_correct ? <CheckCircle2 size={15} color="#10b981" /> : <XCircle size={15} color="#ef4444" />}
                {q.title}
              </div>
              <div style={{ fontSize: '11.5px', marginTop: '6px', lineHeight: 1.45 }}>
                <strong>Your answer ({q.selected_option_id || '—'}):</strong> {q.selected_option_text || 'No response'}
              </div>
              {!q.is_correct && (
                <div style={{ fontSize: '11.5px', marginTop: '4px', lineHeight: 1.45, color: '#10b981' }}>
                  <strong>Best answer ({q.correct_option_id}):</strong> {q.correct_option_text}
                </div>
              )}
              <div style={{ fontSize: '11px', marginTop: '6px', lineHeight: 1.45, color: tk.muted }}>
                <strong>Rationale:</strong> {q.rationale}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle tk={tk}>RECOMMENDED PRACTICE</SectionTitle>
        <ul style={{ paddingLeft: '18px', fontSize: '12px', lineHeight: 1.6 }}>
          {result.recommended_practice_topics.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DecisionTreeTab({ result, tk }) {
  const traps = result.traps_triggered;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <SectionTitle tk={tk}>TRAPS, ERRORS & PENALTIES TRIGGERED ({traps.length})</SectionTitle>
        {traps.length === 0 ? (
          <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 700 }}>No traps, critical errors, or penalties were triggered.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {traps.map((t) => {
              const color = CLASS_COLORS[t.classification] || '#94a3b8';
              return (
                <div
                  key={t.step}
                  style={{ padding: '10px 12px', borderRadius: '12px', background: `${color}14`, border: `1px solid ${color}55` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <AlertTriangle size={14} color={color} />
                    <span style={{ fontSize: '12px', fontWeight: 900 }}>{t.action}</span>
                    <Chip color={color}>{t.classification.replace(/_/g, ' ')}</Chip>
                    {t.severity && <Chip color={color}>{t.severity}</Chip>}
                    <span style={{ fontSize: '10.5px', color: tk.muted, fontFamily: 'monospace' }}>
                      T+{formatClock(t.timestamp_sec || 0)}
                    </span>
                  </div>
                  <div style={{ fontSize: '11.5px', marginTop: '4px' }}>{t.detail || t.label}</div>
                  {t.rationale && (
                    <div style={{ fontSize: '11px', marginTop: '4px', color: tk.muted, lineHeight: 1.45 }}>{t.rationale}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <SectionTitle tk={tk}>DECISION TREE (CHRONOLOGICAL)</SectionTitle>
        <div style={{ position: 'relative', paddingLeft: '22px' }}>
          <div style={{ position: 'absolute', left: '7px', top: '4px', bottom: '4px', width: '2px', background: tk.border }} />
          {result.decision_tree.map((n) => {
            const color = CLASS_COLORS[n.classification] || '#94a3b8';
            return (
              <div key={n.step} style={{ position: 'relative', marginBottom: '10px' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '-21px',
                    top: '4px',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: color,
                    boxShadow: `0 0 0 3px ${color}33`,
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '10.5px', fontFamily: 'monospace', color: tk.muted }}>
                    T+{formatClock(n.timestamp_sec || 0)}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 800 }}>{n.label}</span>
                  <Chip color={color}>{n.classification.replace(/_/g, ' ')}</Chip>
                  {n.score_impact.map((s) => (
                    <Chip key={s} color={s.startsWith('-') ? '#ef4444' : '#10b981'}>{s}</Chip>
                  ))}
                </div>
                {n.detail && <div style={{ fontSize: '11px', marginTop: '2px' }}>{n.detail}</div>}
                {n.rationale && ['CORRECT', 'TRAP', 'CRITICAL_ERROR', 'PENALTY', 'PHYSIOLOGIC_EVENT', 'NEUTRAL'].includes(n.classification) && (
                  <div style={{ fontSize: '10.5px', marginTop: '2px', color: tk.muted, lineHeight: 1.4 }}>{n.rationale}</div>
                )}
                {n.vitals_snapshot && (
                  <div style={{ fontSize: '10px', marginTop: '2px', color: tk.muted, fontFamily: 'monospace' }}>
                    Vitals at decision: SpO2 {n.vitals_snapshot.spo2}% • HR {n.vitals_snapshot.hr} • RR {n.vitals_snapshot.rr} • EtCO2 {n.vitals_snapshot.etco2}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RawJsonTab({ payload, result, tk, darkMode }) {
  const [copied, setCopied] = useState(null);
  const block = (title, data, key) => {
    const text = JSON.stringify(data, null, 2);
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionTitle tk={tk}>{title}</SectionTitle>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(text);
              setCopied(key);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10.5px',
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: '999px',
              border: `1px solid ${tk.border}`,
              background: 'transparent',
              color: tk.text,
              cursor: 'pointer',
            }}
          >
            <Copy size={11} /> {copied === key ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre
          style={{
            maxHeight: '320px',
            overflow: 'auto',
            padding: '12px',
            borderRadius: '12px',
            background: darkMode ? 'rgba(2,6,23,0.7)' : 'rgba(15,23,42,0.06)',
            border: `1px solid ${tk.border}`,
            fontSize: '10.5px',
            lineHeight: 1.45,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            userSelect: 'text',
          }}
        >
          {text}
        </pre>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {block('TELEMETRY PAYLOAD SENT → POST /api/evaluate', payload, 'payload')}
      {result && block('EVALUATION ENGINE RESPONSE', result, 'result')}
    </div>
  );
}

export default function PerformanceReport({
  scenario,
  darkMode,
  status,
  payload,
  result,
  error,
  onRetry,
  onNewAttempt,
}) {
  const tk = examTokens(darkMode);
  const [tab, setTab] = useState('diagnostic');
  const ex = scenario.exam_config;

  const tabs = [
    { id: 'diagnostic', label: 'Diagnostic Breakdown', icon: BarChart3 },
    { id: 'tree', label: 'Decision Tree & Traps Triggered', icon: GitBranch },
    { id: 'json', label: 'Raw JSON Telemetry', icon: Braces },
  ];
  const bandColor = result ? BAND_COLORS[result.readiness_band.level] || '#94a3b8' : '#94a3b8';

  return (
    <ExamOverlay darkMode={darkMode} width={980}>
      {/* Header */}
      <div style={{ padding: '22px 28px 14px', borderBottom: `1px solid ${tk.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '10.5px', fontWeight: 900, letterSpacing: '0.2em', color: tk.accent }}>
              NGN EXAM READINESS ASSESSMENT • {scenario.scenario_id}
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 900, marginTop: '4px' }}>Official NCLEX-RN Performance Report</h2>
          </div>
          <Chip color="#94a3b8">
            <Lock size={11} /> LOCKED — RESULTS FINAL
          </Chip>
        </div>
        <div style={{ fontSize: '11px', color: tk.muted, marginTop: '6px', fontFamily: 'monospace' }}>
          Candidate {payload?.student_id} • Session {payload?.session_id}
          {result ? ` • ${new Date(result.evaluated_at).toLocaleString()} • ${result.engine}` : ''}
        </div>
      </div>

      {status === 'submitting' && (
        <div style={{ padding: '60px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <Loader2 size={28} color={tk.accent} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ fontSize: '13px', fontWeight: 700 }}>Scoring attempt with the Study AI Evaluation Engine…</div>
          <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
        </div>
      )}

      {status === 'error' && (
        <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontWeight: 800, fontSize: '13px' }}>
            <AlertTriangle size={16} /> The evaluation engine could not be reached. Your attempt is preserved — no scores have been estimated.
          </div>
          <div style={{ fontSize: '11.5px', color: tk.muted, fontFamily: 'monospace' }}>{error}</div>
          <div>
            <button
              onClick={onRetry}
              style={{
                padding: '10px 18px',
                borderRadius: '999px',
                background: tk.primary,
                color: '#fff',
                border: 'none',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Retry Submission
            </button>
          </div>
          <RawJsonTab payload={payload} result={null} tk={tk} darkMode={darkMode} />
        </div>
      )}

      {status === 'done' && result && (
        <>
          {/* Summary */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
              padding: '18px 28px',
              flexWrap: 'wrap',
              borderBottom: `1px solid ${tk.border}`,
            }}
          >
            <div style={{ color: tk.text }}>
              <ScoreRing score={result.overall_competency_score} color={bandColor} />
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontSize: '16px', fontWeight: 900, color: bandColor }}>{result.readiness_band.label}</div>
              <div style={{ fontSize: '12px', color: tk.muted, marginTop: '4px', lineHeight: 1.45 }}>
                {result.readiness_band.detail}
              </div>
              {result.critical_safety_events.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {result.critical_safety_events.map((c, i) => (
                    <Chip key={`${c}-${i}`} color="#ef4444">
                      <AlertTriangle size={10} /> {c.replace(/_/g, ' ')}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '4px 14px', fontSize: '11.5px' }}>
              <span style={{ color: tk.muted }}>End of bedside phase</span>
              <strong>{result.end_reason.replace(/_/g, ' ')}</strong>
              <span style={{ color: tk.muted }}>Time used</span>
              <strong style={{ fontFamily: 'monospace' }}>
                {formatClock(result.time_used_sec)} / {formatClock(result.time_limit_sec)}
              </strong>
              <span style={{ color: tk.muted }}>Patient stabilized</span>
              <strong style={{ color: result.stabilized_at_end ? '#10b981' : '#ef4444' }}>
                {result.stabilized_at_end ? 'Yes' : 'No'}
              </strong>
              <span style={{ color: tk.muted }}>Traps / errors</span>
              <strong>{result.traps_triggered.length}</strong>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '6px', padding: '12px 28px 0', flexWrap: 'wrap' }}>
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '999px',
                    background: active ? tk.primary : 'transparent',
                    color: active ? '#ffffff' : tk.text,
                    border: active ? '1px solid rgba(255,255,255,0.4)' : `1px solid ${tk.border}`,
                    fontSize: '12px',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={13} /> {t.label}
                </button>
              );
            })}
          </div>
          <div style={{ padding: '16px 28px' }}>
            {tab === 'diagnostic' && <DiagnosticTab result={result} tk={tk} />}
            {tab === 'tree' && <DecisionTreeTab result={result} tk={tk} />}
            {tab === 'json' && <RawJsonTab payload={payload} result={result} tk={tk} darkMode={darkMode} />}
          </div>
        </>
      )}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 28px 22px',
          borderTop: `1px solid ${tk.border}`,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '11px', color: tk.muted }}>
          A new attempt resets the room, the patient, and the clock to {formatClock(ex.duration_sec)}.
        </span>
        <button
          onClick={onNewAttempt}
          disabled={status === 'submitting'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 20px',
            borderRadius: '999px',
            background: tk.primary,
            color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.4)',
            fontSize: '13px',
            fontWeight: 900,
            cursor: status === 'submitting' ? 'wait' : 'pointer',
            opacity: status === 'submitting' ? 0.6 : 1,
          }}
        >
          <RotateCcw size={15} /> Start New Exam Attempt
        </button>
      </div>
    </ExamOverlay>
  );
}
