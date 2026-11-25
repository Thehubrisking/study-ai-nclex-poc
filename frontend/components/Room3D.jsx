'use client';

import React, {
  Suspense,
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
  useGLTF,
} from '@react-three/drei';
import * as THREE from 'three';
import { live } from '../lib/liveVitals';
import { SweepMonitor, LOGICAL_W, LOGICAL_H } from '../lib/monitorRenderer';
import { fitModel, keepHalfGeometry, filterGeometryTriangles } from '../lib/fitModel';
import { speakPatientCue } from '../utils/clinicalAudio';
import HospitalRoom, { RoomLighting, ROOM } from './HospitalRoom';
import AdaptiveQuality, { dprForMode, isSoftwareRenderer } from './AdaptiveQuality';
import {
  NAV,
  registerObstacle,
  unregisterObstacle,
  resolveCollisions,
  findPath,
  nearestFree,
} from '../lib/navigation';

// Locomotion tuning (m/s, m/s^2). ~1.25 m/s is a purposeful clinical walk; the mocap Walk clip
// is time-scaled to this ground speed so the feet stay planted.
const WALK_SPEED = 1.25;
const WALK_ACCEL = 3.0;
const WALK_DECEL = 4.2;
const _camFwd = new THREE.Vector3();
const _camRight = new THREE.Vector3();

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
  surgical_site: {
    nursePos: [-0.92, 0, -0.28],
    lookAt: [-0.04, 1.38, -0.16],
    otsCam: [-0.92, 2.02, 1.05],
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
  surgical_site: {
    pos: [-0.88, 2.02, 1.05],
    target: [-0.04, 1.36, -0.16],
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
 * ActorCore Photorealistic Rigged 3rd-Person RN Nurse (/models/nurse_daniel.glb)
 * - Reallusion ActorScan 3D nurse/clinician mesh (4,982 verts, 2K PBR BaseColor/Normal/ORM)
 * - 101 CC_Base bones (including CC_Base_L_Eye, CC_Base_R_Eye, CC_Base_JawRoot & full finger rig)
 * - 26 ARKit & Viseme facial morph targets (live physiological blinking, clinical focus & bedside warmth)
 * - Exact ColorID / RGBMask texture (/models/nurse_daniel_masks.png) separates skin, scrubs, eyes & hair
 * - Clicking the nurse cycles Native Surgical Plum -> StudyAI Forest -> ICU Navy -> Ceil Blue scrubs
 */
const SCRUB_PALETTES = {
  plum: {
    name: 'Surgical Plum (Native)',
    top: '#582048',
    tintStrength: 0.0,
  },
  forest: {
    name: 'StudyAI Forest',
    top: '#1e4a38',
    tintStrength: 0.92,
  },
  navy: {
    name: 'ICU Navy',
    top: '#1c3a6e',
    tintStrength: 0.92,
  },
  ceil: {
    name: 'Ceil Blue',
    top: '#3b6ea5',
    tintStrength: 0.9,
  },
};
const SCRUB_CYCLE = ['plum', 'forest', 'navy', 'ceil'];

function createNurseMaterial(src, uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    map: src.map || null,
    normalMap: src.normalMap || null,
    normalScale: src.normalScale ? src.normalScale.clone() : new THREE.Vector2(1, 1),
    roughnessMap: src.roughnessMap || null,
    metalnessMap: src.metalnessMap || null,
    aoMap: src.aoMap || null,
    aoMapIntensity: 0.72,
    roughness: 1,
    metalness: 1,
    side: THREE.DoubleSide,
    color: new THREE.Color(1, 1, 1),
    envMapIntensity: 0.85,
  });
  if (mat.map) mat.map.anisotropy = 4;
  if (mat.normalMap) mat.normalMap.anisotropy = 4;
  mat.name = 'nurse_actorscan_pbr';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uScrubColor = uniforms.uScrubColor;
    shader.uniforms.uScrubStrength = uniforms.uScrubStrength;
    shader.uniforms.uNurseMasks = uniforms.uNurseMasks;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uScrubColor;
        uniform float uScrubStrength;
        uniform sampler2D uNurseMasks;
        void main() {`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Exact Reallusion ColorID + RGBMask channels (opaque RGB PNG): R=Skin, G=Scrubs+Cap, B=Eyeballs
        #ifdef USE_MAP
          vec4 nMasks = texture2D(uNurseMasks, vMapUv);
        #else
          vec4 nMasks = vec4(0.0);
        #endif
        float nSkin = nMasks.r;
        float nCloth = nMasks.g;
        float nEye = nMasks.b;

        // Non-destructive scrub recolor when toggled (preserves ActorScan folds, stitching, lanyard, ID & skin)
        if (uScrubStrength > 0.01 && nCloth > 0.01) {
          float nLin = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 nTint = uScrubColor * clamp(nLin / 0.032, 0.0, 2.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, nTint, nCloth * uScrubStrength);
        }
        // Subtle living eye sclera clarity
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.08, nEye * 0.45);
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.90, nCloth * 0.65);
        roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor * 0.94, 0.42, 0.64), nSkin * 0.55);
        roughnessFactor = mix(roughnessFactor, 0.04, nEye * 0.95);
        `
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor *= (1.0 - nSkin) * (1.0 - nCloth) * (1.0 - nEye);
        `
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float nNdV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        float nRim = pow(1.0 - nNdV, 3.6);
        // Subtle physiological dermal wrap + woven poplin rim
        reflectedLight.directDiffuse += nSkin * reflectedLight.directDiffuse * vec3(0.045, 0.016, 0.008);
        reflectedLight.indirectDiffuse += nCloth * nRim * diffuseColor.rgb * 0.08;
        `
      );
  };
  mat.customProgramCacheKey = () => 'nurse_actorscan_std_v3';
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

const _nurseBlendQuat = new THREE.Quaternion();
/** Slerps the (mocap-animated) bone toward a procedural character-space pose by weight w. */
function blendNurseCharRotation(bone, rx, ry, rz, w) {
  if (!bone || !bone.userData.bindQuat || w <= 0.001) return;
  _nurseEuler.set(rx, ry, rz, 'XYZ');
  _nurseDeltaQuat.setFromEuler(_nurseEuler);
  _nurseLocalDelta
    .copy(bone.userData.charQuatInv)
    .multiply(_nurseDeltaQuat)
    .multiply(bone.userData.charQuat);
  _nurseBlendQuat.copy(bone.userData.bindQuat).multiply(_nurseLocalDelta);
  bone.quaternion.slerp(_nurseBlendQuat, Math.min(1, w));
}

/** Layers a small character-space rotation on top of the current (mocap) bone pose. */
function addNurseCharRotation(bone, rx, ry, rz) {
  if (!bone || !bone.userData.charQuat) return;
  _nurseEuler.set(rx, ry, rz, 'XYZ');
  _nurseDeltaQuat.setFromEuler(_nurseEuler);
  _nurseLocalDelta
    .copy(bone.userData.charQuatInv)
    .multiply(_nurseDeltaQuat)
    .multiply(bone.userData.charQuat);
  bone.quaternion.multiply(_nurseLocalDelta);
}

/* ---------- ActorCore mocap clips retargeted onto the nurse rig (see nurse_daniel.glb) ---------- */
const NURSE_GLB_URL = '/models/nurse_daniel.glb?v=ac3';
const NURSE_LOOP_CLIPS = ['Idle', 'Walk'];
const NURSE_ONE_SHOTS = ['Inspect', 'ReachHigh', 'ReachMid'];
const NURSE_CLIP_FPS = 30;
// Ground speed of the in-place Walk clip at timeScale 1 (root motion measured during the bake)
const NURSE_WALK_CLIP_SPEED = 0.917;
// Which reach the nurse performs when the candidate acts at a station
const STATION_GESTURE = {
  bedside_monitor: 'ReachHigh', // monitor power / controls at ~1.4 m
  wall_oxygen: 'ReachHigh', // headwall flowmeter
  iv_pump: 'ReachHigh', // pole-mounted PCA pump
  hospital_bed: 'ReachMid', // bed frame & side rail controls
  surgical_site: 'ReachMid', // inspect midline laparotomy dressing, JP bulb & G-tube
  wristband: 'ReachMid', // scan the patient's wristband
  ehr_tablet: 'ReachMid', // workstation keyboard / screen
};
const _footWorld = new THREE.Vector3();

const CC_BONE_ALIASES = {
  CC_Base_Hip: 'Hips',
  CC_Base_Pelvis: 'Pelvis',
  CC_Base_Waist: 'Spine',
  CC_Base_Spine01: 'Spine1',
  CC_Base_Spine02: 'Spine2',
  CC_Base_NeckTwist01: 'Neck',
  CC_Base_NeckTwist02: 'Neck2',
  CC_Base_Head: 'Head',
  CC_Base_L_Eye: 'LeftEye',
  CC_Base_R_Eye: 'RightEye',
  CC_Base_JawRoot: 'Jaw',
  CC_Base_L_Clavicle: 'LeftShoulder',
  CC_Base_R_Clavicle: 'RightShoulder',
  CC_Base_L_Upperarm: 'LeftArm',
  CC_Base_R_Upperarm: 'RightArm',
  CC_Base_L_Forearm: 'LeftForeArm',
  CC_Base_R_Forearm: 'RightForeArm',
  CC_Base_L_Hand: 'LeftHand',
  CC_Base_R_Hand: 'RightHand',
  CC_Base_L_Thigh: 'LeftUpLeg',
  CC_Base_R_Thigh: 'RightUpLeg',
  CC_Base_L_Calf: 'LeftLeg',
  CC_Base_R_Calf: 'RightLeg',
  CC_Base_L_Foot: 'LeftFoot',
  CC_Base_R_Foot: 'RightFoot',
  CC_Base_L_ToeBase: 'LeftToeBase',
  CC_Base_R_ToeBase: 'RightToeBase',
};

function NurseAvatar3D({
  cameraFocusId,
  cameraTrigger,
  nurseStateRef,
  scrubStyle = 'plum',
  onToggleScrubStyle,
  frozen = false,
  onArrive,
  onDepart,
  onReachSideRail,
  nurseCue,
}) {
  const { scene: nurseGltfScene, animations: nurseClips } = useGLTF(NURSE_GLB_URL);
  const mixerRef = useRef(null);
  const actionsRef = useRef({});
  const weightsRef = useRef({ Idle: 1, Walk: 0, Inspect: 0, ReachHigh: 0, ReachMid: 0 });
  const oneShotRef = useRef({ active: null, pending: null, pendingAge: 0 });
  const arrivedRef = useRef(false);
  const groupRef = useRef();
  const blobRef = useRef();
  const leftFootShadowRef = useRef();
  const rightFootShadowRef = useRef();
  const navRingRef = useRef();
  const bonesRef = useRef({});
  const morphMeshesRef = useRef([]);
  const headLookYawRef = useRef(0);
  const headLookPitchRef = useRef(0);
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
  const masksTexture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const tex = new THREE.TextureLoader().load('/models/nurse_daniel_masks.png?v=ac3');
    tex.flipY = false; // Match glTF UV origin (top-left)
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }, []);
  const scrubColorUniform = useRef({ value: new THREE.Color('#1e4a38') });
  const scrubStrengthUniform = useRef({ value: 0.0 });
  const masksUniform = useRef({ value: null });
  masksUniform.current.value = masksTexture;

  const keysRef = useRef({});
  const smoothSpeedRef = useRef(0);
  const reachBlendRef = useRef(0);

  const palette = SCRUB_PALETTES[scrubStyle] || SCRUB_PALETTES.plum;

  useEffect(() => {
    scrubColorUniform.current.value.set(palette.top);
    scrubStrengthUniform.current.value = palette.tintStrength;
  }, [palette.top, palette.tintStrength]);

  // Configure ActorScan PBR shader, morph target references, and CC_Base character-space bind quaternions
  useLayoutEffect(() => {
    if (!nurseGltfScene) return;

    nurseGltfScene.traverse((obj) => {
      if (obj.userData.bindQuat) obj.quaternion.copy(obj.userData.bindQuat);
      if (obj.userData.bindPos) obj.position.copy(obj.userData.bindPos);
    });

    nurseGltfScene.updateMatrixWorld(true);
    const sceneWorldQuatInv = new THREE.Quaternion();
    nurseGltfScene.getWorldQuaternion(sceneWorldQuatInv).invert();
    const boneWorldQuat = new THREE.Quaternion();
    const map = {};
    const morphMeshes = [];

    nurseGltfScene.traverse((obj) => {
      if (obj.isMesh) {
        // Nurse Daniel already renders 3 real-time ground/foot contact AO shadows;
        // skipping dynamic shadow-map skinning lets us cache the room shadow map at 0 cost/frame!
        obj.castShadow = false;
        obj.receiveShadow = true;
        obj.frustumCulled = false;
        // Never CPU-raycast SkinnedMesh on pointermove; a 12-triangle hitbox handles clicks
        obj.raycast = () => {};

        if (obj.morphTargetDictionary && obj.morphTargetInfluences) {
          morphMeshes.push(obj);
        }

        if (!obj.userData.nursePbr) {
          obj.material = createNurseMaterial(obj.material, {
            uScrubColor: scrubColorUniform.current,
            uScrubStrength: scrubStrengthUniform.current,
            uNurseMasks: masksUniform.current,
          });
          obj.userData.nursePbr = true;
        }
      }

      if (
        obj.isBone ||
        (obj.name && (obj.name.startsWith('CC_Base_') || obj.name === 'RL_BoneRoot'))
      ) {
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

        map[obj.name] = obj;
        if (CC_BONE_ALIASES[obj.name]) {
          map[CC_BONE_ALIASES[obj.name]] = obj;
        }
        // Finger aliases: CC_Base_L_Mid1 -> LeftHandMiddle1, CC_Base_L_Index1 -> LeftHandIndex1, etc.
        const fingerMatch = obj.name.match(/^CC_Base_(L|R)_(Index|Mid|Ring|Pinky|Thumb)([123])$/);
        if (fingerMatch) {
          const side = fingerMatch[1] === 'L' ? 'LeftHand' : 'RightHand';
          const fname = fingerMatch[2] === 'Mid' ? 'Middle' : fingerMatch[2];
          map[`${side}${fname}${fingerMatch[3]}`] = obj;
        }
      }
    });

    bonesRef.current = map;
    morphMeshesRef.current = morphMeshes;
  }, [nurseGltfScene]);

  // Mocap animation mixer: looping Idle/Walk base layer + one-shot Inspect / Reach gestures
  useLayoutEffect(() => {
    if (!nurseGltfScene || !nurseClips?.length) return undefined;
    const mixer = new THREE.AnimationMixer(nurseGltfScene);
    const actions = {};
    [...NURSE_LOOP_CLIPS, ...NURSE_ONE_SHOTS].forEach((name) => {
      const src = THREE.AnimationClip.findByName(nurseClips, name);
      if (!src) return;
      // Drop the exporter's trailing hold-frame so loops wrap seamlessly
      const frames = Math.round(src.duration * NURSE_CLIP_FPS);
      const clip = THREE.AnimationUtils.subclip(src, name, 0, frames, NURSE_CLIP_FPS);
      const action = mixer.clipAction(clip);
      if (NURSE_LOOP_CLIPS.includes(name)) {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.setEffectiveWeight(weightsRef.current[name] || 0);
      actions[name] = action;
    });
    // Desynchronise the idle so it never starts on the exact same frame
    if (actions.Idle) actions.Idle.time = Math.random() * actions.Idle.getClip().duration;
    mixerRef.current = mixer;
    actionsRef.current = actions;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(nurseGltfScene);
      mixerRef.current = null;
      actionsRef.current = {};
    };
  }, [nurseGltfScene, nurseClips]);

  // Station actions performed in the panel -> the nurse physically reaches for the equipment
  useEffect(() => {
    if (!nurseCue || !nurseCue.nonce) return;
    oneShotRef.current.pending = STATION_GESTURE[nurseCue.station] || 'ReachMid';
    oneShotRef.current.pendingAge = 0;
  }, [nurseCue?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

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
    st.pendingRailSide = null;
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

    let inputFwd = 0;
    let inputRight = 0;
    if (keys.KeyW || keys.ArrowUp) inputFwd += 1;
    if (keys.KeyS || keys.ArrowDown) inputFwd -= 1;
    if (keys.KeyA || keys.ArrowLeft) inputRight -= 1;
    if (keys.KeyD || keys.ArrowRight) inputRight += 1;

    // Camera-relative XZ movement so WASD always steers naturally from any Free Orbit angle
    let moveX = 0;
    let moveZ = 0;
    if (inputFwd !== 0 || inputRight !== 0) {
      state.camera.getWorldDirection(_camFwd);
      _camFwd.y = 0;
      if (_camFwd.lengthSq() < 1e-5) _camFwd.set(0, 0, -1);
      else _camFwd.normalize();
      _camRight.set(-_camFwd.z, 0, _camFwd.x);
      moveX = _camFwd.x * inputFwd + _camRight.x * inputRight;
      moveZ = _camFwd.z * inputFwd + _camRight.z * inputRight;
    }

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
      st.pendingRailSide = null;
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

        // Bedside rail arrival: reach out with mocap "ReachMid" and physically raise/lower the rail
        if (!frozen && st.pendingRailSide) {
          const railSide = st.pendingRailSide;
          st.pendingRailSide = null;
          st.facingRailUntil = t + 2.2;
          oneShotRef.current.pending = 'ReachMid';
          oneShotRef.current.pendingAge = 0;
          setTimeout(() => {
            onReachSideRail?.(railSide);
          }, 180);
        }

        // Station arrival: the station panel only opens once the nurse is physically there
        if (
          !frozen &&
          !arrivedRef.current &&
          !st.manualWalk &&
          cameraFocusId &&
          cameraFocusId !== 'overview'
        ) {
          arrivedRef.current = true;
          // Lean in and examine the equipment on arrival (mocap "Inspect")
          oneShotRef.current.pending = 'Inspect';
          oneShotRef.current.pendingAge = 0;
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

    // Safety net: if a station or rail walk is blocked by furniture (no real progress for 1.2 s), treat it
    // as arrived so the interaction can never become unreachable.
    if (!manualInput && desiredSpeed > 0 && moved < 0.004) {
      st.stuckT = (st.stuckT || 0) + frameDt;
      if (st.stuckT > 1.2 && !frozen) {
        if (st.pendingRailSide) {
          const railSide = st.pendingRailSide;
          st.pendingRailSide = null;
          st.path = [{ x: st.pos.x, z: st.pos.z }];
          st.goalPos.set(st.pos.x, 0, st.pos.z);
          st.facingRailUntil = t + 2.2;
          oneShotRef.current.pending = 'ReachMid';
          oneShotRef.current.pendingAge = 0;
          setTimeout(() => onReachSideRail?.(railSide), 180);
        } else if (
          !st.manualWalk &&
          !arrivedRef.current &&
          cameraFocusId &&
          cameraFocusId !== 'overview'
        ) {
          st.path = [{ x: st.pos.x, z: st.pos.z }];
          st.goalPos.set(st.pos.x, 0, st.pos.z);
          arrivedRef.current = true;
          onArrive?.(cameraFocusId);
        }
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
      (!isWalking && !st.manualWalk && cameraFocusId && cameraFocusId !== 'overview') ||
      Boolean(!isWalking && st.facingRailUntil && t < st.facingRailUntil);
    reachBlendRef.current = THREE.MathUtils.lerp(
      reachBlendRef.current,
      isAtStation ? 1 : 0,
      Math.min(1, frameDt * 6)
    );
    const reach = reachBlendRef.current;

    if (!nurseGltfScene) return;
    const B = (name) => bonesRef.current[name];

    // Station posture classification (drives facial expression + gaze weight)
    const isChartingStation = cameraFocusId === 'ehr_tablet';
    const isPanelStation =
      cameraFocusId === 'bedside_monitor' ||
      cameraFocusId === 'iv_pump' ||
      cameraFocusId === 'wall_oxygen';
    const isBedsideStation =
      cameraFocusId === 'wristband' || cameraFocusId === 'hospital_bed';

    // ---------- 1. Mocap state machine (ActorCore clips retargeted onto the CC_Base rig) ----------
    const mixer = mixerRef.current;
    const actions = actionsRef.current;
    const wts = weightsRef.current;
    const shot = oneShotRef.current;

    // Start a requested one-shot once the nurse has (almost) stopped walking
    if (shot.pending) {
      shot.pendingAge += frameDt;
      if (w < 0.25 && actions[shot.pending]) {
        const next = shot.pending;
        const cur = shot.active ? actions[shot.active] : null;
        const sameAndFresh =
          cur && shot.active === next && cur.time < cur.getClip().duration * 0.6;
        if (!sameAndFresh) {
          const a = actions[next];
          a.reset();
          a.setEffectiveTimeScale(1);
          a.play();
          shot.active = next;
        }
        shot.pending = null;
      } else if (shot.pendingAge > 1.6) {
        shot.pending = null; // candidate kept walking: drop the gesture
      }
    }

    // A one-shot fades out near its end, or immediately when the nurse starts walking again
    let shotTarget = 0;
    let shotRate = 5;
    if (shot.active) {
      const a = actions[shot.active];
      const remaining = a ? a.getClip().duration - a.time : 0;
      if (!a || w > 0.15) {
        shotRate = 9;
      } else if (remaining > 0.45) {
        shotTarget = 1;
      }
    }

    let shotSum = 0;
    NURSE_ONE_SHOTS.forEach((name) => {
      const target = name === shot.active ? shotTarget : 0;
      wts[name] += (target - wts[name]) * Math.min(1, frameDt * shotRate);
      if (wts[name] < 0.002 && target === 0) {
        wts[name] = 0;
        if (actions[name]?.isRunning()) actions[name].stop();
        if (shot.active === name && shotTarget === 0) shot.active = null;
      }
      shotSum += wts[name];
    });
    shotSum = Math.min(1, shotSum);

    // Base layer: Idle <-> Walk by real ground speed; one-shots take the remaining weight
    wts.Walk = w * (1 - shotSum);
    wts.Idle = (1 - w) * (1 - shotSum);

    if (mixer) {
      Object.entries(actions).forEach(([name, a]) => a.setEffectiveWeight(wts[name] || 0));
      // Lock stride to ground speed so the feet plant instead of skating
      if (actions.Walk) {
        actions.Walk.setEffectiveTimeScale(
          THREE.MathUtils.clamp(vs / NURSE_WALK_CLIP_SPEED, 0.55, 1.75)
        );
      }
      mixer.update(frameDt);
    }

    // ---------- 2. Procedural overlays on top of the mocap ----------
    // Subtle breathing so even the short idle never looks frozen
    const breath = Math.sin(t * 2.05) * 0.012;
    addNurseCharRotation(B('Spine2'), breath * 0.6, 0, 0);
    addNurseCharRotation(B('LeftShoulder'), 0, 0, -breath * 0.35);
    addNurseCharRotation(B('RightShoulder'), 0, 0, breath * 0.35);

    // Head / neck gaze toward the station target (or a calm room scan when idle in open floor)
    const lookDx = st.lookTarget.x - st.pos.x;
    const lookDz = st.lookTarget.z - st.pos.z;
    const horizDist = Math.max(0.35, Math.hypot(lookDx, lookDz));
    let relLookYaw = Math.atan2(lookDx, lookDz) - st.yaw;
    while (relLookYaw > Math.PI) relLookYaw -= Math.PI * 2;
    while (relLookYaw < -Math.PI) relLookYaw += Math.PI * 2;
    const idleScanYaw =
      (Math.sin(t * 0.52) * 0.22 + Math.sin(t * 1.31) * 0.05) * (1 - w) * (1 - reach);
    const idleScanPitch = Math.sin(t * 0.37 + 1.3) * 0.05 * (1 - w) * (1 - reach);
    const targetYaw =
      THREE.MathUtils.clamp(relLookYaw, -0.62, 0.62) * reach + idleScanYaw;
    const targetPitch =
      THREE.MathUtils.clamp(Math.atan2(1.636 - st.lookTarget.y, horizDist), -0.3, 0.38) * reach +
      idleScanPitch;
    headLookYawRef.current = THREE.MathUtils.lerp(
      headLookYawRef.current,
      targetYaw,
      Math.min(1, frameDt * 5)
    );
    headLookPitchRef.current = THREE.MathUtils.lerp(
      headLookPitchRef.current,
      targetPitch,
      Math.min(1, frameDt * 5)
    );
    const headYaw = headLookYawRef.current;
    const headPitch = headLookPitchRef.current;
    // Gaze weight: none while walking (natural mocap head), partial during gestures / Inspect lean
    const lookW =
      (1 - w) *
      (0.55 - 0.25 * (wts.Inspect || 0) - 0.15 * ((wts.ReachHigh || 0) + (wts.ReachMid || 0)));
    blendNurseCharRotation(B('Neck'), headPitch * 0.3, headYaw * 0.28, 0, lookW);
    blendNurseCharRotation(B('Neck2'), headPitch * 0.22, headYaw * 0.22, 0, lookW);
    blendNurseCharRotation(B('Head'), headPitch * 0.48, headYaw * 0.5, 0, lookW);

    // Organic blink (~150ms blink every ~3.9s) + eye-gaze lead (eyes are not driven by the mocap)
    const bWave = Math.sin(t * 0.81) * 0.5 + Math.sin(t * 1.93 + 1.2) * 0.5;
    const blink = THREE.MathUtils.smoothstep(bWave, 0.945, 0.992);
    const eyeYaw =
      THREE.MathUtils.clamp(headYaw * 0.24 + Math.sin(t * 2.3) * 0.018, -0.18, 0.18) * (1 - blink);
    const eyePitch = THREE.MathUtils.clamp(headPitch * 0.22, -0.14, 0.14) * (1 - blink);
    setNurseCharRotation(B('LeftEye'), eyePitch, eyeYaw, 0);
    setNurseCharRotation(B('RightEye'), eyePitch, eyeYaw, 0);

    // ---------- 3. Real-time ARKit facial animation (blinks, clinical focus, bedside warmth) ----------
    const focusing = Math.max(reach, wts.Inspect || 0);
    for (const mesh of morphMeshesRef.current) {
      const dict = mesh.morphTargetDictionary;
      const infl = mesh.morphTargetInfluences;
      if (!dict || !infl) continue;
      const setMorph = (name, val) => {
        const idx = dict[name];
        if (idx !== undefined) infl[idx] = val;
      };
      setMorph('Eyes_Blink', blink);
      const focusWeight = (isPanelStation || isChartingStation ? 1 : 0) * focusing;
      const bedsideWeight = (isBedsideStation ? 1 : 0) * focusing;
      setMorph('Brow_Drop_Left', focusWeight * 0.24);
      setMorph('Brow_Drop_Right', focusWeight * 0.24);
      setMorph('Eye_Squint_L', focusWeight * 0.14 + bedsideWeight * 0.08);
      setMorph('Eye_Squint_R', focusWeight * 0.14 + bedsideWeight * 0.08);
      setMorph('A01_Brow_Inner_Up', bedsideWeight * 0.2);
      setMorph('Mouth_Smile', bedsideWeight * 0.16 + (1 - reach) * 0.04);
      setMorph('Mouth_Lips_Part', 0.04 + Math.max(0, breath) * 1.6);
    }

    // ---------- 4. Contact shadows follow the real (animated) shoe positions ----------
    if (blobRef.current) blobRef.current.material.opacity = 0.28 - w * 0.04;
    if (navRingRef.current) {
      navRingRef.current.material.opacity = THREE.MathUtils.lerp(0.05, 0.14, w);
    }
    if (groupRef.current) {
      groupRef.current.updateWorldMatrix(true, false);
      [
        [B('LeftFoot'), leftFootShadowRef.current],
        [B('RightFoot'), rightFootShadowRef.current],
      ].forEach(([foot, shadow]) => {
        if (!foot || !shadow) return;
        foot.updateWorldMatrix(true, false);
        foot.getWorldPosition(_footWorld);
        groupRef.current.worldToLocal(_footWorld);
        const lift = THREE.MathUtils.clamp((_footWorld.y - 0.1) / 0.14, 0, 1);
        shadow.position.set(_footWorld.x, 0.007, _footWorld.z + 0.04);
        shadow.material.opacity = 0.36 * (1 - lift * 0.75);
      });
    }
  });

  return (
    <group
      ref={groupRef}
      position={[0.25, 0, 2.35]}
    >
      {/* Ambient torso ground shadow + dual shoe-sole contact AO */}
      <mesh
        ref={blobRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.005, 0.02]}
        renderOrder={1}
      >
        <planeGeometry args={[0.72, 0.72]} />
        <meshBasicMaterial
          map={blobTexture}
          color="#000000"
          transparent
          opacity={0.28}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
      <mesh
        ref={leftFootShadowRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0.095, 0.007, 0.05]}
        scale={[0.85, 1.35, 1]}
        renderOrder={1}
      >
        <planeGeometry args={[0.24, 0.24]} />
        <meshBasicMaterial
          map={blobTexture}
          color="#000000"
          transparent
          opacity={0.36}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-3}
        />
      </mesh>
      <mesh
        ref={rightFootShadowRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[-0.095, 0.007, 0.05]}
        scale={[0.85, 1.35, 1]}
        renderOrder={1}
      >
        <planeGeometry args={[0.24, 0.24]} />
        <meshBasicMaterial
          map={blobTexture}
          color="#000000"
          transparent
          opacity={0.36}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-3}
        />
      </mesh>

      {/* Whisper-subtle StudyAI mint hairline floor cue (only faintly visible during locomotion) */}
      <mesh
        ref={navRingRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.011, 0]}
        renderOrder={2}
      >
        <ringGeometry args={[0.284, 0.294, 48]} />
        <meshBasicMaterial
          color="#6fd1a9"
          transparent
          opacity={0.05}
          depthWrite={false}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-4}
        />
      </mesh>

      {/* ActorCore Photorealistic Rigged RN Nurse (/models/nurse_daniel.glb, native 1.77m height) */}
      <group scale={1}>
        <primitive object={nurseGltfScene} />
      </group>
    </group>
  );
}

function CameraRig({
  cameraFocusId,
  cameraTrigger,
  controlsRef,
  isAnimatingRef,
  introTrigger = 0,
  frozen = false,
}) {
  const { camera } = useThree();
  const animTimerRef = useRef(0);
  const goalPos = useMemo(() => new THREE.Vector3(...CAMERA_PRESETS.overview.pos), []);
  const goalTarget = useMemo(() => new THREE.Vector3(...CAMERA_PRESETS.overview.target), []);
  const _frozenPos = useMemo(() => new THREE.Vector3(...FROZEN_WIDE_CAMERA.pos), []);
  const _frozenTarget = useMemo(() => new THREE.Vector3(...FROZEN_WIDE_CAMERA.target), []);

  useEffect(() => {
    const preset = CAMERA_PRESETS[cameraFocusId] || CAMERA_PRESETS.overview;
    goalPos.set(...preset.pos);
    goalTarget.set(...preset.target);
    isAnimatingRef.current = true;
    animTimerRef.current = 0;
  }, [cameraFocusId, cameraTrigger, introTrigger, goalPos, goalTarget, isAnimatingRef]);

  useFrame((_, delta) => {
    const targetFov = frozen ? 42 : 44;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, delta * 4));
      camera.updateProjectionMatrix();
    }

    // Frozen exam gate (pre-briefing / exit questions / report): hold wide establishing shot
    if (frozen) {
      camera.position.lerp(_frozenPos, Math.min(1, delta * 2.5));
      if (controlsRef.current) {
        controlsRef.current.target.lerp(_frozenTarget, Math.min(1, delta * 2.5));
        controlsRef.current.update();
      }
      return;
    }

    // Keep Free Orbit pan target gently bounded inside the room interior
    if (controlsRef.current && !isAnimatingRef.current) {
      const tgt = controlsRef.current.target;
      tgt.x = THREE.MathUtils.clamp(tgt.x, ROOM.minX + 0.5, ROOM.maxX - 0.4);
      tgt.y = THREE.MathUtils.clamp(tgt.y, 0.45, 1.9);
      tgt.z = THREE.MathUtils.clamp(tgt.z, ROOM.minZ + 0.4, ROOM.maxZ - 0.6);
      return;
    }

    if (!isAnimatingRef.current) return;
    animTimerRef.current += delta;
    const step = Math.min(1, delta * 5.5);

    camera.position.lerp(goalPos, step);
    if (controlsRef.current) {
      controlsRef.current.target.lerp(goalTarget, step);
      controlsRef.current.update();
    }

    if (
      animTimerRef.current > 0.9 ||
      (camera.position.distanceTo(goalPos) < 0.04 &&
        (!controlsRef.current ||
          controlsRef.current.target.distanceTo(goalTarget) < 0.04))
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
  // StudyAI Figma 36:53..36:67 Hotspot Design: circular mint/amber ring + dark forest label pill
  const ringBorder = isSelected ? '#e8b04b' : isCompleted ? '#4e8a72' : '#6fd1a9';
  const ringFill = isSelected
    ? 'rgba(232, 176, 75, 0.22)'
    : isCompleted
      ? 'rgba(78, 138, 114, 0.14)'
      : 'rgba(111, 209, 169, 0.14)';

  return (
    <group position={position}>
      <Html center zIndexRange={[20, 0]}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            onSelect(objConfig.id);
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '5px',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            transform: hovered || isSelected ? 'scale(1.08)' : 'scale(1)',
            transition: 'transform 0.15s ease',
            fontFamily: 'inherit',
          }}
        >
          <span
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: ringFill,
              border: `2px solid ${ringBorder}`,
              boxShadow: isSelected
                ? '0 0 0 4px rgba(232, 176, 75, 0.18), 0 6px 18px rgba(10, 19, 16, 0.45)'
                : '0 0 0 4px rgba(111, 209, 169, 0.10), 0 6px 18px rgba(10, 19, 16, 0.4)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: ringBorder,
              }}
            />
          </span>
          <span
            style={{
              padding: '3px 11px',
              borderRadius: '999px',
              background: isSelected ? '#143528' : 'rgba(10, 19, 16, 0.88)',
              border: isSelected ? '1px solid #6fd1a9' : '1px solid #2a4136',
              color: '#ddebe4',
              fontSize: '11px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 6px 16px rgba(0, 0, 0, 0.35)',
            }}
          >
            {stationLabel}
          </span>
        </button>
      </Html>
    </group>
  );
}

/* ---------- 1. Hospital Bed (GLB + PBR Metallic Frame & Quilted Coverlet) ---------- */
function makeQuiltedBlanketTexture() {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');

  // Warm oat/beige quilted comforter tone from reference photo
  g.fillStyle = '#d7cab5';
  g.fillRect(0, 0, size, size);

  // Subtle puffy shading inside each quilted square
  const step = 64;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const grad = g.createRadialGradient(
        x + step * 0.48,
        y + step * 0.45,
        4,
        x + step * 0.5,
        y + step * 0.5,
        step * 0.65
      );
      grad.addColorStop(0, 'rgba(255, 252, 245, 0.22)');
      grad.addColorStop(0.7, 'rgba(215, 202, 181, 0.0)');
      grad.addColorStop(1, 'rgba(130, 114, 92, 0.24)');
      g.fillStyle = grad;
      g.fillRect(x, y, step, step);
    }
  }

  // Quilted stitch lines
  g.strokeStyle = 'rgba(138, 122, 100, 0.45)';
  g.lineWidth = 2;
  for (let i = 0; i <= size; i += step) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(size, i);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.5, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Interactive 3D Hospital Bed Side Rail extracted directly from `hospital_bed_carlos.glb`.
 * Starts folded down below the mattress on PACU arrival with zero text spoilers — the student
 * visually observes the lowered rails and clicks directly on each 3D rail to walk the nurse over,
 * grab it (`ReachMid`), and swing/lock it up along its four-bar parallelogram hinge linkage.
 */
function InteractiveBedSideRail({ side, isUp, geometry, baseMaterial, frozen, onRailClick }) {
  const railGroupRef = useRef();
  const armFrontRef = useRef();
  const armBackRef = useRef();
  const progressRef = useRef(isUp ? 1 : 0);
  const [hovered, setHovered] = useState(false);
  const sideSign = side === 'left' ? 1 : -1;

  const railMaterial = useMemo(() => {
    const m = baseMaterial ? baseMaterial.clone() : new THREE.MeshStandardMaterial({ color: '#dde3ea' });
    m.roughness = 0.28;
    m.metalness = 0.35;
    return m;
  }, [baseMaterial]);

  useEffect(() => {
    if (!hovered) return undefined;
    document.body.style.cursor = 'pointer';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

  useFrame((_, delta) => {
    const goal = isUp ? 1 : 0;
    // Smooth mechanical swing (~0.48s travel)
    progressRef.current = THREE.MathUtils.damp(progressRef.current, goal, 7.5, Math.min(delta, 0.1));
    const p = progressRef.current;

    // Four-bar parallelogram linkage kinematics: swings ~84° down & toward foot when stowed
    const maxSwingRad = 1.46;
    const theta = (1 - p) * maxSwingRad;
    const armLen = 0.34;
    const dy = -armLen * (1 - Math.cos(theta));
    const dz = armLen * Math.sin(theta) * 0.38;
    const dx = sideSign * (1 - p) * 0.022;

    if (railGroupRef.current) {
      railGroupRef.current.position.set(dx, dy, dz);
    }

    // Subtle metallic sheen highlight only while hovered
    if (railMaterial.emissive) {
      railMaterial.emissive.setHex(hovered && !frozen ? 0x2f7a58 : 0x000000);
      railMaterial.emissiveIntensity = hovered && !frozen ? 0.35 : 0;
    }

    // Rotate the two stainless-steel swing-arm links connecting frame track -> rail
    const armRotX = Math.atan2(dz, armLen + dy);
    if (armFrontRef.current) armFrontRef.current.rotation.x = armRotX;
    if (armBackRef.current) armBackRef.current.rotation.x = armRotX;
  });

  const handleClick = (e) => {
    e.stopPropagation();
    if (frozen) return;
    onRailClick?.(side);
  };

  return (
    <group>
      {/* Articulated four-bar stainless-steel pivot arms anchored to the aluminium bed rail track */}
      {[-0.56, 0.44].map((zPivot, idx) => (
        <group
          key={zPivot}
          ref={idx === 0 ? armBackRef : armFrontRef}
          position={[sideSign * 0.566, 0.875, zPivot]}
        >
          <mesh position={[0, 0.08, 0]} castShadow>
            <boxGeometry args={[0.014, 0.17, 0.024]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.82} roughness={0.24} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.013, 0.013, 0.024, 12]} />
            <meshStandardMaterial color="#64748b" metalness={0.85} roughness={0.25} />
          </mesh>
        </group>
      ))}

      {/* Moving split side-rail assembly — triggered ONLY by clicking its dedicated marker pin */}
      <group ref={railGroupRef} position={[sideSign * (isUp ? 0 : 0.022), isUp ? 0 : -0.305, isUp ? 0 : 0.128]}>
        {geometry && (
          <mesh
            geometry={geometry}
            material={railMaterial}
            castShadow
            receiveShadow
            raycast={() => {}}
          />
        )}

        {/* Dedicated spoiler-free Side Rail Marker Pin */}
        {!frozen && (
          <Html position={[sideSign * 0.58, 1.18, 0.05]} center zIndexRange={[20, 0]}>
            <button
              type="button"
              onClick={handleClick}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                transform: hovered ? 'scale(1.1)' : 'scale(1)',
                transition: 'transform 0.15s ease',
                fontFamily: 'inherit',
              }}
            >
              <span
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: isUp
                    ? 'rgba(78, 138, 114, 0.18)'
                    : 'rgba(111, 209, 169, 0.16)',
                  border: `2px solid ${isUp ? '#4e8a72' : '#6fd1a9'}`,
                  boxShadow: '0 0 0 3px rgba(111, 209, 169, 0.10), 0 6px 16px rgba(10, 19, 16, 0.4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span
                  style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    background: isUp ? '#4e8a72' : '#6fd1a9',
                  }}
                />
              </span>
              {hovered && (
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: '999px',
                    background: 'rgba(10, 19, 16, 0.92)',
                    border: '1px solid #6fd1a9',
                    color: '#eaf2ee',
                    fontSize: '11px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
                  }}
                >
                  Side Rail
                </span>
              )}
            </button>
          </Html>
        )}
      </group>
    </group>
  );
}

const PILLOW_GLB_URL = '/models/pillow.glb?v=cradle_v1';

/**
 * Builds a static, lightweight (~6.8k tri) 3D quilted hospital bed pad with realistic
 * weight-bearing depressions + baked vertex-color contact AO underneath the patient's
 * pelvis/sacrum, splayed thighs, calves, and heels (zero runtime CPU/GPU deformation cost).
 */
function createDepressedBedPadGeometry() {
  const geo = new THREE.BoxGeometry(0.92, 0.054, 1.38, 36, 2, 48);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i); // local Z in [-0.69, +0.69]; world Z = z + 0.38 -> [-0.31, +1.07]
    const wz = z + 0.38;

    const edgeX = Math.max(0, (Math.abs(x) - 0.39) / 0.07);
    const edgeZ = Math.max(0, (Math.abs(z) - 0.61) / 0.08);
    const edgeRoll = Math.min(1, Math.hypot(edgeX, edgeZ));

    let sink = 0;
    let bolster = 0;
    if (y > -0.01) {
      const topWeight = THREE.MathUtils.clamp((y + 0.01) / 0.036, 0, 1);

      // 1. Pelvic / sacral weight sinkage (world Z ~ -0.22..+0.14, X ~ -0.22..+0.22)
      const px = x / 0.22;
      const pz = (wz + 0.04) / 0.20;
      const pelvisSink = 0.035 * Math.exp(-(px * px + pz * pz) * 1.3);

      // 2. Dual splayed leg/calf troughs (Left X: +0.10 -> +0.20, Right X: -0.10 -> -0.19 across wz = 0.02..0.90)
      let legSink = 0;
      if (wz > -0.04 && wz < 0.96) {
        const tLeg = THREE.MathUtils.clamp((wz - 0.02) / 0.86, 0, 1);
        const lxCenter = 0.10 + 0.105 * tLeg;
        const rxCenter = -(0.10 + 0.095 * tLeg);
        const kneeRelief = 1.0 - 0.26 * Math.exp(-(((wz - 0.39) / 0.13) ** 2));
        const dL = (x - lxCenter) / 0.095;
        const dR = (x - rxCenter) / 0.095;
        const endFade =
          THREE.MathUtils.smoothstep(wz, -0.04, 0.08) *
          (1 - THREE.MathUtils.smoothstep(wz, 0.84, 0.96));
        legSink =
          0.025 *
          kneeRelief *
          endFade *
          (Math.exp(-dL * dL * 1.5) + Math.exp(-dR * dR * 1.5));
      }

      // 3. Localized heel cups (Left heel ~ (+0.205, +0.88), Right heel ~ (-0.195, +0.87))
      const hlX = (x - 0.205) / 0.068;
      const hlZ = (wz - 0.88) / 0.075;
      const hrX = (x + 0.195) / 0.068;
      const hrZ = (wz - 0.87) / 0.075;
      const heelSink =
        0.032 *
        (Math.exp(-(hlX * hlX + hlZ * hlZ) * 1.6) +
          Math.exp(-(hrX * hrX + hrZ * hrZ) * 1.6));

      sink = Math.max(pelvisSink, legSink, heelSink) * (1 - edgeRoll * 0.85);

      const flank =
        Math.exp(-(((Math.abs(x) - 0.32) / 0.065) ** 2)) *
        THREE.MathUtils.smoothstep(wz, -0.10, 0.15) *
        (1 - THREE.MathUtils.smoothstep(wz, 0.80, 0.98));
      const midRidge =
        Math.exp(-((x / 0.06) ** 2)) *
        THREE.MathUtils.smoothstep(wz, 0.28, 0.52) *
        (1 - THREE.MathUtils.smoothstep(wz, 0.82, 0.98));
      bolster = 0.0065 * Math.max(flank, midRidge * 0.8) * (1 - edgeRoll);

      y = y - topWeight * sink + topWeight * bolster - edgeRoll * 0.015 * topWeight;
    }

    pos.setXYZ(i, x, y, z);

    // Subtle warm-taupe contact ambient occlusion inside weight depressions
    const ao = THREE.MathUtils.clamp(sink / 0.034, 0, 1);
    const r = 1.0 - ao * 0.21 - edgeRoll * 0.04;
    const g = 1.0 - ao * 0.22 - edgeRoll * 0.04;
    const b = 1.0 - ao * 0.20 - edgeRoll * 0.03;
    colors[i * 3 + 0] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Contoured upper-torso backrest sheet with subtle scapular/shoulder sinkage + contact AO.
 */
function createContouredBackrestGeometry() {
  const geo = new THREE.BoxGeometry(0.84, 0.068, 0.92, 24, 2, 28);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const z = pos.getZ(i);
    const edge = Math.min(
      1,
      Math.hypot(
        Math.max(0, (Math.abs(x) - 0.35) / 0.07),
        Math.max(0, (Math.abs(z) - 0.39) / 0.07)
      )
    );
    let sink = 0;
    if (y > 0) {
      const sx = x / 0.24;
      const sz = (z + 0.04) / 0.32;
      sink = 0.024 * Math.exp(-(sx * sx + sz * sz) * 1.4) * (1 - edge);
      y = y - sink - edge * 0.015;
    }
    pos.setXYZ(i, x, y, z);
    const ao = THREE.MathUtils.clamp(sink / 0.024, 0, 1);
    colors[i * 3 + 0] = 0.98 - ao * 0.16;
    colors[i * 3 + 1] = 0.97 - ao * 0.16;
    colors[i * 3 + 2] = 0.95 - ao * 0.13;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function HospitalBedGLB({
  bedAngle,
  leftRailUp = false,
  rightRailUp = false,
  onRailClick,
  frozen = false,
  bedObj,
  isCompleted,
  isSelected,
  onSelectObject,
}) {
  const { scene: bedScene } = useGLTF('/models/hospital_bed_carlos.glb');
  const { scene: pillowScene } = useGLTF(PILLOW_GLB_URL);
  const backrestRef = useRef();
  const quiltTex = useMemo(() => makeQuiltedBlanketTexture(), []);
  const depressedPadGeo = useMemo(() => createDepressedBedPadGeometry(), []);
  const backrestGeo = useMemo(() => createContouredBackrestGeometry(), []);

  const { fittedBed, leftRailGeo, rightRailGeo, railBaseMat } = useMemo(() => {
    const fitted = fitModel(bedScene, {
      axis: 'longest-horizontal',
      target: 2.7,
      alignLongestToZ: true,
      lift: 0,
      onMesh: (m) => {
        // Use a lightweight 12-triangle hitbox for bed clicks instead of raycasting 52k bed triangles
        m.raycast = () => {};
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
    }).object;

    // Extract the Left (+X world) and Right (-X world) split side-rail assemblies from Object_14
    // while keeping Headboard & Footboard (|cz| < 0.35) fixed on the bed frame.
    fitted.updateWorldMatrix(true, true);
    let lGeo = null;
    let rGeo = null;
    let baseMat = null;
    const railNode = fitted.getObjectByName('Object_14');
    if (railNode && railNode.isMesh && railNode.geometry) {
      const origGeo = railNode.geometry;
      baseMat = railNode.material;
      const headFootGeo = filterGeometryTriangles(origGeo, (_cx, _cy, cz) => Math.abs(cz) < 0.35);
      lGeo = filterGeometryTriangles(origGeo, (_cx, _cy, cz) => cz >= 0.35);
      rGeo = filterGeometryTriangles(origGeo, (_cx, _cy, cz) => cz <= -0.35);
      lGeo.applyMatrix4(railNode.matrixWorld);
      lGeo.computeVertexNormals();
      lGeo.computeBoundingBox();
      lGeo.computeBoundingSphere();
      rGeo.applyMatrix4(railNode.matrixWorld);
      rGeo.computeVertexNormals();
      rGeo.computeBoundingBox();
      rGeo.computeBoundingSphere();
      railNode.geometry = headFootGeo;
    }

    return { fittedBed: fitted, leftRailGeo: lGeo, rightRailGeo: rGeo, railBaseMat: baseMat };
  }, [bedScene]);

  const fittedPillow = useMemo(
    () =>
      fitModel(pillowScene, {
        axis: 'width',
        target: 0.74,
        floor: false,
        onMesh: (m) => {
          m.castShadow = false;
          m.receiveShadow = true;
          m.raycast = () => {};
          if (m.material) {
            m.material.roughness = 0.9;
            m.material.metalness = 0;
          }
        },
      }).object,
    [pillowScene]
  );

  useFrame((_, delta) => {
    if (backrestRef.current) {
      // Synchronized 0.76x slope with patient spine so head & upper back stay nestled in the pillow cradle across 0-60 deg
      const targetRad = THREE.MathUtils.degToRad(bedAngle * 0.76);
      backrestRef.current.rotation.x = THREE.MathUtils.lerp(
        backrestRef.current.rotation.x,
        targetRad,
        Math.min(1, delta * 18)
      );
    }
  });

  // Register the bed's measured floor footprint as a navigation obstacle (nurse walks around it)
  useEffect(() => {
    fittedBed.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(fittedBed);
    registerObstacle('hospital_bed', {
      minX: b.min.x,
      maxX: b.max.x,
      minZ: b.min.z,
      minY: b.min.y,
      maxZ: b.max.z,
    });
    return () => unregisterObstacle('hospital_bed');
  }, [fittedBed]);

  return (
    <group>
      <primitive object={fittedBed} />

      {/* Weight-depressed quilted hospital bed pad + contact AO troughs under pelvis, calves, and heels */}
      <group position={[0, 1.111, 0.38]}>
        <mesh geometry={depressedPadGeo} receiveShadow>
          <meshStandardMaterial
            map={quiltTex}
            vertexColors
            color="#ffffff"
            roughness={0.88}
            metalness={0}
          />
        </mesh>
      </group>

      {/* Footboard warm woodgrain inset panel & slate-blue bumper trim (from reference photo) */}
      <group position={[0, 0.94, 1.335]}>
        <RoundedBox args={[0.68, 0.24, 0.018]} radius={0.008} position={[0, 0.04, 0]}>
          <meshStandardMaterial color="#d8b28a" roughness={0.48} />
        </RoundedBox>
        <RoundedBox args={[0.84, 0.048, 0.026]} radius={0.012} position={[0, -0.11, 0.006]}>
          <meshStandardMaterial color="#425c8a" roughness={0.45} />
        </RoundedBox>
      </group>

      {/* Articulating contoured backrest sheet + sculpted head-depression pillow */}
      <group ref={backrestRef} position={[0, 1.072, -0.31]}>
        <mesh geometry={backrestGeo} position={[0, 0.012, -0.44]} receiveShadow>
          <meshStandardMaterial
            vertexColors
            color="#f8f6f0"
            roughness={0.9}
            metalness={0}
          />
        </mesh>
        <group position={[0, 0.056, -0.67]}>
          <primitive object={fittedPillow} />
        </group>
      </group>

      {/* Authentic 3D Left & Right Bedside Safety Rails — directly interactive in the simulation */}
      <InteractiveBedSideRail
        side="left"
        isUp={leftRailUp}
        geometry={leftRailGeo}
        baseMaterial={railBaseMat}
        frozen={frozen}
        onRailClick={onRailClick}
      />
      <InteractiveBedSideRail
        side="right"
        isUp={rightRailUp}
        geometry={rightRailGeo}
        baseMaterial={railBaseMat}
        frozen={frozen}
        onRailClick={onRailClick}
      />

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

const PATIENT_GLB_URL = '/models/patient.glb?v=draped_blink_v2';
const PATIENT_SCALE = 1.18;

function PatientAndWristband({
  bedAngle,
  o2Device,
  verifiedId,
  hemorrhageShock = false,
  crystalloidBolus = false,
  vitals,
  monitorConnected = true,
  verbalCues,
  wristbandObj,
  isCompleted,
  isSelected,
  onSelectObject,
}) {
  const { scene } = useGLTF(PATIENT_GLB_URL);
  const materials = useRef([]);
  const bonesRef = useRef({});
  const currAngleRef = useRef(0);
  const headOverlayRef = useRef();
  const leftWristRef = useRef();
  const rightHandIvRef = useRef();
  const maskRef = useRef();
  const blinkStateRef = useRef({
    nextBlinkAt: 1.4,
    blinkStart: -10,
    doubleQueued: false,
  });

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
    if (vitals.patient_status === 'HEMORRHAGIC_SHOCK') {
      return {
        text: cues.hemorrhage_shock || cues.hypoxic,
        severity: 'critical',
        badge: `BP ${vitals.bp} • HEMORRHAGE`,
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

  useLayoutEffect(() => {
    const skinMats = [];
    const allMats = [];
    const bmap = {};

    scene.updateMatrixWorld(true);
    const sceneWorldQuatInv = new THREE.Quaternion();
    scene.getWorldQuaternion(sceneWorldQuatInv).invert();
    const boneWorldQuat = new THREE.Quaternion();

    scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = true;
        obj.frustumCulled = false;
        obj.raycast = () => {};
        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of list) {
          if (!mat || !mat.isMeshStandardMaterial) continue;
          allMats.push(mat);
          const mname = (mat.name || '').toLowerCase();
          if (mname.includes('gown')) {
            mat.side = THREE.DoubleSide;
            mat.roughness = 0.88;
            mat.metalness = 0.0;
          } else if (mname.includes('eye')) {
            mat.roughness = 0.05;
            mat.metalness = 0.0;
          } else if (mname.includes('teeth')) {
            mat.roughness = 0.35;
            mat.metalness = 0.0;
          } else {
            skinMats.push(mat);
          }
        }
      }

      if (obj.isBone || obj.name?.startsWith('CC_Base_') || obj.name === 'RL_BoneRoot') {
        if (!obj.userData.bindQuat) {
          obj.userData.bindQuat = obj.quaternion.clone();
        }
        obj.getWorldQuaternion(boneWorldQuat);
        obj.userData.charQuat = sceneWorldQuatInv.clone().multiply(boneWorldQuat);
        obj.userData.charQuatInv = obj.userData.charQuat.clone().invert();
        bmap[obj.name] = obj;
      }
    });

    materials.current = skinMats.length > 0 ? skinMats : allMats;
    bonesRef.current = bmap;

    // Pose all 30 AccuRIG finger phalanx bones along the true knuckle hinge axis (`uk = [0.461, -0.384, -0.800]`)
    // so when the hand is pronated palm-down on the bed, the fingers & thumb drape softly onto the sheet!
    ['L', 'R'].forEach((side) => {
      const m = side === 'L' ? 1 : -1;
      ['Index', 'Mid', 'Ring', 'Pinky'].forEach((f, fi) => {
        const cas = 1 + fi * 0.06;
        const t1 = -0.12;
        const t2 = 0.16 * cas;
        const t3 = 0.08 * cas;
        setNurseCharRotation(bmap[`CC_Base_${side}_${f}1`], 0.461 * t1, -0.384 * t1 * m, -0.8 * t1 * m);
        setNurseCharRotation(bmap[`CC_Base_${side}_${f}2`], 0.461 * t2, -0.384 * t2 * m, -0.8 * t2 * m);
        setNurseCharRotation(bmap[`CC_Base_${side}_${f}3`], 0.461 * t3, -0.384 * t3 * m, -0.8 * t3 * m);
      });
      // Tuck thumb naturally beside the index finger with palmar pad resting gently on the sheet
      setNurseCharRotation(bmap[`CC_Base_${side}_Thumb1`], -0.14, 0.28 * m, -0.22 * m);
      setNurseCharRotation(bmap[`CC_Base_${side}_Thumb2`], 0.06, 0.12 * m, -0.08 * m);
      setNurseCharRotation(bmap[`CC_Base_${side}_Thumb3`], 0.04, 0.08 * m, -0.05 * m);
    });
  }, [scene]);

  useFrame((state, delta) => {
    const elapsed = state.clock.elapsedTime;
    const B = bonesRef.current;

    // 1. Subtle natural pallor & diaphoretic skin moisture (zero artificial blue emissive cast on dark skin!)
    const t = THREE.MathUtils.clamp((94 - live.spo2) / 14, 0, 1);
    const pallor = crystalloidBolus ? 0.02 : hemorrhageShock ? 0.08 : 0.04;
    _tint.setRGB(
      1 - 0.06 * t - pallor * 0.03,
      1 - 0.06 * t - pallor * 0.03,
      1 - 0.05 * t - pallor * 0.02
    );
    const targetRoughness = crystalloidBolus ? 0.88 : hemorrhageShock ? 0.72 : 0.82;
    for (const m of materials.current) {
      m.color.copy(_tint);
      m.roughness = targetRoughness;
      if (m.emissive) {
        m.emissive.setRGB(0, 0, 0);
      }
    }

    // 2. Synchronized Fowler's spine articulation (0.76x matching backrestRef) + relaxed pillow rest
    currAngleRef.current = THREE.MathUtils.lerp(
      currAngleRef.current,
      bedAngle,
      Math.min(1, delta * 18)
    );
    const elevRad = THREE.MathUtils.degToRad(currAngleRef.current);
    const breath = (Math.sin(live.respPhase - Math.PI / 2) + 1) / 2;
    const isBradypneic = live.rr <= 10;
    const isDistressed = live.spo2 < 92 && !isBradypneic;
    const breathAmp = isBradypneic ? 0.014 : isDistressed ? 0.045 : 0.028;

    // Patient's head rests turned naturally toward his LEFT side (+ry in Character Space)
    const headRestlessYaw = isBradypneic
      ? 0.62
      : isDistressed
        ? 0.52 + Math.sin(elapsed * 1.45) * 0.1
        : 0.48 + Math.sin(elapsed * 0.45) * 0.035;
    const spasm = isDistressed ? (Math.sin(elapsed * 2.9) + 1) * 0.5 : 0;

    setNurseCharRotation(B.CC_Base_Waist, elevRad * 0.34, 0, 0);
    setNurseCharRotation(
      B.CC_Base_Spine01,
      elevRad * 0.25 + breath * breathAmp + spasm * 0.022,
      isDistressed ? Math.sin(elapsed * 1.2) * 0.02 : 0,
      0.015
    );
    setNurseCharRotation(B.CC_Base_Spine02, elevRad * 0.17 + breath * breathAmp * 0.9, 0, -0.01);

    // Relaxed dropped shoulders resting back against the pillow/mattress
    setNurseCharRotation(B.CC_Base_L_Clavicle, -0.04 + breath * breathAmp * 0.35, 0.05, -0.06);
    setNurseCharRotation(B.CC_Base_R_Clavicle, -0.04 + breath * breathAmp * 0.35, -0.05, 0.06);

    // Neck & head turn smoothly to the LEFT side and sink gently backward into the sculpted pillow cradle
    setNurseCharRotation(
      B.CC_Base_NeckTwist01,
      -0.05 + elevRad * 0.04 - (isBradypneic ? 0.04 : 0),
      headRestlessYaw * 0.55,
      isBradypneic ? 0.09 : 0.06
    );
    setNurseCharRotation(
      B.CC_Base_Head,
      -0.03 + elevRad * 0.04 - breath * 0.02,
      headRestlessYaw * 0.45,
      0.05
    );

    // 3. Softened brow, heavy post-op resting eyelids, natural human blinks & calm eye micro-gaze
    if (B.CC_Base_BrowRelax) {
      setNurseCharRotation(B.CC_Base_BrowRelax, isBradypneic ? 0.11 : 0.085, 0, 0);
    }

    const bs = blinkStateRef.current;
    if (elapsed >= bs.nextBlinkAt) {
      bs.blinkStart = elapsed;
      if (!bs.doubleQueued && ((Math.sin(elapsed * 12.9898) * 43758.5453) % 1 + 1) % 1 < 0.2) {
        bs.doubleQueued = true;
        bs.nextBlinkAt = elapsed + 0.32;
      } else {
        bs.doubleQueued = false;
        const jitter = ((Math.sin(elapsed * 78.233) * 19341.7) % 1 + 1) % 1;
        bs.nextBlinkAt = elapsed + (isBradypneic ? 4.4 : 2.6) + jitter * 2.8;
      }
    }
    const dtBlink = elapsed - bs.blinkStart;
    let blinkWave = 0;
    if (dtBlink >= 0 && dtBlink < 0.095) {
      blinkWave = Math.sin((dtBlink / 0.095) * (Math.PI * 0.5));
    } else if (dtBlink >= 0.095 && dtBlink < 0.29) {
      const u = (dtBlink - 0.095) / 0.195;
      blinkWave = Math.cos(u * (Math.PI * 0.5));
    }

    // Never stare wide-eyed: heavy sedated lids when bradypneic, drowsy post-op lids at arrival/hypoxia, soft calm lids when stable
    const baseDroop = isBradypneic ? 0.78 : isDistressed || !monitorConnected ? 0.42 : 0.26;
    const lidClose = Math.max(baseDroop, blinkWave);
    const upperLidRx = lidClose * 0.62;
    const lowerLidRx = -lidClose * 0.14;
    setNurseCharRotation(B.CC_Base_L_UpperLid, upperLidRx, 0, 0);
    setNurseCharRotation(B.CC_Base_R_UpperLid, upperLidRx * 0.98, 0, 0);
    setNurseCharRotation(B.CC_Base_L_LowerLid, lowerLidRx, 0, 0);
    setNurseCharRotation(B.CC_Base_R_LowerLid, lowerLidRx, 0, 0);

    // Soft downward/natural eye gaze drift instead of staring straight at the ceiling
    const gazeDown = isBradypneic ? 0.18 : 0.11 + Math.sin(elapsed * 0.37) * 0.035;
    const gazeYaw = Math.sin(elapsed * 0.53) * 0.055 + Math.sin(elapsed * 1.17) * 0.02;
    setNurseCharRotation(B.CC_Base_L_Eye, gazeDown, gazeYaw, 0);
    setNurseCharRotation(B.CC_Base_R_Eye, gazeDown, gazeYaw, 0);

    // Subtle open-mouth breathing during bradypnea/hypoxia vs relaxed jaw when stabilized
    if (B.CC_Base_JawRoot) {
      const jawOpen = isBradypneic ? 0.13 + breath * 0.05 : isDistressed ? 0.07 + breath * 0.07 : 0.025;
      setNurseCharRotation(B.CC_Base_JawRoot, jawOpen, 0, 0);
    }

    // 4. Pronated, palm-down forearms & hands resting flush and relaxed on the quilted bed pad across 0-60 deg Fowler's
    setNurseCharRotation(
      B.CC_Base_L_Upperarm,
      0.12 - elevRad * 0.098,
      -0.234,
      -0.373 - elevRad * 0.005
    );
    setNurseCharRotation(
      B.CC_Base_L_Forearm,
      0.887 - elevRad * 0.372 - breath * 0.01,
      -0.407 - elevRad * 0.095,
      -0.027 + elevRad * 0.255
    );
    setNurseCharRotation(B.CC_Base_L_ForearmTwist01, 0.11, -0.05, 0.15);
    setNurseCharRotation(B.CC_Base_L_ForearmTwist02, 0.12, -0.05, 0.16);
    setNurseCharRotation(
      B.CC_Base_L_Hand,
      0.238 - elevRad * 0.07,
      -0.058 - elevRad * 0.01,
      0.364 + elevRad * 0.084
    );

    setNurseCharRotation(
      B.CC_Base_R_Upperarm,
      0.115 - elevRad * 0.098,
      0.225,
      0.358 + elevRad * 0.005
    );
    setNurseCharRotation(
      B.CC_Base_R_Forearm,
      0.855 - elevRad * 0.365 - breath * 0.01,
      0.395 + elevRad * 0.095,
      0.025 - elevRad * 0.25
    );
    setNurseCharRotation(B.CC_Base_R_ForearmTwist01, 0.11, 0.05, -0.15);
    setNurseCharRotation(B.CC_Base_R_ForearmTwist02, 0.12, 0.05, -0.16);
    setNurseCharRotation(
      B.CC_Base_R_Hand,
      0.235 - elevRad * 0.07,
      0.058 + elevRad * 0.01,
      -0.358 - elevRad * 0.084
    );

    // 5. Relaxed knees, natural external hip turnout, plantarflexed ankles & toes nestled in bed depressions
    const legShift = isDistressed ? Math.sin(elapsed * 1.15) * 0.032 : Math.sin(elapsed * 0.32) * 0.008;
    const gatch = elevRad * 0.06;
    setNurseCharRotation(B.CC_Base_L_Thigh, -0.17 - gatch + legShift, -0.13, 0.03);
    setNurseCharRotation(B.CC_Base_L_Calf, 0.28 + gatch * 1.25, 0, 0);
    setNurseCharRotation(B.CC_Base_L_Foot, 0.28, -0.05, 0);
    setNurseCharRotation(B.CC_Base_L_ToeBase, 0.12, 0, 0);

    setNurseCharRotation(B.CC_Base_R_Thigh, -0.19 - gatch - legShift, 0.11, -0.025);
    setNurseCharRotation(B.CC_Base_R_Calf, 0.31 + gatch * 1.25, 0, 0);
    setNurseCharRotation(B.CC_Base_R_Foot, 0.30, 0.04, 0);
    setNurseCharRotation(B.CC_Base_R_ToeBase, 0.12, 0, 0);

    if (headOverlayRef.current && B.CC_Base_Head && headOverlayRef.current.parent) {
      const headBone = B.CC_Base_Head;
      headBone.updateWorldMatrix(true, false);
      headBone.getWorldPosition(_headPos);
      headBone.getWorldQuaternion(_headQuat);
      // Convert bone world quaternion to Character-Space world orientation (+Y = crown, +Z = nose forward)
      _headQuat.multiply(headBone.userData.charQuatInv);
      _headUp.set(0, 1, 0).applyQuaternion(_headQuat);
      _headFront.set(0, 0, 1).applyQuaternion(_headQuat);
      _headPos.addScaledVector(_headUp, 0.045).addScaledVector(_headFront, 0.185);
      headOverlayRef.current.parent.worldToLocal(headOverlayRef.current.position.copy(_headPos));
      if (maskRef.current) {
        maskRef.current.quaternion.setFromUnitVectors(_yAxis, _headFront);
      }
    }

    if (B.CC_Base_L_Hand && leftWristRef.current?.parent) {
      B.CC_Base_L_Hand.updateWorldMatrix(true, false);
      B.CC_Base_L_Hand.getWorldPosition(_headPos);
      _headPos.x += 0.004;
      _headPos.y += 0.002;
      _headPos.z -= 0.024;
      leftWristRef.current.parent.worldToLocal(leftWristRef.current.position.copy(_headPos));
    }
    if (B.CC_Base_R_Hand && rightHandIvRef.current?.parent) {
      B.CC_Base_R_Hand.updateWorldMatrix(true, false);
      B.CC_Base_R_Hand.getWorldPosition(_headPos);
      _headPos.x += 0.018;
      _headPos.y += 0.016;
      _headPos.z += 0.052;
      rightHandIvRef.current.parent.worldToLocal(rightHandIvRef.current.position.copy(_headPos));
    }
  });

  // Exam mode: neutral border (no red/amber/green "how am I doing" colouring)
  const bubbleBorderColor = 'rgba(148, 163, 184, 0.7)';
  const hotspotCtx = React.useContext(HotspotContext);
  const patientAssessed = hotspotCtx.visible && isSelected;

  return (
    <group>
      {/* Rigged AccuRIG 3D Patient Model (nurse movement triggered strictly via station markers) */}
      <group position={[0, 1.178, -0.05]}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <group scale={PATIENT_SCALE} position={[0, -0.89 * PATIENT_SCALE, 0]}>
            <primitive object={scene} />
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

        {/* Interactive Patient Verbal Assessment Bubble — Matches Figma 36:80 / 29:3851 */}
        {patientAssessed && verbalState.text && (
          <Html position={[0, 0.38, 0]} center zIndexRange={[18, 0]}>
            <div
              onClick={stop(() => {
                onSelectObject('wristband');
                speakPatientCue(verbalState.text, true);
              })}
              title="Click to assess patient & trigger voice cue"
              style={{
                maxWidth: '285px',
                minWidth: '220px',
                padding: '10px 14px',
                borderRadius: '14px',
                background: 'rgba(13, 27, 21, 0.92)',
                borderTop: '1px solid #2a4136',
                borderRight: '1px solid #2a4136',
                borderBottom: '1px solid #2a4136',
                borderLeft: '3px solid #e8b04b',
                color: '#e4efe9',
                boxShadow: '0 14px 30px rgba(0, 0, 0, 0.5)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                userSelect: 'none',
              }}
            >
              <div
                style={{
                  fontSize: '12.5px',
                  fontWeight: 500,
                  fontStyle: verbalState.text.startsWith('[') ? 'italic' : 'normal',
                  lineHeight: 1.48,
                  color: '#e4efe9',
                }}
              >
                {verbalState.text.startsWith('[')
                  ? verbalState.text
                  : `“${verbalState.text}”`}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginTop: '6px',
                  fontSize: '11px',
                  color: '#8ca69b',
                }}
              >
                <span>John Doe, 62 — PACU handoff</span>
                <span style={{ color: '#6fd1a9', fontWeight: 700 }}>🔊 Listen</span>
              </div>
            </div>
          </Html>
        )}
      </group>

      {/* Procedural IV Cannula on Dorsum (Back) of Patient's Pronated Right Hand */}
      <group ref={rightHandIvRef} position={[-0.295, 1.188, -0.04]} rotation={[0, 0.16, 0]}>
        <mesh>
          <boxGeometry args={[0.048, 0.005, 0.062]} />
          <meshStandardMaterial
            color="#eef1f4"
            transparent
            opacity={0.82}
            roughness={0.9}
          />
        </mesh>
        <mesh position={[0, 0.009, -0.008]} rotation={[Math.PI / 2 - 0.12, 0, 0]}>
          <cylinderGeometry args={[0.007, 0.008, 0.036, 12]} />
          <meshStandardMaterial color="#38bdf8" roughness={0.4} metalness={0.2} />
        </mesh>
      </group>

      {/* Patient ID Wristband + Red Allergy Alert Band Wrapping Around Pronated Left Wrist */}
      <group
        ref={leftWristRef}
        position={[0.31, 1.174, -0.12]}
      >
        <mesh rotation={[0.06, -0.14, 0]} castShadow>
          <torusGeometry args={[0.039, 0.008, 12, 24]} />
          <meshStandardMaterial
            color={verifiedId ? '#d1fae5' : '#f8fafc'}
            emissive={verifiedId ? '#10b981' : '#38bdf8'}
            emissiveIntensity={verifiedId ? 0.9 : 0.35}
            roughness={0.38}
          />
        </mesh>
        <mesh position={[0.003, 0, -0.017]} rotation={[0.06, -0.14, 0]}>
          <torusGeometry args={[0.04, 0.0055, 10, 24]} />
          <meshStandardMaterial
            color="#dc2626"
            emissive="#991b1b"
            emissiveIntensity={0.35}
            roughness={0.42}
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

/* ---------- 2B. Post-Exploratory Laparotomy 3D Attention Emote (Triggers Situational Clinical Video) ---------- */
function PatientDistressEmote3D({ bedAngle = 0, visible = false, onInspect }) {
  const [hovered, setHovered] = useState(false);
  const ctx = React.useContext(HotspotContext);
  if (!ctx.visible || !visible) return null;

  const elevY = Math.sin(THREE.MathUtils.degToRad(Math.max(0, bedAngle))) * 0.18;
  const accentColor = '#e8b04b';

  return (
    <group position={[0.22, 1.56 + elevY, -0.78]}>
      <Html center zIndexRange={[23, 0]}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            onInspect?.();
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title="Walk nurse over & watch close-up bedside observation clip"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '5px',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
            animation: 'studyaiEmoteFloat 2.2s ease-in-out infinite',
          }}
        >
          <span
            style={{
              position: 'relative',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(10, 19, 16, 0.92)',
              border: `2px solid ${accentColor}`,
              boxShadow: `0 10px 24px rgba(0, 0, 0, 0.52), 0 0 0 4px rgba(232, 176, 75, 0.18)`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: hovered ? 'scale(1.10)' : 'scale(1)',
              transition: 'transform 0.16s ease',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: -3,
                borderRadius: '50%',
                border: `2px solid ${accentColor}`,
                animation: 'studyaiEmotePulse 1.8s cubic-bezier(0.2, 0.6, 0.3, 1) infinite',
                pointerEvents: 'none',
              }}
            />
            <span style={{ fontSize: '21px', lineHeight: 1 }}>😮‍💨</span>
            <span
              style={{
                position: 'absolute',
                right: '-2px',
                bottom: '-2px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: accentColor,
                color: '#0a1310',
                fontSize: '9px',
                fontWeight: 900,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ▶
            </span>
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '999px',
              background: 'rgba(10, 19, 16, 0.92)',
              border: `1px solid ${accentColor}`,
              color: '#fde68a',
              fontSize: '11px',
              fontWeight: 800,
              whiteSpace: 'nowrap',
              boxShadow: '0 6px 16px rgba(0, 0, 0, 0.45)',
            }}
          >
            Observe Patient ▶
          </span>
        </button>
      </Html>
    </group>
  );
}

function SurgicalDrainsAndDressing3D({
  bedAngle = 0,
  jpAssessed = false,
  primaryDressingRemoved = false,
  emoteIcon = '🩸',
  surgicalObj,
  isSelected,
  onSelectObject,
}) {
  const [hovered, setHovered] = useState(false);
  const ctx = React.useContext(HotspotContext);
  if (!ctx.visible || !surgicalObj) return null;

  const elevY = Math.sin(THREE.MathUtils.degToRad(Math.max(0, bedAngle))) * 0.065;
  const stationLabel = ctx.labels[surgicalObj.id] || 'Abdominal Assessment';

  // Expressive clinical emote state (neutral/attention-calling without low-poly 3D clutter)
  const emoteGlyph = primaryDressingRemoved ? '⚠️' : jpAssessed ? '🩹' : emoteIcon;
  const accentColor = primaryDressingRemoved
    ? '#ee8572'
    : isSelected
      ? '#e8b04b'
      : jpAssessed
        ? '#6fd1a9'
        : '#f28b82';

  return (
    <group position={[0, 1.53 + elevY, -0.14]}>
      <Html center zIndexRange={[22, 0]}>
        <style>{`
          @keyframes studyaiEmoteFloat {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-5px); }
          }
          @keyframes studyaiEmotePulse {
            0% { transform: scale(0.95); opacity: 0.72; }
            70% { transform: scale(1.48); opacity: 0; }
            100% { transform: scale(1.48); opacity: 0; }
          }
        `}</style>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.blur();
            onSelectObject('surgical_site');
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title="Inspect surgical site & watch clinical video"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
            animation: 'studyaiEmoteFloat 2.4s ease-in-out infinite',
          }}
        >
          {/* Floating Emote Speech Bubble with Pulsing Attention Halo */}
          <span
            style={{
              position: 'relative',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(10, 19, 16, 0.90)',
              border: `2px solid ${accentColor}`,
              boxShadow: `0 10px 24px rgba(0, 0, 0, 0.48), 0 0 0 4px ${accentColor}26`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: hovered || isSelected ? 'scale(1.10)' : 'scale(1)',
              transition: 'transform 0.16s ease',
            }}
          >
            {!jpAssessed && (
              <span
                style={{
                  position: 'absolute',
                  inset: -3,
                  borderRadius: '50%',
                  border: `2px solid ${accentColor}`,
                  animation: 'studyaiEmotePulse 1.9s cubic-bezier(0.2, 0.6, 0.3, 1) infinite',
                  pointerEvents: 'none',
                }}
              />
            )}
            <span style={{ fontSize: '21px', lineHeight: 1 }}>{emoteGlyph}</span>
            {/* Mini Play-Video Badge on bottom-right corner of the emote */}
            <span
              style={{
                position: 'absolute',
                right: '-3px',
                bottom: '-2px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: '#1e4a38',
                border: '1.5px solid #6fd1a9',
                color: '#eaf2ee',
                fontSize: '8.5px',
                fontWeight: 900,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ▶
            </span>
          </span>

          {/* Pointer tail + Label Pill */}
          <span
            style={{
              padding: '3px 11px',
              borderRadius: '999px',
              background: isSelected ? '#143528' : 'rgba(10, 19, 16, 0.90)',
              border: `1px solid ${hovered || isSelected ? accentColor : '#2a4136'}`,
              color: '#eaf2ee',
              fontSize: '11px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 6px 16px rgba(0, 0, 0, 0.38)',
            }}
          >
            {hovered ? `${stationLabel} · Watch clip ▶` : stationLabel}
          </span>
        </button>
      </Html>
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
        m.castShadow = false;
        m.raycast = () => {};
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
    const m = new SweepMonitor(canvas, { pixelRatio: 1, patientName });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { monitor: m, texture: tex };
  }, [patientName]);

  const monitorFrameAcc = useRef(0);
  useFrame((state, delta) => {
    if (monitorConnected) {
      monitorFrameAcc.current += delta;
      if (monitorFrameAcc.current >= 1 / 24) {
        monitor.tick(monitorFrameAcc.current);
        monitorFrameAcc.current = 0;
        texture.needsUpdate = true;
      }
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

    <group>
      {/* Outlet adapter (DISS quick-connect) from the headwall O2 outlet */}
      <mesh position={[x, 1.5, z - 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.06, 16]} />
        <meshStandardMaterial {...BRUSHED_METAL} />
      </mesh>

      {/* Thorpe-tube flowmeter body */}
      <group position={[x, 1.39, z]}>
        <RoundedBox args={[0.085, 0.24, 0.07]} radius={0.015}>
          <meshStandardMaterial {...BRUSHED_METAL} />
        </RoundedBox>
        <mesh position={[0, 0.02, 0.037]}>
          <cylinderGeometry args={[0.018, 0.018, 0.16, 16]} />
          <meshStandardMaterial {...CLEAR_POLYMER} color="#e0f2fe" />
        </mesh>
        {/* Float ball rises when O2 is flowing */}
        <mesh position={[0, o2Device ? 0.06 : -0.05, 0.037]}>
          <sphereGeometry args={[0.011, 12, 12]} />
          <meshStandardMaterial
            color={o2Device ? '#10b981' : '#64748b'}
            emissive={o2Device ? '#10b981' : '#000000'}
            emissiveIntensity={o2Device ? 1.6 : 0}
            toneMapped={false}
          />
        </mesh>
        {/* Flow control knob */}
        <mesh position={[0, -0.135, 0.01]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.022, 0.022, 0.03, 16]} />
          <meshStandardMaterial color="#16a34a" roughness={0.4} />
        </mesh>
      </group>

      {/* Humidifier bottle hanging below the flowmeter */}
      <group position={[x, 1.15, z + 0.01]}>
        <mesh>
          <cylinderGeometry args={[0.042, 0.038, 0.14, 18]} />
          <meshStandardMaterial {...CLEAR_POLYMER} color="#bae6fd" />
        </mesh>
        <mesh position={[0, -0.015, 0]}>
          <cylinderGeometry args={[0.035, 0.032, 0.09, 16]} />
          <meshStandardMaterial {...CLEAR_POLYMER} color="#38bdf8" />
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
          m.castShadow = false;
          m.raycast = () => {};
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
    >
      <primitive object={fittedPole} />

      {/* Mounted Morphine PCA Infusion Pump Unit on Pole */}
      <group position={[0.16, 1.32, 0]} rotation={[0, Math.PI, 0]}>
        <RoundedBox args={[0.22, 0.3, 0.16]} radius={0.025}>
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

      {/* IV Morphine PCA Infusion Bag */}
      <mesh position={[0.26, 1.98, 0.02]}>
        <capsuleGeometry args={[0.065, 0.15, 8, 16]} />
        <meshStandardMaterial {...CLEAR_POLYMER} color="#e0f2fe" />
      </mesh>

      {/* IV Drip Chamber + Falling Droplet */}
      <mesh position={[0.26, 1.75, 0.02]}>
        <cylinderGeometry args={[0.018, 0.015, 0.09, 14]} />
        <meshStandardMaterial {...CLEAR_POLYMER} color="#bae6fd" />
      </mesh>
      <mesh ref={dripDropRef} position={[0.26, 1.76, 0.02]}>
        <sphereGeometry args={[0.007, 8, 8]} />
        <meshStandardMaterial {...CLEAR_POLYMER} color="#38bdf8" />
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

/** O2 mask attachment point (world) at 0° / 30° / 60° head-of-bed, measured from AccuRIG CC_Base_Head. */
const MASK_AT_ANGLE = [
  [0, [0.09, 1.325, -0.87]],
  [30, [0.09, 1.56, -0.7]],
  [60, [0.09, 1.695, -0.435]],
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
      {/* Slim translucent medical oxygen tubing curving smoothly from humidifier bottle under chin into mask */}
      {o2Device && (
      <SplineTube
        color="#6ee7b7"
        emissive="#10b981"
        emissiveIntensity={0.85}
        opacity={0.78}
        radius={0.0065}
        points={[
          [-0.88, 1.08, -1.83],
          [-0.78, 0.98, -1.52],
          [-0.52, 1.08, -1.18],
          [-0.24, Math.max(1.16, my - 0.18), mz - 0.04],
          [mx - 0.04, my - 0.055, mz + 0.045],
          [mx, my - 0.015, mz + 0.015],
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
          [-0.6, 1.18, -0.10],
          [-0.44, 1.16, -0.07],
          [-0.295, 1.192, -0.05],
        ]}
      />
    </group>
  );
}

/** Room alarm light pulses smoothly red when monitor is connected and SpO2 < 90%, RR <= 10, or alarm is active. */
function AlarmLight({ monitorConnected = true }) {
  const ref = useRef();
  useFrame((state) => {
    if (!ref.current) return;
    const pulse = (Math.sin(state.clock.elapsedTime * 5.0) + 1) * 0.5;
    const hypoxiaAlarm =
      monitorConnected && (live.alarm || live.spo2 < 90 || live.rr <= 10);
    ref.current.color.set(hypoxiaAlarm ? '#ef4444' : '#ffffff');
    ref.current.intensity = hypoxiaAlarm ? 0.35 + pulse * 1.1 : 0.4;
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

/**
 * On-demand shadow-map baker: renders the 1024x1024 room shadow map once after GLB assets mount
 * and only when bed articulation or side rails change, eliminating 60Hz per-frame shadow passes!
 */
function OnDemandShadowMap({ bedAngle, leftRailUp, rightRailUp }) {
  const gl = useThree((s) => s.gl);
  const framesLeft = useRef(4);

  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    framesLeft.current = 4;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);

  useEffect(() => {
    framesLeft.current = Math.max(framesLeft.current, 2);
  }, [bedAngle, leftRailUp, rightRailUp]);

  useFrame(() => {
    if (framesLeft.current > 0) {
      gl.shadowMap.needsUpdate = true;
      framesLeft.current -= 1;
    }
  });

  return null;
}

const Room3D = React.memo(function Room3D({
  scenarioData,
  vitals,
  monitorConnected = true,
  bedAngle,
  leftRailUp = false,
  rightRailUp = false,
  onToggleSideRail,
  o2Device,
  pcaPaused,
  verifiedId,
  jpAssessed = false,
  primaryDressingRemoved = false,
  hemorrhageShock = false,
  crystalloidBolus = false,
  distressEmoteVisible = false,
  onInspectDistress,
  completedObjects,
  selectedObjectId,
  onSelectObject,
  darkMode = false,
  cameraFocusId = 'overview',
  cameraTrigger = 0,
  introTrigger = 0,
  frozen = false,
  inspectedStations = [],
  stationLabels = {},
  onNurseArrive,
  onNurseDepart,
  nurseCue,
  quality = 'auto',
  onQualityStats,
}) {
  const controlsRef = useRef();
  const isAnimatingRef = useRef(false);
  const [scrubStyle, setScrubStyle] = useState('plum');
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
    st.pendingRailSide = null;
    st.facingRailUntil = 0;
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

  const handleSideRailClick = (side) => {
    if (frozen) return;
    if (selectedObjectId) onNurseDepart?.();
    const st = nurseStateRef.current;
    const isLeft = side === 'left';
    const standX = isLeft ? 0.92 : -0.92;
    const standZ = isLeft ? -0.02 : 0.52;
    const free = nearestFree(standX, standZ);
    st.goalPos.set(free.x, 0, free.z);
    st.lookTarget.set(isLeft ? 0.48 : -0.48, 1.05, isLeft ? -0.02 : 0.35);
    st.manualWalk = true;
    st.pendingRailSide = side;
  };

  const softwareGpu = useMemo(() => isSoftwareRenderer(), []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        shadows={!softwareGpu && quality !== 'performance'}
        dpr={dpr}
        camera={{ position: [3.5, 2.3, 4.2], fov: 44, near: 0.08, far: 40 }}
        gl={{
          antialias: !softwareGpu && quality !== 'performance',
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.06,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        <color attach="background" args={[bgColor]} />
        <fog attach="fog" args={[bgColor, 14, 32]} />

        {/* Mount OrbitControls FIRST so camera.position is finalized BEFORE HospitalRoom cutaway runs */}
        <OrbitControls
          ref={controlsRef}
          enabled={!frozen}
          enableDamping
          dampingFactor={0.08}
          enablePan={!frozen}
          screenSpacePanning={false}
          minPolarAngle={0.18}
          maxPolarAngle={Math.PI / 2.04}
          minDistance={1.15}
          maxDistance={7.2}
          target={[0, 0.95, -0.05]}
          onStart={() => {
            isAnimatingRef.current = false;
          }}
        />

        <CameraRig
          cameraFocusId={cameraFocusId}
          cameraTrigger={cameraTrigger}
          controlsRef={controlsRef}
          isAnimatingRef={isAnimatingRef}
          introTrigger={introTrigger}
          frozen={frozen}
        />

        <AdaptiveQuality
          mode={quality}
          onDpr={setDpr}
          onStats={onQualityStats}
        />

        <HotspotContext.Provider value={hotspotCtx}>

        {/* Day-shift / night-shift clinical lighting rig + zero-cost cached shadow map */}
        <RoomLighting darkMode={darkMode} />
        <AlarmLight monitorConnected={monitorConnected} />
        {!softwareGpu && quality !== 'performance' && (
          <OnDemandShadowMap
            bedAngle={bedAngle}
            leftRailUp={leftRailUp}
            rightRailUp={rightRailUp}
          />
        )}

        {/* Enclosed Med-Surg Patient Room (vinyl floor, headwall, window + lounge, door, curtain, clock) */}
        <group>
          <HospitalRoom
            darkMode={darkMode}
            monitorConnected={monitorConnected}
          />

          {/* 0. ActorCore Rigged RN Nurse Avatar */}
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
            onReachSideRail={onToggleSideRail}
            nurseCue={nurseCue}
          />

          <Suspense fallback={null}>
            <TrendelenburgTilt bedAngle={bedAngle}>
              <HospitalBedGLB
                bedAngle={Math.max(0, bedAngle)}
                leftRailUp={leftRailUp}
                rightRailUp={rightRailUp}
                onRailClick={handleSideRailClick}
                frozen={frozen}
                bedObj={getObj('hospital_bed')}
                {...sel('hospital_bed')}
              />

              <PatientAndWristband
                bedAngle={Math.max(0, bedAngle)}
                o2Device={o2Device}
                verifiedId={verifiedId}
                hemorrhageShock={hemorrhageShock}
                crystalloidBolus={crystalloidBolus}
                vitals={vitals}
                monitorConnected={monitorConnected}
                verbalCues={scenarioData.patient_verbal_cues}
                wristbandObj={getObj('wristband')}
                {...sel('wristband')}
              />

              <SurgicalDrainsAndDressing3D
                bedAngle={Math.max(0, bedAngle)}
                jpAssessed={jpAssessed}
                primaryDressingRemoved={primaryDressingRemoved}
                emoteIcon={scenarioData?.exam_config?.surgical_site?.emote_glyph || '🩸'}
                surgicalObj={getObj('surgical_site')}
                {...sel('surgical_site')}
              />

              <PatientDistressEmote3D
                bedAngle={Math.max(0, bedAngle)}
                visible={distressEmoteVisible}
                onInspect={onInspectDistress}
              />
            </TrendelenburgTilt>

            <BedsideMonitor3D
              patientName={scenarioData.patient.name}
              monitorConnected={monitorConnected}
              monitorObj={getObj('bedside_monitor')}
              {...sel('bedside_monitor')}
            />

            <WallOxygenPanel3D
              o2Device={o2Device}
              wallO2Obj={getObj('wall_oxygen')}
              {...sel('wall_oxygen')}
            />

            <IvPumpPole3D
              pcaPaused={pcaPaused}
              ivPumpObj={getObj('iv_pump')}
              {...sel('iv_pump')}
            />

            <EhrWorkstationCart3D
              ehrObj={getObj('ehr_tablet')}
              {...sel('ehr_tablet')}
            />

            <ClinicalTubes
              o2Device={o2Device}
              pcaPaused={pcaPaused}
              monitorConnected={monitorConnected}
              bedAngle={Math.max(0, bedAngle)}
            />
          </Suspense>
        </group>

        </HotspotContext.Provider>
      </Canvas>
    </div>
  );
});

export default Room3D;

useGLTF.preload('/models/hospital_bed_carlos.glb');
useGLTF.preload(PILLOW_GLB_URL);
useGLTF.preload(PATIENT_GLB_URL);
useGLTF.preload(NURSE_GLB_URL);
useGLTF.preload('/models/heart_monitor.glb');
useGLTF.preload('/models/ventilator.glb');
useGLTF.preload('/models/iv_pole.glb');
