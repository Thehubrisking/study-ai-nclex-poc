'use client';

/**
 * AdaptiveQuality — deterministic DPR selection capped cleanly at 1.0 in Auto mode
 * (with automatic step-down on software/low-end WebGL) so laptops sustain smooth 60 FPS.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

export const QUALITY_MODES = ['auto', 'high', 'balanced', 'performance'];

export const QUALITY_TIERS = {
  auto: { label: 'Auto', scale: 1.0, hint: 'Adaptive 60 FPS target (1.0x DPR max)' },
  high: { label: 'High', scale: 1.2, hint: 'Crisp high resolution for discrete GPUs' },
  balanced: { label: 'Balanced', scale: 0.8, hint: '80% resolution for mid-range laptops' },
  performance: { label: 'Performance', scale: 0.65, hint: 'Fastest rendering for integrated graphics' },
};

const MAX_DPR = 1.25;
const DPR_STEP = 0.05;

let _cachedSoftwareGpu = null;
export function isSoftwareRenderer() {
  if (typeof window === 'undefined') return false;
  if (_cachedSoftwareGpu !== null) return _cachedSoftwareGpu;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) {
      _cachedSoftwareGpu = true;
      return true;
    }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
    _cachedSoftwareGpu = /SwiftShader|Basic Render Driver|llvmpipe|Software/i.test(renderer);
  } catch {
    _cachedSoftwareGpu = false;
  }
  return _cachedSoftwareGpu;
}

export function nativeDpr() {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

const snap = (v) => Math.max(0.5, Math.round(v / DPR_STEP) * DPR_STEP);

export function dprForMode(mode) {
  if (isSoftwareRenderer() && mode === 'auto') {
    return 0.55;
  }
  const native = nativeDpr();
  if (mode === 'auto') {
    return Math.min(1.0, snap(native));
  }
  if (mode === 'balanced') {
    return Math.min(0.85, snap(native * 0.8));
  }
  if (mode === 'performance') {
    return Math.min(0.7, snap(native * 0.65));
  }
  const scale = QUALITY_TIERS[mode]?.scale ?? 1.0;
  return Math.min(MAX_DPR, snap(native * scale));
}

export function nativePercent(dpr) {
  return Math.round((dpr / nativeDpr()) * 100);
}

export default function AdaptiveQuality({ mode = 'auto', onDpr, onStats }) {
  const viewportDpr = useThree((s) => s.viewport.dpr);
  const autoDowngradedRef = useRef(false);

  useEffect(() => {
    autoDowngradedRef.current = false;
    onDpr?.(dprForMode(mode));
  }, [mode, onDpr]);

  // Lightweight FPS readout + automatic one-time step-down in Auto mode if GPU < 28 FPS
  const meter = useRef({ frames: 0, t: 0, lastFps: -1 });
  useFrame((_, rawDelta) => {
    const m = meter.current;
    m.frames += 1;
    m.t += Math.min(rawDelta, 0.5);
    if (m.t >= 1.0) {
      const fps = Math.max(1, Math.round(m.frames / m.t));
      if (fps !== m.lastFps) {
        m.lastFps = fps;
        onStats?.({ fps, dpr: viewportDpr });
      }
      if (mode === 'auto' && !autoDowngradedRef.current && fps < 28 && viewportDpr > 0.65) {
        autoDowngradedRef.current = true;
        onDpr?.(0.65);
      }
      m.frames = 0;
      m.t = 0;
    }
  });

  return null;
}
