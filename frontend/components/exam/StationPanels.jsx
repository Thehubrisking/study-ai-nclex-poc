'use client';

import React, { useState } from 'react';
import {
  Power,
  UserCheck,
  Flag,
  Pill,
  Syringe,
  AlertOctagon,
  ShieldAlert,
  ShieldCheck,
  Droplets,
  HelpCircle,
  CheckCircle2,
} from 'lucide-react';
import VitalsMonitorModal from '../VitalsMonitorModal';

/**
 * StudyAI Exam-mode station panel bodies — Matches Figma 36:84 ("Patient chart") & 36:144 action cards.
 * Every option uses uniform StudyAI clinical styling (no spoiler green/red correctness cues).
 */
function useTokens(darkMode) {
  return {
    text: darkMode ? '#eaf2ee' : '#101713',
    muted: darkMode ? '#8ca69b' : '#6b746a',
    section: darkMode ? '#6fd1a9' : '#1e4a38',
    border: darkMode ? '#2a4136' : '#e7eae3',
    sub: darkMode ? 'liquid-subcard-dark' : 'liquid-subcard-light',
    selectedBg: darkMode ? '#143528' : '#f3fae6',
    selectedBorder: darkMode ? '2px solid #6fd1a9' : '2px solid #1e4a38',
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
        padding: '11px 14px',
        borderRadius: '14px',
        textAlign: align,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: disabled ? tk.muted : tk.text,
        background: selected ? tk.selectedBg : undefined,
        border: selected ? tk.selectedBorder : undefined,
        fontSize: '12.5px',
        fontWeight: selected ? 700 : 500,
        lineHeight: 1.45,
        opacity: disabled ? 0.65 : 1,
        transition: 'border-color 0.14s ease, background 0.14s ease',
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
        gap: '9px',
        padding: '10px 14px',
        borderRadius: '12px',
        fontSize: '12.5px',
        fontWeight: 700,
        color: tk.text,
      }}
    >
      {Icon && <Icon size={14} color={tk.section} style={{ flexShrink: 0 }} />}
      <span>{children}</span>
    </div>
  );
}

/**
 * In-Station NCLEX Clinical Check — lets the candidate connect observed station cues
 * to NCLEX concepts without revealing correctness until the post-exam Gap Chart.
 */
function StationMicroQuestion({ tk, darkMode, question, selectedOptionId, onSelect }) {
  if (!question) return null;
  return (
    <div
      style={{
        marginTop: '6px',
        padding: '13px 14px',
        borderRadius: '14px',
        background: darkMode ? 'rgba(10, 19, 16, 0.85)' : '#f8faf5',
        border: `1px solid ${tk.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '9px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '10.5px',
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: tk.section,
            textTransform: 'uppercase',
          }}
        >
          <HelpCircle size={13} /> NCLEX Station Check · {question.ncsbn_category}
        </span>
        {selectedOptionId && (
          <span
            className="font-mono-clinical"
            style={{
              fontSize: '10.5px',
              color: '#bfe8d6',
              background: '#1e3a2f',
              padding: '2px 8px',
              borderRadius: '999px',
            }}
          >
            Saved ({selectedOptionId})
          </span>
        )}
      </div>

      <div style={{ fontSize: '12.5px', fontWeight: 600, lineHeight: 1.5, color: tk.text }}>
        {question.prompt}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {question.options.map((opt) => {
          const isSel = selectedOptionId === opt.id;
          return (
            <OptionButton
              key={opt.id}
              tk={tk}
              selected={isSel}
              onClick={() => onSelect?.(question.question_id, opt.id)}
            >
              <strong style={{ color: tk.section, marginRight: '6px' }}>{opt.id}.</strong>
              {opt.text}
            </OptionButton>
          );
        })}
      </div>
    </div>
  );
}

export default function StationPanelBody(props) {
  const { stationId, scenario, darkMode } = props;
  const tk = useTokens(darkMode);
  const ex = scenario.exam_config;
  const [surgicalMediaTab, setSurgicalMediaTab] = useState('jp_dressing');

  const stationQuestion = ex.station_questions?.[stationId] || null;
  const selectedStationAnswer = stationQuestion
    ? props.stationAnswers?.[stationQuestion.question_id] || null
    : null;

  /* ---------- 1. BEDSIDE MONITOR ---------- */
  if (stationId === 'bedside_monitor') {
    if (!props.monitorConnected) {
      return (
        <div
          className={tk.sub}
          style={{
            padding: '18px',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div
            className="font-mono-clinical"
            style={{
              borderRadius: '12px',
              background: '#0a1310',
              border: '1px solid #22382f',
              padding: '26px 16px',
              textAlign: 'center',
              color: '#5e7a6c',
              fontWeight: 600,
              fontSize: '12.5px',
              letterSpacing: '0.06em',
            }}
          >
            {ex.monitor.standby_title}
          </div>
          <div style={{ fontSize: '12.5px', color: tk.muted, lineHeight: 1.5 }}>
            {ex.monitor.standby_text}
          </div>
          <OptionButton tk={tk} selected onClick={props.onPowerOn}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Power size={15} color="#6fd1a9" /> {ex.monitor.power_on_label}
            </span>
          </OptionButton>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <VitalsMonitorModal
          patientName={scenario.patient.name}
          vitals={props.vitals}
          checkedVitals={props.vitalsDocumented}
          darkMode={darkMode}
          examMode
          onLogInspection={props.onDocumentVitals}
        />
        <StationMicroQuestion
          tk={tk}
          darkMode={darkMode}
          question={stationQuestion}
          selectedOptionId={selectedStationAnswer}
          onSelect={props.onAnswerStationQuestion}
        />
      </div>
    );
  }

  /* ---------- 2. PATIENT WRIST ---------- */
  if (stationId === 'wristband') {
    const p = scenario.patient;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className={tk.sub} style={{ padding: '14px 16px', borderRadius: '14px' }}>
          <div
            style={{
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: tk.section,
            }}
          >
            {ex.wristband.observation_title.toUpperCase()}
          </div>
          <div style={{ fontSize: '13px', marginTop: '6px', lineHeight: 1.55 }}>
            {p.presenting_status}.
          </div>
        </div>
        <div
          className={tk.sub}
          style={{
            padding: '14px 16px',
            borderRadius: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.06em',
                color: tk.section,
              }}
            >
              PATIENT ID WRISTBAND
            </span>
            <UserCheck size={15} color={tk.muted} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14.5px', fontWeight: 800 }}>
            <span>{p.name}</span>
            <span className="font-mono-clinical" style={{ fontSize: '12.5px', color: tk.muted }}>
              {p.mrn}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: tk.muted }}>DOB: {p.dob}</div>
          <div
            style={{
              marginTop: '2px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              alignSelf: 'flex-start',
              padding: '3px 10px',
              borderRadius: '999px',
              background: '#3a1f1b',
              color: '#f2a493',
              fontSize: '11.5px',
              fontWeight: 800,
            }}
          >
            {ex.wristband.allergy_band_text}
          </div>
        </div>
        {props.verifiedId ? (
          <Note tk={tk} icon={UserCheck}>
            {ex.wristband.verified_label}
          </Note>
        ) : (
          <OptionButton tk={tk} selected onClick={props.onVerifyId}>
            {ex.wristband.verify_label}
          </OptionButton>
        )}
      </div>
    );
  }

  /* ---------- 3. PATIENT CHART / EHR WORKSTATION ---------- */
  if (stationId === 'ehr_tablet') {
    const tab = props.activeEhrTab;
    const m = ex.mar_actions;
    const p = scenario.patient;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '3px 11px',
                borderRadius: '999px',
                background: '#3a1f1b',
                color: '#f2a493',
                fontSize: '11px',
                fontWeight: 800,
              }}
            >
              {props.allergyFlagged ? 'Allergy: Penicillin (Flagged)' : 'Allergies in chart'}
            </span>
            <span
              style={{
                padding: '3px 11px',
                borderRadius: '999px',
                background: darkMode ? '#1e3a2f' : '#dff0c0',
                color: darkMode ? '#bfe8d6' : '#1e4a38',
                fontSize: '11px',
                fontWeight: 800,
              }}
            >
              Full code
            </span>
            <span
              style={{
                padding: '3px 11px',
                borderRadius: '999px',
                background: darkMode ? '#1e3a2f' : '#f1f3ee',
                color: darkMode ? '#bfe8d6' : '#475045',
                fontSize: '11px',
                fontWeight: 800,
              }}
            >
              {p.age} {p.gender?.[0]} · Post-Laparotomy
            </span>
          </div>
          <span className="font-mono-clinical" style={{ fontSize: '11px', color: tk.muted }}>
            {p.mrn}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '3px',
            borderRadius: '999px',
            background: darkMode ? '#0a1310' : '#f1f3ee',
            border: darkMode ? '1px solid #1d2e27' : '1px solid #e7eae3',
          }}
        >
          {Object.keys(scenario.ehr_tabs).map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                onClick={() => props.onSelectEhrTab(k)}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: '999px',
                  background: active ? (darkMode ? '#1e3a2f' : '#1e4a38') : 'transparent',
                  color: active ? '#ffffff' : tk.muted,
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: k === 'mar' ? 'uppercase' : 'capitalize',
                  cursor: 'pointer',
                }}
              >
                {k}
              </button>
            );
          })}
        </div>

        <div
          style={{
            fontSize: '11.5px',
            fontWeight: 800,
            letterSpacing: '0.05em',
            color: tk.section,
            textTransform: 'uppercase',
          }}
        >
          {tab === 'mar' ? 'ACTIVE MEDICATION ORDERS' : `PATIENT ${tab.toUpperCase()}`}
        </div>

        <div
          className={tk.sub}
          style={{
            padding: '14px 16px',
            borderRadius: '14px',
            fontSize: '13px',
            lineHeight: 1.62,
            whiteSpace: 'pre-line',
            color: tk.text,
            userSelect: 'text',
          }}
        >
          {scenario.ehr_tabs[tab]}
        </div>

        {tab === 'mar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '11px',
                fontWeight: 800,
                color: tk.section,
              }}
            >
              <span>SCHEDULED & PRN ACTIONS</span>
              <span
                style={{
                  background: '#e8b04b',
                  color: '#0a1310',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '10.5px',
                  fontWeight: 800,
                }}
              >
                Due now
              </span>
            </div>
            {props.cefazolinStatus === 'GIVEN' ? (
              <Note tk={tk} icon={Pill}>
                {m.cefazolin.given_label}
              </Note>
            ) : props.cefazolinStatus === 'HELD' ? (
              <Note tk={tk} icon={AlertOctagon}>
                {m.cefazolin.hard_stop_label}
              </Note>
            ) : (
              <OptionButton tk={tk} onClick={props.onCefazolin}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Pill size={14} color="#e8b04b" /> {m.cefazolin.label}
                </span>
              </OptionButton>
            )}
            {props.naloxonePrepared ? (
              <Note tk={tk} icon={Syringe}>
                {m.naloxone.prepared_label}
              </Note>
            ) : (
              <OptionButton tk={tk} onClick={props.onPrepareNaloxone}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Syringe size={14} color="#6fd1a9" /> {m.naloxone.label}
                </span>
              </OptionButton>
            )}
          </div>
        )}

        {tab === 'allergies' &&
          (props.allergyFlagged ? (
            <Note tk={tk} icon={Flag}>
              {ex.allergy_flag.flagged_label}
            </Note>
          ) : (
            <OptionButton tk={tk} selected onClick={props.onFlagAllergy}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Flag size={14} color="#f2a493" /> {ex.allergy_flag.label}
              </span>
            </OptionButton>
          ))}

        <StationMicroQuestion
          tk={tk}
          darkMode={darkMode}
          question={stationQuestion}
          selectedOptionId={selectedStationAnswer}
          onSelect={props.onAnswerStationQuestion}
        />
      </div>
    );
  }

  /* ---------- 4. HOSPITAL BED ARTICULATION ---------- */
  if (stationId === 'hospital_bed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          style={{
            fontSize: '11.5px',
            fontWeight: 800,
            color: tk.section,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          HEAD-OF-BED ARTICULATION
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          {ex.bed_positions.map((pos) => (
            <OptionButton
              key={pos.angle}
              tk={tk}
              selected={props.bedAngle === pos.angle}
              onClick={() => props.onSetBed(pos)}
            >
              <div style={{ fontSize: '13.5px', fontWeight: 800 }}>{pos.title}</div>
              <div style={{ fontSize: '11px', color: tk.muted, marginTop: '2px' }}>{pos.sub}</div>
            </OptionButton>
          ))}
        </div>
      </div>
    );
  }

  /* ---------- 5. SURGICAL DRESSING, JP DRAIN & G-TUBE ---------- */
  if (stationId === 'surgical_site') {
    const ss = ex.surgical_site;
    if (!ss) return null;
    const mediaTabs = ss.media_tabs || [];
    const activeMedia = mediaTabs.find((m) => m.id === surgicalMediaTab) || mediaTabs[0];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Clinical Visual / Media Switcher (JP Drain & Dressing vs. Fig 31-2 Dehiscence/Evisceration) */}
        {mediaTabs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                gap: '4px',
                padding: '3px',
                borderRadius: '999px',
                background: darkMode ? '#0a1310' : '#f1f3ee',
                border: darkMode ? '1px solid #1d2e27' : '1px solid #e7eae3',
              }}
            >
              {mediaTabs.map((mt) => {
                const active = activeMedia?.id === mt.id;
                return (
                  <button
                    key={mt.id}
                    type="button"
                    onClick={() => setSurgicalMediaTab(mt.id)}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: '999px',
                      background: active ? (darkMode ? '#1e3a2f' : '#1e4a38') : 'transparent',
                      color: active ? '#ffffff' : tk.muted,
                      border: 'none',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {mt.label}
                  </button>
                );
              })}
            </div>

            {activeMedia && (
              <div
                style={{
                  borderRadius: '14px',
                  overflow: 'hidden',
                  border: `1px solid ${tk.border}`,
                  background: '#0a1310',
                }}
              >
                <img
                  src={activeMedia.image_url}
                  alt={activeMedia.label}
                  style={{
                    width: '100%',
                    maxHeight: '195px',
                    objectFit: 'contain',
                    display: 'block',
                    background: '#f8fafc',
                  }}
                />
                <div
                  style={{
                    padding: '9px 12px',
                    fontSize: '11.5px',
                    lineHeight: 1.45,
                    color: '#afc6bc',
                  }}
                >
                  {activeMedia.caption}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bedside Surgical Inspection Readout */}
        <div
          className={tk.sub}
          style={{
            padding: '12px 14px',
            borderRadius: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
            fontSize: '12.5px',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.06em', color: tk.section }}>
            {ss.dressing_title}
          </div>
          <div>
            <strong style={{ color: '#f2a493' }}>Incision Gauze: </strong>
            {ss.dressing_finding}
          </div>
          <div>
            <strong style={{ color: '#e8b04b' }}>JP Bulb Drain (RLQ): </strong>
            {ss.jp_finding}
          </div>
          <div>
            <strong style={{ color: '#bfe8d6' }}>G-Tube (LUQ): </strong>
            {ss.gtube_finding}
          </div>
        </div>

        {/* Nursing Actions at Surgical Site */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {ss.actions.map((act) => {
            const done =
              (act.event_code === 'ASSESS_JP_HEMORRHAGE' && props.jpAssessed) ||
              (act.event_code === 'VERIFY_GTUBE' && props.gtubeVerified) ||
              (act.event_code === 'REMOVE_PRIMARY_DRESSING_TRAP' && props.primaryDressingRemoved);
            return (
              <OptionButton
                key={act.id}
                tk={tk}
                selected={done}
                disabled={done}
                onClick={() => props.onSurgicalAction?.(act)}
              >
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  {done ? (
                    <CheckCircle2 size={14} color="#6fd1a9" style={{ marginTop: '2px', flexShrink: 0 }} />
                  ) : (
                    <Droplets size={14} color={tk.section} style={{ marginTop: '2px', flexShrink: 0 }} />
                  )}
                  <span>{act.label}</span>
                </span>
              </OptionButton>
            );
          })}
        </div>

        <StationMicroQuestion
          tk={tk}
          darkMode={darkMode}
          question={stationQuestion}
          selectedOptionId={selectedStationAnswer}
          onSelect={props.onAnswerStationQuestion}
        />
      </div>
    );
  }

  /* ---------- 6. WALL GAS OUTLET ---------- */
  if (stationId === 'wall_oxygen') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            fontSize: '11.5px',
            fontWeight: 800,
            color: tk.section,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          OXYGEN FLOWMETER · WALL OUTLET
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
          {ex.oxygen_devices.map((dev) => (
            <OptionButton
              key={dev.id}
              tk={tk}
              selected={props.o2Device === dev.id}
              onClick={() => props.onSetO2(dev.id)}
            >
              <div style={{ fontSize: '13px', fontWeight: 800 }}>{dev.title}</div>
              <div className="font-mono-clinical" style={{ fontSize: '11px', color: tk.muted, marginTop: '3px' }}>
                {dev.flow}
              </div>
            </OptionButton>
          ))}
          <OptionButton tk={tk} selected={!props.o2Device} onClick={() => props.onSetO2(null)}>
            <div style={{ fontSize: '13px', fontWeight: 800 }}>Room air (Off)</div>
            <div style={{ fontSize: '11px', color: tk.muted, marginTop: '3px' }}>Flowmeter closed</div>
          </OptionButton>
        </div>
      </div>
    );
  }

  /* ---------- 7. IV INFUSION PUMP ---------- */
  if (stationId === 'iv_pump') {
    const pump = ex.iv_pump;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div
          className="font-mono-clinical"
          style={{
            borderRadius: '14px',
            background: '#0a1310',
            padding: '13px 15px',
            color: '#ddebe4',
            border: '1px solid #2a4136',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600 }}>
            <span style={{ color: '#6fd1a9' }}>{pump.channel_label}</span>
            <span style={{ color: props.pcaPaused ? '#e8b04b' : '#6fd1a9' }}>
              {props.pcaPaused ? '■ PAUSED' : '▶ INFUSING'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '10px' }}>
            {pump.display_rows.map((r) => (
              <div key={r.label}>
                <div style={{ fontSize: '9.5px', color: '#8ca69b' }}>{r.label.toUpperCase()}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#bfe8d6', marginTop: '2px' }}>
                  {r.value}
                </div>
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

        {/* Dedicated Secondary Crystalloid Line for Post-Op Hypotension / Hemorrhage */}
        {pump.crystalloid_bolus && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.05em',
                color: tk.section,
              }}
            >
              {pump.secondary_channel_label || 'SECONDARY LINE · HEMODYNAMIC SUPPORT'}
            </div>
            {props.crystalloidBolus ? (
              <Note tk={tk} icon={Droplets}>
                {pump.crystalloid_bolus.active_label}
              </Note>
            ) : (
              <OptionButton tk={tk} onClick={props.onCrystalloidBolus}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Droplets size={14} color="#6fd1a9" /> {pump.crystalloid_bolus.label}
                </span>
              </OptionButton>
            )}
          </div>
        )}

        {props.naloxonePrepared && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.05em',
                color: tk.section,
              }}
            >
              PREPARED MEDICATION (Y-SITE)
            </div>
            <OptionButton tk={tk} selected onClick={props.onAdministerNaloxone}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Syringe size={14} color="#6fd1a9" /> {ex.naloxone.administer_label}
              </span>
            </OptionButton>
          </div>
        )}
      </div>
    );
  }

  return null;
}
