'use client';

/**
 * Zero-Dependency Web Audio API ICU Sound Synthesizer
 * ---------------------------------------------------
 * 1. Pulse oximeter QRS beep synced to `vitals.hr` whose pitch scales with `vitals.spo2`
 *    (lower pitch at 84-88%, crisp higher pitch at 96-97%).
 * 2. Medical IEC 60601-1-8 high-priority alarm chime when `vitals.spo2 < 90` or `vitals.rr <= 10`.
 * 3. Subtle low-frequency servo actuator hum for 600ms when the hospital bed tilts
 *    between 0°, 30°, and 60°.
 * 4. Optional Web Speech API (`window.speechSynthesis`) patient voice cue helper.
 */

class ClinicalAudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = true; // Starts muted until user unmutes (satisfies browser autoplay policy)
    this.vitals = { spo2: 88, hr: 114, rr: 26 };
    this.qrsTimer = null;
    this.alarmTimer = null;
    this._running = false;
    // Exam mode: the bedside monitor starts OFF / STANDBY, so no pulse tone or alarms until powered on
    this.monitorPowered = false;
  }

  /** Gate the pulse-oximeter tone and IEC alarms on the bedside monitor's power state. */
  setMonitorPowered(on) {
    this.monitorPowered = Boolean(on);
  }

  _ensureContext() {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.muted) {
      this._ensureContext();
      this.startLoops();
      // Play an immediate confirmation QRS beep on unmute
      this.playQrsBeep();
    } else {
      this.stopLoops();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  updateVitals(vitals) {
    if (!vitals) return;
    this.vitals = {
      spo2: Number(vitals.spo2 ?? 88),
      hr: Number(vitals.hr ?? 114),
      rr: Number(vitals.rr ?? 26),
    };
  }

  /**
   * Pulse oximeter QRS tone:
   * Pitch maps linearly/exponentially with SpO2:
   * - 84% -> ~430 Hz (deep hypoxic warning pitch)
   * - 88% -> ~515 Hz (low hypoxic pitch)
   * - 96-97% -> ~760-790 Hz (crisp normoxic ICU monitor pitch)
   */
  playQrsBeep() {
    if (this.muted || !this.monitorPowered) return;
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clampedSpo2 = Math.max(75, Math.min(100, this.vitals.spo2));
    // Map SpO2 [80..100] -> [400Hz..820Hz]
    const norm = (clampedSpo2 - 80) / 20;
    const freq = 400 + Math.max(0, norm) * 420;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  /**
   * Medical IEC 60601-1-8 High-Priority Alarm Chime
   * Triggered when `vitals.spo2 < 90` or `vitals.rr <= 10`.
   * Plays a 3-pulse urgent clinical triplet (C5 - F5 - A5).
   */
  playHighPriorityAlarm() {
    if (this.muted || !this.monitorPowered) return;
    const { spo2, rr } = this.vitals;
    if (!(spo2 < 90 || rr <= 10)) return;

    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Urgent higher-alert cadence if bradypneic (RR <= 10)
    const notes = rr <= 10 ? [987.77, 783.99, 987.77] : [659.25, 783.99, 987.77];

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.115);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.12);
    });
  }

  /**
   * Subtle low-frequency electric actuator servo hum for 600ms
   * when the hospital bed tilts between 0°, 30°, and 60°.
   */
  playBedServoHum(fromAngle = 0, toAngle = 30) {
    if (this.muted) return;
    const ctx = this._ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const duration = 0.6; // 600ms spec requirement
    const goingUp = toAngle >= fromAngle;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'sine';

    const startFreq = goingUp ? 88 : 112;
    const endFreq = goingUp ? 112 : 86;

    osc1.frequency.setValueAtTime(startFreq, now);
    osc1.frequency.linearRampToValueAtTime(endFreq, now + duration);

    osc2.frequency.setValueAtTime(startFreq * 0.5, now);
    osc2.frequency.linearRampToValueAtTime(endFreq * 0.5, now + duration);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(210, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.06);
    gain.gain.setValueAtTime(0.05, now + duration - 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration + 0.02);
    osc2.stop(now + duration + 0.02);
  }

  startLoops() {
    this.stopLoops();
    this._running = true;

    const scheduleNextQrs = () => {
      if (!this._running || this.muted) return;
      this.playQrsBeep();
      const hr = Math.max(40, Math.min(180, this.vitals.hr || 100));
      const intervalMs = Math.round(60000 / hr);
      this.qrsTimer = setTimeout(scheduleNextQrs, intervalMs);
    };

    const scheduleNextAlarm = () => {
      if (!this._running || this.muted) return;
      if (this.vitals.spo2 < 90 || this.vitals.rr <= 10) {
        this.playHighPriorityAlarm();
      }
      this.alarmTimer = setTimeout(scheduleNextAlarm, 2600);
    };

    this.qrsTimer = setTimeout(scheduleNextQrs, 250);
    this.alarmTimer = setTimeout(scheduleNextAlarm, 900);
  }

  stopLoops() {
    this._running = false;
    if (this.qrsTimer) {
      clearTimeout(this.qrsTimer);
      this.qrsTimer = null;
    }
    if (this.alarmTimer) {
      clearTimeout(this.alarmTimer);
      this.alarmTimer = null;
    }
  }
}

export const clinicalAudio = new ClinicalAudioEngine();

/**
 * Optional Web Speech API voice synthesizer for patient verbal cues.
 */
export function speakPatientCue(text, force = false) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (clinicalAudio.muted && !force) return;
  if (!text || text.startsWith('[')) return; // Do not read stage directions aloud

  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.86;
    utter.pitch = 0.88;
    utter.volume = 0.85;
    window.speechSynthesis.speak(utter);
  } catch {}
}
