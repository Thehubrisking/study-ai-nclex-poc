'use client';

/**
 * AdaptiveQuality — stable DPR selection that keeps EffectComposer buffers in sync
 * without mid-navigation dynamic DPR oscillation (which caused WebGL FBO resize blinks).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

export const QUALITY_MODES = ['auto', 'high', 'balanced', 'performance'];

export const QUALITY_TIERS = {
  auto: { label: 'Auto', scale: 1.0, hint: 'Stable native screen resolution (capped for smooth orbit)' },
  high: { label: 'High', scale: 1.25, hint: 'Supersampled above native for crispest edges' },
  balanced: { label: 'Balanced', scale: 0.9, hint: '90% of native resolution' },
  performance: { label: 'Performance', scale: 0.7, hint: '70% of native resolution for integrated graphics' },
};

const MAX_DPR = 1.5;
const DPR_STEP = 0.05;

export function nativeDpr() {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

const snap = (v) => Math.max(0.5, Math.round(v / DPR_STEP) * DPR_STEP);

/** Deterministic DPR for a mode — never mutates mid-navigation unless the user clicks the quality pill. */
export function dprForMode(mode) {
  const native = nativeDpr();
  if (mode === 'auto') {
    return Math.min(1.15, snap(native * 0.9));
  }
  const scale = QUALITY_TIERS[mode]?.scale ?? 1.0;
  return Math.min(MAX_DPR, snap(native * scale));
}

export function nativePercent(dpr) {
  return Math.round((dpr / nativeDpr()) * 100);
}

export default function AdaptiveQuality({ mode = 'auto', composerRef, onDpr, onStats }) {
  const viewportDpr = useThree((s) => s.viewport.dpr);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);

  useEffect(() => {
    onDpr?.(dprForMode(mode));
  }, [mode, onDpr]);

  // Keep post-processing render targets matched to the real drawing-buffer size
  useLayoutEffect(() => {
    const composer = composerRef?.current;
    if (composer) composer.setSize(width, height);
  }, [composerRef, viewportDpr, width, height]);

  // Lightweight FPS readout (updates HUD at most once per second)
  const meter = useRef({ frames: 0, t: 0 });
  useFrame((_, delta) => {
    const m = meter.current;
    m.frames += 1;
    m.t += delta;
    if (m.t >= 1) {
      onStats?.({ fps: Math.round(m.frames / m.t), dpr: viewportDpr });
      m.frames = 0;
      m.t = 0;
    }
  });

  return null;
}
