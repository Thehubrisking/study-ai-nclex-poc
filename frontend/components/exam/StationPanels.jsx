'use client';

import React from 'react';
import { Power, UserCheck, Flag, Pill, Syringe, AlertOctagon } from 'lucide-react';
import VitalsMonitorModal from '../VitalsMonitorModal';

/**
 * Exam-mode station panel bodies. Every option uses the same neutral styling — the candidate
 * never sees "correct" (green) vs "dangerous" (red) colouring, and no consequence text is shown.
 */
function useTokens(darkMode) {
  return {
    text: darkMode ? '#f8fafc' : '#0f172a',
    muted: darkMode ? '#94a3b8' : '#64748b',
    border: darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)',
    sub: darkMode ? 'liquid-subcard-dark' : 'liquid-subcard-light',
    selectedBg: darkMode ? 'rgba(37, 99, 235, 0.28)' : 'rgba(37, 99, 235, 0.12)',
  };
}

function OptionButton({ tk, selected = false, disabled = false, onClick, children, align = 'left' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={selected ? '' : tk.sub}
      style={{
        width: '100%',
        padding: '11px 13px',
        borderRadius: '14px',
        textAlign: align,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? tk.muted : tk.text,
        background: selected ? tk.selectedBg : undefined,
        border: selected ? '1.5px solid #2563eb' : undefined,
        fontSize: '12px',
        fontWeight: 700,
        lineHeight: 1.4,
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Note({ tk, children, icon: Icon }) {
  return (
    <div
      className={tk.sub}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '9px 12px',
        borderRadius: '12px',
        fontSize: '11.5px',
        fontWeight: 600,
        color: tk.text,
      }}
    >
      {Icon && <Icon size={14} color={tk.muted} />}
      <span>{children}</span>
    </div>
  );
}

export default function StationPanelBody(props) {
  const { stationId, scenario, darkMode } = props;
  const tk = useTokens(darkMode);
  const ex = scenario.exam_config;

  /* ---------- 1. BEDSIDE MONITOR ---------- */
  if (stationId === 'bedside_monitor') {
    if (!props.monitorConnected) {
      return (
        <div className={tk.sub} style={{ padding: '18px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div
            style={{
              borderRadius: '12px',
              background: '#020617',
              padding: '26px 16px',
              textAlign: 'center',
              color: '#475569',
              fontFamily: 'monospace',
              fontWeight: 800,
              letterSpacing: '0.08em',
            }}
          >
            {ex.monitor.standby_title}
          </div>
          <div style={{ fontSize: '12px', color: tk.muted }}>{ex.monitor.standby_text}</div>
          <OptionButton tk={tk} onClick={props.onPowerOn}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Power size={15} /> {ex.monitor.power_on_label}
            </span>
          </OptionButton>
        </div>
      );
    }
    return (
      <VitalsMonitorModal
        patientName={scenario.patient.name}
        vitals={props.vitals}
        checkedVitals={props.vitalsDocumented}
        darkMode={darkMode}
        examMode
        onLogInspection={props.onDocumentVitals}
      />
    );
  }

  /* ---------- 2. PATIENT WRIST ---------- */
  if (stationId === 'wristband') {
    const p = scenario.patient;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className={tk.sub} style={{ padding: '13px 15px', borderRadius: '16px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', color: tk.muted }}>
            {ex.wristband.observation_title.toUpperCase()}
          </div>
          <div style={{ fontSize: '12.5px', marginTop: '4px', lineHeight: 1.5 }}>{p.presenting_status}.</div>
        </div>
        <div className={tk.sub} style={{ padding: '13px 15px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', color: tk.muted }}>PATIENT ID WRISTBAND</span>
            <UserCheck size={15} color={tk.muted} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 800 }}>
            <span>{p.name}</span>
            <span style={{ fontFamily: 'monospace' }}>{p.mrn}</span>
          </div>
          <div style={{ fontSize: '11.5px', color: tk.muted }}>DOB: {p.dob}</div>
          <div style={{ fontSize: '11.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: '#dc2626', display: 'inline-block' }} />
            {ex.wristband.allergy_band_text}
          </div>
        </div>
        {props.verifiedId ? (
          <Note tk={tk} icon={UserCheck}>{ex.wristband.verified_label}</Note>
        ) : (
          <OptionButton tk={tk} onClick={props.onVerifyId}>{ex.wristband.verify_label}</OptionButton>
        )}
      </div>
    );
  }

  /* ---------- 3. EHR WORKSTATION ---------- */
  if (stationId === 'ehr_tablet') {
    const tab = props.activeEhrTab;
    const m = ex.mar_actions;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '4px',
            borderRadius: '999px',
            background: darkMode ? 'rgba(15, 23, 42, 0.55)' : 'rgba(241, 245, 249, 0.85)',
          }}
        >
          {Object.keys(scenario.ehr_tabs).map((k) => (
            <button
              key={k}
              onClick={() => props.onSelectEhrTab(k)}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: '999px',
                background: tab === k ? 'linear-gradient(135deg, #0066ff, #2563eb)' : 'transparent',
                color: tab === k ? '#ffffff' : tk.muted,
                border: 'none',
                fontSize: '11px',
                fontWeight: 800,
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <div
          className={tk.sub}
          style={{
            padding: '13px 15px',
            borderRadius: '16px',
            fontSize: '12.5px',
            lineHeight: 1.6,
            whiteSpace: 'pre-line',
            fontWeight: 500,
            userSelect: 'text',
          }}
        >
          {scenario.ehr_tabs[tab]}
        </div>

        {tab === 'mar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', color: tk.muted }}>MAR ACTIONS</div>
            {props.cefazolinStatus === 'GIVEN' ? (
              <Note tk={tk} icon={Pill}>{m.cefazolin.given_label}</Note>
            ) : props.cefazolinStatus === 'HELD' ? (
              <Note tk={tk} icon={AlertOctagon}>{m.cefazolin.hard_stop_label}</Note>
            ) : (
              <OptionButton tk={tk} onClick={props.onCefazolin}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Pill size={14} /> {m.cefazolin.label}
                </span>
              </OptionButton>
            )}
            {props.naloxonePrepared ? (
              <Note tk={tk} icon={Syringe}>{m.naloxone.prepared_label}</Note>
            ) : (
              <OptionButton tk={tk} onClick={props.onPrepareNaloxone}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Syringe size={14} /> {m.naloxone.label}
                </span>
              </OptionButton>
            )}
          </div>
        )}

        {tab === 'allergies' &&
          (props.allergyFlagged ? (
            <Note tk={tk} icon={Flag}>{ex.allergy_flag.flagged_label}</Note>
          ) : (
            <OptionButton tk={tk} onClick={props.onFlagAllergy}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Flag size={14} /> {ex.allergy_flag.label}
              </span>
            </OptionButton>
          ))}
      </div>
    );
  }

  /* ---------- 4. BED FRAME CONTROLS ---------- */
  if (stationId === 'hospital_bed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '11.5px', color: tk.muted }}>Head-of-bed position:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          {ex.bed_positions.map((pos) => (
            <OptionButton key={pos.angle} tk={tk} selected={props.bedAngle === pos.angle} onClick={() => props.onSetBed(pos)}>
              <div style={{ fontSize: '13px', fontWeight: 900 }}>{pos.title}</div>
              <div style={{ fontSize: '10.5px', opacity: 0.75, marginTop: '2px' }}>{pos.sub}</div>
            </OptionButton>
          ))}
        </div>
      </div>
    );
  }

  /* ---------- 5. WALL GAS OUTLET ---------- */
  if (stationId === 'wall_oxygen') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ fontSize: '11.5px', color: tk.muted }}>Oxygen flowmeter (green O2 outlet):</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          {ex.oxygen_devices.map((dev) => (
            <OptionButton key={dev.id} tk={tk} selected={props.o2Device === dev.id} onClick={() => props.onSetO2(dev.id)}>
              <div style={{ fontSize: '12.5px', fontWeight: 900 }}>{dev.title}</div>
              <div style={{ fontSize: '10.5px', opacity: 0.75, marginTop: '2px' }}>{dev.flow}</div>
            </OptionButton>
          ))}
          <OptionButton tk={tk} selected={!props.o2Device} onClick={() => props.onSetO2(null)}>
            <div style={{ fontSize: '12.5px', fontWeight: 900 }}>Off</div>
            <div style={{ fontSize: '10.5px', opacity: 0.75, marginTop: '2px' }}>Flowmeter closed</div>
          </OptionButton>
        </div>
      </div>
    );
  }

  /* ---------- 6. IV INFUSION PUMP ---------- */
  if (stationId === 'iv_pump') {
    const pump = ex.iv_pump;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          style={{
            borderRadius: '14px',
            background: '#020617',
            padding: '12px 14px',
            fontFamily: 'monospace',
            color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 800 }}>
            <span>{pump.channel_label}</span>
            <span style={{ color: props.pcaPaused ? '#fbbf24' : '#4ade80' }}>
              {props.pcaPaused ? '■ PAUSED' : '▶ INFUSING'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '8px' }}>
            {pump.display_rows.map((r) => (
              <div key={r.label}>
                <div style={{ fontSize: '9.5px', color: '#64748b' }}>{r.label.toUpperCase()}</div>
                <div style={{ fontSize: '13px', fontWeight: 800 }}>{r.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {pump.options.map((opt) => (
            <OptionButton key={opt.id} tk={tk} onClick={() => props.onPcaOption(opt)}>
              {opt.label}
            </OptionButton>
          ))}
        </div>
        {props.naloxonePrepared && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.08em', color: tk.muted }}>
              PREPARED MEDICATION (Y-SITE)
            </div>
            <OptionButton tk={tk} onClick={props.onAdministerNaloxone}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Syringe size={14} /> {ex.naloxone.administer_label}
              </span>
            </OptionButton>
          </div>
        )}
      </div>
    );
  }

  return null;
}
