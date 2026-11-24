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
        gap: '12px',
        background: '#0a1310',
        color: '#6fd1a9',
        fontSize: '14px',
        fontWeight: 800,
      }}
    >
      <img src="/figma-assets/logo-mark-lime.svg" alt="" width={26} height={23} />
      <span>Preparing 3D patient room…</span>
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
  // Station actions cue a physical mocap reach from the 3D nurse ({ station, nonce })
  const [nurseCue, setNurseCue] = useState({ station: null, nonce: 0 });
  const cueNurse = useCallback(
    (station) => setNurseCue((c) => ({ station, nonce: c.nonce + 1 })),
    []
  );
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
    cueNurse('bedside_monitor');
    patch({ monitorConnected: true });
    recordEvent(
      'POWER_ON_MONITOR',
      'bedside_monitor',
      `Monitor on — SpO2 ${vitals.spo2}%, HR ${vitals.hr}, RR ${vitals.rr}, BP ${vitals.bp}`
    );
  };

  const handleDocumentVitals = () => {
    cueNurse('bedside_monitor');
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
    cueNurse('wristband');
    patch({ verifiedId: true });
    recordEvent('VERIFY_PATIENT_ID', 'wristband', `${p.name} • DOB ${p.dob} • ${p.mrn}`);
  };

  const handleFlagAllergy = () => {
    if (clin.allergyFlagged) return;
    cueNurse('ehr_tablet');
    patch({ allergyFlagged: true });
    recordEvent('FLAG_ALLERGY', 'ehr_tablet', scenarioData.ehr_tabs.allergies);
  };

  const handleCefazolin = () => {
    if (clin.cefazolinStatus) return;
    cueNurse('ehr_tablet');
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
    cueNurse('ehr_tablet');
    checkBlind(EX.mar_actions.naloxone.label, 'ehr_tablet');
    patch({ naloxonePrepared: true });
    recordEvent('PREPARE_NALOXONE', 'ehr_tablet', 'Naloxone 0.4 mg drawn up for IV push');
  };

  const handleAdministerNaloxone = () => {
    if (!clin.naloxonePrepared) return;
    cueNurse('iv_pump');
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
    cueNurse('iv_pump');
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
    cueNurse('hospital_bed');
    clinicalAudio.playBedServoHum(clin.bedAngle, pos.angle);
    patch({ bedAngle: pos.angle });
    recordEvent(pos.event_code, 'hospital_bed', `${pos.title} (${pos.angle}°)`, {
      bed_angle_deg: pos.angle,
    });
  };

  const handleSetO2 = (deviceId) => {
    if (deviceId === clin.o2Device) return;
    cueNurse('wall_oxygen');
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
  const remainingSec = Math.max(0, EX.duration_sec - examElapsed);
  const clockColor =
    remainingSec <= 30 ? '#ee8572' : remainingSec <= 60 ? '#e8b04b' : '#bfe8d6';

  // Format patient name as "DOE, John" to match Figma 36:12 ("ADELEKE, Tunde")
  const nameParts = (scenarioData.patient.name || 'John Doe').trim().split(/\s+/);
  const formattedPatientName =
    nameParts.length >= 2
      ? `${nameParts[nameParts.length - 1].toUpperCase()}, ${nameParts.slice(0, -1).join(' ')}`
      : scenarioData.patient.name;

  // Recent 3 candidate actions for the Figma 36:138..36:143 trace chips
  const recentTrace = actionTimeline
    .filter((e) => e.action !== 'BEGIN_TIMED_ASSESSMENT' && e.action !== 'BEDSIDE_PHASE_END')
    .slice(-3);

  const totalStations = EX.walk_bar_order.length;
  const stationProgressPct = totalStations
    ? Math.min(100, (inspectedStations.length / totalStations) * 100)
    : 0;

  const pillControl = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    height: isPhone ? '30px' : '32px',
    padding: isPhone ? '0 9px' : '0 12px',
    borderRadius: '999px',
    border: '1px solid #2a4136',
    background: '#11211a',
    color: '#afc6bc',
    fontSize: isPhone ? '11px' : '12px',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  // Clinical colour helper for Figma 36:68 "Vitals — live" card
  const hrColor = vitals.hr > 105 || vitals.hr < 55 ? '#e8b04b' : '#bfe8d6';
  const spo2Color = vitals.spo2 < 90 ? '#ee8572' : vitals.spo2 < 94 ? '#e8b04b' : '#bfe8d6';
  const rrColor = vitals.rr <= 10 ? '#ee8572' : vitals.rr > 22 ? '#e8b04b' : '#bfe8d6';

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100dvh',
        background: '#0a1310',
        color: '#eaf2ee',
        overflow: 'hidden',
      }}
    >
      {/* 3D ROOM — frozen + blurred outside the timed bedside phase */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          filter: frozen ? 'blur(8px) saturate(0.8) brightness(0.65)' : 'none',
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
          introTrigger={introTrigger}
          frozen={frozen}
          inspectedStations={inspectedStations}
          stationLabels={EX.station_labels}
          onNurseArrive={handleNurseArrive}
          onNurseDepart={handleNurseDepart}
          nurseCue={nurseCue}
          quality={quality}
          onQualityStats={setQualityStats}
        />
      </div>

      {isBedside && (
        <>
          {/* TOP SCENARIO HEADER BAR — Matches Figma 36:7 ("Entry assessment — scenario") */}
          <header
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 40,
              paddingTop: 'env(safe-area-inset-top, 0px)',
              background: 'rgba(10, 19, 16, 0.94)',
              borderBottom: '1px solid #1d2e27',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
            }}
          >
            <div
              style={{
                minHeight: isPhone ? '50px' : '58px',
                padding: isPhone ? '6px 10px' : '0 22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: isPhone ? '6px' : '12px',
                flexWrap: isPhone ? 'nowrap' : 'wrap',
              }}
            >
              {/* LEFT: S Monogram + Scenario Title + Patient Pill (Figma 36:8..36:13) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? '8px' : '12px', minWidth: 0 }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '14px',
                    background: '#eaf2ee',
                    color: '#0a1310',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  S
                </div>

                {!isPhone && (
                  <span
                    style={{
                      fontSize: '15px',
                      fontWeight: 800,
                      color: '#eaf2ee',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Entry assessment — scenario
                  </span>
                )}

                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '7px',
                    height: '31px',
                    padding: '0 13px',
                    borderRadius: '999px',
                    background: '#11211a',
                    border: '1px solid #2a4136',
                    fontSize: '12.5px',
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <strong style={{ color: '#ddebe4', fontWeight: 800, whiteSpace: 'nowrap' }}>
                    {formattedPatientName}
                  </strong>
                  <span
                    style={{
                      color: '#8ca69b',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {scenarioData.patient.age} {scenarioData.patient.gender?.[0]}
                    {!isPhone ? ' · PACU · Post-op' : ''}
                  </span>
                </div>
              </div>

              {/* RIGHT: Progress + Utility Controls + Mono Clock + Finish/Exit (Figma 36:14..36:20) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? '5px' : '10px', flexShrink: 0 }}>
                {!isPhone && !isTablet && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginRight: '4px' }}>
                    <span
                      className="font-mono-clinical"
                      style={{ fontSize: '12px', color: '#8ca69b', whiteSpace: 'nowrap' }}
                    >
                      station {inspectedStations.length} of {totalStations}
                    </span>
                    <div
                      style={{
                        width: '96px',
                        height: '6px',
                        borderRadius: '3px',
                        background: '#1d2e27',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.max(6, stationProgressPct)}%`,
                          borderRadius: '3px',
                          background: '#6fd1a9',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                )}

                <button
                  style={pillControl}
                  onClick={(e) => {
                    cycleQuality();
                    e.currentTarget.blur();
                  }}
                  title={`Render quality: ${QUALITY_TIERS[quality].label} (${qualityStats.fps} FPS)`}
                >
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background:
                        qualityStats.fps >= 45 ? '#6fd1a9' : qualityStats.fps >= 25 ? '#e8b04b' : '#ee8572',
                    }}
                  />
                  {!isPhone && QUALITY_TIERS[quality].label}
                  <span className="font-mono-clinical" style={{ color: '#8ca69b', fontSize: '11px' }}>
                    {qualityStats.fps}fps
                  </span>
                </button>

                <button style={pillControl} onClick={handleToggleAudio} title="Toggle clinical audio">
                  {audioMuted ? <VolumeX size={13} /> : <Volume2 size={13} color="#6fd1a9" />}
                </button>

                {/* Countdown Timer Pill (Figma 36:17) */}
                <div
                  className="font-mono-clinical"
                  style={{
                    height: '31px',
                    padding: isPhone ? '0 10px' : '0 14px',
                    borderRadius: '15.5px',
                    background: '#1a2c25',
                    color: clockColor,
                    fontSize: isPhone ? '14px' : '16.5px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  title="Time remaining"
                >
                  {formatClock(remainingSec)}
                </div>

                {/* Outlined Save & Exit / Escalate button (Figma 36:19) */}
                <button
                  onClick={() => setShowConcludeConfirm(true)}
                  style={{
                    height: '33px',
                    padding: isPhone ? '0 11px' : '0 15px',
                    borderRadius: '16.5px',
                    background: isPhone ? '#6fd1a9' : 'transparent',
                    border: isPhone ? 'none' : '1px solid #2a4136',
                    color: isPhone ? '#0a1310' : '#afc6bc',
                    fontSize: isPhone ? '11.5px' : '13px',
                    fontWeight: isPhone ? 800 : 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isPhone ? 'Finish' : 'Save & exit'}
                </button>
              </div>
            </div>

            {/* Mobile Portrait Vitals Strip */}
            {isPhone && !isLandscape && (
              <div
                className="no-scrollbar"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  overflowX: 'auto',
                  padding: '0 10px 7px',
                }}
              >
                {clin.monitorConnected ? (
                  [
                    ['HR', `${vitals.hr}`, hrColor],
                    ['SpO₂', `${vitals.spo2}%`, spo2Color],
                    ['BP', vitals.bp, '#bfe8d6'],
                    ['RR', `${vitals.rr}`, rrColor],
                    ['EtCO₂', `${vitals.etco2}`, '#bfe8d6'],
                  ].map(([label, val, col]) => (
                    <span
                      key={label}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '3px 9px',
                        borderRadius: '999px',
                        background: '#11211a',
                        border: '1px solid #2a4136',
                        fontSize: '11px',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ color: '#8ca69b' }}>{label}</span>
                      <span className="font-mono-clinical" style={{ color: col, fontWeight: 600 }}>
                        {val}
                      </span>
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: '11px', color: '#8ca69b', padding: '2px 4px' }}>
                    Vitals — standby (walk to Bedside Monitor to power on)
                  </span>
                )}
              </div>
            )}
          </header>

          {/* FLOATING "Vitals — live" CARD ON DESKTOP/TABLET (Matches Figma 36:68) */}
          {(!isPhone || isLandscape) && (
            <div
              onClick={() => handleSelectStation('bedside_monitor')}
              title="Click to walk to Bedside Monitor"
              style={{
                position: 'fixed',
                top: '74px',
                left: '20px',
                zIndex: 28,
                width: '216px',
                padding: '14px 18px',
                borderRadius: '14px',
                background: 'rgba(13, 27, 21, 0.90)',
                border: '1px solid #2a4136',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                cursor: 'pointer',
                boxShadow: '0 14px 32px rgba(0, 0, 0, 0.42)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: clin.monitorConnected ? '10px' : '6px',
                }}
              >
                <span style={{ fontSize: '11.5px', fontWeight: 800, color: '#8ca69b' }}>
                  {clin.monitorConnected ? 'Vitals — live' : 'Vitals — standby'}
                </span>
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: clin.monitorConnected ? '#6fd1a9' : '#5e7a6c',
                  }}
                />
              </div>

              {clin.monitorConnected ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[
                    ['HR', `${vitals.hr}`, hrColor],
                    ['SpO₂', `${vitals.spo2}%`, spo2Color],
                    ['BP', vitals.bp, '#bfe8d6'],
                    ['RR', `${vitals.rr}`, rrColor],
                    ['EtCO₂', `${vitals.etco2}`, '#bfe8d6'],
                  ].map(([label, value, color]) => (
                    <div
                      key={label}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: '12.5px', color: '#afc6bc' }}>{label}</span>
                      <span
                        className="font-mono-clinical"
                        style={{ fontSize: '17px', fontWeight: 600, color }}
                      >
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#afc6bc', lineHeight: 1.45 }}>
                  Telemetry off — click or walk to <strong style={{ color: '#6fd1a9' }}>Bedside Monitor</strong> to power on.
                </div>
              )}
            </div>
          )}

          {/* BOTTOM CLINICAL ACTION & WALK DOCK — Matches Figma 36:129..36:155 */}
          <div
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 38,
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              background: 'rgba(10, 19, 16, 0.94)',
              borderTop: '1px solid #1d2e27',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            <div
              style={{
                padding: isPhone ? '8px 10px 10px' : '12px 22px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: isPhone ? '6px' : '10px',
              }}
            >
              {/* Top Prompt + Recent Timestamped Trace Chips (Desktop / Tablet — Figma 36:129 + 36:138) */}
              {!isPhone && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '14.5px', fontWeight: 800, color: '#eaf2ee' }}>
                      What do you do next?
                    </span>
                    <span style={{ fontSize: '12px', color: '#5e7a6c' }}>
                      Walk to any bedside station or click its pin in the room
                    </span>
                  </div>

                  {recentTrace.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      {recentTrace.map((ev) => (
                        <span
                          key={ev.step}
                          className="font-mono-clinical"
                          style={{
                            padding: '3px 10px',
                            borderRadius: '12px',
                            background: '#11211a',
                            border: '1px solid #1d2e27',
                            color: '#afc6bc',
                            fontSize: '11px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatClock(ev.timestamp_sec)} {(ev.station_label || ev.label).toLowerCase()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Station Action Cards + Primary Mint CTA ("Finish and see my gap chart" — Figma 36:144 + 36:154) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div
                  className="no-scrollbar"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    overflowX: 'auto',
                    flex: 1,
                    minWidth: 0,
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  <button
                    onClick={handleDoorwayView}
                    style={{
                      height: isPhone ? '38px' : '42px',
                      padding: '0 14px',
                      borderRadius: '12px',
                      background: cameraFocusId === 'overview' && !activeDrawerId ? '#143528' : '#11211a',
                      border:
                        cameraFocusId === 'overview' && !activeDrawerId
                          ? '1.5px solid #6fd1a9'
                          : '1px solid #2a4136',
                      color: '#afc6bc',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    Doorway view
                  </button>

                  {EX.walk_bar_order.map((id) => {
                    const active = activeDrawerId === id;
                    const visited = inspectedStations.includes(id);
                    return (
                      <button
                        key={id}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          handleSelectStation(id);
                        }}
                        style={{
                          height: isPhone ? '38px' : '42px',
                          padding: '0 15px',
                          borderRadius: '12px',
                          background: active ? '#143528' : '#11211a',
                          border: active ? '2px solid #6fd1a9' : '1px solid #2a4136',
                          color: '#ffffff',
                          fontSize: '13px',
                          fontWeight: active ? 700 : 500,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            background: active ? '#6fd1a9' : visited ? '#4e8a72' : '#6fd1a9',
                            opacity: visited && !active ? 0.6 : 1,
                          }}
                        />
                        {EX.station_labels[id]}
                      </button>
                    );
                  })}
                </div>

                {!isPhone && (
                  <button
                    onClick={() => setShowConcludeConfirm(true)}
                    style={{
                      height: '42px',
                      padding: '0 22px',
                      borderRadius: '12px',
                      background: '#6fd1a9',
                      border: 'none',
                      color: '#0a1310',
                      fontSize: '14px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    Finish and see my gap chart
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* STATION PANEL (opens once the nurse arrives at the bedside station) */}
          {activeDrawerId && (
            <DraggableGlassPanel
              id="drawer"
              title={activeDrawerId === 'ehr_tablet' ? 'Patient chart' : EX.station_labels[activeDrawerId]}
              subtitle={
                isTouch
                  ? 'Inspecting station • Tap chevron to peek at room'
                  : 'Inspecting station • Press [Esc] to close'
              }
              icon={OBJECT_ICONS[activeDrawerId] || Activity}
              badgeColor="#1e4a38"
              initialPos={{
                x: Math.max(16, vw - 440 - 20),
                y: 72,
              }}
              width={440}
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
            <ExamOverlay darkMode width={480}>
              <div
                style={{
                  padding: isPhone ? '20px 18px' : '24px 26px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#eaf2ee' }}>
                  Finish bedside scenario?
                </div>
                <div style={{ fontSize: '13.5px', color: '#afc6bc', lineHeight: 1.55 }}>
                  Your bedside choices and their order will be locked as a structured trace, followed
                  by {EX.exit_questions.length} clinical escalation questions to build your gap chart.
                </div>
                <div
                  className="exam-actions"
                  style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}
                >
                  <button
                    style={{
                      ...pillControl,
                      height: '42px',
                      padding: '0 18px',
                      justifyContent: 'center',
                    }}
                    onClick={() => setShowConcludeConfirm(false)}
                  >
                    Return to bedside
                  </button>
                  <button
                    onClick={() => endBedside('STUDENT_CONCLUDED')}
                    style={{
                      height: '42px',
                      padding: '0 22px',
                      borderRadius: '999px',
                      background: '#6fd1a9',
                      color: '#0a1310',
                      fontWeight: 800,
                      fontSize: '13.5px',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '7px',
                    }}
                  >
                    <LogOut size={14} /> Continue to exit questions
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
