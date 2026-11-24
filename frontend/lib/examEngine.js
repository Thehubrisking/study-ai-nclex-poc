/**
 * examEngine.js — Deterministic NGN exam physiology (pure functions, no timers).
 *
 * Vitals are derived from the room state every render across BOTH post-exploratory laparotomy axes:
 *   1. Opioid-Induced Respiratory Depression (Morphine PCA, HOB angle, O2 device, Naloxone)
 *   2. Postoperative Hemorrhage / Hypovolemia (JP drain assessment, 0.9% NS crystalloid bolus, Branch D shock)
 */

export const EXAM_STAGES = {
  PRE_BRIEFING: 'PRE_BRIEFING',
  BEDSIDE: 'BEDSIDE',
  EXIT_QUESTIONS: 'EXIT_QUESTIONS',
  FINAL_REPORT: 'FINAL_REPORT',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function parseSystolic(bp) {
  const m = String(bp || '').match(/^(\d+)/);
  return m ? Number(m[1]) : 110;
}

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

  // 1. Severe opioid hypoventilation dominates respiratory drive
  if (level === 'toxic_bolus' || level === 'toxic_flush' || level === 'crash') {
    const src =
      level === 'toxic_bolus'
        ? ph.acute_opioid_toxicity
        : level === 'toxic_flush'
          ? ph.residual_line_flush
          : branching.branch_b_opioid_trap.vitals;
    v = { ...v, ...src };
    if (bed.spo2_delta < 0) v.spo2 += bed.spo2_delta;
    if (device && level === 'crash') v.spo2 += ph.o2_bonus_when_bradypneic || 0;
    if (state.hemorrhageShock && !state.crystalloidBolus) {
      v.bp = branching.branch_d_hemorrhagic_shock?.vitals_delta?.bp_override || '78/46';
      v.hr = Math.max(v.hr, 136);
    }
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
    if (!state.pcaPaused && level !== 'reversed') {
      v.spo2 = Math.min(v.spo2, branching.branch_b_opioid_trap.masked_spo2);
    }
  }

  // 4. Hemorrhage / Perfusion axis (Branch D shock vs. Crystalloid resuscitation)
  if (state.crystalloidBolus) {
    v.bp = ph.crystalloid_supported_bp || '110/68';
    v.hr += ph.crystalloid_hr_delta || -14;
  } else if (state.hemorrhageShock) {
    const d = branching.branch_d_hemorrhagic_shock?.vitals_delta || {};
    v.hr = d.hr_override || 136;
    v.bp = d.bp_override || '78/46';
    v.spo2 += d.spo2_delta || -3;
  }

  // 5. Branch A: full cardiopulmonary + surgical hemorrhage stabilization
  if (
    state.pcaPaused &&
    device &&
    state.bedAngle >= 30 &&
    state.jpAssessed &&
    (state.crystalloidBolus || !state.hemorrhageShock)
  ) {
    v = {
      ...v,
      ...branching.branch_a_optimal.vitals,
      bp: state.crystalloidBolus ? ph.crystalloid_supported_bp || '110/68' : '102/64',
    };
  }

  v.spo2 = clamp(Math.round(v.spo2), 50, ph.spo2_ceiling || 99);
  v.rr = Math.max(4, Math.round(v.rr));
  v.hr = clamp(Math.round(v.hr), 45, 165);
  const sbp = parseSystolic(v.bp);
  v.alarm_active =
    v.spo2 < thresholds.spo2_low ||
    v.rr <= (thresholds.rr_low || 10) ||
    v.rr > thresholds.rr_high ||
    v.hr > thresholds.hr_high ||
    sbp < (thresholds.sbp_low || 90);
  v.patient_status = isStabilized(v, state, scenario)
    ? 'STABILIZED'
    : state.hemorrhageShock && !state.crystalloidBolus
      ? 'HEMORRHAGIC_SHOCK'
      : scenario.initial_vitals.patient_status;
  return v;
}

export function isStabilized(vitals, state, scenario) {
  const c = scenario.exam_config.stabilization_criteria;
  return (
    vitals.spo2 >= c.spo2_min &&
    vitals.rr >= c.rr_min &&
    (!c.requires_pca_paused || Boolean(state.pcaPaused)) &&
    (!c.requires_jp_assessed || Boolean(state.jpAssessed)) &&
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
