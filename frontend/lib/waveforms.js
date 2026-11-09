/**
 * waveforms.js — Analytic ICU waveform synthesis for the Study AI monitor.
 *
 * Technique inspired by the open-source "3d-icu-patient-monitor" project
 * (github.com/AleksandraKaminska/3d-icu-patient-monitor): waveforms are
 * generated mathematically (no recorded footage) from summed Gaussian waves
 * placed at physiological millisecond offsets. This is an independent
 * implementation (that repo ships no code licence), extended with a continuous
 * `hypoxia` factor (0 = normoxic, 1 = critical) that morphs every channel.
 *
 * All inputs are plain numbers so the same math drives both the 3D monitor
 * texture (Room3D) and the 2D overlay (VitalsMonitorModal).
 */

const TAU = Math.PI * 2;
export const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Asymmetric Gaussian bell: separate rise (sL) and fall (sR) widths. */
function bell(t, center, amp, sL, sR = sL) {
  const s = t < center ? sL : sR;
  const d = t - center;
  return amp * Math.exp(-(d * d) / (2 * s * s));
}

/**
 * ECG lead II sample.
 * - P / QRS keep fixed millisecond widths; only diastole stretches with HR.
 * - QT follows Bazett (QT ≈ 0.4·√RR).
 * - Hypoxia adds demand-ischaemia ST depression, a flattened T wave, larger
 *   respiratory baseline wander (laboured breathing) and restlessness artefact.
 */
export function ecgSample(tBeat, rr, respPhase, hypoxia) {
  const qt = 0.4 * Math.sqrt(rr);
  const tPeak = 0.215 + qt * 0.55;

  let v =
    bell(tBeat, 0.09, 0.13, 0.022) + // P
    bell(tBeat, 0.195, -0.12, 0.008) + // Q
    bell(tBeat, 0.215, 1.0, 0.0095) + // R
    bell(tBeat, 0.242, -0.24, 0.01, 0.013) + // S
    bell(tBeat, tPeak, 0.26 * (1 - 0.5 * hypoxia), 0.045, 0.03); // T

  // ST-segment depression from the J point up to the T-wave peak.
  const j = 0.26;
  if (hypoxia > 0 && tBeat > j && tBeat < tPeak) {
    v -= 0.1 * hypoxia * Math.min(1, (tBeat - j) / 0.03);
  }

  v += Math.sin(respPhase) * (0.02 + 0.06 * hypoxia); // baseline wander
  v += (Math.random() - 0.5) * 0.035 * hypoxia; // muscle / motion artefact
  return v;
}

/**
 * SpO2 plethysmograph sample for a beat phase (0..1).
 * Sharp systolic upstroke, slower run-off and a dicrotic notch. Low saturation
 * shrinks perfusion amplitude and damps the notch (vasoconstricted, hypoxic).
 */
export function plethSample(phase, spo2, hypoxia) {
  const systolic = bell(phase, 0.18, 1.0, 0.055, 0.15);
  const dicrotic = bell(phase, 0.47, 0.3 * (1 - 0.75 * hypoxia), 0.045, 0.09);
  const perfusion = 0.3 + 0.7 * clamp01((spo2 - 75) / 23);
  return (systolic + dicrotic) * perfusion;
}

/**
 * Impedance respiration sample for a respiratory phase (0..2π).
 * Inspiration occupies ~40% of the cycle; hypoxic tachypnoea is shallower.
 */
export function respSample(respPhase, hypoxia) {
  const q = (((respPhase % TAU) + TAU) % TAU) / TAU;
  const insp = 0.4;
  const s =
    q < insp
      ? Math.sin((q / insp) * (Math.PI / 2)) ** 2
      : Math.cos(((q - insp) / (1 - insp)) * (Math.PI / 2)) ** 2;
  return s * (1 - 0.45 * hypoxia);
}

/**
 * Stateful cardiac clock advanced once per waveform sample.
 * RR is recomputed every sample (phase-continuous), so an HR change re-times
 * the trace immediately instead of waiting for the next beat. Per-beat jitter
 * (HRV + pulse amplitude variability) grows with hypoxia.
 */
export class HeartClock {
  constructor(hr = 80) {
    this.phase = 0;
    this.jitter = 1;
    this.amp = 1;
    this.rr = 60 / Math.max(20, hr);
  }

  advance(dt, hr, hypoxia) {
    this.rr = (60 / Math.max(20, hr)) * this.jitter;
    this.phase += dt / this.rr;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.jitter = 1 + (Math.random() - 0.5) * 0.04 * (1 + 2 * hypoxia);
      this.amp = 1 + (Math.random() - 0.5) * 0.5 * hypoxia;
    }
  }

  get tBeat() {
    return this.phase * this.rr;
  }

  /** Pleth lags the ECG by the pulse-transit time (~0.2 s). */
  plethPhase(transitSec = 0.2) {
    return (((this.phase - transitSec / this.rr) % 1) + 1) % 1;
  }
}
