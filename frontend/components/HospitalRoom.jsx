'use client';

/**
 * HospitalRoom.jsx — Grounded Med-Surg Patient Room Shell & Physically-Based Lighting Rig.
 *
 * Grounded in the architectural reference photograph:
 * - Warm sand/beige seamless speckled hospital sheet-vinyl floor + slate-grey entry threshold strip
 * - Creamy off-white perimeter walls with a recessed powder-blue accent headwall, projecting upper
 *   bulkhead soffit, and concealed warm-white linear cove wash light
 * - Dual horizontal ivory/off-white headwall utility raceways (upper power rail + lower clinical gas
 *   & nurse-call rail) with a mounted white wire-mesh supply basket
 * - One-way (downward-facing) 2x2 acoustic T-bar drop ceiling with flush 2x4 glowing LED troffer
 *   panels, recessed downlights, HVAC return grille & sprinkler (visible from inside, transparent from above)
 * - Dark-bronze framed picture window overlooking a twilight blue-hour mountain & city skyline, with
 *   ceiling troffer reflection on the glass
 * - Window-side family lounge: navy-blue sleeper sofa on light-oak plinth, round navy ottoman,
 *   cantilevered laptop table with silver laptop, corner floral vase, curved frosted wall sconce,
 *   and high-back navy clinical recliner with curved oak armrests
 * - Ceiling-tracked two-tone privacy curtain (white perforated mesh header + pleated slate-grey drape)
 */
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { live } from '../lib/liveVitals';
import { ROOM } from '../lib/roomBounds';

export { ROOM };
const WALL_T = 0.12;
const WINDOW = { z0: 0.55, z1: 2.55, y0: 0.88, y1: 2.32 };
const DOOR = { z0: 3.15, z1: 4.05, h: 2.15 };

const THEMES = {
  day: {
    floor: '#dccbb0',
    speck: ['#e7dac2', '#cfbda0', '#f1e6d2', '#c3af8e', '#d6c4a6'],
    seam: '#c8b494',
    outerFloor: '#cbbba0',
    threshold: '#707780',
    wall: '#f5efe4',
    soffit: '#f8f3ea',
    headwallAccent: '#b4c7de',
    headwallRail: '#f6f1e8',
    headwallTrim: '#dcd5c8',
    base: '#baa78a',
    frame: '#4c5057',
    door: '#cca97e',
    sky: ['#5b82ad', '#8cb0d6', '#bfd6ec'],
    hills: ['#294360', '#355475'],
    curtain: '#626c79',
    sofa: '#27344f',
    recliner: '#2a3854',
    oak: '#cfa97e',
    coveIntensity: 1.45,
    trofferIntensity: 2.2,
  },
  // Reference-photo mode: warm-lit hospital room interior with blue-hour twilight mountain/city window
  night: {
    floor: '#d4c2a2',
    speck: ['#e0d0b4', '#c6b291', '#eadcc4', '#b9a481', '#cdbba0'],
    seam: '#bfa987',
    outerFloor: '#b8a78c',
    threshold: '#686f78',
    wall: '#efe8da',
    soffit: '#f4eee2',
    headwallAccent: '#a9bdd6',
    headwallRail: '#f2ece1',
    headwallTrim: '#d5cebf',
    base: '#b29e80',
    frame: '#464a50',
    door: '#c4a075',
    sky: ['#355379', '#5c7fa6', '#88a7c9'],
    hills: ['#1b2e47', '#243c5a'],
    curtain: '#5a6470',
    sofa: '#243048',
    recliner: '#26344e',
    oak: '#c8a378',
    coveIntensity: 1.85,
    trofferIntensity: 2.45,
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

  // Warm mottled clouds matching seamless homogeneous hospital sheet vinyl
  for (let i = 0; i < 85; i++) {
    g.globalAlpha = 0.06;
    g.fillStyle = theme.speck[i % theme.speck.length];
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, 24 + rnd() * 68, 0, Math.PI * 2);
    g.fill();
  }
  // Fine vinyl granules
  for (let i = 0; i < 14000; i++) {
    g.globalAlpha = 0.18 + rnd() * 0.36;
    g.fillStyle = theme.speck[i % theme.speck.length];
    const r = 0.6 + rnd() * 1.7;
    g.fillRect(rnd() * size, rnd() * size, r, r);
  }
  // Subtle heat-welded sheet seam along one edge only (not harsh tiles)
  g.globalAlpha = 0.32;
  g.strokeStyle = theme.seam;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, 1);
  g.lineTo(size, 1);
  g.stroke();
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeSkyTexture(theme) {
  if (typeof document === 'undefined') return null;
  const w = 512;
  const h = 384;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');

  // Blue-hour twilight gradient from reference photo
  const grad = g.createLinearGradient(0, 0, 0, h * 0.72);
  grad.addColorStop(0, theme.sky[0]);
  grad.addColorStop(0.55, theme.sky[1]);
  grad.addColorStop(1, theme.sky[2]);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  // Soft dusk clouds
  const rnd = seededRandom(73);
  for (let i = 0; i < 18; i++) {
    const cx = rnd() * w;
    const cy = 30 + rnd() * (h * 0.35);
    const rx = 50 + rnd() * 90;
    const ry = 8 + rnd() * 16;
    const cg = g.createRadialGradient(cx, cy, 2, cx, cy, rx);
    cg.addColorStop(0, 'rgba(226, 236, 248, 0.22)');
    cg.addColorStop(1, 'rgba(226, 236, 248, 0)');
    g.fillStyle = cg;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Distant rolling hills / ridge silhouette (as seen through the window in the reference photo)
  g.fillStyle = theme.hills[1];
  g.beginPath();
  g.moveTo(0, h);
  g.lineTo(0, h * 0.56);
  for (let x = 0; x <= w; x += 32) {
    const y = h * 0.55 + Math.sin(x * 0.015) * 14 + Math.cos(x * 0.038) * 8;
    g.lineTo(x, y);
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();

  // Foreground wooded hillside + valley campus buildings
  g.fillStyle = theme.hills[0];
  g.beginPath();
  g.moveTo(0, h);
  g.lineTo(0, h * 0.64);
  for (let x = 0; x <= w; x += 24) {
    const y = h * 0.63 + Math.cos(x * 0.018 + 1.2) * 12 + Math.sin(x * 0.05) * 6;
    g.lineTo(x, y);
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();

  // Mid-ground hospital/university low-rise buildings with twilight window rows
  const buildings = [
    { x: 90, y: h * 0.66, bw: 135, bh: 38 },
    { x: 245, y: h * 0.68, bw: 95, bh: 32 },
    { x: 35, y: h * 0.72, bw: 70, bh: 28 },
    { x: 360, y: h * 0.65, bw: 110, bh: 42 },
  ];
  for (const b of buildings) {
    g.fillStyle = '#243b58';
    g.fillRect(b.x, b.y, b.bw, b.bh);
    g.fillStyle = '#334e70';
    g.fillRect(b.x, b.y, b.bw, 3);
    for (let wy = b.y + 6; wy < b.y + b.bh - 5; wy += 6) {
      for (let wx = b.x + 5; wx < b.x + b.bw - 6; wx += 7) {
        if (rnd() > 0.35) {
          g.fillStyle = rnd() > 0.3 ? '#dbeafe' : '#fde68a';
          g.globalAlpha = 0.45 + rnd() * 0.45;
          g.fillRect(wx, wy, 4, 2.5);
        }
      }
    }
    g.globalAlpha = 1;
  }

  // Scattered distant warm/cool twilight street & hillside lights
  for (let i = 0; i < 95; i++) {
    const lx = rnd() * w;
    const ly = h * 0.58 + rnd() * (h * 0.36);
    g.fillStyle = rnd() > 0.45 ? '#fef3c7' : '#bae6fd';
    g.globalAlpha = 0.35 + rnd() * 0.55;
    g.fillRect(lx, ly, 2.2, 2.2);
  }
  g.globalAlpha = 1;

  // Subtle reflection of the interior ceiling LED troffer in the upper-left window glass
  g.fillStyle = 'rgba(255, 253, 245, 0.42)';
  g.beginPath();
  g.moveTo(28, 52);
  g.lineTo(96, 48);
  g.lineTo(108, 60);
  g.lineTo(38, 64);
  g.closePath();
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCeilingGridTexture() {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');

  // Fine fissured acoustic tile surface
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, size, size);
  const rnd = seededRandom(901);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = 'rgba(160,152,138,0.16)';
    g.fillRect(rnd() * size, rnd() * size, 1.5, 1.5);
  }

  // Crisp white/metallic T-bar grid perimeter
  g.strokeStyle = '#d5d0c5';
  g.lineWidth = 6;
  g.strokeRect(0, 0, size, size);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.strokeRect(3, 3, size - 6, size - 6);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCurtainMeshTexture() {
  if (typeof document === 'undefined') return null;
  const w = 128;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);

  // Top & bottom reinforced twill tape bands
  g.fillStyle = 'rgba(242, 238, 228, 0.95)';
  g.fillRect(0, 0, w, 14);
  g.fillRect(0, h - 14, w, 14);

  // Open vertical hospital mesh weave
  g.fillStyle = 'rgba(238, 234, 224, 0.78)';
  for (let x = 0; x < w; x += 6) {
    g.fillRect(x, 14, 2.5, h - 28);
  }
  for (let y = 18; y < h - 14; y += 10) {
    g.fillRect(0, y, w, 1.8);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- Small building blocks ---------------- */

function Slab({ args, position, rotation, color, roughness = 0.88, metalness = 0, cast = false }) {
  return (
    <mesh position={position} rotation={rotation} castShadow={cast} receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

/** Coved vinyl baseboard along one wall run (matches reference photo's clean coved base). */
function CovedBaseboard({ axis, from, to, theme }) {
  const len = to - from;
  const mid = (from + to) / 2;
  return axis === 'x' ? (
    <Slab
      args={[len, 0.11, 0.018]}
      position={[mid, 0.055, ROOM.minZ + 0.009]}
      color={theme.base}
      roughness={0.55}
      cast={false}
    />
  ) : (
    <Slab
      args={[0.018, 0.11, len]}
      position={[ROOM.minX + 0.009, 0.055, mid]}
      color={theme.base}
      roughness={0.55}
      cast={false}
    />
  );
}

/* ---------------- Architectural Headwall & Ceiling ---------------- */

function HeadwallConsole({ theme, night }) {
  const z = ROOM.minZ;

  const gasOutlet = (x, y, color, labelColor, key) => (
    <group key={key} position={[x, y, z + 0.088]}>
      <RoundedBox args={[0.052, 0.068, 0.016]} radius={0.006}>
        <meshStandardMaterial color={color} roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, -0.004, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.013, 0.013, 0.01, 16]} />
        <meshStandardMaterial color={labelColor} roughness={0.4} metalness={0.3} />
      </mesh>
    </group>
  );

  const duplexSocket = (x, y, isEmergency, key) => (
    <group key={key} position={[x, y, z + 0.078]}>
      <RoundedBox args={[0.054, 0.082, 0.01]} radius={0.004}>
        <meshStandardMaterial color={isEmergency ? '#dc2626' : '#f8fafc'} roughness={0.38} />
      </RoundedBox>
      {[-0.018, 0.018].map((dy) => (
        <mesh key={dy} position={[0, dy, 0.006]}>
          <boxGeometry args={[0.026, 0.018, 0.002]} />
          <meshStandardMaterial color={isEmergency ? '#991b1b' : '#cbd5e1'} roughness={0.5} />
        </mesh>
      ))}
    </group>
  );

  return (
    <group>
      {/* RECESSED POWDER-BLUE ACCENT HEADWALL PANEL (matches reference photo) */}
      <mesh position={[0.1, 1.28, z + 0.015]} receiveShadow>
        <planeGeometry args={[3.35, 2.36]} />
        <meshStandardMaterial
          color={theme.headwallAccent}
          roughness={0.85}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* Left vertical wing wall framing the recessed headwall niche */}
      <Slab
        args={[0.14, ROOM.height, 0.26]}
        position={[-1.62, ROOM.height / 2, z + 0.13]}
        color={theme.wall}
        roughness={0.88}
      />

      {/* PROJECTING UPPER BULKHEAD SOFFIT above the powder-blue headwall */}
      <Slab
        args={[4.85, 0.44, 0.28]}
        position={[0.75, ROOM.height - 0.22, z + 0.14]}
        color={theme.soffit}
        roughness={0.85}
      />

      {/* CONCEALED WARM-WHITE LINEAR COVE WASH LIGHT tucked under the bulkhead soffit */}
      <mesh position={[0.1, ROOM.height - 0.445, z + 0.18]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.2, 0.09]} />
        <meshStandardMaterial
          color="#fffbeb"
          emissive="#fef3c7"
          emissiveIntensity={theme.coveIntensity}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* UPPER HORIZONTAL IVORY RACEWAY RAIL (y = 2.02m, matches upper rail in reference photo) */}
      <group position={[0.1, 2.02, z + 0.036]}>
        <RoundedBox args={[2.85, 0.18, 0.068]} radius={0.012} castShadow receiveShadow>
          <meshStandardMaterial color={theme.headwallRail} roughness={0.45} />
        </RoundedBox>
        <Slab
          args={[2.83, 0.018, 0.072]}
          position={[0, 0.075, 0]}
          color={theme.headwallTrim}
          roughness={0.5}
          cast={false}
        />
        <Slab
          args={[2.83, 0.018, 0.072]}
          position={[0, -0.075, 0]}
          color={theme.headwallTrim}
          roughness={0.5}
          cast={false}
        />
      </group>
      {/* Emergency red & normal white outlets along upper raceway */}
      {duplexSocket(-0.62, 2.02, true, 'up_em1')}
      {duplexSocket(-0.54, 2.02, true, 'up_em2')}
      {duplexSocket(-0.38, 2.02, false, 'up_w1')}
      {duplexSocket(0.55, 2.02, false, 'up_w2')}
      {duplexSocket(0.85, 2.02, true, 'up_em3')}

      {/* LOWER HORIZONTAL CLINICAL HEADWALL CONSOLE RAIL (y = 1.46m, matches lower rail in reference photo) */}
      <group position={[0.1, 1.46, z + 0.042]}>
        <RoundedBox args={[2.85, 0.25, 0.082]} radius={0.014} castShadow receiveShadow>
          <meshStandardMaterial color={theme.headwallRail} roughness={0.42} />
        </RoundedBox>
        <Slab
          args={[2.83, 0.02, 0.086]}
          position={[0, 0.108, 0]}
          color={theme.headwallTrim}
          roughness={0.5}
          cast={false}
        />
        <Slab
          args={[2.83, 0.02, 0.086]}
          position={[0, -0.108, 0]}
          color={theme.headwallTrim}
          roughness={0.5}
          cast={false}
        />
        {/* Lower utility chase under the left side of the console */}
        <RoundedBox args={[0.92, 0.14, 0.055]} radius={0.01} position={[-0.78, -0.19, -0.01]}>
          <meshStandardMaterial color={theme.headwallRail} roughness={0.48} />
        </RoundedBox>
      </group>

      {/* Subtle warm indirect wash under the lower headwall rail */}
      <mesh position={[0.1, 1.32, z + 0.06]}>
        <boxGeometry args={[2.6, 0.008, 0.008]} />
        <meshStandardMaterial
          color="#fff7ed"
          emissive="#fde68a"
          emissiveIntensity={night ? 1.4 : 0.55}
          toneMapped={false}
        />
      </mesh>

      {/* WHITE WIRE-MESH GLOVE / SUPPLY BASKET mounted above the lower rail (from reference photo) */}
      <group position={[-0.72, 1.71, z + 0.08]}>
        <RoundedBox args={[0.48, 0.11, 0.12]} radius={0.012}>
          <meshStandardMaterial color="#f8fafc" roughness={0.35} wireframe />
        </RoundedBox>
        <Slab args={[0.48, 0.012, 0.12]} position={[0, -0.052, 0]} color="#f1f5f9" roughness={0.35} cast={false} />
        {/* Vertical support brackets down to the lower rail */}
        <Slab args={[0.016, 0.14, 0.016]} position={[-0.16, -0.09, -0.04]} color="#e2e8f0" roughness={0.4} cast={false} />
        <Slab args={[0.016, 0.14, 0.016]} position={[0.16, -0.09, -0.04]} color="#e2e8f0" roughness={0.4} cast={false} />
      </group>

      {/* Medical gas outlets & sockets along the lower rail */}
      {gasOutlet(-0.98, 1.46, '#16a34a', '#bbf7d0', 'o2a')}
      {gasOutlet(-0.84, 1.46, '#facc15', '#fef08a', 'air')}
      {gasOutlet(-0.7, 1.46, '#f8fafc', '#475569', 'vac')}
      {duplexSocket(-0.52, 1.46, true, 'lo_em1')}
      {duplexSocket(-0.43, 1.46, true, 'lo_em2')}
      {duplexSocket(0.48, 1.46, false, 'lo_w1')}
      {duplexSocket(0.68, 1.46, false, 'lo_w2')}

      {/* Nurse call station on the lower rail */}
      <group position={[0.92, 1.46, z + 0.082]}>
        <RoundedBox args={[0.09, 0.095, 0.014]} radius={0.008}>
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </RoundedBox>
        <mesh position={[0, 0.01, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.008, 20]} />
          <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.45} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Suspended 2x2 Acoustic Tile Ceiling + Glowing 2x4 Flush LED Troffer Panels.
 * Uses `side={THREE.FrontSide}` facing downward (-Y) so eye-level / 3rd-person cameras see
 * the realistic ceiling and glowing light troffers, while high-angle orbit cameras look
 * straight through from above without obstruction.
 */
function AcousticCeiling({ theme, night }) {
  const gridTex = useMemo(() => makeCeilingGridTexture(night), [night]);
  const roomW = ROOM.maxX - ROOM.minX;
  const roomD = ROOM.maxZ - ROOM.minZ;
  const cx = (ROOM.minX + ROOM.maxX) / 2;
  const cz = (ROOM.minZ + ROOM.maxZ) / 2;
  const y = ROOM.height;

  return (
    <group>
      {/* Acoustic tile grid plane (faces -Y only) */}
      <mesh position={[cx, y, cz]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[roomW, roomD]} />
        <meshStandardMaterial
          map={gridTex}
          roughness={0.92}
          metalness={0}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Main 2x4 ft Recessed LED Troffer directly over the bed (prominent in reference photo) */}
      {[
        [0.05, 0.15, 1.22, 0.62],
        [-1.35, 1.85, 1.22, 0.62],
      ].map(([tx, tz, w, d], idx) => (
        <group key={idx} position={[tx, y - 0.008, tz]}>
          {/* White bezel frame */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w + 0.08, d + 0.08]} />
            <meshStandardMaterial
              color="#e5e0d5"
              roughness={0.5}
              side={THREE.FrontSide}
              polygonOffset
              polygonOffsetFactor={-1}
            />
          </mesh>
          {/* Glowing acrylic diffuser */}
          <mesh position={[0, -0.006, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w, d]} />
            <meshStandardMaterial
              color="#fffdf9"
              emissive="#fff8e7"
              emissiveIntensity={theme.trofferIntensity}
              toneMapped={false}
              side={THREE.FrontSide}
              polygonOffset
              polygonOffsetFactor={-2}
            />
          </mesh>
        </group>
      ))}

      {/* Recessed circular downlights + fire sprinkler dome */}
      {[
        [-0.95, -0.55],
        [1.45, -0.55],
        [1.45, 1.85],
      ].map(([dx, dz], i) => (
        <mesh key={i} position={[dx, y - 0.005, dz]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.075, 20]} />
          <meshStandardMaterial
            color="#fffbeb"
            emissive="#fde68a"
            emissiveIntensity={1.2}
            toneMapped={false}
            side={THREE.FrontSide}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------- Picture Window & Window-Side Lounge (from Reference Photo) ---------------- */

function PictureWindow({ theme }) {
  const sky = useMemo(() => makeSkyTexture(theme), [theme]);
  const zc = (WINDOW.z0 + WINDOW.z1) / 2;
  const yc = (WINDOW.y0 + WINDOW.y1) / 2;
  const wz = WINDOW.z1 - WINDOW.z0;
  const hy = WINDOW.y1 - WINDOW.y0;
  const fx = ROOM.minX - WALL_T / 2;
  const transomY = WINDOW.y0 + 0.28;

  return (
    <group>
      {/* Twilight exterior mountain & city view */}
      <mesh position={[fx - 0.02, yc, zc]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[wz, hy]} />
        <meshBasicMaterial map={sky} toneMapped={false} />
      </mesh>
      {/* Architectural insulated glazing reflection */}
      <mesh position={[fx + 0.012, yc, zc]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[wz, hy]} />
        <meshStandardMaterial
          color="#bfdbfe"
          transparent
          opacity={0.14}
          roughness={0.08}
          metalness={0.1}
          envMapIntensity={1.2}
          depthWrite={false}
        />
      </mesh>
      {/* Dark bronze/charcoal anodized aluminum perimeter frame (matches reference photo) */}
      <Slab args={[0.14, 0.055, wz + 0.1]} position={[fx, WINDOW.y1 + 0.025, zc]} color={theme.frame} roughness={0.38} metalness={0.45} />
      <Slab args={[0.14, 0.055, wz + 0.1]} position={[fx, WINDOW.y0 - 0.025, zc]} color={theme.frame} roughness={0.38} metalness={0.45} />
      <Slab args={[0.14, hy, 0.055]} position={[fx, yc, WINDOW.z0 - 0.025]} color={theme.frame} roughness={0.38} metalness={0.45} />
      <Slab args={[0.14, hy, 0.055]} position={[fx, yc, WINDOW.z1 + 0.025]} color={theme.frame} roughness={0.38} metalness={0.45} />
      {/* Horizontal lower transom bar + vertical mullion on lower hopper pane */}
      <Slab args={[0.08, 0.042, wz]} position={[fx + 0.01, transomY, zc]} color={theme.frame} roughness={0.38} metalness={0.45} />
      <Slab
        args={[0.07, transomY - WINDOW.y0, 0.04]}
        position={[fx + 0.01, (transomY + WINDOW.y0) / 2, zc + 0.25]}
        color={theme.frame}
        roughness={0.38}
        metalness={0.45}
      />
      {/* Deep interior window sill */}
      <Slab
        args={[0.2, 0.032, wz + 0.16]}
        position={[ROOM.minX + 0.05, WINDOW.y0 - 0.02, zc]}
        color={theme.soffit}
        roughness={0.45}
      />
    </group>
  );
}

/**
 * Window-Side Family Lounge & Corner Clinical Seating from the reference photograph:
 * 1. Navy-blue upholstered sleeper sofa on a warm light-oak plinth base under the window
 * 2. Round navy-blue upholstered ottoman tucked in front of the sofa
 * 3. Cantilevered brushed-steel laptop over-table with a silver laptop
 * 4. Corner side table with a glass vase of crimson/rose flowers & green foliage
 * 5. Curved half-cylinder frosted warm wall sconce on the left wall
 * 6. High-back navy-blue clinical recliner chair with curved oak armrests in the corner
 */
function WindowSideLounge({ theme, night }) {
  const sofaZ = 1.58;
  const sofaX = ROOM.minX + 0.38;

  return (
    <group>
      {/* 1. NAVY SLEEPER SOFA ON LIGHT-OAK WOOD PLINTH (under the window) */}
      <group position={[sofaX, 0, sofaZ]}>
        {/* Brushed metal legs */}
        {[
          [-0.24, -0.82],
          [0.24, -0.82],
          [-0.24, 0.82],
          [0.24, 0.82],
        ].map(([lx, lz], i) => (
          <mesh key={i} position={[lx, 0.07, lz]} castShadow>
            <cylinderGeometry args={[0.016, 0.016, 0.14, 12]} />
            <meshStandardMaterial {...ALUMINUM} />
          </mesh>
        ))}
        {/* Warm light-oak wood plinth base */}
        <RoundedBox args={[0.64, 0.06, 1.82]} radius={0.012} position={[0, 0.16, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={theme.oak} roughness={0.48} />
        </RoundedBox>
        {/* Navy seat cushion */}
        <RoundedBox args={[0.6, 0.18, 1.62]} radius={0.04} position={[0.02, 0.28, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={theme.sofa} roughness={0.78} />
        </RoundedBox>
        {/* Navy backrest cushions (2-panel split) */}
        {[-0.4, 0.4].map((bz, i) => (
          <RoundedBox
            key={i}
            args={[0.16, 0.42, 0.79]}
            radius={0.035}
            position={[-0.22, 0.56, bz]}
            rotation={[0, 0, -0.08]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={theme.sofa} roughness={0.78} />
          </RoundedBox>
        ))}
        {/* Navy armrests */}
        {[-0.85, 0.85].map((az, i) => (
          <RoundedBox key={i} args={[0.62, 0.34, 0.11]} radius={0.03} position={[0, 0.36, az]} castShadow receiveShadow>
            <meshStandardMaterial color={theme.sofa} roughness={0.76} />
          </RoundedBox>
        ))}
      </group>

      {/* 2. ROUND NAVY OTTOMAN WITH LIGHT-OAK BASE RING */}
      <group position={[sofaX + 0.36, 0, sofaZ + 0.42]}>
        <mesh position={[0, 0.035, 0]} castShadow>
          <cylinderGeometry args={[0.23, 0.23, 0.05, 24]} />
          <meshStandardMaterial color={theme.oak} roughness={0.48} />
        </mesh>
        <mesh position={[0, 0.19, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.24, 0.235, 0.27, 28]} />
          <meshStandardMaterial color={theme.sofa} roughness={0.76} />
        </mesh>
      </group>

      {/* 3. CANTILEVERED LAPTOP SIDE TABLE + OPEN SILVER LAPTOP */}
      <group position={[sofaX + 0.32, 0, sofaZ + 0.68]}>
        <RoundedBox args={[0.32, 0.018, 0.26]} radius={0.006} position={[0, 0.01, 0]}>
          <meshStandardMaterial {...ALUMINUM} />
        </RoundedBox>
        <mesh position={[-0.1, 0.33, 0]} castShadow>
          <cylinderGeometry args={[0.016, 0.016, 0.64, 14]} />
          <meshStandardMaterial {...ALUMINUM} />
        </mesh>
        <RoundedBox args={[0.36, 0.02, 0.44]} radius={0.008} position={[0.02, 0.65, 0]} castShadow>
          <meshStandardMaterial color="#e2e8f0" roughness={0.35} />
        </RoundedBox>
        {/* Silver laptop on the table */}
        <group position={[0.03, 0.665, 0]} rotation={[0, 0.35, 0]}>
          <RoundedBox args={[0.22, 0.008, 0.3]} radius={0.003}>
            <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.6} />
          </RoundedBox>
          <RoundedBox
            args={[0.22, 0.19, 0.007]}
            radius={0.003}
            position={[-0.09, 0.09, 0]}
            rotation={[0, Math.PI / 2, 0.28]}
            castShadow
          >
            <meshStandardMaterial color="#d8dee9" roughness={0.28} metalness={0.65} />
          </RoundedBox>
        </group>
      </group>

      {/* 4. CORNER SIDE TABLE + VASE OF FLOWERS (between sofa and recliner, as in reference photo) */}
      <group position={[ROOM.minX + 0.34, 0, 0.42]}>
        <RoundedBox args={[0.38, 0.38, 0.38]} radius={0.015} position={[0, 0.19, 0]} castShadow>
          <meshStandardMaterial color={theme.oak} roughness={0.5} />
        </RoundedBox>
        {/* Clear glass vase */}
        <mesh position={[0, 0.47, 0]}>
          <cylinderGeometry args={[0.055, 0.042, 0.18, 16]} />
          <meshStandardMaterial
            color="#d1fae5"
            transparent
            opacity={0.52}
            roughness={0.12}
            metalness={0.05}
          />
        </mesh>
        {/* Bouquet of red/pink blossoms + green foliage */}
        {[
          [0, 0.61, 0, '#be123c', 0.045],
          [0.04, 0.59, 0.03, '#e11d48', 0.038],
          [-0.04, 0.6, -0.02, '#9f1239', 0.04],
          [0.02, 0.63, -0.035, '#f43f5e', 0.035],
          [-0.03, 0.58, 0.04, '#15803d', 0.042],
          [0.04, 0.57, -0.03, '#166534', 0.04],
        ].map(([bx, by, bz, col, r], i) => (
          <mesh key={i} position={[bx, by, bz]}>
            <sphereGeometry args={[r, 10, 8]} />
            <meshStandardMaterial color={col} roughness={0.75} />
          </mesh>
        ))}
      </group>

      {/* 5. CURVED HALF-CYLINDER FROSTED WALL SCONCE on the left wall (prominent in reference photo) */}
      <group position={[ROOM.minX + 0.015, 1.65, 0.18]} rotation={[0, Math.PI / 2, 0]}>
        <Slab args={[0.16, 0.3, 0.018]} position={[0, 0, 0]} color="#e2e8f0" roughness={0.4} cast={false} />
        <mesh position={[0, 0, 0.015]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.075, 0.075, 0.26, 20, 1, false, -Math.PI / 2, Math.PI]} />
          <meshStandardMaterial
            color="#fffbeb"
            emissive="#fde68a"
            emissiveIntensity={night ? 2.4 : 1.75}
            roughness={0.25}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* 6. HIGH-BACK NAVY CLINICAL RECLINER CHAIR WITH CURVED OAK ARMRESTS */}
      <group position={[-2.42, 0, -0.48]} rotation={[0, 0.38, 0]}>
        {/* Seat cushion */}
        <RoundedBox args={[0.58, 0.14, 0.56]} radius={0.03} position={[0, 0.42, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={theme.recliner} roughness={0.68} />
        </RoundedBox>
        {/* High-back contoured headrest & lumbar back */}
        <RoundedBox
          args={[0.56, 0.74, 0.13]}
          radius={0.035}
          position={[0, 0.82, -0.22]}
          rotation={[-0.12, 0, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={theme.recliner} roughness={0.68} />
        </RoundedBox>
        {/* Headrest pillow bolster */}
        <RoundedBox
          args={[0.52, 0.22, 0.06]}
          radius={0.025}
          position={[0, 1.04, -0.19]}
          rotation={[-0.12, 0, 0]}
          castShadow
        >
          <meshStandardMaterial color={theme.recliner} roughness={0.65} />
        </RoundedBox>
        {/* Curved light-oak wooden arm frames + legs */}
        {[-0.31, 0.31].map((ax, i) => (
          <group key={i} position={[ax, 0, 0]}>
            <RoundedBox args={[0.045, 0.055, 0.58]} radius={0.015} position={[0, 0.58, 0.02]} castShadow>
              <meshStandardMaterial color={theme.oak} roughness={0.45} />
            </RoundedBox>
            <RoundedBox args={[0.045, 0.58, 0.055]} radius={0.012} position={[0, 0.29, 0.26]} rotation={[0.08, 0, 0]} castShadow>
              <meshStandardMaterial color={theme.oak} roughness={0.45} />
            </RoundedBox>
            <RoundedBox args={[0.045, 0.58, 0.055]} radius={0.012} position={[0, 0.29, -0.24]} rotation={[-0.08, 0, 0]} castShadow>
              <meshStandardMaterial color={theme.oak} roughness={0.45} />
            </RoundedBox>
          </group>
        ))}
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
      <Slab args={[0.03, DOOR.h + 0.08, 0.07]} position={[x + 0.015, (DOOR.h + 0.08) / 2, DOOR.z0 - 0.035]} color={theme.soffit} roughness={0.45} />
      <Slab args={[0.03, DOOR.h + 0.08, 0.07]} position={[x + 0.015, (DOOR.h + 0.08) / 2, DOOR.z1 + 0.035]} color={theme.soffit} roughness={0.45} />
      <Slab args={[0.03, 0.08, w + 0.14]} position={[x + 0.015, DOOR.h + 0.04, zc]} color={theme.soffit} roughness={0.45} />
      {/* Warm wood-veneer door leaf with stainless kick plate */}
      <Slab args={[0.045, DOOR.h, w]} position={[x + 0.0225, DOOR.h / 2, zc]} color={theme.door} roughness={0.52} />
      <Slab args={[0.05, 0.25, w - 0.04]} position={[x + 0.025, 0.14, zc]} color="#cbd5e1" roughness={0.3} metalness={0.7} />
      {/* Vision panel */}
      <mesh position={[x + 0.048, 1.45, zc - 0.18]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.16, 0.6]} />
        <meshStandardMaterial color="#bfdbfe" roughness={0.14} transparent opacity={0.55} />
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
    <group position={[0.1, 2.34, ROOM.minZ + 0.01]}>
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
    <group position={[2.3, 2.18, ROOM.minZ + 0.02]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.035, 48]} />
        <meshStandardMaterial color="#334155" roughness={0.35} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.019]}>
        <circleGeometry args={[0.145, 48]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.6} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.122, Math.cos(a) * 0.122, 0.021]} rotation={[0, 0, -a]}>
            <boxGeometry args={[i % 3 === 0 ? 0.01 : 0.005, i % 3 === 0 ? 0.026 : 0.016, 0.002]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
        );
      })}
      {hand(hourRef, 0.075, 0.011, '#0f172a', 0.023)}
      {hand(minRef, 0.11, 0.007, '#0f172a', 0.026)}
      {hand(secRef, 0.12, 0.003, '#dc2626', 0.029)}
      <mesh position={[0, 0, 0.031]}>
        <circleGeometry args={[0.008, 16]} />
        <meshStandardMaterial color="#dc2626" />
      </mesh>
    </group>
  );
}

function CareWhiteboard() {
  const strokes = [
    [-0.32, 0.18, 0.28, '#1d4ed8'],
    [-0.34, 0.11, 0.22, '#0f172a'],
    [-0.32, 0.04, 0.26, '#0f172a'],
    [-0.34, -0.04, 0.18, '#15803d'],
    [0.1, 0.18, 0.26, '#b91c1c'],
    [0.08, 0.11, 0.2, '#0f172a'],
    [0.1, 0.04, 0.28, '#0f172a'],
  ];
  return (
    <group position={[-2.35, 1.65, ROOM.minZ + 0.015]}>
      <RoundedBox args={[0.96, 0.66, 0.022]} radius={0.01}>
        <meshStandardMaterial {...ALUMINUM} />
      </RoundedBox>
      <mesh position={[0, 0, 0.013]}>
        <planeGeometry args={[0.9, 0.6]} />
        <meshStandardMaterial color="#ffffff" roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.25, 0.014]}>
        <planeGeometry args={[0.9, 0.07]} />
        <meshStandardMaterial color="#2c5282" roughness={0.5} />
      </mesh>
      {strokes.map(([x, y, w, c], i) => (
        <mesh key={i} position={[x + w / 2, y, 0.015]}>
          <planeGeometry args={[w, 0.01]} />
          <meshStandardMaterial color={c} roughness={0.6} />
        </mesh>
      ))}
      <Slab args={[0.42, 0.022, 0.045]} position={[0.15, -0.34, 0.026]} color="#cbd5e1" roughness={0.4} metalness={0.5} />
    </group>
  );
}

function GloveAndSharpsStation() {
  const z = ROOM.minZ;
  return (
    <group position={[2.3, 0, z]}>
      <RoundedBox args={[0.44, 0.28, 0.095]} radius={0.01} position={[0, 1.55, 0.05]} castShadow>
        <meshStandardMaterial color="#e2e8f0" roughness={0.35} metalness={0.3} />
      </RoundedBox>
      {['#93c5fd', '#c4b5fd', '#f1f5f9'].map((c, i) => (
        <group key={c} position={[-0.14 + i * 0.14, 1.55, 0.098]}>
          <mesh>
            <boxGeometry args={[0.12, 0.24, 0.012]} />
            <meshStandardMaterial color={c} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.04, 0.007]}>
            <boxGeometry args={[0.065, 0.028, 0.002]} />
            <meshStandardMaterial color="#e0f2fe" roughness={0.9} />
          </mesh>
        </group>
      ))}
      <Slab args={[0.24, 0.045, 0.03]} position={[0, 1.24, 0.015]} color="#94a3b8" roughness={0.35} metalness={0.6} />
      <RoundedBox args={[0.21, 0.26, 0.12]} radius={0.015} position={[0, 1.08, 0.075]} castShadow>
        <meshStandardMaterial color="#dc2626" roughness={0.4} />
      </RoundedBox>
      <RoundedBox args={[0.22, 0.038, 0.13]} radius={0.01} position={[0, 1.22, 0.075]}>
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
  const trackY = ROOM.height - 0.03;
  const length = 1.75;
  const meshH = 0.38;
  const fabricH = 1.82;
  const x = 2.75;
  const zc = ROOM.minZ + 0.08 + length / 2;
  const meshTex = useMemo(() => makeCurtainMeshTexture(), []);

  const makeFolded = (h, segsY) => {
    const geo = new THREE.PlaneGeometry(length, h, 48, segsY);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const v = pos.getY(i);
      const bunch = 0.65 + 0.35 * (1 - (u + length / 2) / length);
      const flare = 1 + 0.22 * Math.max(0, -v / h);
      pos.setZ(i, Math.sin(u * Math.PI * 2 * 8.5) * 0.055 * bunch * flare);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const fabricGeo = useMemo(() => makeFolded(fabricH, 3), []);
  const meshGeo = useMemo(() => makeFolded(meshH, 1), []);

  return (
    <group>
      {/* Ceiling-mounted anodized aluminum curtain track */}
      <mesh position={[x, trackY, zc + 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.014, 0.014, length + 0.45, 12]} />
        <meshStandardMaterial {...ALUMINUM} />
      </mesh>
      <group position={[x, 0, zc]} rotation={[0, Math.PI / 2, 0]}>
        {/* Top white open-weave perforated mesh header (from reference photo) */}
        <mesh geometry={meshGeo} position={[0, trackY - meshH / 2 - 0.02, 0]}>
          <meshStandardMaterial
            map={meshTex}
            color="#f5f2eb"
            transparent
            opacity={0.82}
            roughness={0.88}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Deep pleated slate-grey/blue hospital curtain fabric */}
        <mesh geometry={fabricGeo} position={[0, trackY - meshH - fabricH / 2 - 0.02, 0]} receiveShadow>
          <meshStandardMaterial
            color={theme.curtain}
            roughness={0.84}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ---------------- Physically-Based Chiaroscuro Cinematic Lighting Rig ---------------- */

export function RoomLighting({ darkMode = false }) {
  const trofferTarget = useMemo(() => new THREE.Object3D(), []);
  const windowTarget = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    trofferTarget.position.set(0.05, 0.75, 0.05);
    windowTarget.position.set(0.4, 0.6, 0.6);
    trofferTarget.updateMatrixWorld();
    windowTarget.updateMatrixWorld();
  }, [trofferTarget, windowTarget]);

  const night = darkMode;

  return (
    <>
      <primitive object={trofferTarget} />
      <primitive object={windowTarget} />

      {/* Warm hospital ceiling + floor bounce fill */}
      <hemisphereLight
        args={[
          '#fff8eb',
          '#94826b',
          night ? 0.78 : 0.92,
        ]}
      />
      <ambientLight intensity={night ? 0.22 : 0.28} color="#fff1dc" />

      {/* Main overhead 2x4 LED troffer key light (single crisp 1024x1024 shadow map) */}
      <directionalLight
        target={trofferTarget}
        position={[0.65, 4.4, 1.35]}
        color="#ffefd6"
        intensity={night ? 2.65 : 2.85}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={1}
        shadow-camera-far={14}
        shadow-camera-left={-4.2}
        shadow-camera-right={4.2}
        shadow-camera-top={4.2}
        shadow-camera-bottom={-4.2}
      />

      {/* Cool twilight blue-hour directional fill entering through the left picture window */}
      <directionalLight
        target={windowTarget}
        position={[-4.2, 2.25, 1.55]}
        intensity={night ? 0.85 : 1.05}
        color="#60a5fa"
      />

      {/* Recessed headwall soffit warm amber cove wash */}
      <pointLight
        position={[0.1, 2.35, ROOM.minZ + 0.45]}
        intensity={night ? 3.8 : 3.2}
        distance={5.5}
        color="#fcd34d"
        decay={2}
      />
    </>
  );
}

/* ---------------- Room shell ---------------- */

export default function HospitalRoom({ darkMode = false, monitorConnected = true, onFloorClick }) {
  const theme = darkMode ? THEMES.night : THEMES.day;
  const leftWallRef = useRef();
  const backWallRef = useRef();
  const curtainRef = useRef();
  const ceilingRef = useRef();

  const roomW = ROOM.maxX - ROOM.minX;
  const roomD = ROOM.maxZ - ROOM.minZ;
  const floorTex = useMemo(
    () => makeVinylTexture(theme, roomW / 1.8, roomD / 1.8),
    [theme, roomW, roomD]
  );

  // 360° Free Orbit cutaway: runs AFTER OrbitControls updates camera.position so walls/curtain
  // hide cleanly with generous inner clearance before the near plane ever clips an exterior face.
  useFrame(({ camera }) => {
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    if (leftWallRef.current) leftWallRef.current.visible = cx > ROOM.minX + 0.30;
    if (backWallRef.current) backWallRef.current.visible = cz > ROOM.minZ + 0.35;
    if (curtainRef.current) curtainRef.current.visible = !(cx > 2.48 && cz < 0.45);
    if (ceilingRef.current) ceilingRef.current.visible = cy < ROOM.height - 0.12;
  });

  const H = ROOM.height;
  const lx = ROOM.minX - WALL_T / 2;
  const segA = WINDOW.z0 - ROOM.minZ;
  const segB = ROOM.maxZ - WINDOW.z1;
  const winW = WINDOW.z1 - WINDOW.z0;

  return (
    <group>
      {/* Surrounding floor plane (offset well below vinyl sheet to eliminate z-fighting) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]} receiveShadow raycast={() => {}}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color={theme.outerFloor} roughness={0.88} />
      </mesh>

      {/* Warm sand/beige homogeneous sheet-vinyl hospital floor (matches reference photo) */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(ROOM.minX + ROOM.maxX) / 2, 0, (ROOM.minZ + ROOM.maxZ) / 2]}
        receiveShadow
        raycast={() => {}}
      >
        <planeGeometry args={[roomW, roomD]} />
        <meshStandardMaterial
          map={floorTex}
          color="#ffffff"
          roughness={0.34}
          metalness={0.04}
          envMapIntensity={0.6}
        />
      </mesh>

      {/* Slate-grey entry threshold strip near doorway / privacy curtain */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[ROOM.minX + 0.65, 0.004, 3.45]}
        receiveShadow
        raycast={() => {}}
      >
        <planeGeometry args={[1.3, 1.35]} />
        <meshStandardMaterial
          color={theme.threshold}
          roughness={0.52}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* Suspended 2x2 acoustic ceiling grid + glowing 2x4 LED troffer panels */}
      <group ref={ceilingRef}>
        <AcousticCeiling theme={theme} night={darkMode} />
      </group>

      {/* BACK (HEAD) WALL */}
      <group ref={backWallRef}>
        <Slab
          args={[roomW + WALL_T, H, WALL_T]}
          position={[(ROOM.minX - WALL_T + ROOM.maxX) / 2, H / 2, ROOM.minZ - WALL_T / 2]}
          color={theme.wall}
        />
        <CovedBaseboard axis="x" from={ROOM.minX} to={ROOM.maxX} theme={theme} />
        <HeadwallConsole theme={theme} night={darkMode} />
        <AlarmDome monitorConnected={monitorConnected} />
        <WallClock />
        <CareWhiteboard />
        <GloveAndSharpsStation />
      </group>

      {/* LEFT (WINDOW / LOUNGE / DOOR) WALL */}
      <group ref={leftWallRef}>
        <Slab args={[WALL_T, H, segA]} position={[lx, H / 2, ROOM.minZ + segA / 2]} color={theme.wall} />
        <Slab args={[WALL_T, WINDOW.y0, winW]} position={[lx, WINDOW.y0 / 2, WINDOW.z0 + winW / 2]} color={theme.wall} />
        <Slab
          args={[WALL_T, H - WINDOW.y1, winW]}
          position={[lx, (H + WINDOW.y1) / 2, WINDOW.z0 + winW / 2]}
          color={theme.wall}
        />
        <Slab args={[WALL_T, H, segB]} position={[lx, H / 2, WINDOW.z1 + segB / 2]} color={theme.wall} />
        {/* Upper perimeter soffit return along window wall */}
        <Slab
          args={[0.22, 0.34, WINDOW.z1 - ROOM.minZ + 0.2]}
          position={[ROOM.minX + 0.11, H - 0.17, (ROOM.minZ + WINDOW.z1) / 2]}
          color={theme.soffit}
          roughness={0.85}
        />
        <CovedBaseboard axis="z" from={ROOM.minZ} to={DOOR.z0 - 0.08} theme={theme} />
        <PictureWindow theme={theme} />
        <WindowSideLounge theme={theme} night={darkMode} />
        <EntryDoor theme={theme} />
        <SanitizerDispenser />
      </group>

      <group ref={curtainRef}>
        <PrivacyCurtain theme={theme} />
      </group>
    </group>
  );
}
