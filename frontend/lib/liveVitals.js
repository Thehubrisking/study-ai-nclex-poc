/**
 * liveVitals.js — Shared, mutable "live" physiology state.
 *
 * React state (page.jsx) holds the *target* vitals set by deterministic
 * interventions from scenario_hypoxia.json. This module eases the live values
 * toward those targets with a short exponential time constant
 * (monitor_config.physiology_easing_ms, default 25 ms → ~98% settled < 100 ms)
 * and derives hypoxia / cyanosis / alarm factors.
 *
 * Kept outside React so the 3D useFrame loop and the 2D canvas loop can read
 * it every frame without triggering re-renders.
 */
import { useEffect } from 'react';
import scenarioData from '../config/scenario_hypoxia.json';
import { clamp01 } from './waveforms';

const cfg = scenarioData.monitor_config;
const NUMERIC_KEYS = ['spo2', 'hr', 'rr', 'etco2', 'temp_c'];

/** Pure derivation, also used by React components for instant text cues. */
export function deriveClinicalState(spo2, alarmActive = false) {
  const { spo2_low, spo2_critical } = cfg.alarm_thresholds;
  const { onset_spo2, full_spo2, max_intensity } = cfg.cyanosis;
  const hypoxia = clamp01((spo2_low - spo2) / (spo2_low - spo2_critical));
  const cyanosisRaw = clamp01((onset_spo2 - spo2) / (onset_spo2 - full_spo2));
  return {
    hypoxia,
    cyanosisRaw,
    cyanosis: cyanosisRaw * max_intensity,
    alarm: Boolean(alarmActive) || spo2 < spo2_low,
  };
}

const init = scenarioData.initial_vitals;
export const live = {
  ...init,
  target: { ...init },
  respPhase: 0,
  tAbs: 0,
  ...deriveClinicalState(init.spo2, init.alarm_active),
};

export function setLiveTarget(vitals) {
  live.target = { ...vitals };
  // Non-numeric fields switch immediately.
  live.bp = vitals.bp;
  live.patient_status = vitals.patient_status;
  live.alarm_active = vitals.alarm_active;
}

export function stepLive(rawDt) {
  const dt = Math.min(Math.max(rawDt, 0), 0.1);
  const k = 1 - Math.exp(-(dt * 1000) / cfg.physiology_easing_ms);
  for (const key of NUMERIC_KEYS) {
    const t = Number(live.target[key]);
    if (Number.isFinite(t)) live[key] += (t - live[key]) * k;
  }
  live.tAbs += dt;
  live.respPhase = (live.respPhase + dt * (Math.max(4, live.rr) / 60) * Math.PI * 2) % (Math.PI * 2);
  Object.assign(live, deriveClinicalState(live.spo2, live.alarm_active));
}

/** Mount once (page.jsx): pushes React targets in and runs the easing loop. */
export function useLiveVitalsDriver(vitals) {
  useEffect(() => {
    setLiveTarget(vitals);
  }, [vitals]);

  useEffect(() => {
    let raf;
    let last = performance.now();
    const loop = (now) => {
      stepLive((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export const monitorConfig = cfg;
