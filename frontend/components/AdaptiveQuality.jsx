'use client';

/**
 * AdaptiveQuality — resolution (DPR) scaling that keeps the post-processing chain in sync.
 *
 * Why the old DPR pass produced a "ghost" overlay:
 *   @react-three/postprocessing only resizes its EffectComposer buffers when the CSS canvas
 *   size changes, not when the device-pixel-ratio changes. Lowering DPR shrank the WebGL drawing
 *   buffer but left the composer's input/output/depth targets at the old resolution, so the final
 *   pass sampled a mismatched, magnified copy of the frame on top of the scene.
 *
 * This component:
 *   1. Picks a DPR from the user's quality mode (Auto / High / Balanced / Performance).
 *   2. In Auto, uses drei's PerformanceMonitor to step DPR up/down gradually (with hysteresis
 *      and a flip-flop limit, so the image doesn't keep changing resolution).
 *   3. Re-sizes the EffectComposer every time the real drawing-buffer DPR changes, so every
 *      render target matches the canvas (no ghosting).
 *   4. Reports measured FPS + current DPR to the HUD about once per second.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';

export const QUALITY_MODES = ['auto', 'high', 'balanced', 'performance'];

// Every tier is a fraction of the display's NATIVE resolution (window.devicePixelRatio), so the
// modes behave the same on a 4K laptop, a 1080p monitor, or a zoomed-out browser tab.
export const QUALITY_TIERS = {
  auto: { label: 'Auto', hint: 'Adjusts resolution automatically to keep motion smooth' },
  high: { label: 'High', scale: 1.25, hint: 'Supersampled above native for the crispest edges, heaviest on the GPU' },
  balanced: { label: 'Balanced', scale: 1.0, hint: 'Native screen resolution' },
  performance: { label: 'Performance', scale: 0.7, hint: '70% of native resolution for integrated graphics' },
};

const AUTO_MIN_SCALE = 0.5; // Auto never drops below half of native resolution
const AUTO_MAX_SCALE = 1.0; // ...and never supersamples (that is what High is for)
const MAX_DPR = 2;
const DPR_STEP = 0.05;

export function nativeDpr() {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

const snap = (v) => Math.max(DPR_STEP, Math.round(v / DPR_STEP) * DPR_STEP);

/** DPR for a mode; Auto maps PerformanceMonitor's 0..1 factor onto [50%, 100%] of native. */
export function dprForMode(mode, factor = 0.5) {
  const native = nativeDpr();
  const scale =
    mode === 'auto'
      ? AUTO_MIN_SCALE + (AUTO_MAX_SCALE - AUTO_MIN_SCALE) * factor
      : QUALITY_TIERS[mode]?.scale ?? 1;
  return Math.min(MAX_DPR, snap(native * scale));
}

/** Render resolution as a percentage of native (what the HUD shows). */
export function nativePercent(dpr) {
  return Math.round((dpr / nativeDpr()) * 100);
}

export default function AdaptiveQuality({ mode = 'auto', composerRef, onDpr, onStats }) {
  const [factor, setFactor] = useState(0.5);
  const viewportDpr = useThree((s) => s.viewport.dpr);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);

  // 1–2. Resolve the DPR for the current mode / Auto factor and push it to the Canvas
  useEffect(() => {
    onDpr?.(dprForMode(mode, factor));
  }, [mode, factor, onDpr]);

  // Switching back to Auto starts from the middle of the range rather than a stale extreme
  useEffect(() => {
    if (mode === 'auto') setFactor(0.5);
  }, [mode]);

  // 3. Keep every post-processing render target at the real drawing-buffer resolution
  useLayoutEffect(() => {
    const composer = composerRef?.current;
    if (composer) composer.setSize(width, height);
  }, [composerRef, viewportDpr, width, height]);

  // 4. Lightweight FPS meter for the HUD (one state update per second at most)
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

  if (mode !== 'auto') return null;
  return (
    <PerformanceMonitor
      // Integrated-GPU friendly targets: step down under ~28 FPS, step back up above ~50 FPS
      bounds={() => [28, 50]}
      factor={0.5}
      step={0.1}
      flipflops={4}
      onChange={({ factor: f }) => setFactor(f)}
      // Too many up/down swings: settle on a safe resolution instead of oscillating
      onFallback={() => setFactor(0.2)}
    />
  );
}
