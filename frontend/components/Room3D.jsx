'use client';

import React, {
  Suspense,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Html,
  RoundedBox,
  Environment,
  useGLTF,
  PerformanceMonitor,
} from '@react-three/drei';
import {
  EffectComposer,
  N8AO,
  Bloom,
  SMAA,
  Vignette,
  ToneMapping,
} from '@react-three/postprocessing';
import { Effect, ToneMappingMode, SMAAPreset } from 'postprocessing';
import * as THREE from 'three';
import { live } from '../lib/liveVitals';
import { SweepMonitor, LOGICAL_W, LOGICAL_H } from '../lib/monitorRenderer';
import { fitModel, keepHalfGeometry } from '../lib/fitModel';
import { speakPatientCue } from '../utils/clinicalAudio';
import HospitalRoom, { RoomLighting, ROOM } from './HospitalRoom';
import AdaptiveQuality, { dprForMode } from './AdaptiveQuality';
import {
  NAV,
  registerObstacle,
  unregisterObstacle,
  resolveCollisions,
  findPath,
  nearestFree,
} from '../lib/navigation';

// Locomotion tuning (m/s, m/s^2). ~1.4 m/s is a brisk clinical walking pace.
const WALK_SPEED = 1.45;
const WALK_ACCEL = 3.2;
const WALK_DECEL = 4.5;
// Natural gait reference: hip-to-ankle leg length of the scaled nurse avatar (metres)
const NURSE_LEG_LEN = 0.78;

/** Keeps a camera position inside the cutaway room envelope (walls, ceiling, open-side margin). */
const ROOM_FOCUS = new THREE.Vector3(0.1, 1.0, 0.2);
function clampInsideRoom(v) {
  v.x = THREE.MathUtils.clamp(v.x, ROOM.minX + 0.3, ROOM.maxX + 0.8);
  v.z = THREE.MathUtils.clamp(v.z, ROOM.minZ + 0.35, ROOM.maxZ + 0.6);
  v.y = THREE.MathUtils.clamp(v.y, 0.6, ROOM.height + 0.4);
  return v;
}

/* ---------- Station Waypoints & Over-the-Shoulder 3rd-Person Camera Presets ---------- */
const STATION_WAYPOINTS = {
  overview: {
    nursePos: [0.25, 0, 2.35],
    lookAt: [0.0, 1.15, -0.2],
    otsCam: [0.95, 1.82, 3.65],
  },
  bedside_monitor: {
    nursePos: [1.15, 0, 0.28],
    lookAt: [1.6, 1.5, -0.7],
    otsCam: [1.72, 1.76, 1.32],
  },
  wristband: {
    nursePos: [0.92, 0, 0.12],
    lookAt: [0.15, 1.18, -0.25],
    otsCam: [1.58, 1.72, 1.08],
  },
  ehr_tablet: {
    nursePos: [1.28, 0, 1.22],
    lookAt: [1.85, 1.26, 0.55],
    otsCam: [1.95, 1.72, 2.15],
  },
  hospital_bed: {
    nursePos: [0.85, 0, 1.55],
    lookAt: [0.0, 1.15, -0.25],
    otsCam: [1.65, 1.82, 2.55],
  },
  wall_oxygen: {
    nursePos: [-0.94, 0, -1.25],
    lookAt: [-0.88, 1.38, -1.84],
    otsCam: [-0.22, 1.76, 1.15],
  },
  iv_pump: {
    nursePos: [-1.2, 0, 0.5],
    lookAt: [-1.2, 1.4, -0.15],
    otsCam: [-0.12, 1.76, 1.32],
  },
};

/** IV pole footprint centre — keep in sync with lib/navigation.js iv_pole_base. */
const IV_POLE_POS = [-1.15, 0, -0.15];

/** Still, wide establishing shot used while the exam room is frozen (briefing / exit / report). */
const FROZEN_WIDE_CAMERA = {
  pos: [3.4, 2.5, 4.3],
  target: [0, 0.95, -0.1],
};

const CAMERA_PRESETS = {
  overview: {
    pos: [3.5, 2.3, 4.2],
    target: [0, 0.95, -0.05],
  },
  bedside_monitor: {
    pos: [2.25, 1.9, 1.15],
    target: [1.55, 1.5, -0.7],
  },
  wristband: {
    pos: [1.45, 1.72, 1.05],
    target: [0.15, 1.2, -0.28],
  },
  ehr_tablet: {
    pos: [2.6, 1.68, 1.75],
    target: [1.85, 1.25, 0.55],
  },
  hospital_bed: {
    pos: [2.55, 1.92, 2.25],
    target: [0.0, 1.15, -0.25],
  },
  wall_oxygen: {
    pos: [-0.1, 1.9, 0.1],
    target: [-0.88, 1.38, -1.84],
  },
  iv_pump: {
    pos: [-0.3, 1.9, 1.45],
    target: [-1.2, 1.4, -0.15],
  },
};

/**
 * Custom Rigged 3rd-Person RN Nurse Character (/models/nurse.glb)
 * - Uses the user's custom Tripo 3D rigged medical nurse model (medical_nurse_3d_model_*)
 *   with 65 Mixamo bones (mixamorig:Hips -> Spine -> Head, Left/Right Arms & Legs)
 * - Single texture atlas is split at shade time into skin / hair / scrub cloth / shoe masks,
 *   each with its own physically-based response (see createNurseMaterial)
 * - Scrubs default to the model's native navy; clicking the nurse cycles Periwinkle / Cobalt tints
 * - Full biomechanical walk cycle, breathing idle posture, and clinical station assessment gestures
 */
const SCRUB_PALETTES = {
  navy: {
    name: 'Navy (Native)',
    top: '#1e3a8a',
    tintStrength: 0.0,
  },
  periwinkle: {
    name: 'Periwinkle Sky',
    top: '#7ba4e8',
    tintStrength: 0.9,
  },
  cobalt: {
    name: 'Cobalt Royal',
    top: '#0e56db',
    tintStrength: 0.9,
  },
};
const SCRUB_CYCLE = ['navy', 'periwinkle', 'cobalt'];

/**
 * Converts the Tripo single-atlas material into a masked multi-layer MeshPhysicalMaterial:
 *  - Skin:  warm albedo lift, mid roughness, view-dependent subsurface scatter rim + wrapped diffuse bleed
 *  - Hair:  low roughness + masked clearcoat lobe for a glossy highlight band, deeper albedo
 *  - Cloth: high roughness, suppressed specular, masked sheen (fabric fuzz), optional scrub recolor
 *  - Shoes: semi-gloss white synthetic
 * Masks are derived per-pixel from the albedo (navy scrubs / brown skin / black hair / white shoes).
 */
function createNurseMaterial(src, uniforms) {
  const mat = new THREE.MeshPhysicalMaterial({
    map: src.map || null,
    normalMap: src.normalMap || null,
    normalScale: src.normalScale ? src.normalScale.clone().multiplyScalar(1.15) : new THREE.Vector2(1.15, 1.15),
    roughnessMap: src.roughnessMap || null,
    roughness: 1,
    metalness: 0,
    color: new THREE.Color(0.97, 0.97, 0.97),
    ior: 1.4,
    specularIntensity: 0.6,
    sheen: 1,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#aab8e0'),
    clearcoat: 1,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.85,
  });
  if (mat.map) mat.map.anisotropy = 8;
  mat.name = 'nurse_layered_pbr';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uScrubColor = uniforms.uScrubColor;
    shader.uniforms.uScrubStrength = uniforms.uScrubStrength;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uScrubColor;
        uniform float uScrubStrength;
        void main() {`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // ---- Per-pixel material segmentation from the albedo atlas ----
        vec3 nAlb = sqrt(max(diffuseColor.rgb, vec3(0.0)));           // ~perceptual
        float nLuma = dot(nAlb, vec3(0.299, 0.587, 0.114));
        float nMin = min(nAlb.r, min(nAlb.g, nAlb.b));
        float nWhite = smoothstep(0.56, 0.74, nMin);
        float nCloth = smoothstep(0.03, 0.13, nAlb.b - max(nAlb.r, nAlb.g)) * (1.0 - nWhite);
        float nSkin = smoothstep(0.05, 0.15, nAlb.r - nAlb.b)
                    * smoothstep(-0.01, 0.03, nAlb.r - nAlb.g)
                    * (1.0 - nWhite) * (1.0 - nCloth);
        float nHair = smoothstep(0.23, 0.11, nLuma) * (1.0 - nCloth) * (1.0 - nSkin);

        // Skin: gentle warmth & saturation lift (baked AI textures read grey under ACES)
        vec3 nSkinTone = diffuseColor.rgb * vec3(1.06, 0.97, 0.92);
        diffuseColor.rgb = mix(diffuseColor.rgb, nSkinTone, nSkin);
        // Hair: deepen to a rich blue-black
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 0.84, 0.9), nHair);
        // Cloth: non-destructive scrub recolor that preserves baked folds/seams
        if (uScrubStrength > 0.01) {
          float nLin = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 nTint = uScrubColor * clamp(nLin / 0.05, 0.0, 2.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, nTint, nCloth * uScrubStrength);
        }
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.88, nCloth * 0.8);
        roughnessFactor = mix(roughnessFactor, 0.5, nSkin * 0.75);
        roughnessFactor = mix(roughnessFactor, 0.62, nHair * 0.9);
        roughnessFactor = mix(roughnessFactor, 0.4, nWhite * 0.6);
        `
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        material.specularColor *= mix(1.0, 0.35, nCloth);   // matte woven fabric
        material.specularColor *= mix(1.0, 0.55, nHair);   // hair fibres: soft, low sheen
        #ifdef USE_SHEEN
          material.sheenColor *= nCloth;                    // fabric fuzz only on scrubs
        #endif
        #ifdef USE_CLEARCOAT
          material.clearcoat *= nHair * 0.18;               // faint hair highlight band only
        #endif
        `
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        // Skin subsurface approximation: warm wrapped bleed + view-grazing scatter rim
        float nNdV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        float nRim = pow(1.0 - nNdV, 3.0);
        reflectedLight.directDiffuse += nSkin * reflectedLight.directDiffuse * vec3(0.24, 0.07, 0.03);
        reflectedLight.indirectDiffuse += nSkin * nRim * diffuseColor.rgb * vec3(0.55, 0.22, 0.14);
        // Cloth: soft fabric rim from fibre back-scatter
        reflectedLight.indirectDiffuse += nCloth * nRim * diffuseColor.rgb * 0.25;
        `
      );
  };
  mat.customProgramCacheKey = () => 'nurse_layered_pbr_v1';
  return mat;
}

const _nurseEuler = new THREE.Euler();
const _nurseDeltaQuat = new THREE.Quaternion();
const _nurseLocalDelta = new THREE.Quaternion();

/**
 * Applies a rotation (rx, ry, rz) defined in clean Character Space:
 *   +X = Character Left  (rx < 0 swings downward limbs FORWARD; rx > 0 pitches spine/head FORWARD)
 *   +Y = Character Up    (ry > 0 yaws/twists LEFT; ry < 0 yaws/twists RIGHT)
 *   +Z = Character Front (rz < 0 adducts LeftArm inward; rz > 0 adducts RightArm inward)
 * Converted into each bone's exact local space via similarity transform:
 *   q_bone = q_bindLocal * (q_charBind^-1 * q_deltaChar * q_charBind)
 */
function setNurseCharRotation(bone, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  if (!bone || !bone.userData.bindQuat || !bone.userData.charQuat) return;
  _nurseEuler.set(rx, ry, rz, order);
  _nurseDeltaQuat.setFromEuler(_nurseEuler);
  _nurseLocalDelta
    .copy(bone.userData.charQuatInv)
    .multiply(_nurseDeltaQuat)
    .multiply(bone.userData.charQuat);
  bone.quaternion.copy(bone.userData.bindQuat).multiply(_nurseLocalDelta);
}

function NurseAvatar3D({
  cameraFocusId,
  cameraTrigger,
  nurseStateRef,
  scrubStyle = 'navy',
  onToggleScrubStyle,
  frozen = false,
  onArrive,
  onDepart,
}) {
  const { scene: nurseGltfScene } = useGLTF('/models/nurse.glb?v=rn2');
  const arrivedRef = useRef(false);
  const groupRef = useRef();
  const blobRef = useRef();
  const bonesRef = useRef({});
  const blobTexture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  const scrubColorUniform = useRef({ value: new THREE.Color('#0e56db') });
  const scrubStrengthUniform = useRef({ value: 0.0 });

  const keysRef = useRef({});
  const walkPhaseRef = useRef(0);
  const smoothSpeedRef = useRef(0);
  const reachBlendRef = useRef(0);

  const palette = SCRUB_PALETTES[scrubStyle] || SCRUB_PALETTES.navy;

  useEffect(() => {
    scrubColorUniform.current.value.set(palette.top);
    scrubStrengthUniform.current.value = palette.tintStrength;
  }, [palette.top, palette.tintStrength]);

  // Configure shadows, PBR response, optional Cobalt scrub shader shift, and capture character-space bind quaternions
  useLayoutEffect(() => {
    if (!nurseGltfScene) return;

    // 1. Restore bind pose first if re-running layout effect
    nurseGltfScene.traverse((obj) => {
      if (obj.userData.bindQuat) obj.quaternion.copy(obj.userData.bindQuat);
      if (obj.userData.bindPos) obj.position.copy(obj.userData.bindPos);
    });

    // 2. Update world matrices and compute scene root inverse quaternion so bone orientations are in pure character space
    nurseGltfScene.updateMatrixWorld(true);
    const sceneWorldQuatInv = new THREE.Quaternion();
    nurseGltfScene.getWorldQuaternion(sceneWorldQuatInv).invert();
    const boneWorldQuat = new THREE.Quaternion();
    const map = {};

    nurseGltfScene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.frustumCulled = false;

        if (!obj.userData.nursePbr) {
          obj.material = createNurseMaterial(obj.material, {
            uScrubColor: scrubColorUniform.current,
            uScrubStrength: scrubStrengthUniform.current,
          });
          obj.userData.nursePbr = true;
        }
      }

      // Note: THREE.GLTFLoader sanitizes 'mixamorig:Hips' -> 'mixamorigHips' (strips colon).
      // Index by shortName ('Hips'), sanitized name ('mixamorigHips'), and raw name ('mixamorig:Hips').
      if (obj.isBone || (obj.name && obj.name.toLowerCase().startsWith('mixamorig'))) {
        if (!obj.userData.bindQuat) {
          obj.userData.bindQuat = obj.quaternion.clone();
        }
        if (!obj.userData.bindPos) {
          obj.userData.bindPos = obj.position.clone();
        }
        obj.getWorldQuaternion(boneWorldQuat);
        const charQuat = sceneWorldQuatInv.clone().multiply(boneWorldQuat);
        obj.userData.charQuat = charQuat;
        obj.userData.charQuatInv = charQuat.clone().invert();

        const shortName = obj.name.replace(/^mixamorig:?/i, '');
        map[shortName] = obj;
        map[obj.name] = obj;
        map[`mixamorig:${shortName}`] = obj;
      }
    });

    bonesRef.current = map;
  }, [nurseGltfScene]);

  // Listen for WASD / Arrow keys for real-time 3rd-person nurse navigation
  useEffect(() => {
    const onKeyDown = (e) => {
      if (
        e.target &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT')
      ) {
        return;
      }
      keysRef.current[e.code] = true;
    };
    const onKeyUp = (e) => {
      keysRef.current[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Update target waypoint when station selection changes
  useEffect(() => {
    const wp =
      STATION_WAYPOINTS[cameraFocusId] || STATION_WAYPOINTS.overview;
    const st = nurseStateRef.current;
    st.goalPos.set(...wp.nursePos);
    st.lookTarget.set(...wp.lookAt);
    st.otsCamGoal.set(...wp.otsCam);
    st.manualWalk = false;
    arrivedRef.current = false;
  }, [cameraFocusId, cameraTrigger, nurseStateRef]);

  useFrame((state, delta) => {
    const st = nurseStateRef.current;
    const keys = frozen ? {} : keysRef.current;
    const t = state.clock.elapsedTime;
    // Real-time locomotion: integrate the whole frame in small sub-steps so a low frame rate does
    // not turn into slow motion, while collision response stays stable.
    const frameDt = Math.min(delta, 0.25);
    const subSteps = Math.max(1, Math.ceil(frameDt / 0.04));
    const dt = frameDt / subSteps;

    let moveX = 0;
    let moveZ = 0;
    if (keys.KeyW || keys.ArrowUp) moveZ -= 1;
    if (keys.KeyS || keys.ArrowDown) moveZ += 1;
    if (keys.KeyA || keys.ArrowLeft) moveX -= 1;
    if (keys.KeyD || keys.ArrowRight) moveX += 1;

    const turnTowards = (targetYaw, rate) => {
      let diff = targetYaw - st.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      st.yaw += diff * Math.min(1, dt * rate);
    };

    const manualInput = moveX !== 0 || moveZ !== 0;
    const prevX = st.pos.x;
    const prevZ = st.pos.z;
    let desiredSpeed = 0;
    for (let sub = 0; sub < subSteps; sub++) {
    let dirX = 0;
    let dirZ = 0;
    desiredSpeed = 0;

    if (moveX !== 0 || moveZ !== 0) {
      // ---- Manual WASD: steer + slide along furniture (collision response) ----
      if (arrivedRef.current) {
        arrivedRef.current = false;
        onDepart?.();
      }
      st.manualWalk = true;
      st.path = null;
      const len = Math.hypot(moveX, moveZ);
      dirX = moveX / len;
      dirZ = moveZ / len;
      desiredSpeed = WALK_SPEED;
      turnTowards(Math.atan2(dirX, dirZ), 12);
    } else {
      // ---- Click/station walk: follow an A* path that routes around obstacles ----
      const goalKey = `${st.goalPos.x.toFixed(2)},${st.goalPos.z.toFixed(2)}|${NAV.version}`;
      if (st.pathKey !== goalKey) {
        st.pathKey = goalKey;
        st.path = findPath(st.pos, { x: st.goalPos.x, z: st.goalPos.z });
      }
      const path = st.path || [];
      while (path.length > 1 && Math.hypot(path[0].x - st.pos.x, path[0].z - st.pos.z) < 0.12) {
        path.shift();
      }
      const next = path[0];
      const final = path[path.length - 1];
      const distToNext = next ? Math.hypot(next.x - st.pos.x, next.z - st.pos.z) : 0;
      const distToFinal = final
        ? path.reduce(
            (acc, pt, i) =>
              acc +
              (i === 0
                ? distToNext
                : Math.hypot(pt.x - path[i - 1].x, pt.z - path[i - 1].z)),
            0
          )
        : 0;

      if (next && distToFinal > 0.03) {
        dirX = (next.x - st.pos.x) / Math.max(distToNext, 1e-4);
        dirZ = (next.z - st.pos.z) / Math.max(distToNext, 1e-4);
        // Arrive behaviour: ease into the stop instead of halting abruptly
        desiredSpeed = Math.min(WALK_SPEED, Math.max(0.35, distToFinal * 2.4));
        turnTowards(Math.atan2(dirX, dirZ), 9);
      } else {
        st.speed = 0;
        const lx = st.lookTarget.x - st.pos.x;
        const lz = st.lookTarget.z - st.pos.z;
        turnTowards(Math.atan2(lx, lz), 7);

        // Station arrival: the station panel only opens once the nurse is physically there
        if (
          !frozen &&
          !arrivedRef.current &&
          !st.manualWalk &&
          cameraFocusId &&
          cameraFocusId !== 'overview'
        ) {
          arrivedRef.current = true;
          onArrive?.(cameraFocusId);
        }
      }
    }

    // ---- Simple locomotion physics: acceleration / deceleration ----
    const accel = desiredSpeed > (st.speed || 0) ? WALK_ACCEL : WALK_DECEL;
    st.speed = THREE.MathUtils.clamp(
      (st.speed || 0) + Math.sign(desiredSpeed - (st.speed || 0)) * accel * dt,
      0,
      Math.max(desiredSpeed, st.speed || 0)
    );
    if (desiredSpeed === 0 && st.speed < 0.05) st.speed = 0;
    if (st.speed > 0 && (dirX || dirZ)) {
      st.pos.x += dirX * st.speed * dt;
      st.pos.z += dirZ * st.speed * dt;
      if (manualInput) st.goalPos.copy(st.pos);
    }
    resolveCollisions(st.pos);
    } // end locomotion sub-steps

    // Actual distance travelled drives the gait so feet don't skate
    const moved = Math.hypot(st.pos.x - prevX, st.pos.z - prevZ);
    const actualSpeed = moved / Math.max(frameDt, 1e-4);
    const isWalking = actualSpeed > 0.08;
    st.isWalking = isWalking;

    // Safety net: if a station walk is blocked by furniture (no real progress for 1.2 s), treat it
    // as arrived so the station panel can never become unreachable.
    if (!manualInput && !st.manualWalk && desiredSpeed > 0 && moved < 0.004) {
      st.stuckT = (st.stuckT || 0) + frameDt;
      if (
        st.stuckT > 1.2 &&
        !frozen &&
        !arrivedRef.current &&
        cameraFocusId &&
        cameraFocusId !== 'overview'
      ) {
        st.path = [{ x: st.pos.x, z: st.pos.z }];
        st.goalPos.set(st.pos.x, 0, st.pos.z);
        arrivedRef.current = true;
        onArrive?.(cameraFocusId);
      }
    } else {
      st.stuckT = 0;
    }

    if (groupRef.current) {
      groupRef.current.position.copy(st.pos);
      groupRef.current.rotation.y = st.yaw;
    }

    // Walk blend follows real speed (smoothed, m/s), so starts/stops blend naturally
    smoothSpeedRef.current = THREE.MathUtils.lerp(
      smoothSpeedRef.current,
      Math.min(actualSpeed, WALK_SPEED * 1.2),
      Math.min(1, frameDt * 8)
    );
    const vs = smoothSpeedRef.current;
    // w: 0 = standing idle, 1 = full gait shape (reached by a slow walk, not only at top speed)
    const w = THREE.MathUtils.smoothstep(vs, 0.04, 0.4);

    const isAtStation =
      !isWalking && !st.manualWalk && cameraFocusId && cameraFocusId !== 'overview';
    reachBlendRef.current = THREE.MathUtils.lerp(
      reachBlendRef.current,
      isAtStation ? 1 : 0,
      Math.min(1, frameDt * 6)
    );
    const reach = reachBlendRef.current;

    // Natural gait scaling: people take SHORTER, quicker steps when walking slowly instead of the
    // same long stride in slow motion. Stride (one full L+R cycle) grows with speed, and the hip
    // swing angle is derived from it so the planted foot doesn't skate across the floor.
    const strideLen = THREE.MathUtils.clamp(0.72 + 0.5 * vs, 0.82, 1.45);
    const hipAmp = Math.asin(Math.min(0.6, strideLen / (4 * NURSE_LEG_LEN)));
    const k = hipAmp / 0.46; // gait intensity: ~0.6 when strolling, ~1 at a brisk pace
    walkPhaseRef.current += moved * ((Math.PI * 2) / strideLen);
    const p = walkPhaseRef.current;

    if (!nurseGltfScene) return;
    const B = (name) => bonesRef.current[name];

    // Gait phase convention: p = π/2 → LEFT heel strike (left leg forward), p = 3π/2 → RIGHT heel
    // strike. Mid-stance (legs passing each other) happens at p = 0 and p = π.
    // Blob shadow is widest when the feet are spread (double support) and tightest at mid-stance
    if (blobRef.current) {
      const spread = Math.abs(Math.sin(p)) * w * k;
      blobRef.current.scale.set(1 - spread * 0.05, 1 + spread * 0.18, 1);
      blobRef.current.material.opacity = 0.42 - spread * 0.04;
    }

    // 1. Pelvis (Hips) — In Armature space, bindPos.z is vertical height (+Y) and bindPos.x is lateral (+X)
    // Inverted-pendulum walk: the pelvis is HIGHEST at mid-stance (cos 2p = 1) and LOWEST at
    // double support when both feet are on the ground. (The old curve did the opposite, which
    // read as a hop.) It also shifts sideways over whichever foot is carrying the weight.
    const hips = B('Hips');
    const idleCycle = Math.sin(t * 1.15);
    const gaitVerticalBounce = Math.cos(p * 2) * 0.0095 * w * k - 0.004 * w * k;
    const gaitLateralShift = -Math.cos(p) * 0.011 * w * k;
    const idleWeightShift = idleCycle * 0.011 * (1 - w);
    if (hips && hips.userData.bindPos) {
      hips.position.set(
        hips.userData.bindPos.x + gaitLateralShift + idleWeightShift,
        hips.userData.bindPos.y,
        hips.userData.bindPos.z + gaitVerticalBounce
      );
      setNurseCharRotation(
        hips,
        0.035 * w,
        // Pelvis turns toward the swinging leg; gentle list (drop) on the swing side at mid-swing
        -Math.sin(p) * 0.08 * w * k + idleCycle * 0.03 * (1 - w),
        Math.cos(p) * 0.03 * w * k + idleCycle * 0.035 * (1 - w)
      );
    }

    // 2. Spine & Chest (upright clinical posture, visible respiratory chest expansion, contrapposto S-curve)
    const breath = Math.sin(t * 2.2) * 0.026;
    const spineYaw = Math.sin(p) * 0.06 * w * k - idleCycle * 0.025 * (1 - w);
    const spineRoll = -Math.cos(p) * 0.02 * w * k - idleCycle * 0.03 * (1 - w);
    const spinePitch = -0.025 * (1 - w) + 0.03 * w + reach * 0.07 + breath;
    setNurseCharRotation(B('Spine'), spinePitch * 0.35, spineYaw * 0.35, spineRoll * 0.4);
    setNurseCharRotation(B('Spine1'), spinePitch * 0.35, spineYaw * 0.35, spineRoll * 0.3);
    setNurseCharRotation(B('Spine2'), spinePitch * 0.3, spineYaw * 0.3, spineRoll * 0.3);

    // 3. Neck & Head (correct auto-rig forward tilt so head is held poised & upright; natural clinical gaze scan)
    const headYaw = Math.sin(t * 0.85) * 0.11 * (1 - w) * (1 - reach * 0.5) - spineYaw * 0.55;
    const headPitch = -0.10 * (1 - reach) + reach * 0.08 + Math.sin(t * 1.45) * 0.028;
    const headRoll = Math.sin(t * 0.95) * 0.025 * (1 - w);
    setNurseCharRotation(B('Neck'), headPitch * 0.45, headYaw * 0.4, headRoll * 0.4);
    setNurseCharRotation(B('Head'), headPitch * 0.55, headYaw * 0.6, headRoll * 0.6);

    // 4. Shoulders, Arms, ForeArms & Hands
    // Lower shoulders from A-pose and rise/fall gently with respiration
    setNurseCharRotation(B('LeftShoulder'), 0, 0, -0.08 + breath * 0.4);
    setNurseCharRotation(B('RightShoulder'), 0, 0, 0.08 - breath * 0.4);

    // Left Arm: Adducted inward from A-pose (rz = -0.28), opposite-phase walk swing, lifts chart/watch at station
    // Relaxed pendulum arm swing, opposite to the legs, smaller when strolling
    const lArmWalkPitch = Math.sin(p - 0.15) * 0.33 * w * k;
    const lArmIdlePitch = (-0.06 + Math.sin(t * 1.15 + 1.0) * 0.025) * (1 - w) - reach * 0.24;
    setNurseCharRotation(
      B('LeftArm'),
      lArmWalkPitch + lArmIdlePitch,
      -0.08 * (1 - w),
      -0.42 * (1 - w) - 0.3 * w
    );
    const lElbowBend =
      (-0.26 - Math.max(0, -Math.sin(p - 0.15)) * 0.22 * k) * w +
      (-0.1 + breath * 0.6) * (1 - w) * (1 - reach) +
      -0.62 * reach;
    setNurseCharRotation(
      B('LeftForeArm'),
      lElbowBend,
      -0.08 * (1 - w) - 0.32 * reach,
      -0.10 * (1 - w)
    );
    setNurseCharRotation(B('LeftHand'), -0.08, -0.12, -0.08);

    // Right Arm: Adducted inward from A-pose (rz = +0.28); swings forward when left leg steps; reaches at station
    const rArmWalkPitch = -Math.sin(p - 0.15) * 0.33 * w * k;
    const stationGesture = Math.sin(t * 2.8) * 0.06 * reach;
    const rArmStationPitch = -0.54 * reach + stationGesture;
    setNurseCharRotation(
      B('RightArm'),
      rArmWalkPitch + (-0.06 - Math.sin(t * 1.15 + 1.0) * 0.025) * (1 - w) * (1 - reach) + rArmStationPitch,
      0.08 * (1 - w) + 0.14 * reach,
      0.42 * (1 - w) * (1 - reach * 0.5) + 0.3 * w
    );
    const rElbowBend =
      (-0.26 - Math.max(0, Math.sin(p - 0.15)) * 0.22 * k) * w +
      (-0.1 + breath * 0.6) * (1 - w) * (1 - reach) +
      (-0.64 - stationGesture * 0.65) * reach;
    setNurseCharRotation(
      B('RightForeArm'),
      rElbowBend,
      0.08 * (1 - w) + 0.26 * reach,
      0.10 * (1 - w)
    );
    setNurseCharRotation(
      B('RightHand'),
      -0.08 + reach * 0.16,
      0.12,
      0.08
    );

    // Soft anatomical finger curl
    ['Index', 'Middle', 'Ring', 'Pinky'].forEach((finger, fIdx) => {
      const curl = 0.18 + fIdx * 0.03;
      [1, 2, 3].forEach((jIdx) => {
        setNurseCharRotation(B(`LeftHand${finger}${jIdx}`), curl, 0, -0.05);
        setNurseCharRotation(B(`RightHand${finger}${jIdx}`), curl * (1 - reach * 0.4), 0, 0.05);
      });
    });

    // 5. Lower Limbs — phase-correct biomechanical gait + contrapposto idle knee relaxation
    // Left leg: swing phase while it moves forward (cos p > 0, p ∈ (−π/2, π/2)), heel strike at
    // p = π/2, stance until p = 3π/2. The right leg is the same curve shifted by π.
    const lIdleKnee = Math.max(0, idleCycle) * 0.08 + 0.04;
    const rIdleKnee = Math.max(0, -idleCycle) * 0.08 + 0.04;
    // Hip flexion/extension: stride-derived amplitude, slight forward bias (more flexion than extension)
    const lHipPitch = (-Math.sin(p) * hipAmp - 0.05 * k) * w - lIdleKnee * 0.45 * (1 - w);
    const rHipPitch = (Math.sin(p) * hipAmp - 0.05 * k) * w - rIdleKnee * 0.45 * (1 - w);

    // Knee: big flexion in EARLY swing so the foot clears the floor (peaks just after toe-off),
    // straightening before heel strike; a small cushioning bend just after heel strike.
    const swingCurve = (x) => Math.pow(Math.max(0, Math.cos(x)), 1.6);
    const lSwingKnee = swingCurve(p + 0.45) * (0.55 + 0.3 * k) * 0.95;
    const rSwingKnee = swingCurve(p + Math.PI + 0.45) * (0.55 + 0.3 * k) * 0.95;
    const lStanceCushion = Math.pow(Math.max(0, Math.sin(p - 0.55)), 3) * 0.16 * k;
    const rStanceCushion = Math.pow(Math.max(0, -Math.sin(p - 0.55)), 3) * 0.16 * k;
    const lKneePitch = (lSwingKnee + lStanceCushion + 0.03) * w + lIdleKnee * (1 - w);
    const rKneePitch = (rSwingKnee + rStanceCushion + 0.03) * w + rIdleKnee * (1 - w);

    // Ankle: toes up at heel strike, flat through stance, plantar-flexed push-off just before toe-off
    const lAnklePitch = (-Math.sin(p - 0.35) * 0.17 * k + 0.03) * w;
    const rAnklePitch = (Math.sin(p - 0.35) * 0.17 * k + 0.03) * w;
    // Toe break only during push-off (late stance), not mid-stance
    const lToePitch = -Math.pow(Math.max(0, -Math.sin(p + 0.25)), 2) * 0.3 * w * k;
    const rToePitch = -Math.pow(Math.max(0, Math.sin(p + 0.25)), 2) * 0.3 * w * k;

    setNurseCharRotation(B('LeftUpLeg'), lHipPitch, 0, -0.015 * (1 - w));
    setNurseCharRotation(B('RightUpLeg'), rHipPitch, 0, 0.015 * (1 - w));
    setNurseCharRotation(B('LeftLeg'), lKneePitch, 0, 0);
    setNurseCharRotation(B('RightLeg'), rKneePitch, 0, 0);
    setNurseCharRotation(B('LeftFoot'), lAnklePitch, 0, 0);
    setNurseCharRotation(B('RightFoot'), rAnklePitch, 0, 0);
    setNurseCharRotation(B('LeftToeBase'), lToePitch, 0, 0);
    setNurseCharRotation(B('RightToeBase'), rToePitch, 0, 0);
  });

  return (
    <group
      ref={groupRef}
      position={[0.25, 0, 2.35]}
      onClick={stop(() => onToggleScrubStyle?.())}
    >
      {/* Soft contact blob shadow (follows the nurse; no render-target history, so no trails) */}
      <mesh
        ref={blobRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.006, 0.02]}
        renderOrder={1}
      >
        <planeGeometry args={[0.78, 0.78]} />
        <meshBasicMaterial
          map={blobTexture}
          color="#000000"
          transparent
          opacity={0.42}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>

      {/* Ground Navigation Ring beneath RN Avatar (no depth write so AO doesn't halo it) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} renderOrder={2}>
        <ringGeometry args={[0.27, 0.3, 48]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* User's Custom Rigged 3D RN Nurse Model (/models/nurse.glb, scaled to ~1.70m standing height) */}
      <group scale={1.74}>
        <primitive object={nurseGltfScene} />
      </group>
    </group>
  );
}

function CameraRig({
  cameraFocusId,
  cameraTrigger,
  cameraMode = 'third_person',
  nurseStateRef,
  controlsRef,
  introTrigger = 0,
  frozen = false,
}) {
  const { camera } = useThree();
  const isAnimatingRef = useRef(false);
  const animTimerRef = useRef(0);
  const introTimerRef = useRef(introTrigger > 0 ? 0 : 99);
  const goalPos = useMemo(() => new THREE.Vector3(0.95, 1.82, 3.65), []);
  const goalTarget = useMemo(() => new THREE.Vector3(0, 1.15, -0.2), []);
  const _shoulderOffset = useMemo(() => new THREE.Vector3(), []);
  const _behind = useMemo(() => new THREE.Vector3(), []);
  const _outward = useMemo(() => new THREE.Vector3(), []);
  const _camDir = useMemo(() => new THREE.Vector3(), []);
  const _toTarget = useMemo(() => new THREE.Vector3(), []);
  const _right = useMemo(() => new THREE.Vector3(), []);
  const _frozenPos = useMemo(() => new THREE.Vector3(...FROZEN_WIDE_CAMERA.pos), []);
  const _frozenTarget = useMemo(() => new THREE.Vector3(...FROZEN_WIDE_CAMERA.target), []);

  // 4-second opening dolly runs only when the candidate presses [Enter Room & Begin]
  useEffect(() => {
    if (introTrigger === 0) return;
    introTimerRef.current = 0;
    camera.position.set(0.35, 2.25, 5.4);
  }, [introTrigger, camera]);

  useEffect(() => {
    const preset =
      CAMERA_PRESETS[cameraFocusId] || CAMERA_PRESETS.overview;
    goalPos.set(...preset.pos);
    goalTarget.set(...preset.target);
    isAnimatingRef.current = true;
    animTimerRef.current = 0;
  }, [cameraFocusId, cameraTrigger, cameraMode, goalPos, goalTarget]);

  useFrame((_, delta) => {
    const st = nurseStateRef.current;

    // 0. Frozen exam gate (pre-briefing / exit questions / report): hold a still, wide establishing shot
    if (frozen) {
      camera.position.lerp(_frozenPos, Math.min(1, delta * 2));
      if (controlsRef.current) {
        controlsRef.current.target.lerp(_frozenTarget, Math.min(1, delta * 2));
        controlsRef.current.update();
      }
      return;
    }

    // 1. 4-Second Opening Cinematic Dolly into Hospital Room (Chapter I PACU Arrival)
    if (introTimerRef.current < 4.0) {
      introTimerRef.current += delta;
      const wp = STATION_WAYPOINTS.overview;
      goalPos.set(...wp.otsCam);
      goalTarget.set(...wp.lookAt);
      camera.position.lerp(goalPos, Math.min(1, delta * 1.8));
      if (controlsRef.current) {
        controlsRef.current.target.lerp(goalTarget, Math.min(1, delta * 2.4));
        controlsRef.current.update();
      }
      return;
    }

    // 2. Over-the-Shoulder 3rd-Person Follow Mode
    if (cameraMode === 'third_person') {
      if (st.manualWalk || st.isWalking) {
        // Follow from behind, but bias the camera toward the room's open/outer side so it always
        // looks INTO the room (never at the open cutaway front, never wedged behind the bed).
        _behind.set(-Math.sin(st.yaw), 0, -Math.cos(st.yaw));
        _outward.set(st.pos.x - ROOM_FOCUS.x, 0, st.pos.z - ROOM_FOCUS.z);
        const outLen = _outward.length();
        if (outLen > 1e-3) _outward.multiplyScalar(1 / outLen);
        const outwardBias = THREE.MathUtils.clamp(outLen / 1.6, 0.35, 1.0) * 1.4;
        _camDir.copy(_behind).addScaledVector(_outward, outwardBias).normalize();
        goalPos.copy(st.pos).addScaledVector(_camDir, 2.3);
        goalPos.y = 2.05;
        // Look past the nurse toward the room centre so she sits in the lower third
        goalTarget
          .copy(st.pos)
          .lerp(ROOM_FOCUS, 0.45);
        goalTarget.y = 1.0;
      } else {
        // Station inspection: stand back and to the right of the nurse, raised, so her head
        // never hides the device; frame the device left-of-centre (drawer opens on the right)
        _toTarget.set(st.lookTarget.x - st.pos.x, 0, st.lookTarget.z - st.pos.z);
        if (_toTarget.lengthSq() < 1e-4) _toTarget.set(0, 0, -1);
        _toTarget.normalize();
        _right.set(-_toTarget.z, 0, _toTarget.x);
        goalPos
          .copy(st.pos)
          .addScaledVector(_toTarget, -1.05)
          .addScaledVector(_right, 0.85);
        goalPos.y = 1.95;
        goalTarget.copy(st.lookTarget).addScaledVector(_right, 0.38);
      }
      clampInsideRoom(goalPos);

      const step = Math.min(1, delta * 4.0);
      camera.position.lerp(goalPos, step);
      if (controlsRef.current) {
        controlsRef.current.target.lerp(goalTarget, step);
        controlsRef.current.update();
      }
      return;
    }

    // 3. Free Orbit Mode (smoothly dollies on station click, then releases to user orbit)
    // Never let the user orbit/zoom through the headwall or window wall into the void
    clampInsideRoom(camera.position);
    if (!isAnimatingRef.current) return;
    animTimerRef.current += delta;
    const step = Math.min(1, delta * 5.5);

    camera.position.lerp(goalPos, step);
    if (controlsRef.current) {
      controlsRef.current.target.lerp(goalTarget, step);
      controlsRef.current.update();
    }

    if (
      animTimerRef.current > 1.15 ||
      (camera.position.distanceTo(goalPos) < 0.03 &&
        (!controlsRef.current ||
          controlsRef.current.target.distanceTo(goalTarget) < 0.03))
    ) {
      isAnimatingRef.current = false;
    }
  });

  return null;
}

/* ---------- PBR material presets (High-Quality Render spec §5) ---------- */
// Brushed metallic PBR for IV pole, bed frame, rails, and hardware
const BRUSHED_METAL = { color: '#c7ced8', metalness: 0.8, roughness: 0.25 };
// Soft matte fabric for hospital mattress, pillow & linens
const MATTE_FABRIC = {
  roughness: 0.9,
  metalness: 0,
  sheen: 0.55,
  sheenRoughness: 0.8,
};
// Clear polymer/liquid for IV Morphine PCA bag, drip chamber & O2 humidifier bottle
// Uses alpha transparency instead of WebGL transmission so Three.js does not re-render the
// entire 900k-triangle opaque scene into a second transmissionRenderTarget every frame.
const CLEAR_POLYMER = {
  transparent: true,
  opacity: 0.52,
  roughness: 0.12,
  metalness: 0.05,
};

const DOMAIN_COLORS = {
  knowledge: '#38bdf8',
  prioritisation: '#f59e0b',
  risk_recognition: '#f43f5e',
  clinical_judgment: '#a855f7',
};

const stop = (fn) => (e) => {
  e.stopPropagation();
  fn();
};

/** Preserves gl.toneMappingExposure inside EffectComposer before ACES tone mapping. */
class ExposureEffectImpl extends Effect {
  constructor(exposure = 1) {
    super(
      'ExposureEffect',
      /* glsl */ `uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
      }`,
      { uniforms: new Map([['exposure', new THREE.Uniform(exposure)]]) }
    );
  }
}

const Exposure = forwardRef(function Exposure(_, ref) {
  const exposure = useThree((s) => s.gl.toneMappingExposure);
  const effect = useMemo(() => new ExposureEffectImpl(exposure), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    effect.uniforms.get('exposure').value = exposure;
  }, [effect, exposure]);
  return <primitive ref={ref} object={effect} dispose={null} />;
});

/** Error boundary so an HDRI issue never blocks rendering. */
class EnvironmentBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.warn('[Room3D] Environment HDRI fallback:', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Exam-mode hotspot context (provided inside the Canvas):
 *  - labels: neutral station names from scenario_hypoxia.json exam_config.station_labels
 *  - inspected: stations the candidate has physically walked to (gates the patient's verbal cue)
 *  - visible: false while the room is frozen (pre-briefing / exit questions / report)
 *
 * Pins show ONLY the neutral station name: no sequence numbers (they would reveal the
 * clinical priority order) and no status/value badges (e.g. SpO2, infusion rate).
 */
const HotspotContext = React.createContext({
  labels: {},
  inspected: [],
  visible: true,
});

function InteractiveHotspot({
  position,
  objConfig,
  isCompleted,
  isSelected,
  onSelect,
}) {
  const [hovered, setHovered] = useState(false);
  const ctx = React.useContext(HotspotContext);
  if (!ctx.visible) return null;
  const stationLabel = ctx.labels[objConfig.id] || objConfig.label.split(' (')[0];
  // Neutral styling only: visited stations turn slate (never a green "correct" check)
  const dotColor = isSelected ? '#ffffff' : isCompleted ? '#475569' : '#0066ff';

  return (
    <group position={position}>
      <Html center zIndexRange={[20, 0]}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            // Drop focus so a later Space/Enter press can't silently re-trigger this station
            e.currentTarget.blur();
            onSelect(objConfig.id);
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            padding: '5px 11px 5px 8px',
            borderRadius: '999px',
            background: isSelected
              ? 'linear-gradient(135deg, rgba(0, 102, 255, 0.88), rgba(37, 99, 235, 0.78))'
              : hovered
                ? 'rgba(15, 23, 42, 0.86)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.76), rgba(241, 245, 249, 0.56))',
            border: isSelected
              ? '1px solid rgba(255, 255, 255, 0.9)'
              : '1px solid rgba(255, 255, 255, 0.75)',
            color: isSelected || hovered ? '#ffffff' : '#0f172a',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: isSelected
              ? 'inset 0 1px 1px rgba(255,255,255,0.6), 0 8px 24px rgba(0, 102, 255, 0.42)'
              : 'inset 0 1px 1px rgba(255,255,255,0.85), 0 8px 20px rgba(15, 23, 42, 0.16)',
            transform: hovered || isSelected ? 'scale(1.06)' : 'scale(1)',
            transition: 'all 0.15s ease',
            fontFamily: 'inherit',
            backdropFilter: 'blur(18px) saturate(190%)',
            WebkitBackdropFilter: 'blur(18px) saturate(190%)',
          }}
        >
          <span
            style={{
              width: '9px',
              height: '9px',
              borderRadius: '50%',
              background: dotColor,
              flexShrink: 0,
              boxShadow: isCompleted
                ? '0 0 0 3px rgba(71, 85, 105, 0.25)'
                : '0 0 0 3px rgba(0, 102, 255, 0.22)',
            }}
          />
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '-0.01em' }}>
            {stationLabel}
          </span>
        </button>
      </Html>
    </group>
  );
}

/* ---------- 1. Hospital Bed (GLB + PBR Metallic Frame & Matte Mattress) ---------- */
function HospitalBedGLB({
  bedAngle,
  bedObj,
  isCompleted,
  isSelected,
  onSelectObject,
}) {
  const { scene: bedScene } = useGLTF('/models/hospital_bed_carlos.glb');
  const { scene: pillowScene } = useGLTF('/models/pillow.glb');
  const backrestRef = useRef();

  const fittedBed = useMemo(
    () =>
      fitModel(bedScene, {
        axis: 'longest-horizontal',
        target: 2.7,
        alignLongestToZ: true,
        lift: 0,
        onMesh: (m) => {
          const mat = m.material;
          if (!mat) return;
          const name = (mat.name || '').toLowerCase();
          if (
            name.includes('steel') ||
            name.includes('aluminium') ||
            name.includes('metal')
          ) {
            mat.metalness = 0.8;
            mat.roughness = 0.25;
          } else if (name.includes('cloth') || name.includes('mattress')) {
            mat.roughness = 0.9;
            mat.metalness = 0.0;
          }
        },
      }).object,
    [bedScene]
  );

  const fittedPillow = useMemo(
    () =>
      fitModel(pillowScene, {
        axis: 'width',
        target: 0.72,
        floor: false,
        onMesh: (m) => {
          if (m.material) {
            m.material.roughness = 0.88;
            m.material.metalness = 0;
          }
        },
      }).object,
    [pillowScene]
  );

  useFrame((_, delta) => {
    if (backrestRef.current) {
      const targetRad = THREE.MathUtils.degToRad(bedAngle * 0.72);
      backrestRef.current.rotation.x = THREE.MathUtils.lerp(
        backrestRef.current.rotation.x,
        targetRad,
        Math.min(1, delta * 18)
      );
    }
  });

  const selectBed = stop(() => onSelectObject('hospital_bed'));

  // Register the bed's measured floor footprint as a navigation obstacle (nurse walks around it)
  useEffect(() => {
    fittedBed.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(fittedBed);
    registerObstacle('hospital_bed', {
      minX: b.min.x,
      maxX: b.max.x,
      minZ: b.min.z,
      maxZ: b.max.z,
    });
    return () => unregisterObstacle('hospital_bed');
  }, [fittedBed]);

  return (
    <group onClick={selectBed}>
      <primitive object={fittedBed} />

      {/* Articulating backrest wedge + pillow under the patient's upper torso */}
      <group ref={backrestRef} position={[0, 1.06, -0.32]}>
        {bedAngle > 0 && (
          <RoundedBox
            args={[0.8, 0.08, 0.92]}
            position={[0, 0.02, -0.45]}
            radius={0.03}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial
              {...MATTE_FABRIC}
              color="#cce7de"
              sheenColor="#f0fdf4"
            />
          </RoundedBox>
        )}
        <group position={[0, 0.07, -0.76]}>
          <primitive object={fittedPillow} />
        </group>
      </group>

      {bedObj && (
        <InteractiveHotspot
          position={[0.0, 0.75, 1.38]}
          objConfig={bedObj}
          isCompleted={isCompleted}
          isSelected={isSelected}
          onSelect={onSelectObject}
        />
      )}
    </group>
  );
}

/* ---------- 2. Rigged 3D Patient + Cyanosis + Fowler's Articulation + Wristband ---------- */
const MODEL_SIZE = [0.18, 0.99, 1.0];
const MODEL_CENTER = [0, 0.495, 0];
const _tint = new THREE.Color();
const _cyanEmissive = new THREE.Color('#1e3a8a');
const _headPos = new THREE.Vector3();
const _headQuat = new THREE.Quaternion();
const _headUp = new THREE.Vector3();
const _headFront = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

function PatientAndWristband({
  bedAngle,
  o2Device,
  verifiedId,
  vitals,
  monitorConnected = true,
  verbalCues,
  wristbandObj,
  isCompleted,
  isSelected,
  onSelectObject,
}) {
  const { scene } = useGLTF('/models/patient.glb');
  const materials = useRef([]);
  const currAngleRef = useRef(0);
  const headOverlayRef = useRef();
  const maskRef = useRef();

  // Derive active patient verbal assessment cue from scenario_hypoxia.json
  const verbalState = useMemo(() => {
    const cues = verbalCues || {};
    if (!monitorConnected) {
      return {
        text: cues.admission_arrival || cues.hypoxic,
        severity: 'partial',
        badge: 'PACU ARRIVAL • HANDOFF',
      };
    }
    if (
      vitals.rr <= 10 ||
      vitals.patient_status === 'UNAROUSABLE_NARCAN_REQUIRED'
    ) {
      return {
        text: cues.bradypnea,
        severity: 'critical',
        badge: 'RR <= 10 • UNAROUSABLE',
      };
    }
    if (vitals.spo2 < 90) {
      return {
        text: cues.hypoxic,
        severity: 'warning',
        badge: `SpO2 ${vitals.spo2}% • DYSPNEA`,
      };
    }
    if (vitals.patient_status === 'STABILIZED') {
      return {
        text: cues.stabilized,
        severity: 'stable',
        badge: 'STABILIZED • ALERT',
      };
    }
    return {
      text: cues.partial_support || cues.hypoxic,
      severity: 'partial',
      badge: `SpO2 ${vitals.spo2}% • DROWSY`,
    };
  }, [
    monitorConnected,
    vitals.spo2,
    vitals.rr,
    vitals.patient_status,
    verbalCues,
  ]);

  const targetLength = 2.3;
  const scale = targetLength / Math.max(...MODEL_SIZE);
  const offset = useMemo(
    () => [
      -MODEL_CENTER[0] * scale,
      -MODEL_CENTER[1] * scale,
      -MODEL_CENTER[2] * scale,
    ],
    [scale]
  );

  useLayoutEffect(() => {
    const mats = [];
    scene.traverse((m) => {
      if (m.isMesh) {
        // The bed already casts the floor shadow; skipping shadow-map skinning on the 282k-tri
        // patient mesh saves >560k skinned vertex transforms per frame.
        m.castShadow = false;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const list = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of list) {
          if (mat && mat.isMeshStandardMaterial) mats.push(mat);
        }
      }
    });
    materials.current = mats;

    const capture = (name) => {
      const bone = scene.getObjectByName(name);
      if (bone && !bone.userData.bindQuat) {
        bone.userData.bindQuat = bone.quaternion.clone();
      }
    };
    [
      'Waist',
      'Spine01',
      'Spine02',
      'NeckTwist01',
      'NeckTwist02',
      'Head',
      'L_Clavicle',
      'R_Clavicle',
      'L_Upperarm',
      'R_Upperarm',
      'L_Forearm',
      'R_Forearm',
      'L_Hand',
      'R_Hand',
      'L_Thigh',
      'R_Thigh',
      'L_Calf',
      'R_Calf',
    ].forEach(capture);
  }, [scene]);

  useFrame((state, delta) => {
    const elapsed = state.clock.elapsedTime;
    // 1. Sub-100ms cyanosis skin tint driven by live.spo2
    const t = THREE.MathUtils.clamp((94 - live.spo2) / 14, 0, 1);
    _tint.setRGB(1 - 0.5 * t, 1 - 0.38 * t, 1 - 0.08 * t);
    for (const m of materials.current) {
      m.color.copy(_tint);
      if (m.emissive) {
        m.emissive.copy(_cyanEmissive).multiplyScalar(live.cyanosis * 0.22);
      }
    }

    // 2. Sub-100ms Fowler's / High Fowler's spine articulation + clinical state animations
    currAngleRef.current = THREE.MathUtils.lerp(
      currAngleRef.current,
      bedAngle,
      Math.min(1, delta * 18)
    );
    const elevRad = THREE.MathUtils.degToRad(currAngleRef.current);
    const breath = (Math.sin(live.respPhase - Math.PI / 2) + 1) / 2;
    const isBradypneic = live.rr <= 10;
    const isDistressed = live.spo2 < 92 && !isBradypneic;
    const distressAmt = isDistressed ? 1 : 0;
    const breathAmp = isBradypneic
      ? 0.014
      : isDistressed
        ? 0.058
        : 0.036;

    // Restless head tossing & abdominal spasm during hypoxia vs limp head roll in bradypnea
    const headRestlessYaw = isBradypneic
      ? 0.38
      : isDistressed
        ? Math.sin(elapsed * 1.9) * 0.22
        : Math.sin(elapsed * 0.6) * 0.06;
    const spasm = isDistressed ? (Math.sin(elapsed * 3.4) + 1) * 0.5 : 0;

    const pose = (name, rx, ry, rz) => {
      const bone = scene.getObjectByName(name);
      if (!bone || !bone.userData.bindQuat) return;
      bone.quaternion.copy(bone.userData.bindQuat);
      bone.rotateX(rx);
      bone.rotateY(ry);
      bone.rotateZ(rz);
    };

    // Negative X rotation on Waist/Spine01/Spine02 lifts the patient's torso upward (+Y)
    pose('Waist', -elevRad * 0.42, 0, 0);
    pose(
      'Spine01',
      -elevRad * 0.35 - breath * breathAmp - spasm * 0.035,
      isDistressed ? Math.sin(elapsed * 1.4) * 0.03 : 0,
      0
    );
    pose('Spine02', -elevRad * 0.25 - breath * breathAmp, 0, 0);
    pose('L_Clavicle', -breath * breathAmp * 0.6, 0, 0);
    // R_Clavicle has a -0.21 rad bind tilt relative to L_Clavicle; +0.21 levels the right shoulder
    // to the exact same height (y = 1.185m) as the left shoulder.
    pose('R_Clavicle', 0.21 - breath * breathAmp * 0.6, 0, 0);
    pose(
      'NeckTwist01',
      -0.4 + elevRad * 0.15 + (isBradypneic ? 0.18 : 0),
      headRestlessYaw * 0.6,
      isBradypneic ? 0.22 : 0
    );
    pose('Head', breath * 0.03, headRestlessYaw * 0.4, 0);

    // Left arm rests naturally along the patient's left side on top of the mattress for Wristband ID scan
    pose(
      'L_Upperarm',
      elevRad * 0.25,
      -Math.max(0, elevRad) * 0.08,
      -1.4
    );
    pose('L_Forearm', 0, 0.42 + breath * 0.03, 0);
    pose('L_Hand', 0, 0.42, 0);

    // Right arm rests symmetrically along the patient's right side on top of the mattress,
    // with the right hand positioned directly under the IV cannula.
    pose(
      'R_Upperarm',
      elevRad * 0.25,
      Math.max(0, elevRad) * 0.08,
      1.4
    );
    pose('R_Forearm', 0, -0.42 - breath * 0.03, 0);
    pose('R_Hand', 0, -0.42, 0);

    // Subtle restless lower-limb shift when hypoxic
    const legShift = isDistressed ? Math.sin(elapsed * 1.3) * 0.05 : 0;
    pose('L_Thigh', legShift, 0, 0);
    pose('R_Thigh', -legShift, 0, 0);

    if (headOverlayRef.current) {
      // Track the real Head bone so the O2 mask stays on the nose at every bed angle and while the
      // head tosses/rolls. Head bone +Y runs toward the crown; the face points along -Z.
      const headBone = scene.getObjectByName('Head');
      const overlay = headOverlayRef.current;
      if (headBone && overlay.parent) {
        headBone.updateWorldMatrix(true, false);
        headBone.getWorldPosition(_headPos);
        headBone.getWorldQuaternion(_headQuat);
        _headUp.set(0, 1, 0).applyQuaternion(_headQuat);
        _headFront.set(0, 0, -1).applyQuaternion(_headQuat);
        _headPos.addScaledVector(_headUp, 0.1).addScaledVector(_headFront, 0.19);
        overlay.parent.worldToLocal(overlay.position.copy(_headPos));
        if (maskRef.current) {
          // Cone tip (+Y) points away from the face so its open base sits over nose & mouth
          maskRef.current.quaternion.setFromUnitVectors(_yAxis, _headFront);
        }
      }
    }
  });

  // Exam mode: neutral border (no red/amber/green "how am I doing" colouring)
  const bubbleBorderColor = 'rgba(148, 163, 184, 0.7)';
  const hotspotCtx = React.useContext(HotspotContext);
  // The patient's verbal response is an assessment finding: it is only shown while the candidate is
  // actively at the bedside assessing the patient (Patient Wrist station open), never as a live
  // floating indicator of whether interventions are working.
  const patientAssessed = hotspotCtx.visible && isSelected;

  return (
    <group>
      {/* Rigged 3D Patient Model */}
      <group
        position={[0, 1.2, -0.1]}
        onClick={stop(() => {
          onSelectObject('wristband');
          speakPatientCue(verbalState.text, false);
        })}
      >
        <group rotation={[0, 0, Math.PI / 2]}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <group scale={scale} position={offset}>
              <primitive object={scene} />
            </group>
          </group>
        </group>
      </group>

      {/* Supplemental Oxygen Mask / Nasal Cannula + Floating Patient Speech Bubble */}
      <group ref={headOverlayRef} position={[0, 1.34, -0.92]}>
        {o2Device && (
          <mesh ref={maskRef}>
            <coneGeometry args={[0.075, 0.11, 20]} />
            <meshStandardMaterial
              color="#34d399"
              transparent
              opacity={0.62}
              roughness={0.18}
              emissive="#10b981"
              emissiveIntensity={0.8}
              toneMapped={false}
            />
          </mesh>
        )}

        {/* Interactive Patient Verbal Assessment Bubble (only once the candidate has assessed the patient) */}
        {patientAssessed && verbalState.text && (
          <Html position={[0, 0.38, 0]} center zIndexRange={[18, 0]}>
            <div
              onClick={stop(() => {
                onSelectObject('wristband');
                speakPatientCue(verbalState.text, true);
              })}
              title="Click to assess patient & trigger voice cue"
              style={{
                maxWidth: '255px',
                minWidth: '200px',
                padding: '7px 11px',
                borderRadius: '14px',
                background: 'rgba(15, 23, 42, 0.82)',
                border: `1.5px solid ${bubbleBorderColor}`,
                color: '#f8fafc',
                boxShadow:
                  'inset 0 1px 1px rgba(255,255,255,0.28), 0 10px 24px rgba(2,6,23,0.45)',
                backdropFilter: 'blur(16px) saturate(180%)',
                WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                userSelect: 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '6px',
                  marginBottom: '3px',
                }}
              >
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    color: '#cbd5e1',
                  }}
                >
                  PATIENT RESPONSE
                </span>
                <span
                  style={{
                    fontSize: '9px',
                    padding: '1px 5px',
                    borderRadius: '999px',
                    background: 'rgba(255,255,255,0.12)',
                    color: '#bae6fd',
                    fontWeight: 700,
                  }}
                >
                  🔊 Speak
                </span>
              </div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  fontStyle: verbalState.text.startsWith('[')
                    ? 'italic'
                    : 'normal',
                  lineHeight: 1.32,
                  color: '#f1f5f9',
                }}
              >
                {verbalState.text.startsWith('[')
                  ? verbalState.text
                  : `"${verbalState.text}"`}
              </div>
            </div>
          </Html>
        )}
      </group>

      {/* Procedural IV Cannula on Patient's Right Hand */}
      <group position={[-0.337, 1.135, -0.14]}>
        <mesh>
          <boxGeometry args={[0.055, 0.006, 0.07]} />
          <meshStandardMaterial
            color="#eef1f4"
            transparent
            opacity={0.82}
            roughness={0.9}
          />
        </mesh>
        <mesh position={[0, 0.012, 0.01]} rotation={[0.5, 0, 0]}>
          <cylinderGeometry args={[0.008, 0.009, 0.04, 12]} />
          <meshStandardMaterial color="#38bdf8" roughness={0.4} metalness={0.2} />
        </mesh>
      </group>

      {/* Interactive Patient ID Wristband on Patient's Left Wrist */}
      <group
        position={[0.34, 1.14, -0.16]}
        onClick={stop(() => onSelectObject('wristband'))}
      >
        <mesh rotation={[0.2, 0, 0.15]} castShadow>
          <torusGeometry args={[0.042, 0.012, 12, 24]} />
          <meshStandardMaterial
            color={verifiedId ? '#10b981' : '#ffffff'}
            emissive={verifiedId ? '#10b981' : '#38bdf8'}
            emissiveIntensity={verifiedId ? 1.4 : 0.9}
            toneMapped={false}
          />
        </mesh>
      </group>

      {wristbandObj && (
        <InteractiveHotspot
          position={[0.28, 0.92, 0.28]}
          objConfig={wristbandObj}
          isCompleted={isCompleted}
          isSelected={isSelected}
          onSelect={onSelectObject}
        />
      )}
    </group>
  );
}

/* ---------- 3. Bedside ICU Cardiomonitor (GLB + Emissive Bloom Screen) ---------- */
const MONITOR_MODEL_CENTER = [1.64, 18.19, 0.02];
const MONITOR_MODEL_MIN_Y = -18.65;
const MONITOR_SCREEN_LOCAL = [0, 46.85, -4.9];

function BedsideMonitor3D({
  patientName,
  monitorConnected = true,
  monitorObj,
  isCompleted,
  isSelected,
  onSelectObject,
}) {
  const { scene } = useGLTF('/models/heart_monitor.glb');
  const beaconRef = useRef();

  const { fitted, screen } = useMemo(() => {
    const { object, scale } = fitModel(scene, {
      axis: 'height',
      target: 1.9,
      onMesh: (m) => {
        if (m.material) {
          const n = (m.material.name || '').toLowerCase();
          if (n.includes('metal') || n.includes('steel')) {
            m.material.metalness = 0.8;
            m.material.roughness = 0.25;
          }
        }
      },
    });
    // Place the live waveform screen on the monitor's actual front face (measured from the
    // fitted mesh) so it always sits in front of the GLB's blank screen surface.
    let screen = {
      pos: [
        scale * (MONITOR_SCREEN_LOCAL[0] - MONITOR_MODEL_CENTER[0]),
        scale * (MONITOR_SCREEN_LOCAL[1] - MONITOR_MODEL_MIN_Y),
        scale * (MONITOR_SCREEN_LOCAL[2] - MONITOR_MODEL_CENTER[2]),
      ],
      rotY: Math.PI,
      w: 0.4,
      h: 0.3,
    };
    object.updateMatrixWorld(true);
    const monitorMesh = object.getObjectByName('Monitor_heart_monitor_0');
    const buttonMesh =
      object.getObjectByName('BigButton1_heart_monitor_0') ||
      object.getObjectByName('Button_Platform_heart_monitor_0');
    if (monitorMesh) {
      const mb = new THREE.Box3().setFromObject(monitorMesh);
      const mc = mb.getCenter(new THREE.Vector3());
      const ms = mb.getSize(new THREE.Vector3());
      let front = -1; // default: front faces -Z in fitted space
      if (buttonMesh) {
        const bc = new THREE.Box3().setFromObject(buttonMesh).getCenter(new THREE.Vector3());
        if (Math.abs(bc.z - mc.z) > 1e-4) front = Math.sign(bc.z - mc.z);
      }
      screen = {
        pos: [mc.x, mb.min.y + ms.y * 0.56, front > 0 ? mb.max.z + 0.006 : mb.min.z - 0.006],
        rotY: front > 0 ? 0 : Math.PI,
        w: ms.x * 0.8,
        h: ms.y * 0.66,
      };
    }
    return { fitted: object, screen };
  }, [scene]);

  const { monitor, texture } = useMemo(() => {
    const canvas = document.createElement('canvas');
    const m = new SweepMonitor(canvas, { pixelRatio: 1.5, patientName });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { monitor: m, texture: tex };
  }, [patientName]);

  useFrame((state, delta) => {
    if (monitorConnected) {
      monitor.tick(delta);
      texture.needsUpdate = true;
    }
    const mat = beaconRef.current;
    if (mat) {
      if (!monitorConnected) {
        mat.color.set('#f59e0b');
        mat.emissive.set('#f59e0b');
        mat.emissiveIntensity = 0.65;
        return;
      }
      const on = Math.floor(state.clock.elapsedTime * 2.5) % 2 === 0;
      const hypoxiaAlarm = live.alarm || live.spo2 < 90 || live.rr <= 10;
      if (hypoxiaAlarm) {
        mat.color.set('#ef4444');
        mat.emissive.set('#ef4444');
        mat.emissiveIntensity = on ? 2.5 : 0.15;
      } else {
        mat.color.set('#10b981');
        mat.emissive.set('#10b981');
        mat.emissiveIntensity = 0.9;
      }
    }
  });

  const screenW = screen.w;
  const screenH = screen.h;

  return (
    <group
      position={[1.6, 0, -0.7]}
      rotation={[0, Math.PI, 0]}
      onClick={stop(() => onSelectObject('bedside_monitor'))}
    >
      <primitive object={fitted} />

      {/* Live Emissive ICU Waveform Screen mounted on the 3D monitor face */}
      <group position={screen.pos} rotation={[0, screen.rotY, 0]}>
        <mesh position={[0, 0, 0.002]} renderOrder={1}>
          <planeGeometry args={[screenW, screenH]} />
          {monitorConnected ? (
            <meshBasicMaterial
              map={texture}
              toneMapped={false}
              polygonOffset
              polygonOffsetFactor={-4}
            />
          ) : (
            <meshBasicMaterial
              color="#0b1324"
              toneMapped={false}
              polygonOffset
              polygonOffsetFactor={-4}
            />
          )}
        </mesh>

        {/* Top Red Hypoxia Alarm Beacon (spo2 < 90% physical Bloom) */}
        <mesh position={[0, screenH / 2 + 0.055, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.045, 16]} />
          <meshStandardMaterial
            ref={beaconRef}
            color="#ef4444"
            emissive="#ef4444"
            emissiveIntensity={2.5}
            toneMapped={false}
          />
        </mesh>
      </group>

      {monitorObj && (
        <InteractiveHotspot
          position={[0, 2.06, 0]}
          objConfig={monitorObj}
          isCompleted={isCompleted}
          isSelected={isSelected}
          onSelect={onSelectObject}
        />
      )}
    </group>
  );
}

/* ---------- 4. Wall Oxygen Delivery Unit & Respiratory Ventilator Supply ---------- */
const WALL_O2_POS = [-0.88, 0, -1.845]; // x / z of the headwall flowmeter body, flush with the headwall rail
const VENTILATOR_POS = [-1.75, 0, -1.45]; // tucked into the headwall corner, leaving a walkway to the O2 outlet

function WallOxygenPanel3D({
  o2Device,
  wallO2Obj,
  isCompleted,
  isSelected,
  onSelectObject,
}) {
  const { scene: ventScene } = useGLTF('/models/ventilator.glb');
  const fittedVent = useMemo(
    () =>
      fitModel(ventScene, {
        axis: 'height',
        target: 1.65,
        onMesh: (m) => {
          // ventilator.glb is 502k triangles; disabling shadow-map rasterization on it saves >500k
          // shadow triangles per frame while a floor contact disc grounds the rolling base.
          m.castShadow = false;
          m.receiveShadow = false;
          m.raycast = () => {}; // décor: never hit-tested
          if (m.material) {
            const n = (m.material.name || '').toLowerCase();
            if (n.includes('metal') || n.includes('steel')) {
              m.material.metalness = 0.78;
              m.material.roughness = 0.26;
            }
          }
        },
      }).object,
    [ventScene]
  );

  // Register the ventilator's measured floor footprint as a navigation obstacle
  useEffect(() => {
    registerObstacle('ventilator_unit', {
      minX: VENTILATOR_POS[0] - 0.34,
      maxX: VENTILATOR_POS[0] + 0.34,
      minZ: VENTILATOR_POS[2] - 0.34,
      maxZ: VENTILATOR_POS[2] + 0.34,
    });
    return () => unregisterObstacle('ventilator_unit');
  }, []);

  const [x, , z] = WALL_O2_POS;
  return (
    <>
      {/* 3D Respiratory / Ventilator Unit beside the headwall — décor only. Kept OUTSIDE the
          clickable Wall Gas Outlet group and excluded from raycasting, so clicking it does not open
          the gas outlet station and its 502k triangles are not hit-tested on every pointer move. */}
      <group position={VENTILATOR_POS} rotation={[0, -Math.PI / 2.2, 0]}>
        <primitive object={fittedVent} />
      </group>

    <group onClick={stop(() => onSelectObject('wall_oxygen'))}>
      {/* Outlet adapter (DISS quick-connect) from the headwall O2 outlet */}
      <mesh position={[x, 1.5, z - 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.06, 16]} />
        <meshStandardMaterial {...BRUSHED_METAL} />
      </mesh>

      {/* Thorpe-tube flowmeter body */}
      <group position={[x, 1.39, z]}>
        <RoundedBox args={[0.085, 0.24, 0.07]} radius={0.015} castShadow>
          <meshStandardMaterial {...BRUSHED_METAL} />
        </RoundedBox>
        <mesh position={[0, 0.02, 0.037]}>
          <cylinderGeometry args={[0.018, 0.018, 0.16, 20]} />
          <meshPhysicalMaterial {...CLEAR_POLYMER} color="#e0f2fe" />
        </mesh>
        {/* Float ball rises when O2 is flowing */}
        <mesh position={[0, o2Device ? 0.06 : -0.05, 0.037]}>
          <sphereGeometry args={[0.011, 14, 14]} />
          <meshStandardMaterial
            color={o2Device ? '#10b981' : '#64748b'}
            emissive={o2Device ? '#10b981' : '#000000'}
            emissiveIntensity={o2Device ? 1.6 : 0}
            toneMapped={false}
          />
        </mesh>
        {/* Flow control knob */}
        <mesh position={[0, -0.135, 0.01]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 0.03, 18]} />
          <meshStandardMaterial color="#16a34a" roughness={0.4} />
        </mesh>
      </group>

      {/* Humidifier bottle hanging below the flowmeter */}
      <group position={[x, 1.15, z + 0.01]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.042, 0.038, 0.14, 24]} />
          <meshPhysicalMaterial {...CLEAR_POLYMER} color="#bae6fd" />
        </mesh>
        <mesh position={[0, -0.015, 0]}>
          <cylinderGeometry args={[0.035, 0.032, 0.09, 20]} />
          <meshPhysicalMaterial {...CLEAR_POLYMER} color="#38bdf8" />
        </mesh>
        <mesh position={[0, 0.08, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.025, 18]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </mesh>
      </group>

      {wallO2Obj && (
        <InteractiveHotspot
          position={[x, 1.8, z + 0.08]}
          objConfig={wallO2Obj}
          isCompleted={isCompleted}
          isSelected={isSelected}
          onSelect={onSelectObject}
        />
      )}
    </group>
    </>
  );
}
/* ---------- 5. IV Pole (GLB) + Morphine PCA Pump + Refractive Bag & Drip Chamber ---------- */
function IvPumpPole3D({
  pcaPaused,
  ivPumpObj,
  isCompleted,
  isSelected,
  onSelectObject,
}) {
  const { scene } = useGLTF('/models/iv_pole.glb');
  const dripDropRef = useRef();

  const fittedPole = useMemo(
    () =>
      fitModel(scene, {
        axis: 'height',
        target: 2.4,
        preprocess: (o) =>
          o.traverse((m) => {
            if (m.isMesh) m.geometry = keepHalfGeometry(m.geometry, true);
          }),
        onMesh: (m) => {
          if (m.material) {
            m.material.metalness = 0.8;
            m.material.roughness = 0.25;
          }
        },
      }).object,
    [scene]
  );

  useFrame((state) => {
    if (dripDropRef.current && !pcaPaused) {
      const t = (state.clock.elapsedTime * 1.4) % 1;
      dripDropRef.current.position.y = 1.78 - t * 0.065;
    }
  });

  return (
    <group
      position={IV_POLE_POS}
      rotation={[0, Math.PI, 0]}
      onClick={stop(() => onSelectObject('iv_pump'))}
    >
      <primitive object={fittedPole} />

      {/* Mounted Morphine PCA Infusion Pump Unit on Pole */}
      <group position={[0.16, 1.32, 0]} rotation={[0, Math.PI, 0]}>
        <RoundedBox args={[0.22, 0.3, 0.16]} radius={0.025} castShadow>
          <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.3} />
        </RoundedBox>
        <mesh position={[0, 0.02, 0.082]}>
          <planeGeometry args={[0.15, 0.17]} />
          <meshStandardMaterial
            color={pcaPaused ? '#10b981' : '#f59e0b'}
            emissive={pcaPaused ? '#10b981' : '#f59e0b'}
            emissiveIntensity={1.8}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Refractive IV Morphine PCA Infusion Bag (transmission=0.85, roughness=0.1, ior=1.33) */}
      <mesh position={[0.26, 1.98, 0.02]} castShadow>
        <capsuleGeometry args={[0.065, 0.15, 12, 24]} />
        <meshPhysicalMaterial {...CLEAR_POLYMER} color="#e0f2fe" />
      </mesh>

      {/* Refractive IV Drip Chamber + Falling Droplet */}
      <mesh position={[0.26, 1.75, 0.02]} castShadow>
        <cylinderGeometry args={[0.018, 0.015, 0.09, 20]} />
        <meshPhysicalMaterial {...CLEAR_POLYMER} color="#bae6fd" />
      </mesh>
      <mesh ref={dripDropRef} position={[0.26, 1.76, 0.02]}>
        <sphereGeometry args={[0.007, 10, 10]} />
        <meshPhysicalMaterial {...CLEAR_POLYMER} color="#38bdf8" />
      </mesh>

      {ivPumpObj && (
        <InteractiveHotspot
          position={[0.1, 2.46, 0]}
          objConfig={ivPumpObj}
          isCompleted={isCompleted}
          isSelected={isSelected}
          onSelect={onSelectObject}
        />
      )}
    </group>
  );
}

/* ---------- 6. 2D Patient EHR Workstation Cart ---------- */
/** Text-free EHR UI mock (header, sidebar, vitals trend chart, cards) for the workstation screen. */
function makeEhrScreenTexture() {
  if (typeof document === 'undefined') return null;
  const w = 512;
  const h = 346;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const rr = (x, y, ww, hh, r, col) => {
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(x, y, ww, hh, r);
    g.fill();
  };
  g.fillStyle = '#eef2f7';
  g.fillRect(0, 0, w, h);
  rr(0, 0, w, 34, 0, '#0b4fd6'); // header
  rr(12, 11, 70, 12, 6, 'rgba(255,255,255,0.85)');
  rr(w - 120, 10, 100, 14, 7, 'rgba(255,255,255,0.25)');
  rr(0, 34, 70, h - 34, 0, '#ffffff'); // sidebar
  for (let i = 0; i < 6; i++) rr(14, 52 + i * 38, 42, 22, 8, i === 1 ? '#dbe7ff' : '#f1f5f9');
  // patient card
  rr(84, 46, 200, 70, 12, '#ffffff');
  g.fillStyle = '#c7d2fe';
  g.beginPath();
  g.arc(112, 81, 18, 0, Math.PI * 2);
  g.fill();
  rr(140, 64, 110, 10, 5, '#334155');
  rr(140, 84, 80, 8, 4, '#94a3b8');
  // alert card
  rr(294, 46, 206, 70, 12, '#fff1f2');
  rr(308, 62, 14, 14, 7, '#ef4444');
  rr(332, 64, 120, 10, 5, '#b91c1c');
  rr(332, 84, 90, 8, 4, '#fca5a5');
  // trend chart card
  rr(84, 128, 416, 136, 12, '#ffffff');
  g.strokeStyle = '#e2e8f0';
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(100, 150 + i * 28);
    g.lineTo(486, 150 + i * 28);
    g.stroke();
  }
  const line = (col, base, amp, drift) => {
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= 380; x += 10) {
      const y = base + Math.sin(x * 0.045) * amp + (x / 380) * drift;
      x === 0 ? g.moveTo(104 + x, y) : g.lineTo(104 + x, y);
    }
    g.stroke();
  };
  line('#0b4fd6', 175, 8, 30);
  line('#10b981', 215, 6, -18);
  // med cards
  ['#ffffff', '#ffffff', '#ffffff'].forEach((col, i) => {
    rr(84 + i * 142, 276, 132, 56, 12, col);
    rr(98 + i * 142, 290, 22, 22, 11, ['#dbeafe', '#dcfce7', '#fef3c7'][i]);
    rr(128 + i * 142, 293, 70, 8, 4, '#334155');
    rr(128 + i * 142, 308, 48, 7, 4, '#94a3b8');
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function EhrWorkstationCart3D({
  ehrObj,
  isCompleted,
  isSelected,
  onSelectObject,
}) {
  const ehrScreenTexture = useMemo(() => makeEhrScreenTexture(), []);
  return (
    <group
      position={[1.85, 0, 0.55]}
      rotation={[0, -0.55, 0]}
      onClick={stop(() => onSelectObject('ehr_tablet'))}
    >
      <RoundedBox
        args={[0.44, 0.06, 0.44]}
        position={[0, 0.04, 0]}
        radius={0.02}
        receiveShadow
      >
        <meshStandardMaterial {...BRUSHED_METAL} color="#64748b" />
      </RoundedBox>
      <mesh position={[0, 0.56, 0]} castShadow>
        <cylinderGeometry args={[0.032, 0.04, 1.04, 20]} />
        <meshStandardMaterial {...BRUSHED_METAL} />
      </mesh>
      <RoundedBox
        args={[0.5, 0.035, 0.38]}
        position={[0, 1.08, 0]}
        radius={0.015}
        castShadow
      >
        <meshStandardMaterial color="#f1f5f9" roughness={0.3} metalness={0.1} />
      </RoundedBox>
      <RoundedBox
        args={[0.42, 0.3, 0.03]}
        position={[0, 1.3, -0.04]}
        rotation={[-0.18, 0, 0]}
        radius={0.018}
        castShadow
      >
        <meshStandardMaterial color="#0f172a" roughness={0.25} metalness={0.5} />
      </RoundedBox>
      <mesh position={[0, 1.3, -0.023]} rotation={[-0.18, 0, 0]}>
        <planeGeometry args={[0.37, 0.25]} />
        <meshBasicMaterial map={ehrScreenTexture} toneMapped={false} />
      </mesh>

      {ehrObj && (
        <InteractiveHotspot
          position={[0.22, 1.15, 0.22]}
          objConfig={ehrObj}
          isCompleted={isCompleted}
          isSelected={isSelected}
          onSelect={onSelectObject}
        />
      )}
    </group>
  );
}

/* ---------- Catmull-Rom 3D Medical Tubing & Monitor Leads ---------- */
function SplineTube({
  points,
  radius = 0.008,
  color = '#e2e8f0',
  opacity = 1,
  emissive = '#000000',
  emissiveIntensity = 0,
}) {
  const pointsKey = JSON.stringify(points);
  const geometry = useMemo(() => {
    const pts = points.map((p) => new THREE.Vector3(...p));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    return new THREE.TubeGeometry(curve, 72, radius, 10, false);
    // Keyed on the point VALUES: inline arrays are new every render and would otherwise rebuild
    // (and leak) the tube geometry on every parent re-render.
  }, [pointsKey, radius]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow>
      <meshStandardMaterial
        color={color}
        roughness={0.35}
        metalness={0.1}
        transparent={opacity < 1}
        opacity={opacity}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        toneMapped={emissiveIntensity <= 1}
      />
    </mesh>
  );
}

/** O2 mask attachment point (world) at 0° / 30° / 60° head-of-bed, from the patient's Head bone. */
const MASK_AT_ANGLE = [
  [0, [0.027, 1.421, -0.891]],
  [30, [0.019, 1.692, -0.71]],
  [60, [0.012, 1.856, -0.435]],
];
function maskPointForAngle(deg) {
  const a = THREE.MathUtils.clamp(deg, 0, 60);
  const i = a <= 30 ? 0 : 1;
  const [a0, p0] = MASK_AT_ANGLE[i];
  const [a1, p1] = MASK_AT_ANGLE[i + 1];
  const t = (a - a0) / (a1 - a0);
  return p0.map((v, k) => v + (p1[k] - v) * t);
}

function ClinicalTubes({ o2Device, pcaPaused, monitorConnected = true, bedAngle = 0 }) {
  const [mx, my, mz] = maskPointForAngle(bedAngle);
  return (
    <group>
      {/* Oxygen tubing only exists once the candidate applies O2 (no visual hint beforehand).
          Its far end follows the patient's face as the head of the bed is raised. */}
      {o2Device && (
      <SplineTube
        color={o2Device ? '#6ee7b7' : '#f4f6f9'}
        emissive={o2Device ? '#10b981' : '#000000'}
        emissiveIntensity={o2Device ? 1.2 : 0}
        radius={0.018}
        points={[
          [-0.88, 1.08, -1.83],
          [-0.84, 0.96, -1.62],
          [-0.6, 1.02, -1.32],
          [-0.3, my - 0.05, mz - 0.2],
          [mx - 0.1, my + 0.02, mz - 0.04],
          [mx - 0.03, my - 0.02, mz],
        ]}
      />
      )}

      {/* ECG & SpO2 telemetry leads are applied when the monitor is powered on */}
      {monitorConnected && (
      <>
      <SplineTube
        color="#f1f5f9"
        radius={0.007}
        points={[
          [1.41, 1.75, -0.66],
          [1.08, 1.48, -0.66],
          [0.62, 1.36, -0.64],
          [0.3, 1.3, -0.63],
          [0.1, 1.27, -0.62],
        ]}
      />
      <SplineTube
        color="#94a3b8"
        radius={0.007}
        points={[
          [1.41, 1.68, -0.7],
          [1.04, 1.44, -0.7],
          [0.58, 1.34, -0.66],
          [0.26, 1.29, -0.63],
          [-0.03, 1.27, -0.61],
        ]}
      />
      </>
      )}

      {/* IV Morphine PCA Line: IV Pole Pump / Drip Chamber -> Patient Right Hand Cannula */}
      <SplineTube
        color={pcaPaused ? '#94a3b8' : '#e9e2c6'}
        radius={0.007}
        opacity={0.6}
        points={[
          [-0.85, 1.79, -0.12],
          [-0.76, 1.42, -0.08],
          [-0.6, 1.17, -0.12],
          [-0.46, 1.13, -0.14],
          [-0.34, 1.14, -0.14],
        ]}
      />
    </group>
  );
}

/** Room alarm light pulses red when monitor is connected and SpO2 < 90%, RR <= 10, or alarm is active. */
function AlarmLight({ monitorConnected = true }) {
  const ref = useRef();
  useFrame((state) => {
    if (!ref.current) return;
    const on = Math.floor(state.clock.elapsedTime * 2.5) % 2 === 0;
    const hypoxiaAlarm =
      monitorConnected && (live.alarm || live.spo2 < 90 || live.rr <= 10);
    ref.current.color.set(hypoxiaAlarm ? '#ef4444' : '#ffffff');
    ref.current.intensity = hypoxiaAlarm ? (on ? 1.5 : 0.3) : 0.4;
  });
  return <pointLight ref={ref} position={[1.4, 2.5, -0.5]} />;
}

/**
 * Trendelenburg (head-down) tilt for the bed + patient. The bed GLB is a single mesh (deck and
 * base together), so the visual tilt is kept to a few degrees about the bed's mid-point to avoid
 * obvious wheel/floor intersection; the clinical angle (-15°) drives the physiology separately.
 */
const TRENDELENBURG_VISUAL_DEG = 4;
function TrendelenburgTilt({ bedAngle, children }) {
  const ref = useRef();
  useFrame((_, delta) => {
    if (!ref.current) return;
    const target =
      bedAngle < 0 ? -THREE.MathUtils.degToRad(TRENDELENBURG_VISUAL_DEG) : 0;
    ref.current.rotation.x = THREE.MathUtils.lerp(
      ref.current.rotation.x,
      target,
      Math.min(1, delta * 4)
    );
  });
  return <group ref={ref}>{children}</group>;
}

export default function Room3D({
  scenarioData,
  vitals,
  monitorConnected = true,
  bedAngle,
  o2Device,
  pcaPaused,
  verifiedId,
  completedObjects,
  selectedObjectId,
  onSelectObject,
  darkMode = false,
  cameraFocusId = 'overview',
  cameraTrigger = 0,
  cameraMode = 'third_person',
  introTrigger = 0,
  frozen = false,
  inspectedStations = [],
  stationLabels = {},
  onNurseArrive,
  onNurseDepart,
  quality = 'auto',
  onQualityStats,
}) {
  const controlsRef = useRef();
  const composerRef = useRef();
  const [scrubStyle, setScrubStyle] = useState('navy');
  // Controlled render resolution; AdaptiveQuality picks it and resyncs the post-processing buffers
  const [dpr, setDpr] = useState(() => dprForMode(quality));
  const nurseStateRef = useRef({
    pos: new THREE.Vector3(0.25, 0, 2.35),
    goalPos: new THREE.Vector3(0.25, 0, 2.35),
    lookTarget: new THREE.Vector3(0.0, 1.15, -0.2),
    otsCamGoal: new THREE.Vector3(0.95, 1.82, 3.65),
    yaw: Math.PI,
    isWalking: false,
    manualWalk: false,
  });

  // New exam attempt: put the nurse back at the doorway
  useEffect(() => {
    const st = nurseStateRef.current;
    st.pos.set(0.25, 0, 2.35);
    st.goalPos.set(0.25, 0, 2.35);
    st.lookTarget.set(0.0, 1.15, -0.2);
    st.yaw = Math.PI;
    st.isWalking = false;
    st.manualWalk = false;
    st.path = null;
    st.pathKey = null;
    st.speed = 0;
  }, [introTrigger]);

  const hotspotCtx = useMemo(
    () => ({
      labels: stationLabels,
      inspected: inspectedStations,
      visible: !frozen,
    }),
    [stationLabels, inspectedStations, frozen]
  );

  const getObj = (id) =>
    scenarioData.interactive_objects.find((item) => item.id === id);
  const sel = (id) => ({
    isCompleted: completedObjects.includes(id),
    isSelected: selectedObjectId === id,
    onSelectObject,
  });

  const bgColor = darkMode ? '#070c17' : '#e6ebf1';

  const handleFloorClick = (e) => {
    e.stopPropagation();
    if (frozen) return;
    const pt = e.point;
    if (!pt) return;
    // Clicking on/near furniture walks to the closest reachable floor spot (path routes around it)
    const free = nearestFree(pt.x, pt.z);
    nurseStateRef.current.goalPos.set(free.x, 0, free.z);
    nurseStateRef.current.lookTarget.set(0, 1.15, -0.2);
    nurseStateRef.current.manualWalk = true;
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        shadows
        dpr={dpr}
        // Tight near/far range = much better depth precision (no z-fighting on wall trim / floor)
        camera={{ position: [0.35, 2.25, 5.4], fov: 45, near: 0.05, far: 60 }}
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        <color attach="background" args={[bgColor]} />
        <fog attach="fog" args={[bgColor, 14, 32]} />
        <AdaptiveQuality
          mode={quality}
          composerRef={composerRef}
          onDpr={setDpr}
          onStats={onQualityStats}
        />
        <HotspotContext.Provider value={hotspotCtx}>

        <CameraRig
          cameraFocusId={cameraFocusId}
          cameraTrigger={cameraTrigger}
          cameraMode={cameraMode}
          nurseStateRef={nurseStateRef}
          controlsRef={controlsRef}
          introTrigger={introTrigger}
          frozen={frozen}
        />

        {/* Day-shift / night-shift clinical lighting rig (window sun, exam spot, reading light, fills) */}
        <RoomLighting darkMode={darkMode} />
        <AlarmLight monitorConnected={monitorConnected} />

        {/* Specular Indoor Environment Reflections (local apartment preset HDRI) */}
        <EnvironmentBoundary>
          <Suspense fallback={null}>
            <Environment
              files="/hdri/lebombo_1k.hdr"
              background={false}
              environmentIntensity={darkMode ? 0.32 : 0.4}
            />
          </Suspense>
        </EnvironmentBoundary>

        {/* Enclosed Med-Surg Patient Room (vinyl floor, headwall, window + blinds, door, curtain, clock) */}
        <group>
          <HospitalRoom
            darkMode={darkMode}
            monitorConnected={monitorConnected}
            onFloorClick={handleFloorClick}
          />

          {/* 0. Stylized Articulated 3rd-Person RN Nurse Avatar */}
          <NurseAvatar3D
            cameraFocusId={cameraFocusId}
            cameraTrigger={cameraTrigger}
            nurseStateRef={nurseStateRef}
            scrubStyle={scrubStyle}
            onToggleScrubStyle={() =>
              setScrubStyle(
                (s) => SCRUB_CYCLE[(SCRUB_CYCLE.indexOf(s) + 1) % SCRUB_CYCLE.length]
              )
            }
            frozen={frozen}
            onArrive={onNurseArrive}
            onDepart={onNurseDepart}
          />

          <Suspense fallback={null}>
            {/* 1+2. Bed and patient share one pivot so Trendelenburg (head-down) tilts both together */}
            <TrendelenburgTilt bedAngle={bedAngle}>
              {/* 1. Hospital Bed (GLB + Articulating Headrest + Pillow) */}
              <HospitalBedGLB
                bedAngle={Math.max(0, bedAngle)}
                bedObj={getObj('hospital_bed')}
                {...sel('hospital_bed')}
              />

              {/* 2. Rigged 3D Patient + Cyanosis + Fowler's Pose + Wristband + Cannula + Verbal Bubble */}
              <PatientAndWristband
                bedAngle={Math.max(0, bedAngle)}
                o2Device={o2Device}
                verifiedId={verifiedId}
                vitals={vitals}
                monitorConnected={monitorConnected}
                verbalCues={scenarioData.patient_verbal_cues}
                wristbandObj={getObj('wristband')}
                {...sel('wristband')}
              />
            </TrendelenburgTilt>

            {/* 3. Bedside ICU Cardiomonitor + Emissive Waveform Screen + Alarm Beacon */}
            <BedsideMonitor3D
              patientName={scenarioData.patient.name}
              monitorConnected={monitorConnected}
              monitorObj={getObj('bedside_monitor')}
              {...sel('bedside_monitor')}
            />

            {/* 4. Wall Oxygen Delivery Unit + Refractive Humidifier + Respiratory Unit */}
            <WallOxygenPanel3D
              o2Device={o2Device}
              wallO2Obj={getObj('wall_oxygen')}
              {...sel('wall_oxygen')}
            />

            {/* 5. IV Pole + Morphine PCA Pump + Refractive IV Bag & Drip Chamber */}
            <IvPumpPole3D
              pcaPaused={pcaPaused}
              ivPumpObj={getObj('iv_pump')}
              {...sel('iv_pump')}
            />

            {/* 6. 2D Patient EHR Workstation on Wheels */}
            <EhrWorkstationCart3D
              ehrObj={getObj('ehr_tablet')}
              {...sel('ehr_tablet')}
            />

            {/* Dynamic 3D Catmull-Rom Medical Tubing & Telemetry Leads */}
            <ClinicalTubes
              o2Device={o2Device}
              pcaPaused={pcaPaused}
              monitorConnected={monitorConnected}
              bedAngle={Math.max(0, bedAngle)}
            />
          </Suspense>

          {/* Grounding now comes from real-time shadow maps (window sun + exam spot) + N8AO.
              The per-frame ContactShadows depth bake was removed: its blurred render target
              smeared the moving nurse into a lingering dark trail on the floor. */}
        </group>

        {/* Post-Processing Pass: Bloom + Exposure/ACES + SMAA + Vignette.
            N8AO was removed because its half-res/DPR depth buffer UV mismatch projected a magnified
            dark ghost silhouette overlay across the viewport and stalled integrated GPUs. */}
        <EffectComposer ref={composerRef} multisampling={0}>
          <Bloom luminanceThreshold={1.1} mipmapBlur intensity={0.85} />
          <Exposure />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <SMAA preset={SMAAPreset.HIGH} />
          <Vignette eskil={false} offset={0.1} darkness={0.35} />
        </EffectComposer>

        </HotspotContext.Provider>

        <OrbitControls
          ref={controlsRef}
          enabled={!frozen}
          enablePan={false}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={1.6}
          maxDistance={6.5}
          target={[0, 0.95, -0.05]}
        />
      </Canvas>
    </div>
  );
}

useGLTF.preload('/models/hospital_bed_carlos.glb');
useGLTF.preload('/models/pillow.glb');
useGLTF.preload('/models/patient.glb');
useGLTF.preload('/models/nurse.glb?v=rn2');
useGLTF.preload('/models/heart_monitor.glb');
useGLTF.preload('/models/ventilator.glb');
useGLTF.preload('/models/iv_pole.glb');
