'use client';

/**
 * Study AI — NCLEX-RN Next-Generation (NGN) Exam Readiness Assessment
 *
 * Strict, timed, no-spoiler bedside assessment:
 *   PRE_BRIEFING  -> case briefing gate, frozen + blurred room, nothing runs
 *   BEDSIDE       -> 05:00 countdown; the simulation never acts for the candidate
 *   EXIT_QUESTIONS-> room frozen, HUD hidden, SBAR + ABG questions (all required)
 *   FINAL_REPORT  -> telemetry POSTed to FastAPI /api/evaluate, locked performance report
 *
 * All clinical content, trap definitions, physiology and scoring keys live in
 * config/scenario_hypoxia.json (exam_config) per GEMINI.md.
 */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity,
  Wind,
  ShieldCheck,
  FileText,
  Sliders,
  Syringe,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Camera,
  Footprints,
  Clock,
  LogOut,
  Gauge,
} from 'lucide-react';
import scenarioData from '../config/scenario_hypoxia.json';
import { sendTelemetry } from '../utils/telemetryEmitter';
import { useLiveVitalsDriver } from '../lib/liveVitals';
import { clinicalAudio } from '../utils/clinicalAudio';
import {
  EXAM_STAGES,
  computeVitals,
  isStabilized,
  isNaloxoneIndicated,
  formatClock,
} from '../lib/examEngine';
import DraggableGlassPanel from '../components/DraggableGlassPanel';
import BriefingModal, { ExamOverlay, examTokens } from '../components/exam/BriefingModal';
import ExitQuestionsModal from '../components/exam/ExitQuestionsModal';
import PerformanceReport from '../components/exam/PerformanceReport';
import StationPanelBody from '../components/exam/StationPanels';
import { QUALITY_MODES, QUALITY_TIERS, nativePercent } from '../components/AdaptiveQuality';
import useViewport from '../lib/useViewport';

const Room3D = dynamic(() => import('../components/Room3D'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#09101d',
        color: '#38bdf8',
        fontSize: '14px',
        fontWeight: 700,
      }}
    >
      Preparing exam room...
    </div>
  ),
});

const EX = scenarioData.exam_config;
const OBJECT_ICONS = {
  bedside_monitor: Activity,
  wristband: ShieldCheck,
  ehr_tablet: FileText,
  hospital_bed: Sliders,
  wall_oxygen: Wind,
  iv_pump: Syringe,
};
const SCORED_CLASSES = ['TRAP', 'CRITICAL_ERROR', 'PENALTY'];

const initialClinicalState = () => ({
  monitorConnected: false,
  vitalsDocumented: false,
  verifiedId: false,
  ehrTabsViewed: [],
  activeEhrTab: 'notes',
  allergyFlagged: false,
  cefazolinStatus: null, // null | 'GIVEN' | 'HELD'
  naloxonePrepared: false,
  naloxoneDoses: 0,
  bedAngle: 0,
  o2Device: null,
  pcaPaused: false,
  basalConfirmed: false,
  opioidLevel: 'baseline',
  untreatedDeterioration: false,
});

const EMPTY_SUBMISSION = { status: 'idle', payload: null, result: null, error: null };

export default function StudyAiExamPage() {
  const { width: vw, isPhone, isTablet, isTouch, isLandscape } = useViewport();
  const [examStage, setExamStage] = useState(EXAM_STAGES.PRE_BRIEFING);
  const [darkMode, setDarkMode] = useState(true);
  const [audioMuted, setAudioMuted] = useState(true);
  const [cameraMode, setCameraMode] = useState('third_person');
  // Render quality (DPR) mode, remembered between sessions; stats come back from the 3D canvas
  const [quality, setQuality] = useState('auto');
  const [qualityStats, setQualityStats] = useState({ fps: 0, dpr: 1 });
  useEffect(() => {
    const saved = window.localStorage.getItem('studyai.quality');
    if (saved && QUALITY_MODES.includes(saved)) setQuality(saved);
  }, []);
  const cycleQuality = useCallback(() => {
    setQuality((q) => {
      const next = QUALITY_MODES[(QUALITY_MODES.indexOf(q) + 1) % QUALITY_MODES.length];
      window.localStorage.setItem('studyai.quality', next);
      return next;
    });
  }, []);
  const [cameraFocusId, setCameraFocusId] = useState('overview');
  const [cameraTrigger, setCameraTrigger] = useState(0);
  const [introTrigger, setIntroTrigger] = useState(0);
  const [activeDrawerId, setActiveDrawerId] = useState(null);
  const [drawerMinimized, setDrawerMinimized] = useState(false);
  const [inspectedStations, setInspectedStations] = useState([]);
  const [clin, setClin] = useState(initialClinicalState);
  const [examElapsed, setExamElapsed] = useState(0);
  const [actionTimeline, setActionTimeline] = useState([]);
  const [showConcludeConfirm, setShowConcludeConfirm] = useState(false);
  const [endInfo, setEndInfo] = useState(null);
  const [exitAnswers, setExitAnswers] = useState({});
  const [submission, setSubmission] = useState(EMPTY_SUBMISSION);

  const examStartRef = useRef(null);
  const endedRef = useRef(false);
  const pendingStationRef = useRef(null);
  const inspectedRef = useRef([]);
  const maskingStartRef = useRef(null);
  const renarcStartRef = useRef(null);
  const criticalStartRef = useRef(null);

  const isBedside = examStage === EXAM_STAGES.BEDSIDE;
  const frozen = !isBedside;

  // Deterministic physiology: vitals are derived from the room state, never mutated by timers
  const vitals = useMemo(() => computeVitals(clin, scenarioData), [clin]);
  useLiveVitalsDriver(vitals);
  const vitalsRef = useRef(vitals);
  vitalsRef.current = vitals;
  const clinRef = useRef(clin);
  clinRef.current = clin;

  const patch = useCallback(
    (p) =>
      setClin((prev) => ({ ...prev, ...(typeof p === 'function' ? p(prev) : p) })),
    []
  );

  /* ---------------- Telemetry ---------------- */
  const recordEvent = useCallback((code, objectId = null, detail = '', extra = {}) => {
    const cat = EX.event_catalog[code] || {};
    const v = vitalsRef.current;
    const objMeta = scenarioData.interactive_objects.find((o) => o.id === objectId);
    const entry = {
      timestamp_sec: Number(
        (examStartRef.current
          ? Math.min(EX.duration_sec, (Date.now() - examStartRef.current) / 1000)
          : 0
        ).toFixed(1)
      ),
      action: code,
      label: cat.label || code,
      classification: cat.classification || 'NEUTRAL',
      severity: cat.severity || null,
      rationale: cat.rationale || null,
      object_id: objectId,
      station_label: objectId ? EX.station_labels[objectId] : null,
      diagnostic_domain: objMeta?.diagnostic_domain || null,
      ncjmm_phase: objMeta?.ncjmm_phase || null,
      detail,
      monitor_on: clinRef.current.monitorConnected,
      vitals_snapshot: { spo2: v.spo2, hr: v.hr, rr: v.rr, etco2: v.etco2 },
      ...extra,
    };
    setActionTimeline((prev) => [...prev, { step: prev.length + 1, ...entry }]);
  }, []);

  /** Logs a BLIND_INTERVENTION_PENALTY if admission safety checks are incomplete. */
  const checkBlind = (interventionLabel, objectId) => {
    const c = clinRef.current;
    const status = {
      monitor_powered_on: c.monitorConnected,
      wristband_verified: c.verifiedId,
      mar_reviewed: c.ehrTabsViewed.includes('mar'),
      allergies_reviewed: c.ehrTabsViewed.includes('allergies'),
    };
    const missing = EX.admission_prerequisites.filter((p) => !status[p.key]);
    if (missing.length) {
      recordEvent(
        'BLIND_INTERVENTION_PENALTY',
        objectId,
        `${interventionLabel} — before: ${missing.map((m) => m.label).join(', ')}`,
        { missing_prerequisites: missing.map((m) => m.key) }
      );
    }
  };

  /* ---------------- End of bedside phase ---------------- */
  const endBedside = useCallback(
    (reason) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const timeUsed = Number(
        Math.min(EX.duration_sec, (Date.now() - examStartRef.current) / 1000).toFixed(1)
      );
      const v = vitalsRef.current;
      const c = clinRef.current;
      recordEvent('BEDSIDE_PHASE_END', null, EX.end_reasons[reason] || reason, {
        end_reason: reason,
      });
      setEndInfo({
        reason,
        timeUsedSec: timeUsed,
        vitals: v,
        stabilized: isStabilized(v, c, scenarioData),
        clin: c,
      });
      setActiveDrawerId(null);
      pendingStationRef.current = null;
      setShowConcludeConfirm(false);
      setExamStage(EXAM_STAGES.EXIT_QUESTIONS);
      clinicalAudio.setMonitorPowered(false);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    },
    [recordEvent]
  );

  /* ---------------- Exam clock (UI only — never acts for the candidate) ---------------- */
  useEffect(() => {
    if (!isBedside) return undefined;
    const id = setInterval(() => {
      setExamElapsed((Date.now() - examStartRef.current) / 1000);
    }, 250);
    return () => clearInterval(id);
  }, [isBedside]);

  /* ---------------- Time-dependent physiology & automatic end triggers ---------------- */
  useEffect(() => {
    if (!isBedside || endedRef.current) return;
    const t = examElapsed;
    const bc = scenarioData.clinical_branching;

    // Branch C: untreated hypoxia deteriorates (no O2, bed flat or head-down)
    if (
      !clin.untreatedDeterioration &&
      t >= bc.branch_c_untreated_deterioration.trigger_delay_sec &&
      !clin.o2Device &&
      clin.bedAngle <= 0 &&
      clin.opioidLevel === 'baseline' &&
      !clin.pcaPaused
    ) {
      patch({ untreatedDeterioration: true });
      recordEvent('UNTREATED_HYPOXIA_DETERIORATION');
    }

    // Branch B: O2 (or a confirmed basal rate) with morphine still infusing -> bradypnea crash
    const masking =
      clin.opioidLevel === 'baseline' &&
      !clin.pcaPaused &&
      (Boolean(clin.o2Device) || clin.basalConfirmed);
    if (masking) {
      if (maskingStartRef.current === null) maskingStartRef.current = t;
      else if (t - maskingStartRef.current >= bc.branch_b_opioid_trap.trigger_delay_sec) {
        maskingStartRef.current = null;
        patch({ opioidLevel: 'crash' });
        recordEvent('OPIOID_MASKING_BRADYPNEA');
      }
    } else {
      maskingStartRef.current = null;
    }

    // Re-sedation: naloxone wears off while the PCA is still infusing
    if (clin.opioidLevel === 'reversed' && !clin.pcaPaused) {
      if (renarcStartRef.current === null) renarcStartRef.current = t;
      else if (t - renarcStartRef.current >= EX.naloxone.renarcotization_sec) {
        renarcStartRef.current = null;
        patch({ opioidLevel: 'crash' });
        recordEvent('RENARCOTIZATION');
      }
    } else {
      renarcStartRef.current = null;
    }

    // CODE_BLUE_FAILURE: SpO2 below threshold for longer than the allowed window
    if (vitals.spo2 < EX.code_blue.spo2_threshold) {
      if (criticalStartRef.current === null) {
        criticalStartRef.current = t;
        recordEvent('CRITICAL_HYPOXIA_ONSET');
      } else if (t - criticalStartRef.current > EX.code_blue.sustained_sec) {
        endBedside('CODE_BLUE_FAILURE');
        return;
      }
    } else {
      criticalStartRef.current = null;
    }

    if (t >= EX.duration_sec) endBedside('TIME_EXPIRED');
  }, [examElapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- Audio: pulse tone & alarms only while the monitor is on ---------------- */
  useEffect(() => {
    clinicalAudio.updateVitals(vitals);
  }, [vitals]);
  useEffect(() => {
    clinicalAudio.setMonitorPowered(isBedside && clin.monitorConnected);
  }, [isBedside, clin.monitorConnected]);
  useEffect(() => () => clinicalAudio.stopLoops(), []);

  /* ---------------- Esc closes the station panel / confirm dialog ---------------- */
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || examStage !== EXAM_STAGES.BEDSIDE) return;
      if (showConcludeConfirm) {
        setShowConcludeConfirm(false);
      } else {
        setActiveDrawerId(null);
        pendingStationRef.current = null;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [examStage, showConcludeConfirm]);

  /* ---------------- Stage transitions ---------------- */
  const handleBegin = () => {
    examStartRef.current = Date.now();
    endedRef.current = false;
    maskingStartRef.current = null;
    renarcStartRef.current = null;
    criticalStartRef.current = null;
    setExamElapsed(0);
    setExamStage(EXAM_STAGES.BEDSIDE);
    setIntroTrigger((t) => t + 1);
    setCameraFocusId('overview');
    setCameraTrigger((t) => t + 1);
    recordEvent('BEGIN_TIMED_ASSESSMENT', null, `Time limit ${formatClock(EX.duration_sec)}`);
  };

  const buildPayload = () => {
    const c = endInfo.clin;
    return {
      session_id: 'ngn_' + Math.random().toString(36).slice(2, 10),
      scenario_id: scenarioData.scenario_id,
      student_id: 'stu_4410',
      exam_mode: EX.mode,
      research_scenario_mapping: [
        'SCENARIO_1_POSTOP_DETERIORATION',
        'SCENARIO_2_MED_ADVERSE_REACTION',
        'SCENARIO_5_IMPAIRED_OXYGENATION',
      ],
      time_limit_sec: EX.duration_sec,
      total_scenario_time_sec: endInfo.timeUsedSec,
      end_reason: endInfo.reason,
      stabilized_at_end: endInfo.stabilized,
      safety_checks: {
        monitor_powered_on: c.monitorConnected,
        vitals_documented: c.vitalsDocumented,
        wristband_verified: c.verifiedId,
        mar_reviewed: c.ehrTabsViewed.includes('mar'),
        allergies_reviewed: c.ehrTabsViewed.includes('allergies'),
        notes_reviewed: c.ehrTabsViewed.includes('notes'),
        labs_reviewed: c.ehrTabsViewed.includes('labs'),
        allergy_flagged: c.allergyFlagged,
        cefazolin_status: c.cefazolinStatus,
        naloxone_doses: c.naloxoneDoses,
        paused_morphine_pca_infusion: c.pcaPaused,
      },
      action_timeline: actionTimeline,
      traps_triggered: actionTimeline.filter((e) => SCORED_CLASSES.includes(e.classification)),
      exit_question_responses: EX.exit_questions.map((q) => ({
        question_id: q.question_id,
        selected_option_id: exitAnswers[q.question_id] || null,
      })),
      final_room_state: {
        bed_angle_deg: c.bedAngle,
        o2_device: c.o2Device,
        pca_paused: c.pcaPaused,
        opioid_state: c.opioidLevel,
        monitor_powered_on: c.monitorConnected,
        stations_inspected: inspectedRef.current,
        vitals: endInfo.vitals,
      },
    };
  };

  const submitAttempt = async (payload) => {
    setSubmission({ status: 'submitting', payload, result: null, error: null });
    const res = await sendTelemetry(payload);
    if (res.ok && res.data?.diagnostic_breakdown) {
      setSubmission({ status: 'done', payload, result: res.data, error: null });
    } else {
      setSubmission({
        status: 'error',
        payload,
        result: null,
        error: res.error || 'Unexpected response from the evaluation engine',
      });
    }
  };

  const handleSubmitExit = () => {
    const payload = buildPayload();
    setExamStage(EXAM_STAGES.FINAL_REPORT);
    submitAttempt(payload);
  };

  const handleNewAttempt = () => {
    examStartRef.current = null;
    endedRef.current = false;
    pendingStationRef.current = null;
    inspectedRef.current = [];
    maskingStartRef.current = null;
    renarcStartRef.current = null;
    criticalStartRef.current = null;
    setClin(initialClinicalState());
    setActionTimeline([]);
    setInspectedStations([]);
    setExamElapsed(0);
    setEndInfo(null);
    setExitAnswers({});
    setSubmission(EMPTY_SUBMISSION);
    setActiveDrawerId(null);
    setShowConcludeConfirm(false);
    setCameraFocusId('overview');
    setCameraTrigger((t) => t + 1);
    setExamStage(EXAM_STAGES.PRE_BRIEFING);
  };

  /* ---------------- Station navigation (walk first, then inspect) ---------------- */
  const handleSelectStation = (id) => {
    if (!isBedside) return;
    pendingStationRef.current = id;
    if (activeDrawerId !== id) setActiveDrawerId(null);
    setCameraFocusId(id);
    setCameraTrigger((t) => t + 1);
  };

  const viewEhrTab = (tab) => {
    patch({ activeEhrTab: tab });
    if (!clinRef.current.ehrTabsViewed.includes(tab)) {
      patch((prev) => ({ ehrTabsViewed: [...prev.ehrTabsViewed, tab] }));
      recordEvent('REVIEW_EHR_TAB', 'ehr_tablet', `Reviewed EHR ${tab.toUpperCase()} tab`, { tab });
    }
  };

  const handleNurseArrive = (id) => {
    if (examStage !== EXAM_STAGES.BEDSIDE || pendingStationRef.current !== id) return;
    pendingStationRef.current = null;
    setActiveDrawerId(id);
    setDrawerMinimized(false);
    if (!inspectedRef.current.includes(id)) {
      inspectedRef.current = [...inspectedRef.current, id];
      setInspectedStations(inspectedRef.current);
      recordEvent('INSPECT_STATION', id, `Inspected ${EX.station_labels[id]}`);
    }
    if (id === 'ehr_tablet') viewEhrTab(clinRef.current.activeEhrTab);
  };

  const handleNurseDepart = () => {
    setActiveDrawerId(null);
    pendingStationRef.current = null;
  };

  const handleDoorwayView = () => {
    setActiveDrawerId(null);
    pendingStationRef.current = null;
    setCameraFocusId('overview');
    setCameraTrigger((t) => t + 1);
  };

  /* ---------------- Station actions ---------------- */
  const handlePowerOn = () => {
    if (clin.monitorConnected) return;
    patch({ monitorConnected: true });
    recordEvent(
      'POWER_ON_MONITOR',
      'bedside_monitor',
      `Monitor on — SpO2 ${vitals.spo2}%, HR ${vitals.hr}, RR ${vitals.rr}, BP ${vitals.bp}`
    );
  };

  const handleDocumentVitals = () => {
    patch({ vitalsDocumented: true });
    recordEvent(
      'DOCUMENT_VITALS',
      'bedside_monitor',
      `SpO2 ${vitals.spo2}% • HR ${vitals.hr} • RR ${vitals.rr} • BP ${vitals.bp} • EtCO2 ${vitals.etco2}`
    );
  };

  const handleVerifyId = () => {
    if (clin.verifiedId) return;
    const p = scenarioData.patient;
    patch({ verifiedId: true });
    recordEvent('VERIFY_PATIENT_ID', 'wristband', `${p.name} • DOB ${p.dob} • ${p.mrn}`);
  };

  const handleFlagAllergy = () => {
    if (clin.allergyFlagged) return;
    patch({ allergyFlagged: true });
    recordEvent('FLAG_ALLERGY', 'ehr_tablet', scenarioData.ehr_tabs.allergies);
  };

  const handleCefazolin = () => {
    if (clin.cefazolinStatus) return;
    checkBlind(EX.mar_actions.cefazolin.label, 'ehr_tablet');
    if (clin.allergyFlagged) {
      patch({ cefazolinStatus: 'HELD' });
      recordEvent('CEFAZOLIN_HELD_ALLERGY', 'ehr_tablet', 'Cefazolin 1 g IV — hard stop (allergy flagged)');
    } else {
      patch({ cefazolinStatus: 'GIVEN' });
      recordEvent(
        'ALLERGY_CROSS_SENSITIVITY_ERROR',
        'ehr_tablet',
        'Cefazolin 1 g IV administered — penicillin anaphylaxis not flagged'
      );
    }
  };

  const handlePrepareNaloxone = () => {
    if (clin.naloxonePrepared) return;
    checkBlind(EX.mar_actions.naloxone.label, 'ehr_tablet');
    patch({ naloxonePrepared: true });
    recordEvent('PREPARE_NALOXONE', 'ehr_tablet', 'Naloxone 0.4 mg drawn up for IV push');
  };

  const handleAdministerNaloxone = () => {
    if (!clin.naloxonePrepared) return;
    checkBlind(EX.naloxone.administer_label, 'iv_pump');
    const indicated = isNaloxoneIndicated(vitals, scenarioData);
    renarcStartRef.current = null;
    patch((prev) => ({
      naloxonePrepared: false,
      naloxoneDoses: prev.naloxoneDoses + 1,
      opioidLevel: 'reversed',
    }));
    recordEvent(
      indicated ? 'ADMINISTER_NALOXONE' : 'NALOXONE_NOT_INDICATED',
      'iv_pump',
      `Naloxone 0.4 mg IV push (SpO2 ${vitals.spo2}%, RR ${vitals.rr})`
    );
  };

  const handlePcaOption = (opt) => {
    checkBlind(opt.label, 'iv_pump');
    if (opt.effect === 'ACUTE_OPIOID_TOXICITY') {
      patch({ opioidLevel: 'toxic_bolus' });
    } else if (opt.effect === 'CONTINUE_INFUSION') {
      patch({ pcaPaused: false, basalConfirmed: true });
    } else if (opt.effect === 'PAUSE_INFUSION') {
      patch({ pcaPaused: true });
    } else if (opt.effect === 'RESIDUAL_LINE_FLUSH') {
      patch((prev) => ({
        opioidLevel: prev.opioidLevel === 'toxic_bolus' ? 'toxic_bolus' : 'toxic_flush',
      }));
    }
    recordEvent(opt.event_code, 'iv_pump', opt.label);
  };

  const handleSetBed = (pos) => {
    if (pos.angle === clin.bedAngle) return;
    clinicalAudio.playBedServoHum(clin.bedAngle, pos.angle);
    patch({ bedAngle: pos.angle });
    recordEvent(pos.event_code, 'hospital_bed', `${pos.title} (${pos.angle}°)`, {
      bed_angle_deg: pos.angle,
    });
  };

  const handleSetO2 = (deviceId) => {
    if (deviceId === clin.o2Device) return;
    if (deviceId) checkBlind(`Supplemental O2 — ${deviceId}`, 'wall_oxygen');
    patch({ o2Device: deviceId });
    recordEvent(
      deviceId ? 'ADMINISTER_O2' : 'STOP_O2',
      'wall_oxygen',
      deviceId ? `O2 via ${deviceId}` : 'Flowmeter closed'
    );
  };

  const handleToggleAudio = () => setAudioMuted(clinicalAudio.toggleMute());

  /* ---------------- Render ---------------- */
  const tk = examTokens(darkMode);
  const glassClass = darkMode ? 'liquid-glass-dark' : 'liquid-glass-light';
  const remainingSec = Math.max(0, EX.duration_sec - examElapsed);
  const clockColor = remainingSec <= 30 ? '#ef4444' : remainingSec <= 60 ? '#f59e0b' : tk.text;
  // Constant label: switching chapters on monitor power-on would cue the candidate that something changed
  const phaseLabel = EX.bedside_phase_label;
  const pillBase = {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: isPhone ? '5px 9px' : '5px 11px',
    minHeight: isTouch ? '34px' : undefined,
    borderRadius: '999px',
    border: `1px solid ${tk.border}`,
    background: darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.75)',
    color: tk.text,
    fontSize: isPhone ? '10.5px' : '11px',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100dvh',
        background: darkMode ? '#09101d' : '#e9eef4',
        color: tk.text,
        overflow: 'hidden',
      }}
    >
      {/* 3D ROOM — frozen + blurred outside the timed bedside phase */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          filter: frozen ? 'blur(8px) saturate(0.8) brightness(0.72)' : 'none',
          transition: 'filter 0.6s ease',
          pointerEvents: frozen ? 'none' : 'auto',
        }}
      >
        <Room3D
          scenarioData={scenarioData}
          vitals={vitals}
          monitorConnected={clin.monitorConnected}
          bedAngle={clin.bedAngle}
          o2Device={clin.o2Device}
          pcaPaused={clin.pcaPaused}
          verifiedId={clin.verifiedId}
          completedObjects={inspectedStations}
          selectedObjectId={activeDrawerId}
          onSelectObject={handleSelectStation}
          darkMode={darkMode}
          cameraFocusId={cameraFocusId}
          cameraTrigger={cameraTrigger}
          cameraMode={cameraMode}
          introTrigger={introTrigger}
          frozen={frozen}
          inspectedStations={inspectedStations}
          stationLabels={EX.station_labels}
          onNurseArrive={handleNurseArrive}
          onNurseDepart={handleNurseDepart}
          quality={quality}
          onQualityStats={setQualityStats}
        />
      </div>

      {isBedside && (
        <>
          {/* TOP STATUS BAR */}
          <header
            className={glassClass}
            style={{
              position: 'fixed',
              top: 'max(8px, env(safe-area-inset-top, 8px))',
              left: isPhone ? '8px' : '16px',
              right: isPhone ? '8px' : '16px',
              zIndex: 40,
              display: 'flex',
              flexDirection: isPhone && !isLandscape ? 'column' : 'row',
              alignItems: isPhone && !isLandscape ? 'stretch' : 'center',
              justifyContent: 'space-between',
              padding: isPhone ? '6px 10px' : '7px 14px',
              borderRadius: isPhone ? '18px' : '999px',
              gap: isPhone ? '6px' : '10px',
              flexWrap: isPhone ? 'nowrap' : 'wrap',
            }}
          >
            {/* Row 1 on phone portrait (or left+right on desktop/tablet) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px',
                width: isPhone && !isLandscape ? '100%' : 'auto',
                flex: isPhone && !isLandscape ? undefined : '1 1 auto',
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                {!isPhone && !isTablet && (
                  <span
                    style={{
                      padding: '5px 12px',
                      borderRadius: '999px',
                      background: 'linear-gradient(135deg, #1e3a8a, #1d4ed8)',
                      border: '1px solid rgba(255,255,255,0.3)',
                      color: '#ffffff',
                      fontSize: '10.5px',
                      fontWeight: 900,
                      letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {phaseLabel}
                  </span>
                )}
                <span style={{ ...pillBase, cursor: 'default', minWidth: 0 }}>
                  <strong>{scenarioData.patient.name}</strong>
                  <span style={{ color: tk.muted }}>
                    {scenarioData.patient.age}
                    {scenarioData.patient.gender?.[0]}
                    {!isPhone ? ` • ${scenarioData.patient.mrn}` : ''}
                  </span>
                </span>
              </div>

              {/* Vitals strip inline on desktop/tablet/landscape */}
              {(!isPhone || isLandscape) && (
                <div
                  className="no-scrollbar"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    overflowX: 'auto',
                    minWidth: 0,
                  }}
                >
                  {clin.monitorConnected ? (
                    [
                      ['SpO₂', `${vitals.spo2}%`],
                      ['HR', `${vitals.hr}`],
                      ['RR', `${vitals.rr}`],
                      ['BP', vitals.bp],
                      ['EtCO₂', `${vitals.etco2}`],
                    ].map(([label, value]) => (
                      <span key={label} style={{ ...pillBase, cursor: 'default' }}>
                        <span style={{ color: tk.muted, fontSize: '10px' }}>{label}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{value}</span>
                      </span>
                    ))
                  ) : (
                    <span style={{ ...pillBase, cursor: 'default', color: tk.muted }}>
                      <Activity size={12} /> {isPhone ? 'Monitor OFF' : 'Monitor: OFF / STANDBY'}
                    </span>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? '4px' : '6px', flexShrink: 0 }}>
                <span
                  style={{
                    ...pillBase,
                    cursor: 'default',
                    fontFamily: 'monospace',
                    fontSize: isPhone ? '13px' : '15px',
                    fontWeight: 900,
                    color: clockColor,
                    padding: isPhone ? '4px 8px' : '4px 12px',
                  }}
                  title="Time remaining"
                >
                  <Clock size={12} /> {formatClock(remainingSec)}
                </span>
                <button
                  style={pillBase}
                  onClick={() =>
                    setCameraMode((m) => (m === 'third_person' ? 'free_orbit' : 'third_person'))
                  }
                  title={cameraMode === 'third_person' ? '3rd-Person Camera' : 'Free Orbit Camera'}
                >
                  <Camera size={12} />
                  {!isPhone && (cameraMode === 'third_person' ? '3rd-Person' : 'Free Orbit')}
                </button>
                <button
                  style={pillBase}
                  onClick={(e) => {
                    cycleQuality();
                    // Don't keep focus: a later Space/Enter press would silently change quality again
                    e.currentTarget.blur();
                  }}
                  title={`Render quality: ${QUALITY_TIERS[quality].label} — ${QUALITY_TIERS[quality].hint}\n${qualityStats.fps} FPS at ${nativePercent(qualityStats.dpr)}% of native resolution. Click to cycle Auto → High → Balanced → Performance.`}
                >
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background:
                        qualityStats.fps >= 45 ? '#10b981' : qualityStats.fps >= 25 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                  <Gauge size={12} />
                  {!isPhone && QUALITY_TIERS[quality].label}
                  <span style={{ color: tk.muted, fontFamily: 'monospace', fontWeight: 600 }}>
                    {isPhone
                      ? `${qualityStats.fps}fps`
                      : `${nativePercent(qualityStats.dpr)}% · ${qualityStats.fps}fps`}
                  </span>
                </button>
                <button style={pillBase} onClick={handleToggleAudio} title="Monitor audio">
                  {audioMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                <button style={pillBase} onClick={() => setDarkMode((d) => !d)} title="Theme">
                  {darkMode ? <Sun size={12} /> : <Moon size={12} />}
                </button>
                <button
                  onClick={() => setShowConcludeConfirm(true)}
                  style={{
                    ...pillBase,
                    padding: isPhone ? '5px 10px' : '6px 14px',
                    background: 'linear-gradient(135deg, #0066ff, #2563eb)',
                    border: '1px solid rgba(255,255,255,0.45)',
                    color: '#ffffff',
                    fontWeight: 900,
                    boxShadow: '0 6px 18px rgba(0, 102, 255, 0.4)',
                  }}
                >
                  <LogOut size={12} />{' '}
                  {isPhone || isTablet
                    ? EX.conclude_button_short_label || 'Escalate (SBAR)'
                    : EX.conclude_button_label}
                </button>
              </div>
            </div>

            {/* Row 2 on phone portrait: horizontally scrollable vitals strip */}
            {isPhone && !isLandscape && (
              <div
                className="no-scrollbar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  overflowX: 'auto',
                  width: '100%',
                  paddingTop: '2px',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {clin.monitorConnected ? (
                  [
                    ['SpO₂', `${vitals.spo2}%`],
                    ['HR', `${vitals.hr}`],
                    ['RR', `${vitals.rr}`],
                    ['BP', vitals.bp],
                    ['EtCO₂', `${vitals.etco2}`],
                  ].map(([label, value]) => (
                    <span
                      key={label}
                      style={{
                        ...pillBase,
                        cursor: 'default',
                        padding: '3px 9px',
                        minHeight: '26px',
                      }}
                    >
                      <span style={{ color: tk.muted, fontSize: '9.5px' }}>{label}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '11.5px' }}>{value}</span>
                    </span>
                  ))
                ) : (
                  <span
                    style={{
                      ...pillBase,
                      cursor: 'default',
                      color: tk.muted,
                      padding: '3px 10px',
                      minHeight: '26px',
                      fontSize: '10px',
                    }}
                  >
                    <Activity size={11} /> Monitor: OFF / STANDBY — Walk to Bedside Monitor to power on
                  </span>
                )}
              </div>
            )}
          </header>

          {/* BOTTOM STATION BAR (single-row swipeable rail on phone/tablet; neutral labels) */}
          <div
            className={`${glassClass} no-scrollbar`}
            style={{
              position: 'fixed',
              bottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
              left: isPhone ? '8px' : '50%',
              right: isPhone ? '8px' : 'auto',
              transform: isPhone ? 'none' : 'translateX(-50%)',
              zIndex: 38,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: isPhone ? '6px 10px' : '7px 14px',
              borderRadius: '999px',
              maxWidth: isPhone ? 'none' : 'calc(100vw - 24px)',
              flexWrap: isPhone || isTablet ? 'nowrap' : 'wrap',
              overflowX: isPhone || isTablet ? 'auto' : 'visible',
              justifyContent: isPhone || isTablet ? 'flex-start' : 'center',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '10.5px',
                fontWeight: 800,
                color: tk.accent,
                paddingRight: '6px',
                borderRight: `1px solid ${tk.border}`,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <Footprints size={13} /> {isPhone ? 'Walk:' : 'Walk to:'}
            </span>
            {/* Doorway first, then stations in physical room layout (NOT the clinical priority order) */}
            <button style={{ ...pillBase, color: tk.muted }} onClick={handleDoorwayView}>
              Doorway View
            </button>
            {EX.walk_bar_order.map((id) => {
              const active = activeDrawerId === id;
              const visited = inspectedStations.includes(id);
              return (
                <button
                  key={id}
                  onClick={(e) => {
                    // Drop focus so a later Space/Enter press can't re-trigger the walk
                    e.currentTarget.blur();
                    handleSelectStation(id);
                  }}
                  style={{
                    ...pillBase,
                    background: active
                      ? 'linear-gradient(135deg, #0066ff, #2563eb)'
                      : pillBase.background,
                    color: active ? '#ffffff' : tk.text,
                    opacity: visited && !active ? 0.8 : 1,
                  }}
                >
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: active ? '#ffffff' : visited ? '#475569' : '#0066ff',
                    }}
                  />
                  {EX.station_labels[id]}
                </button>
              );
            })}
          </div>

          {/* STATION PANEL (opens only after the nurse arrives) */}
          {activeDrawerId && (
            <DraggableGlassPanel
              id="drawer"
              title={EX.station_labels[activeDrawerId]}
              subtitle={
                isTouch
                  ? 'Inspecting station • Tap [v] to peek at room'
                  : 'Inspecting station • Press [Esc] to close'
              }
              icon={OBJECT_ICONS[activeDrawerId] || Activity}
              badgeColor="#1d4ed8"
              initialPos={{
                x: Math.max(16, vw - 470 - 20),
                y: 76,
              }}
              width={470}
              minimized={drawerMinimized}
              onToggleMinimize={() => setDrawerMinimized((m) => !m)}
              onClose={() => {
                setActiveDrawerId(null);
                pendingStationRef.current = null;
              }}
              zIndex={32}
              onFocus={() => {}}
              darkMode={darkMode}
              resetSignal={activeDrawerId}
            >
              <StationPanelBody
                stationId={activeDrawerId}
                scenario={scenarioData}
                darkMode={darkMode}
                vitals={vitals}
                monitorConnected={clin.monitorConnected}
                vitalsDocumented={clin.vitalsDocumented}
                onPowerOn={handlePowerOn}
                onDocumentVitals={handleDocumentVitals}
                verifiedId={clin.verifiedId}
                onVerifyId={handleVerifyId}
                activeEhrTab={clin.activeEhrTab}
                onSelectEhrTab={viewEhrTab}
                allergyFlagged={clin.allergyFlagged}
                onFlagAllergy={handleFlagAllergy}
                cefazolinStatus={clin.cefazolinStatus}
                onCefazolin={handleCefazolin}
                naloxonePrepared={clin.naloxonePrepared}
                onPrepareNaloxone={handlePrepareNaloxone}
                onAdministerNaloxone={handleAdministerNaloxone}
                bedAngle={clin.bedAngle}
                onSetBed={handleSetBed}
                o2Device={clin.o2Device}
                onSetO2={handleSetO2}
                pcaPaused={clin.pcaPaused}
                onPcaOption={handlePcaOption}
              />
            </DraggableGlassPanel>
          )}

          {/* CONCLUDE CONFIRMATION */}
          {showConcludeConfirm && (
            <ExamOverlay darkMode={darkMode} width={480}>
              <div style={{ padding: isPhone ? '18px 16px' : '22px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '17px', fontWeight: 900 }}>{EX.conclude_confirm.title}</div>
                <div style={{ fontSize: '12.5px', color: tk.muted, lineHeight: 1.5 }}>
                  {EX.conclude_confirm.body}
                </div>
                <div className="exam-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                  <button style={{ ...pillBase, justifyContent: 'center' }} onClick={() => setShowConcludeConfirm(false)}>
                    {EX.conclude_confirm.cancel_label}
                  </button>
                  <button
                    onClick={() => endBedside('STUDENT_CONCLUDED')}
                    style={{
                      ...pillBase,
                      justifyContent: 'center',
                      background: 'linear-gradient(135deg, #0066ff, #2563eb)',
                      color: '#ffffff',
                      fontWeight: 900,
                      border: '1px solid rgba(255,255,255,0.45)',
                    }}
                  >
                    <LogOut size={13} /> {EX.conclude_confirm.confirm_label}
                  </button>
                </div>
              </div>
            </ExamOverlay>
          )}
        </>
      )}

      {examStage === EXAM_STAGES.PRE_BRIEFING && (
        <BriefingModal scenario={scenarioData} darkMode={darkMode} onBegin={handleBegin} />
      )}

      {examStage === EXAM_STAGES.EXIT_QUESTIONS && endInfo && (
        <ExitQuestionsModal
          scenario={scenarioData}
          darkMode={darkMode}
          endReason={endInfo.reason}
          timeUsedSec={endInfo.timeUsedSec}
          answers={exitAnswers}
          onAnswer={(qid, oid) => setExitAnswers((prev) => ({ ...prev, [qid]: oid }))}
          onSubmit={handleSubmitExit}
        />
      )}

      {examStage === EXAM_STAGES.FINAL_REPORT && (
        <PerformanceReport
          scenario={scenarioData}
          darkMode={darkMode}
          status={submission.status}
          payload={submission.payload}
          result={submission.result}
          error={submission.error}
          onRetry={() => submitAttempt(submission.payload)}
          onNewAttempt={handleNewAttempt}
        />
      )}
    </div>
  );
}
