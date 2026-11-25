'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RotateCw, ZoomIn, ZoomOut, ScanLine, CheckCircle2, X } from 'lucide-react';

/**
 * Renders the high-DPI thermal-printed hospital wristband label texture
 * modeled directly after clinical vinyl snap-closure wristbands (`media_1795620814934_f0ea56e1.jpg`).
 */
export function createThermalLabelTexture(patient) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 640;
  const ctx = canvas.getContext('2d');

  // Crisp matte white adhesive thermal-sticker background with subtle rounded border shadow
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle fine paper grain / thermal print micro-contrast
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.06)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  // Format patient fields cleanly from scenario_hypoxia.json
  const rawName = (patient?.name || 'John Doe').trim();
  const parts = rawName.split(/\s+/);
  const formattedName =
    parts.length >= 2
      ? `${parts[parts.length - 1].toUpperCase()}, ${parts.slice(0, -1).join(' ').toUpperCase()}`
      : rawName.toUpperCase();

  // Convert YYYY-MM-DD -> MM/DD/YYYY (clinical US wristband format matching reference image)
  const rawDob = patient?.dob || '1964-03-14';
  const dobMatch = rawDob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const formattedDob = dobMatch ? `${dobMatch[2]}/${dobMatch[3]}/${dobMatch[1]}` : rawDob;

  const rawMrn = (patient?.mrn || 'MRN-884920').replace(/^MRN[-:\s]*/i, '');
  const hospId = `${rawMrn}14`;
  const genderChar = (patient?.gender || 'Male').toUpperCase().startsWith('F') ? 'F' : 'M';

  ctx.fillStyle = '#111827';
  ctx.textBaseline = 'top';

  // Line 1: Bold Patient Name
  ctx.font = '800 70px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.fillText(`PATIENT NAME: ${formattedName}`, 84, 54);

  // Line 2: DOB | MRN
  ctx.font = '600 52px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.fillText(`DOB: ${formattedDob}  |  MRN: ${rawMrn}`, 84, 146);

  // Line 3: HOSPITAL ID | ADM DATE
  ctx.font = '600 50px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.fillText(`HOSPITAL ID: ${hospId}  |  ADM: 24 NOV 2026`, 84, 220);

  // Center: Deterministic Code-128 style 1D linear barcode
  const barTop = 300;
  const barHeight = 132;
  const barStartX = 560;
  let cursorX = barStartX;
  const seedStr = `${rawMrn}${hospId}DOEJOHN`;
  // Start guard
  const bars = [6, 3, 4, 4, 8, 3];
  for (let i = 0; i < seedStr.length; i++) {
    const code = seedStr.charCodeAt(i);
    bars.push(3 + (code % 4) * 2);
    bars.push(3 + ((code >> 2) % 3) * 2);
    bars.push(3 + ((code >> 4) % 4) * 2);
    bars.push(3 + ((code >> 1) % 3) * 2);
  }
  // Stop guard
  bars.push(7, 3, 4, 3, 6);

  ctx.fillStyle = '#090d16';
  for (let i = 0; i < bars.length; i++) {
    const w = bars[i] * 2.15;
    if (i % 2 === 0 && cursorX + w < 1490) {
      ctx.fillRect(cursorX, barTop, w, barHeight);
    }
    cursorX += w;
  }

  // Human-readable barcode digits centered under bars
  ctx.font = '600 38px "JetBrains Mono", "Consolas", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(hospId, (barStartX + Math.min(cursorX, 1490)) * 0.5, barTop + barHeight + 10);

  // Bottom Line: GENDER | RM | ALLERGIES
  ctx.textAlign = 'left';
  ctx.font = '600 50px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#111827';
  const prefix = `GENDER: ${genderChar}  |  RM: PACU-04  |  `;
  ctx.fillText(prefix, 84, 514);
  const prefixW = ctx.measureText(prefix).width;

  ctx.fillStyle = '#b91c1c';
  ctx.font = '800 50px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.fillText('ALLERGIES: PENICILLIN (SEVERE)', 84 + prefixW, 514);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Secondary embossed crimson allergy tag texture on the opposite side of the strap.
 */
export function createAllergyClaspTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#b91c1c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 36px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.fillText('ALLERGY ALERT', 256, 68);
  ctx.font = '700 28px "Inter", "Segoe UI", Arial, sans-serif';
  ctx.fillText('PENICILLIN · ANAPHYLAXIS', 256, 126);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds the bespoke 3D Hospital Vinyl Snap-Closure Wristband mesh group:
 *   - Elliptical medical vinyl band (`rx = 1.42, rz = 1.05`) with wide front label panel
 *     smoothly S-tapering into a narrower wrist strap around the clasp & back.
 *   - Curved raised adhesive thermal label mapped on the front arc.
 *   - Overlapping 3D snap-rivet clasp tab + hollow snap button on the right shoulder.
 *   - Crimson allergy alert band clip on the back-left strap.
 */
export function buildWristbandArtifactGroup(labelTex, allergyTex, opts = {}) {
  const includeLaser = opts.includeLaser !== false;
  const group = new THREE.Group();

  const RX = 1.42;
  const RZ = 1.04;
  const THICK = 0.036;

  // Height profile H(theta): theta = 0 is front center (+Z).
  // Front label panel spans roughly [-1.20, +1.05] rad -> full height 0.72, tapering smoothly to 0.38 strap height.
  function halfHeightAt(theta) {
    // Normalize angle to [-PI, +PI]
    let a = ((theta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    // Asymmetric S-taper matching reference image (clasp notch on right +1.18 rad, smooth taper on left -1.25 rad)
    const rightT = THREE.MathUtils.smoothstep(a, 0.92, 1.24);
    const leftT = 1 - THREE.MathUtils.smoothstep(a, -1.42, -1.02);
    const narrowFactor = Math.max(rightT, leftT);
    // Slight step-up tab shoulder right at the snap clasp (a ~ 1.28..1.42)
    return THREE.MathUtils.lerp(0.37, 0.195, narrowFactor);
  }

  // 1. Main Closed 3D Vinyl Band Ring (outer wall, inner wall, rounded top & bottom rims)
  const segU = 160;
  const segV = 10; // cross-section around the strap thickness (outer -> top edge -> inner -> bottom edge)
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    const theta = u * Math.PI * 2 - Math.PI; // -PI .. +PI, theta=0 at +Z front
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    const cx = RX * sinT;
    const cz = RZ * cosT;
    // Outward normal of ellipse (RX*sinT, RZ*cosT) -> (RZ*sinT, RX*cosT) normalized
    const nxRaw = RZ * sinT;
    const nzRaw = RX * cosT;
    const nLen = Math.hypot(nxRaw, nzRaw) || 1;
    const nx = nxRaw / nLen;
    const nz = nzRaw / nLen;

    const hh = halfHeightAt(theta);

    for (let iv = 0; iv <= segV; iv++) {
      const vAng = (iv / segV) * Math.PI * 2;
      // Superellipse cross-section for flat vinyl strap with softly beveled edges
      const sv = Math.sin(vAng);
      const cv = Math.cos(vAng);
      const yOff = Math.sign(sv) * Math.pow(Math.abs(sv), 0.55) * hh;
      const rOff = cv * (THICK * 0.5);

      positions.push(cx + nx * rOff, yOff, cz + nz * rOff);
      uvs.push(u, iv / segV);
    }
  }

  const stride = segV + 1;
  for (let iu = 0; iu < segU; iu++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = iu * stride + iv;
      const b = (iu + 1) * stride + iv;
      const c = (iu + 1) * stride + (iv + 1);
      const d = iu * stride + (iv + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const bandGeo = new THREE.BufferGeometry();
  bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bandGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  bandGeo.setIndex(indices);
  bandGeo.computeVertexNormals();

  const vinylMat = new THREE.MeshStandardMaterial({
    color: '#eef0f3',
    roughness: 0.42,
    metalness: 0.02,
  });
  const bandMesh = new THREE.Mesh(bandGeo, vinylMat);
  group.add(bandMesh);

  // 2. Curved Thermal-Printed Adhesive Sticker Panel on Front Arc (theta in [-0.80, +0.78])
  const stSegU = 72;
  const stSegV = 12;
  const stPos = [];
  const stUv = [];
  const stIdx = [];
  const thetaStart = -0.80;
  const thetaEnd = 0.78;
  const stickerHH = 0.325;

  for (let iu = 0; iu <= stSegU; iu++) {
    const u = iu / stSegU;
    const theta = THREE.MathUtils.lerp(thetaStart, thetaEnd, u);
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const cx = RX * sinT;
    const cz = RZ * cosT;
    const nxRaw = RZ * sinT;
    const nzRaw = RX * cosT;
    const nLen = Math.hypot(nxRaw, nzRaw) || 1;
    const nx = nxRaw / nLen;
    const nz = nzRaw / nLen;

    // Rounded corner vertical inset at left/right ends of the sticker
    const endDist = Math.min(u, 1 - u);
    const cornerCurve = endDist < 0.045 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - endDist / 0.045, 2))) : 1;

    for (let iv = 0; iv <= stSegV; iv++) {
      const v = iv / stSegV;
      const y = (v * 2 - 1) * stickerHH * (0.88 + 0.12 * cornerCurve);
      const lift = THICK * 0.5 + 0.0045;
      stPos.push(cx + nx * lift, y, cz + nz * lift);
      stUv.push(u, v);
    }
  }

  const stStride = stSegV + 1;
  for (let iu = 0; iu < stSegU; iu++) {
    for (let iv = 0; iv < stSegV; iv++) {
      const a = iu * stStride + iv;
      const b = (iu + 1) * stStride + iv;
      const c = (iu + 1) * stStride + (iv + 1);
      const d = iu * stStride + (iv + 1);
      stIdx.push(a, b, d, b, c, d);
    }
  }

  const stickerGeo = new THREE.BufferGeometry();
  stickerGeo.setAttribute('position', new THREE.Float32BufferAttribute(stPos, 3));
  stickerGeo.setAttribute('uv', new THREE.Float32BufferAttribute(stUv, 2));
  stickerGeo.setIndex(stIdx);
  stickerGeo.computeVertexNormals();

  const stickerMat = new THREE.MeshStandardMaterial({
    map: labelTex,
    roughness: 0.58,
    metalness: 0.0,
  });
  const stickerMesh = new THREE.Mesh(stickerGeo, stickerMat);
  group.add(stickerMesh);

  // 3. 3D Snap-Rivet Clasp Assembly on Right Side (`theta = +1.26 rad`, matching reference photo!)
  const claspTheta = 1.26;
  const claspGroup = new THREE.Group();
  const cSin = Math.sin(claspTheta);
  const cCos = Math.cos(claspTheta);
  const cNx = (RZ * cSin) / Math.hypot(RZ * cSin, RX * cCos);
  const cNz = (RX * cCos) / Math.hypot(RZ * cSin, RX * cCos);
  claspGroup.position.set(
    RX * cSin + cNx * (THICK * 0.72),
    0,
    RZ * cCos + cNz * (THICK * 0.72)
  );
  claspGroup.rotation.y = Math.atan2(cNx, cNz);

  // Overlapping vertical rounded snap tab
  const tabShape = new THREE.Shape();
  const tw = 0.16;
  const th = 0.29;
  const tr = 0.055;
  tabShape.moveTo(-tw + tr, -th);
  tabShape.lineTo(tw - tr, -th);
  tabShape.quadraticCurveTo(tw, -th, tw, -th + tr);
  tabShape.lineTo(tw, th - tr);
  tabShape.quadraticCurveTo(tw, th, tw - tr, th);
  tabShape.lineTo(-tw + tr, th);
  tabShape.quadraticCurveTo(-tw, th, -tw, th - tr);
  tabShape.lineTo(-tw, -th + tr);
  tabShape.quadraticCurveTo(-tw, -th, -tw + tr, -th);

  const tabGeo = new THREE.ExtrudeGeometry(tabShape, {
    depth: 0.028,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 3,
  });
  tabGeo.center();
  const claspMat = new THREE.MeshStandardMaterial({
    color: '#e6e9ee',
    roughness: 0.36,
    metalness: 0.03,
  });
  const tabMesh = new THREE.Mesh(tabGeo, claspMat);
  claspGroup.add(tabMesh);

  // Raised hollow plastic snap rivet eyelet in center of clasp tab
  const rivetRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.022, 14, 28),
    claspMat
  );
  rivetRing.position.z = 0.026;
  claspGroup.add(rivetRing);

  const rivetWell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.052, 0.024, 20),
    new THREE.MeshStandardMaterial({ color: '#cbd2dc', roughness: 0.55 })
  );
  rivetWell.rotation.x = Math.PI / 2;
  rivetWell.position.z = 0.016;
  claspGroup.add(rivetWell);

  group.add(claspGroup);

  // 4. Perforated Sizing Holes along Back Strap (`theta` from +1.65 to +2.65)
  const holeMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.7 });
  for (let i = 0; i < 6; i++) {
    const ht = 1.68 + i * 0.19;
    const hs = Math.sin(ht);
    const hc = Math.cos(ht);
    const hnx = (RZ * hs) / Math.hypot(RZ * hs, RX * hc);
    const hnz = (RX * hc) / Math.hypot(RZ * hs, RX * hc);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, THICK + 0.006, 14), holeMat);
    hole.position.set(RX * hs, 0, RZ * hc);
    hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(hnx, 0, hnz));
    group.add(hole);
  }

  // 5. Secondary Red Allergy Snap Clip on Back-Left Strap (`theta = -2.05 rad`)
  const alStart = -2.48;
  const alEnd = -1.62;
  const alPos = [];
  const alUv = [];
  const alIdx = [];
  const alSegU = 28;
  const alSegV = 6;
  for (let iu = 0; iu <= alSegU; iu++) {
    const u = iu / alSegU;
    const theta = THREE.MathUtils.lerp(alStart, alEnd, u);
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    const nx = (RZ * s) / Math.hypot(RZ * s, RX * c);
    const nz = (RX * c) / Math.hypot(RZ * s, RX * c);
    for (let iv = 0; iv <= alSegV; iv++) {
      const v = iv / alSegV;
      const y = (v * 2 - 1) * 0.215;
      const lift = THICK * 0.5 + 0.012;
      alPos.push(RX * s + nx * lift, y, RZ * c + nz * lift);
      alUv.push(u, v);
    }
  }
  for (let iu = 0; iu < alSegU; iu++) {
    for (let iv = 0; iv < alSegV; iv++) {
      const a = iu * (alSegV + 1) + iv;
      const b = (iu + 1) * (alSegV + 1) + iv;
      const c = (iu + 1) * (alSegV + 1) + (iv + 1);
      const d = iu * (alSegV + 1) + (iv + 1);
      alIdx.push(a, b, d, b, c, d);
    }
  }
  const alGeo = new THREE.BufferGeometry();
  alGeo.setAttribute('position', new THREE.Float32BufferAttribute(alPos, 3));
  alGeo.setAttribute('uv', new THREE.Float32BufferAttribute(alUv, 2));
  alGeo.setIndex(alIdx);
  alGeo.computeVertexNormals();

  const alMesh = new THREE.Mesh(
    alGeo,
    new THREE.MeshStandardMaterial({
      map: allergyTex,
      roughness: 0.42,
      metalness: 0.04,
    })
  );
  group.add(alMesh);

  // 6. Laser Scanner Beam Mesh (sweeps across barcode when user clicks Scan in inspector)
  let laserMesh = null;
  let laserMat = null;
  if (includeLaser) {
    const laserGeo = new THREE.PlaneGeometry(1.75, 0.025);
    laserMat = new THREE.MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    laserMesh = new THREE.Mesh(laserGeo, laserMat);
    laserMesh.position.set(0, 0, RZ + 0.06);
    group.add(laserMesh);
  }

  return { group, laserMesh, laserMat };
}

export default function WristbandArtifactInspector({
  patient,
  verifiedId = false,
  onVerifyId,
  onClose,
  isMobile = false,
}) {
  const mountRef = useRef(null);
  const [autoSpin, setAutoSpin] = useState(true);
  const [scanAnim, setScanAnim] = useState(false);

  const interactRef = useRef({
    dragging: false,
    lastX: 0,
    lastY: 0,
    rotY: -0.14,
    rotX: 0.16,
    velY: 0,
    velX: 0,
    zoom: 1.0,
    autoSpin: true,
    scanStart: -10,
  });

  useEffect(() => {
    interactRef.current.autoSpin = autoSpin;
  }, [autoSpin]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return undefined;

    const width = container.clientWidth || 480;
    const height = container.clientHeight || 340;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 35);
    const computeBaseDist = (aspect) => Math.max(4.85, 5.55 / Math.max(0.45, aspect));
    let baseDist = computeBaseDist(width / height);
    camera.position.set(0, 0.24, baseDist);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Crisp studio 3-point product lighting
    const hemi = new THREE.HemisphereLight('#ffffff', '#cbd5e1', 1.35);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#ffffff', 1.65);
    keyLight.position.set(2.4, 3.2, 4.0);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#bae6fd', 0.85);
    rimLight.position.set(-3.0, 1.4, -2.5);
    scene.add(rimLight);

    const bottomFill = new THREE.DirectionalLight('#e2e8f0', 0.45);
    bottomFill.position.set(0, -2.5, 2.0);
    scene.add(bottomFill);

    const labelTex = createThermalLabelTexture(patient);
    const allergyTex = createAllergyClaspTexture();
    const { group: bandGroup, laserMesh, laserMat } = buildWristbandArtifactGroup(labelTex, allergyTex);
    scene.add(bandGroup);

    // Soft elliptical pedestal shadow disc underneath the floating 3D wristband
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    const sctx = shadowCanvas.getContext('2d');
    const grad = sctx.createRadialGradient(128, 128, 12, 128, 128, 120);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.16)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 256, 256);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 2.5),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.68;
    scene.add(shadowPlane);

    const dom = renderer.domElement;
    dom.style.cursor = 'grab';
    dom.style.touchAction = 'none';

    const onPointerDown = (e) => {
      e.stopPropagation();
      const st = interactRef.current;
      st.dragging = true;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      st.velY = 0;
      st.velX = 0;
      dom.style.cursor = 'grabbing';
      dom.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
      const st = interactRef.current;
      if (!st.dragging) return;
      const dx = e.clientX - st.lastX;
      const dy = e.clientY - st.lastY;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      st.velY = dx * 0.011;
      st.velX = dy * 0.008;
      st.rotY += st.velY;
      st.rotX = THREE.MathUtils.clamp(st.rotX + st.velX, -0.85, 0.95);
    };

    const onPointerUp = (e) => {
      interactRef.current.dragging = false;
      dom.style.cursor = 'grab';
      dom.releasePointerCapture?.(e.pointerId);
    };

    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const st = interactRef.current;
      st.zoom = THREE.MathUtils.clamp(st.zoom + e.deltaY * 0.0012, 0.68, 1.55);
    };

    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointercancel', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 480;
      const h = container.clientHeight || 340;
      camera.aspect = w / h;
      baseDist = computeBaseDist(camera.aspect);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let rafId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const st = interactRef.current;

      if (!st.dragging) {
        // Smooth inertial glide + gentle auto-rotation when enabled
        st.rotY += st.velY;
        st.rotX = THREE.MathUtils.clamp(st.rotX + st.velX, -0.85, 0.95);
        st.velY *= 0.92;
        st.velX *= 0.90;
        if (st.autoSpin && Math.abs(st.velY) < 0.002) {
          st.rotY += dt * 0.34;
        }
      }

      // Subtle floating levitation on the artifact stage
      bandGroup.position.y = Math.sin(elapsed * 1.6) * 0.03;
      bandGroup.rotation.order = 'YXZ';
      bandGroup.rotation.y = st.rotY;
      bandGroup.rotation.x = st.rotX;

      camera.position.z = THREE.MathUtils.lerp(camera.position.z, baseDist * st.zoom, 0.14);

      // Laser barcode scan sweep animation
      if (st.scanTriggered) {
        st.scanStart = elapsed;
        st.scanTriggered = false;
      }
      const scanDt = elapsed - st.scanStart;
      if (scanDt >= 0 && scanDt < 0.85) {
        const u = scanDt / 0.85;
        laserMesh.position.y = Math.sin(u * Math.PI * 2) * 0.26;
        laserMat.opacity = Math.sin(u * Math.PI) * 0.92;
        // Smoothly face front barcode during scan
        st.rotY = THREE.MathUtils.lerp(st.rotY, 0, 0.16);
        st.rotX = THREE.MathUtils.lerp(st.rotX, 0.1, 0.16);
      } else {
        laserMat.opacity = 0;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      labelTex.dispose();
      allergyTex.dispose();
      shadowTex.dispose();
      scene.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material?.dispose();
        }
      });
      renderer.dispose();
    };
  }, [patient]);

  const triggerScanAndVerify = () => {
    // Normalize rotY into [-PI, PI] so lerp smoothly brings the front barcode label forward
    const st = interactRef.current;
    st.rotY = ((st.rotY + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    // Use performance.now-aligned clock trigger via a fresh flag
    setScanAnim(true);
    setTimeout(() => setScanAnim(false), 900);
    onVerifyId?.();
  };

  useEffect(() => {
    if (scanAnim) {
      // Trigger laser sweep inside animation loop
      // Note: clock.elapsedTime is approximated by setting scanStart on next frame sentinel
      interactRef.current.scanTriggered = true;
    }
  }, [scanAnim]);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: isMobile ? '12px' : '28px',
        right: isMobile ? '12px' : '484px',
        top: isMobile ? '64px' : '76px',
        bottom: isMobile ? 'auto' : '116px',
        height: isMobile ? '320px' : undefined,
        maxWidth: isMobile ? undefined : '720px',
        margin: isMobile ? undefined : '0 auto',
        zIndex: 31,
        borderRadius: '22px',
        background:
          'radial-gradient(circle at 50% 44%, rgba(28, 54, 43, 0.94) 0%, rgba(10, 19, 16, 0.96) 76%)',
        border: '1px solid #2a4136',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(111, 209, 169, 0.14)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Top Artifact Stage Header */}
      <div
        style={{
          padding: '11px 16px',
          borderBottom: '1px solid rgba(42, 65, 54, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span
            style={{
              padding: '3px 9px',
              borderRadius: '999px',
              background: 'rgba(111, 209, 169, 0.14)',
              border: '1px solid rgba(111, 209, 169, 0.4)',
              color: '#6fd1a9',
              fontSize: '10.5px',
              fontWeight: 800,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            3D Artifact
          </span>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: '#eaf2ee',
              whiteSpace: 'nowrap',
            }}
          >
            Patient ID Wristband
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setAutoSpin((s) => !s)}
            title="Toggle 360° auto-rotation"
            style={{
              height: '28px',
              padding: '0 10px',
              borderRadius: '999px',
              background: autoSpin ? '#143528' : '#11211a',
              border: autoSpin ? '1px solid #6fd1a9' : '1px solid #2a4136',
              color: autoSpin ? '#6fd1a9' : '#8ca69b',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <RotateCw size={12} /> {autoSpin ? 'Auto-spin' : 'Paused'}
          </button>

          <button
            type="button"
            onClick={() => {
              const st = interactRef.current;
              st.rotY = -0.12;
              st.rotX = 0.14;
              st.velX = 0;
              st.velY = 0;
              st.zoom = 1.0;
            }}
            title="Reset front label view"
            style={{
              height: '28px',
              padding: '0 10px',
              borderRadius: '999px',
              background: '#11211a',
              border: '1px solid #2a4136',
              color: '#afc6bc',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Front Label
          </button>

          <button
            type="button"
            onClick={() => {
              const st = interactRef.current;
              st.rotY = 2.05;
              st.rotX = 0.12;
              st.velX = 0;
              st.velY = 0;
            }}
            title="Rotate to back allergy alert clasp"
            style={{
              height: '28px',
              padding: '0 10px',
              borderRadius: '999px',
              background: '#2a1515',
              border: '1px solid rgba(239, 68, 68, 0.45)',
              color: '#fca5a5',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Allergy Clasp
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close artifact inspection"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: '#11211a',
                border: '1px solid #2a4136',
                color: '#afc6bc',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Interactive 3D WebGL Wristband Showcase Canvas */}
      <div style={{ position: 'relative', flex: 1, minHeight: '220px' }}>
        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

        {/* Subtle Laser Scan Flash Overlay when Barcode Scan triggers */}
        {scanAnim && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: '68%',
                height: '2px',
                background: '#ef4444',
                boxShadow: '0 0 18px 4px rgba(239, 68, 68, 0.85)',
              }}
            />
          </div>
        )}

        {/* Zoom +/- quick buttons in bottom-right of canvas */}
        <div
          style={{
            position: 'absolute',
            right: '14px',
            bottom: '12px',
            display: 'flex',
            gap: '6px',
          }}
        >
          <button
            type="button"
            onClick={() => {
              interactRef.current.zoom = THREE.MathUtils.clamp(interactRef.current.zoom - 0.18, 0.68, 1.55);
            }}
            title="Zoom in"
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: 'rgba(17, 33, 26, 0.9)',
              border: '1px solid #2a4136',
              color: '#ddebe4',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              interactRef.current.zoom = THREE.MathUtils.clamp(interactRef.current.zoom + 0.18, 0.68, 1.55);
            }}
            title="Zoom out"
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: 'rgba(17, 33, 26, 0.9)',
              border: '1px solid #2a4136',
              color: '#ddebe4',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <ZoomOut size={14} />
          </button>
        </div>
      </div>

      {/* Bottom Interactive Hint & Direct Barcode Scan Action Bar */}
      <div
        style={{
          padding: '11px 18px',
          borderTop: '1px solid rgba(42, 65, 54, 0.75)',
          background: 'rgba(10, 19, 16, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '12px', color: '#8ca69b', fontWeight: 500 }}>
          Drag 360° to inspect printed patient identifiers, snap clasp & red allergy alert band • Scroll to zoom
        </span>

        {verifiedId ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 13px',
              borderRadius: '999px',
              background: 'rgba(20, 53, 40, 0.9)',
              border: '1px solid #6fd1a9',
              color: '#bfe8d6',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            <CheckCircle2 size={14} color="#6fd1a9" /> Two Identifiers Verified
          </span>
        ) : (
          <button
            type="button"
            onClick={triggerScanAndVerify}
            style={{
              height: '34px',
              padding: '0 16px',
              borderRadius: '999px',
              background: '#6fd1a9',
              border: 'none',
              color: '#0a1310',
              fontSize: '12.5px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
            }}
          >
            <ScanLine size={14} /> Scan Barcode & Confirm ID
          </button>
        )}
      </div>
    </div>
  );
}
