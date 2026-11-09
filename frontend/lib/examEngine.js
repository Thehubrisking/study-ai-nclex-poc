/**
 * examEngine.js — Deterministic NGN exam physiology (pure functions, no timers).
 *
 * Vitals are *derived* from the room state every render instead of being mutated by
 * one-off deltas, so any combination of interventions (including traps) always produces
 * a consistent, reproducible result. All numbers come from scenario_hypoxia.json.
 *
 * opioidLevel:
 *   'baseline'    – morphine PCA effect as on arrival
 *   'crash'       – bradypnea after O2 masked hypoventilation / re-sedation (branch B)
 *   'toxic_flush' – residual morphine flushed in from the line
 *   'toxic_bolus' – extra 1 mg demand bolus given (acute toxicity)
 *   'reversed'    – naloxone given
 */

export const EXAM_STAGES = {
  PRE_BRIEFING: 'PRE_BRIEFING',
  BEDSIDE: 'BEDSIDE',
  EXIT_QUESTIONS: 'EXIT_QUESTIONS',
  FINAL_REPORT: 'FINAL_REPORT',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function computeVitals(state, scenario) {
  const ex = scenario.exam_config;
  const ph = ex.physiology;
  const branching = scenario.clinical_branching;
  const thresholds = scenario.monitor_config.alarm_thresholds;
  const bed =
    ex.bed_positions.find((b) => b.angle === state.bedAngle) || {
      spo2_delta: 0,
      rr_delta: 0,
    };
  const device = ex.oxygen_devices.find((d) => d.id === state.o2Device) || null;
  const level = state.opioidLevel;

  let v = { ...scenario.initial_vitals };

  // 1. Opioid hypoventilation dominates: positioning cannot fix it and O2 barely helps
  if (level === 'toxic_bolus' || level === 'toxic_flush' || level === 'crash') {
    const src =
      level === 'toxic_bolus'
        ? ph.acute_opioid_toxicity
        : level === 'toxic_flush'
          ? ph.residual_line_flush
          : branching.branch_b_opioid_trap.vitals;
    v = { ...v, ...src };
    if (bed.spo2_delta < 0) v.spo2 += bed.spo2_delta; // Trendelenburg still hurts
    if (device && level === 'crash') v.spo2 += ph.o2_bonus_when_bradypneic || 0;
    v.spo2 = clamp(Math.round(v.spo2), 50, ph.spo2_ceiling || 99);
    v.alarm_active = true;
    v.patient_status = 'UNAROUSABLE_NARCAN_REQUIRED';
    return v;
  }

  // 2. Respiratory drive: naloxone reversal > PCA paused > baseline (with untreated deterioration)
  if (level === 'reversed') {
    v = { ...v, ...ph.naloxone_reversed };
  } else if (state.pcaPaused) {
    v = { ...v, ...ph.pca_paused };
  } else if (state.untreatedDeterioration && !device && state.bedAngle <= 0) {
    v = { ...v, ...branching.branch_c_untreated_deterioration.vitals };
  }

  // 3. Positioning + supplemental oxygen
  v.spo2 += bed.spo2_delta || 0;
  v.rr += bed.rr_delta || 0;
  if (device) {
    v.spo2 += device.spo2_delta || 0;
    v.hr += ph.o2_hr_delta || 0;
    // Opioid masking: with morphine still infusing, O2 can only lift SpO2 to the masked ceiling
    if (!state.pcaPaused && level !== 'reversed') {
      v.spo2 = Math.min(v.spo2, branching.branch_b_opioid_trap.masked_spo2);
    }
  }

  // 4. Branch A: optimal stabilization (HOB >= 30°, O2 on, PCA paused)
  if (state.pcaPaused && device && state.bedAngle >= 30) {
    v = { ...v, ...branching.branch_a_optimal.vitals };
  }

  v.spo2 = clamp(Math.round(v.spo2), 50, ph.spo2_ceiling || 99);
  v.rr = Math.max(4, Math.round(v.rr));
  v.hr = Math.round(v.hr);
  v.alarm_active =
    v.spo2 < thresholds.spo2_low ||
    v.rr <= 10 ||
    v.rr > thresholds.rr_high ||
    v.hr > thresholds.hr_high;
  v.patient_status = isStabilized(v, state, scenario)
    ? 'STABILIZED'
    : scenario.initial_vitals.patient_status;
  return v;
}

export function isStabilized(vitals, state, scenario) {
  const c = scenario.exam_config.stabilization_criteria;
  return (
    vitals.spo2 >= c.spo2_min &&
    vitals.rr >= c.rr_min &&
    (!c.requires_pca_paused || Boolean(state.pcaPaused)) &&
    !['toxic_bolus', 'toxic_flush', 'crash'].includes(state.opioidLevel)
  );
}

export function isNaloxoneIndicated(vitals, scenario) {
  const ind = scenario.exam_config.naloxone.indication;
  return vitals.spo2 < ind.spo2_below || vitals.rr <= ind.rr_at_or_below;
}

export function formatClock(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
