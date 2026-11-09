/**
 * monitorRenderer.js — Sweep-mode bedside monitor drawn on a 2D canvas.
 *
 * Like a real bedside monitor (and the reference ICU project's Trace), each
 * channel has fixed X slots; a write cursor sweeps left→right overwriting old
 * samples with a short blank "erase bar" ahead of it, so waves stay anchored
 * instead of scrolling.
 *
 * The same renderer is used as a THREE.CanvasTexture on the 3D monitor screen
 * (Room3D) and as a crisp 2D canvas in VitalsMonitorModal.
 */
import { HeartClock, ecgSample, plethSample, respSample } from './waveforms';
import { live, monitorConfig } from './liveVitals';

export const LOGICAL_W = 640;
export const LOGICAL_H = 400;

const SAMPLE_RATE = 200; // Hz
const ECG_SWEEP_SEC = 4;
const GAP = 8; // erase-bar width in samples

function makeChannel(key, sweepSec, every, map) {
  const n = Math.round((SAMPLE_RATE * sweepSec) / every);
  const buf = new Float32Array(n).fill(NaN);
  const ch = monitorConfig.waveform_channels[key];
  return { key, label: ch.label, color: ch.color, buf, n, cursor: 0, every, map };
}

export class SweepMonitor {
  constructor(canvas, { pixelRatio = 1, patientName = '' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pixelRatio = pixelRatio;
    this.patientName = patientName;
    canvas.width = LOGICAL_W * pixelRatio;
    canvas.height = LOGICAL_H * pixelRatio;

    this.heart = new HeartClock(live.hr);
    this.acc = 0;
    this.sampleIndex = 0;
    this.blinkT = 0;

    // map(v) → 0..1 vertical position inside the channel row (0 = top).
    this.channels = [
      makeChannel('ecg', ECG_SWEEP_SEC, 1, (v) => 0.62 - v * 0.48),
      makeChannel('pleth', ECG_SWEEP_SEC, 1, (v) => 0.88 - v * 0.7),
      makeChannel('resp', ECG_SWEEP_SEC * 2, 2, (v) => 0.85 - v * 0.65),
    ];
  }

  sample() {
    const h = live.hypoxia;
    this.heart.advance(1 / SAMPLE_RATE, live.hr, h);
    const values = {
      ecg: ecgSample(this.heart.tBeat, this.heart.rr, live.respPhase, h),
      pleth: plethSample(this.heart.plethPhase(), live.spo2, h) * this.heart.amp,
      resp: respSample(live.respPhase, h),
    };
    this.sampleIndex++;
    for (const ch of this.channels) {
      if (this.sampleIndex % ch.every !== 0) continue;
      ch.buf[ch.cursor] = values[ch.key];
      for (let g = 1; g <= GAP; g++) ch.buf[(ch.cursor + g) % ch.n] = NaN;
      ch.cursor = (ch.cursor + 1) % ch.n;
    }
  }

  tick(rawDt) {
    const dt = Math.min(rawDt, 0.05);
    this.blinkT += dt;
    this.acc += dt;
    const step = 1 / SAMPLE_RATE;
    let guard = 0;
    while (this.acc >= step && guard++ < 64) {
      this.acc -= step;
      this.sample();
    }
    this.draw();
  }

  draw() {
    const { ctx, pixelRatio } = this;
    const { cue_text, alarm_thresholds } = monitorConfig;
    const blinkOn = Math.floor(this.blinkT * 2.5) % 2 === 0;
    const alarm = live.alarm;

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    // Border flashes red while alarming.
    ctx.lineWidth = 4;
    ctx.strokeStyle = alarm ? (blinkOn ? '#ef4444' : '#450a0a') : '#065f46';
    ctx.strokeRect(2, 2, LOGICAL_W - 4, LOGICAL_H - 4);

    // Header: patient + alarm banner.
    const headerH = 38;
    ctx.font = '600 15px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText(`BED 4  ${this.patientName}`, 14, headerH / 2 + 2);

    const bannerW = 250;
    const bx = LOGICAL_W - bannerW - 10;
    if (alarm) {
      ctx.fillStyle = blinkOn ? '#dc2626' : '#7f1d1d';
      ctx.fillRect(bx, 8, bannerW, headerH - 12);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '800 15px monospace';
      ctx.fillText(`*** ${cue_text.alarm_spo2_low} ${Math.round(live.spo2)}% ***`, bx + bannerW / 2, headerH / 2 + 2);
    } else {
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(bx, 8, bannerW, headerH - 12);
      ctx.fillStyle = '#6ee7b7';
      ctx.textAlign = 'center';
      ctx.font = '700 14px monospace';
      ctx.fillText(cue_text.alarm_clear, bx + bannerW / 2, headerH / 2 + 2);
    }

    // Waveform rows (left 68%).
    const traceW = LOGICAL_W * 0.68;
    const top = headerH + 6;
    const rowH = (LOGICAL_H - top - 8) / this.channels.length;

    this.channels.forEach((ch, row) => {
      const y0 = top + row * rowH;
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(12, y0 + rowH);
      ctx.lineTo(traceW, y0 + rowH);
      ctx.stroke();

      ctx.fillStyle = ch.color;
      ctx.font = '700 12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(ch.label, 14, y0 + 12);

      ctx.strokeStyle = ch.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      const x0 = 14;
      const w = traceW - x0 - 6;
      for (let i = 0; i < ch.n; i++) {
        const v = ch.buf[i];
        if (Number.isNaN(v)) {
          pen = false;
          continue;
        }
        const x = x0 + (i / (ch.n - 1)) * w;
        const y = y0 + Math.min(1, Math.max(0, ch.map(v))) * rowH;
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    });

    // Numerics column (right 32%).
    const nx = traceW + 14;
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(traceW + 4, top);
    ctx.lineTo(traceW + 4, LOGICAL_H - 10);
    ctx.stroke();

    const spo2Low = live.spo2 < alarm_thresholds.spo2_low;
    const numerics = [
      { label: 'HR', value: Math.round(live.hr), color: '#22e08a', warn: live.hr > alarm_thresholds.hr_high, big: true },
      { label: 'SpO2 %', value: Math.round(live.spo2), color: '#22d3ee', warn: spo2Low, big: true },
      { label: 'RR', value: Math.round(live.rr), color: '#facc15', warn: live.rr > alarm_thresholds.rr_high },
      { label: 'NIBP', value: live.bp, color: '#e2e8f0' },
      { label: 'EtCO2', value: Math.round(live.etco2), color: '#c084fc' },
    ];

    let y = top + 4;
    for (const n of numerics) {
      const h = n.big ? 78 : 50;
      const flash = n.warn && alarm && !blinkOn;
      ctx.textAlign = 'left';
      ctx.fillStyle = n.warn ? '#f87171' : n.color;
      ctx.font = '700 12px monospace';
      ctx.fillText(n.label, nx, y + 10);
      ctx.fillStyle = flash ? '#7f1d1d' : n.warn ? '#ef4444' : n.color;
      ctx.font = `800 ${n.big ? 46 : 26}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(String(n.value), LOGICAL_W - 16, y + (n.big ? 48 : 32));
      y += h;
    }
  }
}
