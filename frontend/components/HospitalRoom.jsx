'use client';

/**
 * HospitalRoom.jsx — Enclosed med-surg patient room shell + physically-based lighting rig.
 *
 * - Cutaway room (headwall + window wall) that auto-hides walls when the camera orbits behind them
 * - Speckled sheet-vinyl floor (procedural CanvasTexture), sage wainscot, bumper rail & coved base
 * - Window with daylight/night sky, tilted blinds that cast striped sun shadows across the floor
 * - Headwall service console (medical gas outlets, power, nurse call, reading light, LED wash)
 * - Privacy curtain on ceiling track, wall clock (real time), whiteboard, glove & sharps station,
 *   hand sanitizer, entry door, and a code/alarm dome that pulses with live vitals
 * - Day shift vs night shift lighting (driven by the app's dark mode toggle)
 */
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { live } from '../lib/liveVitals';

import { ROOM } from '../lib/roomBounds';

export { ROOM };
const WALL_T = 0.12;
const WINDOW = { z0: 0.6, z1: 2.6, y0: 0.95, y1: 2.25 };
const DOOR = { z0: 3.15, z1: 4.05, h: 2.15 };
const RAIL_Y = 0.95;

const THEMES = {
  day: {
    floor: '#c9ced5',
    speck: ['#bfc5cc', '#e9ecef', '#b3bbc4', '#cfd6dc'],
    seam: '#b9c0c8',
    outerFloor: '#c8ced5',
    wall: '#e8ecf0',
    wainscot: '#d2e5de',
    rail: '#9ab6ad',
    base: '#6d7c86',
    frame: '#e4e8ed',
    door: '#c8a57a',
    sky: ['#79aee0', '#cfe3f5'],
    skyline: '#c5d4e3',
    curtain: '#a8c6d9',
    led: 0.45,
  },
  night: {
    floor: '#2c3546',
    speck: ['#36405a', '#222a3a', '#3d4860', '#2f384c'],
    seam: '#141a26',
    outerFloor: '#1a2232',
    wall: '#2e3a52',
    wainscot: '#27433f',
    rail: '#2e5850',
    base: '#0c121c',
    frame: '#3a4760',
    door: '#5b4733',
    sky: ['#040a18', '#1a2a52'],
    skyline: '#0c1730',
    curtain: '#3b5566',
    led: 1.6,
  },
};

const ALUMINUM = { color: '#d6dce3', metalness: 0.65, roughness: 0.32 };

/* ---------------- Procedural textures ---------------- */

function seededRandom(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function makeVinylTexture(theme, repeatX, repeatY) {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = theme.floor;
  g.fillRect(0, 0, size, size);
  const rnd = seededRandom(1337);
  // Soft mottled clouds for a terrazzo-like sheet vinyl
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = 0.05;
    g.fillStyle = theme.speck[i % theme.speck.length];
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, 20 + rnd() * 60, 0, Math.PI * 2);
    g.fill();
  }
  // Fine chips
  for (let i = 0; i < 12000; i++) {
    g.globalAlpha = 0.25 + rnd() * 0.5;
    g.fillStyle = theme.speck[i % theme.speck.length];
    const r = 0.6 + rnd() * 1.8;
    g.fillRect(rnd() * size, rnd() * size, r, r);
  }
  // Heat-welded seam
  g.globalAlpha = 0.9;
  g.strokeStyle = theme.seam;
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeSkyTexture(theme, night) {
  if (typeof document === 'undefined') return null;
  const w = 512;
  const h = 320;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, theme.sky[0]);
  grad.addColorStop(1, theme.sky[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // Distant city skyline
  const rnd = seededRandom(42);
  let x = 0;
  while (x < w) {
    const bw = 24 + rnd() * 50;
    const bh = 50 + rnd() * 130;
    g.fillStyle = theme.skyline;
    g.fillRect(x, h - bh, bw, bh);
    if (night) {
      for (let wy = h - bh + 6; wy < h - 6; wy += 9) {
        for (let wx = x + 4; wx < x + bw - 4; wx += 7) {
          if (rnd() > 0.72) {
            g.fillStyle = rnd() > 0.5 ? '#fde68a' : '#fef3c7';
            g.globalAlpha = 0.55 + rnd() * 0.45;
            g.fillRect(wx, wy, 3, 4);
            g.globalAlpha = 1;
          }
        }
      }
    }
    x += bw + 2 + rnd() * 6;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- Small building blocks ---------------- */

function Slab({ args, position, rotation, color, roughness = 0.92, metalness = 0, cast = true }) {
  return (
    <mesh position={position} rotation={rotation} castShadow={cast} receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

/** Wainscot + bumper rail + coved base along one wall run. */
function WallTrim({ axis, from, to, theme }) {
  const len = to - from;
  const mid = (from + to) / 2;
  const pieces = [
    { h: RAIL_Y, d: 0.012, y: RAIL_Y / 2, color: theme.wainscot, rough: 0.85 },
    { h: 0.07, d: 0.04, y: RAIL_Y, color: theme.rail, rough: 0.45 },
    { h: 0.1, d: 0.02, y: 0.05, color: theme.base, rough: 0.6 },
  ];
  return pieces.map((p, i) =>
    axis === 'x' ? (
      <Slab
        key={i}
        args={[len, p.h, p.d]}
        position={[mid, p.y, ROOM.minZ + p.d / 2]}
        color={p.color}
        roughness={p.rough}
        cast={false}
      />
    ) : (
      <Slab
        key={i}
        args={[p.d, p.h, len]}
        position={[ROOM.minX + p.d / 2, p.y, mid]}
        color={p.color}
        roughness={p.rough}
        cast={false}
      />
    )
  );
}

/* ---------------- Room features ---------------- */

function WindowWithBlinds({ theme, night }) {
  const sky = useMemo(() => makeSkyTexture(theme, night), [theme, night]);
  const zc = (WINDOW.z0 + WINDOW.z1) / 2;
  const yc = (WINDOW.y0 + WINDOW.y1) / 2;
  const wz = WINDOW.z1 - WINDOW.z0;
  const hy = WINDOW.y1 - WINDOW.y0;
  const fx = ROOM.minX - WALL_T / 2;
  const slats = Array.from({ length: 11 }, (_, i) => WINDOW.y1 - 0.05 - i * 0.048);

  return (
    <group>
      {/* Exterior view */}
      <mesh position={[fx - 0.02, yc, zc]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[wz, hy]} />
        <meshBasicMaterial map={sky} toneMapped={false} />
      </mesh>
      {/* Glazing tint/reflection */}
      <mesh position={[fx + 0.01, yc, zc]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[wz, hy]} />
        <meshPhysicalMaterial
          color="#dbeafe"
          transparent
          opacity={0.12}
          roughness={0.05}
          metalness={0}
          clearcoat={1}
          envMapIntensity={1.2}
          depthWrite={false}
        />
      </mesh>
      {/* Frame + mullion */}
      <Slab args={[0.15, 0.05, wz + 0.1]} position={[fx, WINDOW.y1 + 0.025, zc]} color={theme.frame} roughness={0.4} />
      <Slab args={[0.15, 0.05, wz + 0.1]} position={[fx, WINDOW.y0 - 0.025, zc]} color={theme.frame} roughness={0.4} />
      <Slab args={[0.15, hy, 0.05]} position={[fx, yc, WINDOW.z0 - 0.025]} color={theme.frame} roughness={0.4} />
      <Slab args={[0.15, hy, 0.05]} position={[fx, yc, WINDOW.z1 + 0.025]} color={theme.frame} roughness={0.4} />
      <Slab args={[0.06, hy, 0.035]} position={[fx, yc, zc]} color={theme.frame} roughness={0.4} />
      {/* Interior sill */}
      <Slab args={[0.24, 0.035, wz + 0.2]} position={[ROOM.minX + 0.07, WINDOW.y0 - 0.02, zc]} color={theme.frame} roughness={0.35} />

      {/* Half-lowered, tilted horizontal blinds (cast striped sun shadows) */}
      <group position={[ROOM.minX + 0.07, 0, zc]}>
        <Slab args={[0.06, 0.04, wz - 0.02]} position={[0, WINDOW.y1 - 0.01, 0]} color="#f1f5f9" roughness={0.5} />
        {slats.map((y, i) => (
          <mesh key={i} position={[0, y, 0]} rotation={[0, 0, 0.42]} castShadow>
            <boxGeometry args={[0.05, 0.003, wz - 0.04]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.55} />
          </mesh>
        ))}
        <Slab args={[0.055, 0.012, wz - 0.04]} position={[0, slats[slats.length - 1] - 0.03, 0]} color="#e2e8f0" roughness={0.5} />
        <mesh position={[0.02, (slats[slats.length - 1] + WINDOW.y0) / 2 + 0.1, wz / 2 - 0.12]}>
          <cylinderGeometry args={[0.003, 0.003, 0.55, 6]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
      </group>
    </group>
  );
}

function EntryDoor({ theme }) {
  const zc = (DOOR.z0 + DOOR.z1) / 2;
  const w = DOOR.z1 - DOOR.z0;
  const x = ROOM.minX;
  return (
    <group>
      {/* Casing */}
      <Slab args={[0.03, DOOR.h + 0.08, 0.07]} position={[x + 0.015, (DOOR.h + 0.08) / 2, DOOR.z0 - 0.035]} color={theme.frame} roughness={0.4} />
      <Slab args={[0.03, DOOR.h + 0.08, 0.07]} position={[x + 0.015, (DOOR.h + 0.08) / 2, DOOR.z1 + 0.035]} color={theme.frame} roughness={0.4} />
      <Slab args={[0.03, 0.08, w + 0.14]} position={[x + 0.015, DOOR.h + 0.04, zc]} color={theme.frame} roughness={0.4} />
      {/* Wood-veneer leaf with kick plate */}
      <Slab args={[0.045, DOOR.h, w]} position={[x + 0.0225, DOOR.h / 2, zc]} color={theme.door} roughness={0.55} />
      <Slab args={[0.05, 0.25, w - 0.04]} position={[x + 0.025, 0.14, zc]} color="#cbd5e1" roughness={0.3} metalness={0.7} />
      {/* Vision panel */}
      <mesh position={[x + 0.048, 1.45, zc - 0.18]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.16, 0.6]} />
        <meshPhysicalMaterial color="#bfdbfe" roughness={0.1} transparent opacity={0.55} />
      </mesh>
      {/* Lever handle */}
      <group position={[x + 0.07, 1.05, DOOR.z1 - 0.1]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.025, 0.025, 0.03, 16]} />
          <meshStandardMaterial {...ALUMINUM} />
        </mesh>
        <mesh position={[0.02, 0, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.009, 0.009, 0.13, 10]} />
          <meshStandardMaterial {...ALUMINUM} />
        </mesh>
      </group>
    </group>
  );
}

function AlarmDome({ monitorConnected }) {
  const matRef = useRef();
  useFrame(({ clock }) => {
    if (!matRef.current) return;
    const alarm =
      monitorConnected && (live.alarm || live.spo2 < 90 || live.rr <= 10);
    const on = Math.floor(clock.elapsedTime * 2.5) % 2 === 0;
    matRef.current.emissiveIntensity = alarm ? (on ? 5 : 0.5) : 0.06;
  });
  return (
    <group position={[0, 2.5, ROOM.minZ]}>
      <Slab args={[0.16, 0.04, 0.03]} position={[0, -0.05, 0.015]} color="#e2e8f0" roughness={0.4} cast={false} />
      <mesh position={[0, -0.03, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.055, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          ref={matRef}
          color="#fca5a5"
          emissive="#ef4444"
          emissiveIntensity={0.06}
          roughness={0.25}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function HeadwallConsole({ theme, night }) {
  const z = ROOM.minZ;
  const outlet = (x, color, key) => (
    <group key={key} position={[x, 1.5, z + 0.065]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.032, 0.032, 0.018, 24]} />
        <meshStandardMaterial color={color} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.004, 16]} />
        <meshStandardMaterial color="#1f2937" roughness={0.6} />
      </mesh>
    </group>
  );
  const socket = (x, key) => (
    <group key={key} position={[x, 1.5, z + 0.062]}>
      <RoundedBox args={[0.07, 0.1, 0.012]} radius={0.006}>
        <meshStandardMaterial color="#f8fafc" roughness={0.4} />
      </RoundedBox>
      {[-0.022, 0.022].map((dy) => (
        <mesh key={dy} position={[0, dy, 0.007]}>
          <boxGeometry args={[0.03, 0.022, 0.002]} />
          <meshStandardMaterial color="#cbd5e1" roughness={0.5} />
        </mesh>
      ))}
    </group>
  );

  return (
    <group>
      {/* Aluminum service rail */}
      <RoundedBox args={[2.4, 0.34, 0.055]} radius={0.015} position={[0, 1.5, z + 0.028]} castShadow receiveShadow>
        <meshStandardMaterial {...ALUMINUM} />
      </RoundedBox>
      {/* Indirect LED wash under the rail */}
      <mesh position={[0, 1.325, z + 0.05]}>
        <boxGeometry args={[2.3, 0.008, 0.008]} />
        <meshStandardMaterial
          color="#e0f2fe"
          emissive="#e0f2fe"
          emissiveIntensity={theme.led}
          toneMapped={false}
        />
      </mesh>
      {/* Medical gas outlets: O2 (green), medical air (yellow), vacuum (white) */}
      {outlet(-0.95, '#16a34a', 'o2a')}
      {outlet(-0.82, '#16a34a', 'o2b')}
      {outlet(-0.69, '#facc15', 'air')}
      {outlet(-0.56, '#f1f5f9', 'vac')}
      {/* Hospital-grade power */}
      {[0.5, 0.62, 0.74].map((x, i) => socket(x, `s${i}`))}
      {/* Nurse call */}
      <group position={[0.93, 1.5, z + 0.062]}>
        <RoundedBox args={[0.09, 0.09, 0.014]} radius={0.008}>
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </RoundedBox>
        <mesh position={[0, 0, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 0.01, 20]} />
          <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.4} />
        </mesh>
      </group>

      {/* Over-bed reading luminaire */}
      <group position={[0, 2.0, z + 0.05]}>
        <RoundedBox args={[0.9, 0.07, 0.1]} radius={0.02} castShadow>
          <meshStandardMaterial {...ALUMINUM} />
        </RoundedBox>
        <mesh position={[0, -0.036, 0.005]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.82, 0.07]} />
          <meshStandardMaterial
            color="#fff7ed"
            emissive="#ffe4c4"
            emissiveIntensity={night ? 2.4 : 0.9}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}

function WallClock() {
  const hourRef = useRef();
  const minRef = useRef();
  const secRef = useRef();
  useFrame(() => {
    const d = new Date();
    const s = d.getSeconds() + d.getMilliseconds() / 1000;
    const m = d.getMinutes() + s / 60;
    const h = (d.getHours() % 12) + m / 60;
    if (secRef.current) secRef.current.rotation.z = -(s / 60) * Math.PI * 2;
    if (minRef.current) minRef.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hourRef.current) hourRef.current.rotation.z = -(h / 12) * Math.PI * 2;
  });
  const hand = (ref, len, w, color, z) => (
    <group ref={ref} position={[0, 0, z]}>
      <mesh position={[0, len / 2 - 0.015, 0]}>
        <boxGeometry args={[w, len, 0.003]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
    </group>
  );
  return (
    <group position={[2.3, 2.32, ROOM.minZ + 0.02]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.17, 0.035, 48]} />
        <meshStandardMaterial color="#334155" roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.019]}>
        <circleGeometry args={[0.155, 48]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.6} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.132, Math.cos(a) * 0.132, 0.021]} rotation={[0, 0, -a]}>
            <boxGeometry args={[i % 3 === 0 ? 0.011 : 0.006, i % 3 === 0 ? 0.03 : 0.018, 0.002]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        );
      })}
      {hand(hourRef, 0.08, 0.012, '#0f172a', 0.023)}
      {hand(minRef, 0.12, 0.008, '#0f172a', 0.026)}
      {hand(secRef, 0.13, 0.003, '#dc2626', 0.029)}
      <mesh position={[0, 0, 0.031]}>
        <circleGeometry args={[0.009, 16]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
    </group>
  );
}

function CareWhiteboard() {
  // Abstract handwriting strokes (no text) + magnets
  const strokes = [
    [-0.36, 0.22, 0.32, '#1d4ed8'],
    [-0.38, 0.14, 0.24, '#0f172a'],
    [-0.36, 0.06, 0.3, '#0f172a'],
    [-0.38, -0.04, 0.2, '#15803d'],
    [-0.36, -0.12, 0.28, '#0f172a'],
    [0.12, 0.22, 0.3, '#b91c1c'],
    [0.1, 0.14, 0.22, '#0f172a'],
    [0.12, 0.06, 0.34, '#0f172a'],
    [0.1, -0.04, 0.18, '#1d4ed8'],
  ];
  return (
    <group position={[-2.25, 1.62, ROOM.minZ + 0.012]}>
      <RoundedBox args={[1.12, 0.76, 0.025]} radius={0.01} castShadow>
        <meshStandardMaterial {...ALUMINUM} />
      </RoundedBox>
      <mesh position={[0, 0, 0.014]}>
        <planeGeometry args={[1.06, 0.7]} />
        <meshPhysicalMaterial color="#ffffff" roughness={0.15} clearcoat={0.6} />
      </mesh>
      {/* Header band */}
      <mesh position={[0, 0.3, 0.015]}>
        <planeGeometry args={[1.06, 0.08]} />
        <meshStandardMaterial color="#0e7490" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.0, 0.015]}>
        <planeGeometry args={[0.004, 0.5]} />
        <meshStandardMaterial color="#94a3b8" />
      </mesh>
      {strokes.map(([x, y, w, c], i) => (
        <mesh key={i} position={[x + w / 2, y, 0.016]}>
          <planeGeometry args={[w, 0.012]} />
          <meshStandardMaterial color={c} roughness={0.6} />
        </mesh>
      ))}
      {[
        [0.42, 0.18, '#f43f5e'],
        [0.44, 0.02, '#f59e0b'],
        [-0.45, -0.24, '#10b981'],
      ].map(([x, y, c], i) => (
        <mesh key={i} position={[x, y, 0.022]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.018, 0.018, 0.012, 16]} />
          <meshStandardMaterial color={c} roughness={0.4} />
        </mesh>
      ))}
      {/* Marker tray */}
      <Slab args={[0.5, 0.025, 0.05]} position={[0.2, -0.39, 0.03]} color="#cbd5e1" roughness={0.4} metalness={0.5} />
    </group>
  );
}

function GloveAndSharpsStation() {
  const z = ROOM.minZ;
  return (
    <group position={[2.3, 0, z]}>
      {/* Triple glove box dispenser */}
      <RoundedBox args={[0.46, 0.3, 0.1]} radius={0.01} position={[0, 1.55, 0.05]} castShadow>
        <meshStandardMaterial color="#e2e8f0" roughness={0.35} metalness={0.3} />
      </RoundedBox>
      {['#93c5fd', '#c4b5fd', '#f1f5f9'].map((c, i) => (
        <group key={c} position={[-0.145 + i * 0.145, 1.55, 0.1]}>
          <mesh>
            <boxGeometry args={[0.13, 0.26, 0.012]} />
            <meshStandardMaterial color={c} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.05, 0.007]}>
            <boxGeometry args={[0.07, 0.03, 0.002]} />
            <meshStandardMaterial color="#e0f2fe" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {/* Sharps container on bracket */}
      <Slab args={[0.26, 0.05, 0.03]} position={[0, 1.24, 0.015]} color="#94a3b8" roughness={0.35} metalness={0.6} />
      <RoundedBox args={[0.22, 0.27, 0.13]} radius={0.015} position={[0, 1.08, 0.08]} castShadow>
        <meshStandardMaterial color="#dc2626" roughness={0.4} />
      </RoundedBox>
      <RoundedBox args={[0.23, 0.04, 0.14]} radius={0.01} position={[0, 1.23, 0.08]}>
        <meshStandardMaterial color="#fca5a5" roughness={0.35} />
      </RoundedBox>
    </group>
  );
}

function SanitizerDispenser() {
  return (
    <group position={[ROOM.minX + 0.055, 1.25, 2.88]} rotation={[0, Math.PI / 2, 0]}>
      <RoundedBox args={[0.12, 0.22, 0.09]} radius={0.02} castShadow>
        <meshStandardMaterial color="#f8fafc" roughness={0.3} />
      </RoundedBox>
      <RoundedBox args={[0.09, 0.05, 0.03]} radius={0.01} position={[0, -0.06, 0.05]}>
        <meshStandardMaterial color="#64748b" roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0.05, 0.046]}>
        <planeGeometry args={[0.06, 0.04]} />
        <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

function PrivacyCurtain({ theme }) {
  const trackY = 2.62;
  const length = 1.8;
  const meshH = 0.3;
  const fabricH = 1.75;
  const x = 2.75;
  const zc = ROOM.minZ + 0.06 + length / 2;

  const makeFolded = (h, segsY) => {
    const geo = new THREE.PlaneGeometry(length, h, 120, segsY);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const v = pos.getY(i);
      // Bunched pleats: deeper toward the stacked (wall) end, slight flare at the hem
      const bunch = 0.6 + 0.4 * (1 - (u + length / 2) / length);
      const flare = 1 + 0.25 * Math.max(0, -v / h);
      pos.setZ(i, Math.sin(u * Math.PI * 2 * 7.5) * 0.05 * bunch * flare);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const fabricGeo = useMemo(() => makeFolded(fabricH, 6), []);
  const meshGeo = useMemo(() => makeFolded(meshH, 1), []);

  return (
    <group>
      {/* Ceiling-hung track + drop rods */}
      <mesh position={[x, trackY + 0.02, zc + 0.15]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.012, length + 0.3, 10]} />
        <meshStandardMaterial {...ALUMINUM} />
      </mesh>
      {[zc - length / 2 + 0.05, zc + length / 2 + 0.25].map((z) => (
        <mesh key={z} position={[x, (trackY + ROOM.height) / 2 + 0.02, z]}>
          <cylinderGeometry args={[0.006, 0.006, ROOM.height - trackY, 8]} />
          <meshStandardMaterial {...ALUMINUM} />
        </mesh>
      ))}
      <group position={[x, 0, zc]} rotation={[0, Math.PI / 2, 0]}>
        {/* Breathable top mesh band */}
        <mesh geometry={meshGeo} position={[0, trackY - meshH / 2, 0]}>
          <meshStandardMaterial
            color="#f8fafc"
            transparent
            opacity={0.45}
            roughness={0.9}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Fabric panel */}
        <mesh geometry={fabricGeo} position={[0, trackY - meshH - fabricH / 2, 0]} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={theme.curtain}
            roughness={0.85}
            sheen={1}
            sheenRoughness={0.6}
            sheenColor="#f0f9ff"
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------- Lighting rig ---------------- */

export function RoomLighting({ darkMode = false }) {
  const sunTarget = useMemo(() => new THREE.Object3D(), []);
  const examTarget = useMemo(() => new THREE.Object3D(), []);
  const readTarget = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    sunTarget.position.set(-0.4, 0, 1.4);
    examTarget.position.set(0, 0.8, -0.15);
    readTarget.position.set(0, 0.95, -0.9);
    [sunTarget, examTarget, readTarget].forEach((o) => o.updateMatrixWorld());
  }, [sunTarget, examTarget, readTarget]);

  const night = darkMode;

  return (
    <>
      <primitive object={sunTarget} />
      <primitive object={examTarget} />
      <primitive object={readTarget} />

      {/* Sky / bounce fill */}
      <hemisphereLight
        args={[
          night ? '#6d8cc7' : '#f7fbff',
          night ? '#0a101c' : '#cdd5de',
          night ? 0.55 : 0.42,
        ]}
      />
      <ambientLight intensity={night ? 0.14 : 0.08} />

      {/* Daylight / moonlight through the window (blinds cast striped shadows) */}
      <directionalLight
        target={sunTarget}
        position={[-7.6, 4.3, 2.3]}
        color={night ? '#9db8ff' : '#fff1dc'}
        intensity={night ? 0.9 : 2.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={1}
        shadow-camera-far={20}
        shadow-camera-left={-5.5}
        shadow-camera-right={5.5}
        shadow-camera-top={5.5}
        shadow-camera-bottom={-5.5}
      />

      {/* Ceiling exam luminaire over the bed (soft key illumination) */}
      <spotLight
        target={examTarget}
        position={[0.35, 3.6, 0.6]}
        angle={0.78}
        penumbra={0.9}
        intensity={night ? 7 : 10}
        color={night ? '#dbe7ff' : '#ffffff'}
        decay={2}
      />

      {/* Over-bed warm reading light */}
      <spotLight
        target={readTarget}
        position={[0, 1.96, ROOM.minZ + 0.12]}
        angle={0.9}
        penumbra={1}
        intensity={night ? 5 : 1.2}
        color="#ffd8a6"
        decay={2}
      />

      {/* Corridor-side ceiling troffers (fill) */}
      <pointLight position={[-1.6, 2.8, 2.2]} intensity={night ? 2.2 : 2.4} color={night ? '#b4c4ec' : '#f8fafc'} decay={2} />
      <pointLight position={[1.9, 2.8, 2.0]} intensity={night ? 2.2 : 2.4} color={night ? '#b4c4ec' : '#f8fafc'} decay={2} />
    </>
  );
}

/* ---------------- Room shell ---------------- */

export default function HospitalRoom({ darkMode = false, monitorConnected = true, onFloorClick }) {
  const theme = darkMode ? THEMES.night : THEMES.day;
  const leftWallRef = useRef();
  const backWallRef = useRef();

  const roomW = ROOM.maxX - ROOM.minX;
  const roomD = ROOM.maxZ - ROOM.minZ;
  const floorTex = useMemo(
    () => makeVinylTexture(theme, roomW / 0.9, roomD / 0.9),
    [theme, roomW, roomD]
  );

  // Cutaway: hide a wall whenever the orbit camera swings behind it
  useFrame(({ camera }) => {
    if (leftWallRef.current) leftWallRef.current.visible = camera.position.x > ROOM.minX - 0.05;
    if (backWallRef.current) backWallRef.current.visible = camera.position.z > ROOM.minZ - 0.05;
  });

  const H = ROOM.height;
  const lx = ROOM.minX - WALL_T / 2;
  const segA = WINDOW.z0 - ROOM.minZ;
  const segB = ROOM.maxZ - WINDOW.z1;
  const winW = WINDOW.z1 - WINDOW.z0;

  return (
    <group>
      {/* Corridor / surrounding floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]} receiveShadow onClick={onFloorClick}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color={theme.outerFloor} roughness={0.9} />
      </mesh>

      {/* Polished sheet-vinyl room floor */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(ROOM.minX + ROOM.maxX) / 2, 0, (ROOM.minZ + ROOM.maxZ) / 2]}
        receiveShadow
        onClick={onFloorClick}
      >
        <planeGeometry args={[roomW, roomD]} />
        <meshPhysicalMaterial
          map={floorTex}
          color="#ffffff"
          roughness={0.38}
          clearcoat={0.35}
          clearcoatRoughness={0.25}
          envMapIntensity={0.7}
        />
      </mesh>

      {/* BACK (HEAD) WALL */}
      <group ref={backWallRef}>
        <Slab
          args={[roomW + WALL_T, H, WALL_T]}
          position={[(ROOM.minX - WALL_T + ROOM.maxX) / 2, H / 2, ROOM.minZ - WALL_T / 2]}
          color={theme.wall}
        />
        <WallTrim axis="x" from={ROOM.minX} to={ROOM.maxX} theme={theme} />
        <HeadwallConsole theme={theme} night={darkMode} />
        <AlarmDome monitorConnected={monitorConnected} />
        <WallClock />
        <CareWhiteboard />
        <GloveAndSharpsStation />
      </group>

      {/* LEFT (WINDOW / DOOR) WALL */}
      <group ref={leftWallRef}>
        <Slab args={[WALL_T, H, segA]} position={[lx, H / 2, ROOM.minZ + segA / 2]} color={theme.wall} />
        <Slab args={[WALL_T, WINDOW.y0, winW]} position={[lx, WINDOW.y0 / 2, WINDOW.z0 + winW / 2]} color={theme.wall} />
        <Slab
          args={[WALL_T, H - WINDOW.y1, winW]}
          position={[lx, (H + WINDOW.y1) / 2, WINDOW.z0 + winW / 2]}
          color={theme.wall}
        />
        <Slab args={[WALL_T, H, segB]} position={[lx, H / 2, WINDOW.z1 + segB / 2]} color={theme.wall} />
        <WallTrim axis="z" from={ROOM.minZ} to={DOOR.z0 - 0.08} theme={theme} />
        <WindowWithBlinds theme={theme} night={darkMode} />
        <EntryDoor theme={theme} />
        <SanitizerDispenser />
      </group>

      <PrivacyCurtain theme={theme} />
    </group>
  );
}
