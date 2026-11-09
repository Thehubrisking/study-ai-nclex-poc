'use client';

import React, { useEffect, useRef } from 'react';
import { Activity, Eye, CheckCircle2, AlertTriangle } from 'lucide-react';
import { SweepMonitor } from '../lib/monitorRenderer';
import { deriveClinicalState, monitorConfig } from '../lib/liveVitals';

/**
 * 2D bedside-monitor overlay for the `bedside_monitor` object.
 * Styled with Liquid Glass sub-cards and Dark/Light mode support.
 */
export default function VitalsMonitorModal({
  patientName,
  vitals,
  checkedVitals,
  onLogInspection,
  darkMode = true,
  examMode = false,
}) {
  const canvasRef = useRef(null);
  const { cue_text } = monitorConfig;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const monitor = new SweepMonitor(canvas, { pixelRatio: dpr, patientName });
    let raf;
    let last = performance.now();
    const loop = (now) => {
      monitor.tick((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [patientName]);

  const state = deriveClinicalState(vitals.spo2, vitals.alarm_active);
  const cyanotic = state.cyanosisRaw > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* ICU Waveform Screen */}
      <div
        style={{
          borderRadius: '16px',
          overflow: 'hidden',
          background: '#020617',
          padding: '4px',
          border: darkMode
            ? '1px solid rgba(255,255,255,0.14)'
            : '1px solid rgba(15,23,42,0.12)',
          boxShadow: '0 10px 28px rgba(2, 6, 23, 0.35)',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            aspectRatio: '640 / 400',
            borderRadius: '12px',
            display: 'block',
          }}
        />
      </div>

      {/* Clinical Assessment Cues (Liquid Glass Sub-Cards) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '8px',
        }}
      >
        {/* Exam mode: skin/cyanosis findings belong to bedside assessment, not the monitor read-out */}
        {!examMode && (
        <div
          className={darkMode ? 'liquid-subcard-dark' : 'liquid-subcard-light'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '9px 12px',
            borderRadius: '14px',
          }}
        >
          <span
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '10px',
              background: examMode ? '#475569' : cyanotic ? '#0066ff' : '#10b981',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: cyanotic
                ? '0 4px 12px rgba(0, 102, 255, 0.35)'
                : '0 4px 12px rgba(16, 185, 129, 0.35)',
            }}
          >
            <Eye size={15} />
          </span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: darkMode ? '#f8fafc' : '#0f172a',
              }}
            >
              {cyanotic ? cue_text.cyanosis_present : cue_text.cyanosis_clear}
            </div>
            {!examMode && (
            <div
              style={{
                fontSize: '10px',
                color: darkMode ? '#94a3b8' : '#64748b',
              }}
            >
              Cyanosis index: {Math.round(state.cyanosisRaw * 100)}%
            </div>
            )}
          </div>
        </div>
        )}

        {/* Exam mode hides the waveform interpretation — reading the rhythm is the candidate's job */}
        {!examMode && (
        <div
          className={darkMode ? 'liquid-subcard-dark' : 'liquid-subcard-light'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '9px 12px',
            borderRadius: '14px',
          }}
        >
          <span
            className={state.hypoxia > 0 ? 'alarm-pulse' : ''}
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '10px',
              background: state.hypoxia > 0 ? '#ef4444' : '#10b981',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {state.hypoxia > 0 ? (
              <AlertTriangle size={15} />
            ) : (
              <Activity size={15} />
            )}
          </span>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color:
                state.hypoxia > 0
                  ? darkMode
                    ? '#fca5a5'
                    : '#b91c1c'
                  : darkMode
                    ? '#e2e8f0'
                    : '#334155',
              lineHeight: 1.38,
            }}
          >
            {state.hypoxia > 0
              ? cue_text.waveform_hypoxic
              : cue_text.waveform_normal}
          </div>
        </div>
        )}
      </div>

      {/* Primary Action Pill Button */}
      <button
        onClick={onLogInspection}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '11px 15px',
          borderRadius: '14px',
          background: checkedVitals
            ? examMode
              ? 'linear-gradient(135deg, #475569, #334155)'
              : 'linear-gradient(135deg, #10b981, #059669)'
            : 'linear-gradient(135deg, #0066ff, #2563eb)',
          color: '#ffffff',
          border: '1px solid rgba(255,255,255,0.35)',
          fontWeight: 700,
          fontSize: '12px',
          cursor: 'pointer',
          boxShadow: checkedVitals
            ? 'inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 18px rgba(16, 185, 129, 0.32)'
            : 'inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 18px rgba(0, 102, 255, 0.35)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={15} />
          {examMode
            ? checkedVitals
              ? 'Vital Signs Documented — Click to Re-document'
              : 'Document Vital Signs in Flowsheet'
            : checkedVitals
              ? 'Vitals Cues Recognized & Logged'
              : 'Log Vital Sign Inspection (Recognize Cues)'}
        </span>
        <span
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.22)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
          }}
        >
          ↗
        </span>
      </button>
    </div>
  );
}
