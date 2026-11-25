'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RotateCw, ZoomIn, ZoomOut, Play, Eye, X } from 'lucide-react';
import { fitModel } from '../../lib/fitModel';

const PATIENT_GLB_URL = '/models/patient.glb?v=draped_blink_v2';
const PILLOW_GLB_URL = '/models/pillow.glb';
const PATIENT_SCALE = 1.18;
const INSPECTOR_BED_DEG = 36;

const _euler = new THREE.Euler();
const _deltaQuat = new THREE.Quaternion();
const _localDelta = new THREE.Quaternion();
const _headWorld = new THREE.Vector3();

function setCharRotation(bone, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  if (!bone || !bone.userData.bindQuat || !bone.userData.charQuat) return;
  _euler.set(rx, ry, rz, order);
  _deltaQuat.setFromEuler(_euler);
  _localDelta
    .copy(bone.userData.charQuatInv)
    .multiply(_deltaQuat)
    .multiply(bone.userData.charQuat);
  bone.quaternion.copy(bone.userData.bindQuat).multiply(_localDelta);
}

/**
 * Injects true-to-real-world dark-skin physiological distress cues into the 3D patient skin shader:
 *  - Glistening cool clammy diaphoretic micro-beads across the forehead, brow, temples, nose & upper lip
 *  - Subtle pale ashen-greyish mucosal pallor strictly on the parted lips / perioral zone
 *  - Zero artificial blue lighting or skin glow
 */
function enhanceInspectorSkinMaterial(srcMat, uniforms) {
  const mat = srcMat.clone();
  mat.roughness = 0.80;
  mat.metalness = 0.0;
  if (mat.emissive) mat.emissive.setRGB(0, 0, 0);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDistress = uniforms.uDistress;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vSweatZone;
        varying float vLipZone;
        varying vec3 vBindFacePos;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBindFacePos = position.xyz;
        float swY = smoothstep(1.628, 1.678, position.y) * (1.0 - smoothstep(1.805, 1.848, position.y));
        float swZ = smoothstep(0.030, 0.086, position.z);
        float swX = 1.0 - smoothstep(0.056, 0.094, abs(position.x));
        vSweatZone = clamp(swY * swZ * swX, 0.0, 1.0);

        float lpY = smoothstep(1.621, 1.626, position.y) * (1.0 - smoothstep(1.634, 1.639, position.y));
        float lpZ = smoothstep(0.111, 0.118, position.z);
        float lpX = 1.0 - smoothstep(0.016, 0.026, abs(position.x));
        vLipZone = clamp(lpY * lpZ * lpX, 0.0, 1.0);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDistress;
        varying float vSweatZone;
        varying float vLipZone;
        varying vec3 vBindFacePos;

        float sweatBeadHash(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (uDistress > 0.01 && vLipZone > 0.01) {
          float lipLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 ashenMucosa = vec3(lipLum * 1.03, lipLum * 1.03, lipLum * 1.06);
          diffuseColor.rgb = mix(diffuseColor.rgb, ashenMucosa, vLipZone * uDistress * 0.34);
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float sweatBead = 0.0;
        if (uDistress > 0.01 && vSweatZone > 0.01) {
          vec3 cellA = floor(vBindFacePos * 310.0);
          vec3 fracA = fract(vBindFacePos * 310.0) - 0.5;
          float hA = sweatBeadHash(cellA);
          float dA = length(fracA);
          float dropA = step(0.76, hA) * smoothstep(0.34, 0.08, dA);

          vec3 cellB = floor(vBindFacePos * 540.0 + 11.3);
          vec3 fracB = fract(vBindFacePos * 540.0 + 11.3) - 0.5;
          float hB = sweatBeadHash(cellB);
          float dropB = step(0.82, hB) * smoothstep(0.32, 0.07, length(fracB));

          sweatBead = clamp(dropA + dropB * 0.85, 0.0, 1.0) * vSweatZone * uDistress;
          roughnessFactor = mix(roughnessFactor, 0.34, vSweatZone * uDistress * 0.72);
          roughnessFactor = mix(roughnessFactor, 0.05, sweatBead * 0.92);
        }`
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        if (uDistress > 0.01 && vSweatZone > 0.01) {
          vec3 viewDirW = normalize(vViewPosition);
          float ndv = clamp(dot(normal, viewDirW), 0.0, 1.0);
          float fresnel = pow(1.0 - ndv, 3.2);
          vec3 cCell = floor(vBindFacePos * 310.0);
          float cDrop = step(0.76, sweatBeadHash(cCell)) * smoothstep(0.34, 0.06, length(fract(vBindFacePos * 310.0) - 0.5));
          float glint = pow(max(dot(normal, normalize(vec3(0.36, 0.68, 0.64))), 0.0), 42.0) * cDrop;
          reflectedLight.indirectSpecular += vec3(0.96, 0.98, 1.0) * (fresnel * 0.085 + glint * 0.52) * vSweatZone * uDistress;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'patient_inspector_distress_skin_v2';
  return mat;
}

// Spherical camera presets relative to measured CC_Base_Head world anchor:
// CC_Base_Head pivot sits at C1/skull base; (+0.115 Y, -0.065 Z) centers right on the eyes/brow/nose!
const CAMERA_VIEWS = {
  face: {
    label: 'Face & Sweat',
    azimuth: 0.38,
    elevation: 0.82,
    radius: 0.62,
    offset: [0.0, 0.115, -0.065],
  },
  airway: {
    label: 'Airway & Lips',
    azimuth: 0.24,
    elevation: 0.66,
    radius: 0.46,
    offset: [0.01, 0.085, -0.03],
  },
  chest: {
    label: 'Chest Effort',
    azimuth: 0.48,
    elevation: 0.70,
    radius: 0.86,
    offset: [0.0, 0.03, 0.06],
  },
};

/**
 * Interactive 3D Patient Cue Inspector (modeled after WristbandArtifactInspector):
 * Orbits the camera around the reclining 3D patient on his hospital pillow so specular room
 * lights roll naturally across his glistening diaphoretic brow sweat, drooping/fluttering
 * sedated eyelids, pale parted lips, and labored gasping chest — completely decoupled from
 * the Patient Wristband window, with a one-click launcher for the 1080p Live-Action Film.
 */
export default function PatientDistressInspector3D({
  vitals,
  onWatchVideo,
  onClose,
  hasSideDrawer = false,
  isMobile = false,
}) {
  const mountRef = useRef(null);
  const [autoSpin, setAutoSpin] = useState(false);
  const [activePreset, setActivePreset] = useState('face');
  const [loaded, setLoaded] = useState(false);
  const vitalsRef = useRef(vitals);
  vitalsRef.current = vitals;

  const interactRef = useRef({
    dragging: false,
    lastX: 0,
    lastY: 0,
    azimuth: CAMERA_VIEWS.face.azimuth,
    elevation: CAMERA_VIEWS.face.elevation,
    velAz: 0,
    velEl: 0,
    radius: CAMERA_VIEWS.face.radius,
    offset: [...CAMERA_VIEWS.face.offset],
    autoSpin: false,
  });

  useEffect(() => {
    interactRef.current.autoSpin = autoSpin;
  }, [autoSpin]);

  const applyPreset = (key) => {
    const p = CAMERA_VIEWS[key];
    if (!p) return;
    setActivePreset(key);
    const st = interactRef.current;
    st.azimuth = p.azimuth;
    st.elevation = p.elevation;
    st.radius = p.radius;
    st.offset = [...p.offset];
    st.velAz = 0;
    st.velEl = 0;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return undefined;

    let disposed = false;
    const width = container.clientWidth || 480;
    const height = container.clientHeight || 320;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.05, 16);

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

    // Natural neutral hospital examination lighting (zero blue tint!) + overhead specular grazing for sweat beads
    const hemi = new THREE.HemisphereLight('#f8fafc', '#cbd5e1', 1.32);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fffaf2', 1.70);
    keyLight.position.set(1.3, 2.8, 1.4);
    scene.add(keyLight);

    const sweatGlintLight = new THREE.DirectionalLight('#f1f5f9', 1.05);
    sweatGlintLight.position.set(-1.2, 2.4, 0.6);
    scene.add(sweatGlintLight);

    const headwallRim = new THREE.DirectionalLight('#e2e8f0', 0.60);
    headwallRim.position.set(0.1, 2.0, -2.2);
    scene.add(headwallRim);

    const stageGroup = new THREE.Group();
    scene.add(stageGroup);

    // Contoured white cotton hospital backrest + lower mattress pad so the patient rests naturally in Semi-Fowler's
    const sheetMat = new THREE.MeshStandardMaterial({
      color: '#f6f5f0',
      roughness: 0.9,
      metalness: 0,
    });
    const elevRad = THREE.MathUtils.degToRad(INSPECTOR_BED_DEG);
    const backrestGroup = new THREE.Group();
    backrestGroup.position.set(0, 1.072, -0.31);
    backrestGroup.rotation.x = elevRad * 0.76;

    const upperSheet = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.045, 0.56), sheetMat);
    upperSheet.position.set(0, 0.008, -0.64);
    backrestGroup.add(upperSheet);
    stageGroup.add(backrestGroup);

    const loader = new GLTFLoader();
    const bonesMap = {};
    const skinUniforms = { uDistress: { value: 1.0 } };
    const headAnchor = new THREE.Vector3(0, 1.54, -0.82);
    const smoothTarget = new THREE.Vector3(0, 1.56, -0.77);
    const desiredCamPos = new THREE.Vector3();

    // Load smooth concave hospital pillow
    loader.load(
      PILLOW_GLB_URL,
      (gltf) => {
        if (disposed) return;
        const fittedPillow = fitModel(gltf.scene, {
          axis: 'width',
          target: 0.74,
          floor: false,
          onMesh: (m) => {
            if (m.material) {
              m.material = m.material.clone();
              m.material.roughness = 0.9;
              m.material.metalness = 0;
            }
          },
        }).object;
        const pHolder = new THREE.Group();
        pHolder.position.set(0, 0.056, -0.67);
        pHolder.add(fittedPillow);
        backrestGroup.add(pHolder);
      },
      undefined,
      () => {}
    );

    // Load rigged AccuRIG patient model
    loader.load(
      PATIENT_GLB_URL,
      (gltf) => {
        if (disposed) return;
        const pScene = gltf.scene;
        pScene.updateMatrixWorld(true);
        const sceneWorldQuatInv = new THREE.Quaternion();
        pScene.getWorldQuaternion(sceneWorldQuatInv).invert();
        const boneWorldQuat = new THREE.Quaternion();

        pScene.traverse((obj) => {
          if (obj.isMesh) {
            obj.frustumCulled = false;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            const cloned = mats.map((m) => {
              if (!m) return m;
              const mname = (m.name || '').toLowerCase();
              if (mname.includes('gown')) {
                const gm = m.clone();
                gm.side = THREE.DoubleSide;
                gm.roughness = 0.88;
                gm.metalness = 0;
                return gm;
              }
              if (mname.includes('eye')) {
                const em = m.clone();
                em.roughness = 0.04;
                em.metalness = 0;
                return em;
              }
              if (mname.includes('teeth')) {
                const tm = m.clone();
                tm.roughness = 0.35;
                tm.metalness = 0;
                return tm;
              }
              return enhanceInspectorSkinMaterial(m, skinUniforms);
            });
            obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
          }

          if (obj.isBone || obj.name?.startsWith('CC_Base_') || obj.name === 'RL_BoneRoot') {
            obj.userData.bindQuat = obj.quaternion.clone();
            obj.getWorldQuaternion(boneWorldQuat);
            obj.userData.charQuat = sceneWorldQuatInv.clone().multiply(boneWorldQuat);
            obj.userData.charQuatInv = obj.userData.charQuat.clone().invert();
            bonesMap[obj.name] = obj;
          }
        });

        // Pose Semi-Fowler's spine & relaxed palm-down arms on mattress
        setCharRotation(bonesMap.CC_Base_Waist, elevRad * 0.34, 0, 0);
        setCharRotation(bonesMap.CC_Base_Spine01, elevRad * 0.25, 0, 0.012);
        setCharRotation(bonesMap.CC_Base_Spine02, elevRad * 0.17, 0, -0.01);
        setCharRotation(bonesMap.CC_Base_L_Upperarm, 0.12 - elevRad * 0.098, -0.234, -0.373);
        setCharRotation(bonesMap.CC_Base_L_Forearm, 0.887 - elevRad * 0.372, -0.407, -0.027 + elevRad * 0.255);
        setCharRotation(bonesMap.CC_Base_L_ForearmTwist01, 0.11, -0.05, 0.15);
        setCharRotation(bonesMap.CC_Base_L_ForearmTwist02, 0.12, -0.05, 0.16);
        setCharRotation(bonesMap.CC_Base_L_Hand, 0.238 - elevRad * 0.07, -0.058, 0.364 + elevRad * 0.084);

        setCharRotation(bonesMap.CC_Base_R_Upperarm, 0.115 - elevRad * 0.098, 0.225, 0.358);
        setCharRotation(bonesMap.CC_Base_R_Forearm, 0.855 - elevRad * 0.365, 0.395, 0.025 - elevRad * 0.25);
        setCharRotation(bonesMap.CC_Base_R_ForearmTwist01, 0.11, 0.05, -0.15);
        setCharRotation(bonesMap.CC_Base_R_ForearmTwist02, 0.12, 0.05, -0.16);
        setCharRotation(bonesMap.CC_Base_R_Hand, 0.235 - elevRad * 0.07, 0.058, -0.358 - elevRad * 0.084);

        const outer = new THREE.Group();
        outer.position.set(0, 1.178, -0.05);
        const rotXGroup = new THREE.Group();
        rotXGroup.rotation.set(-Math.PI / 2, 0, 0);
        const scaleGroup = new THREE.Group();
        scaleGroup.scale.setScalar(PATIENT_SCALE);
        scaleGroup.position.set(0, -0.89 * PATIENT_SCALE, 0);
        scaleGroup.add(pScene);
        rotXGroup.add(scaleGroup);
        outer.add(rotXGroup);
        stageGroup.add(outer);

        // Measure exact world position of CC_Base_Head once posed in Semi-Fowler's
        stageGroup.updateMatrixWorld(true);
        if (bonesMap.CC_Base_Head) {
          bonesMap.CC_Base_Head.getWorldPosition(_headWorld);
          headAnchor.copy(_headWorld);
          smoothTarget.copy(_headWorld).add(new THREE.Vector3(...interactRef.current.offset));
        }

        setLoaded(true);
      },
      undefined,
      () => {}
    );

    const dom = renderer.domElement;
    dom.style.cursor = 'grab';
    dom.style.touchAction = 'none';

    const onPointerDown = (e) => {
      e.stopPropagation();
      const st = interactRef.current;
      st.dragging = true;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      st.velAz = 0;
      st.velEl = 0;
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
      st.velAz = -dx * 0.0085;
      st.velEl = dy * 0.0075;
      st.azimuth = THREE.MathUtils.clamp(st.azimuth + st.velAz, -1.22, 1.28);
      st.elevation = THREE.MathUtils.clamp(st.elevation + st.velEl, 0.24, 1.30);
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
      st.radius = THREE.MathUtils.clamp(st.radius + e.deltaY * 0.0006, 0.30, 1.05);
    };

    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointercancel', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 480;
      const h = container.clientHeight || 320;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let rafId = 0;
    const clock = new THREE.Clock();
    const goalTarget = new THREE.Vector3();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      clock.getDelta();
      const elapsed = clock.elapsedTime;
      const st = interactRef.current;

      if (!st.dragging) {
        st.azimuth = THREE.MathUtils.clamp(st.azimuth + st.velAz, -1.22, 1.28);
        st.elevation = THREE.MathUtils.clamp(st.elevation + st.velEl, 0.24, 1.30);
        st.velAz *= 0.91;
        st.velEl *= 0.90;
        if (st.autoSpin && Math.abs(st.velAz) < 0.002) {
          st.azimuth = 0.36 + Math.sin(elapsed * 0.52) * 0.44;
        }
      }

      // Animate 3D patient matching the Gemini Omni clinical acting clip:
      const rr = Math.max(6, vitalsRef.current?.rr || 10);
      const cycleSec = 60 / rr;
      const u = (elapsed % cycleSec) / cycleSec;
      let gasp = 0;
      if (u < 0.32) {
        gasp = Math.sin((u / 0.32) * (Math.PI * 0.5));
      } else if (u < 0.44) {
        gasp = 1.0 - 0.12 * ((u - 0.32) / 0.12);
      } else {
        gasp = 0.88 * Math.pow(1.0 - (u - 0.44) / 0.56, 1.85);
      }

      if (bonesMap.CC_Base_Waist) {
        setCharRotation(bonesMap.CC_Base_Waist, elevRad * 0.34, 0, 0);
        setCharRotation(
          bonesMap.CC_Base_Spine01,
          elevRad * 0.25 + gasp * 0.052,
          Math.sin(elapsed * 0.8) * 0.014,
          0.012
        );
        setCharRotation(bonesMap.CC_Base_Spine02, elevRad * 0.17 + gasp * 0.046, 0, -0.01);

        setCharRotation(bonesMap.CC_Base_L_Clavicle, -0.03 + gasp * 0.042, 0.05, -0.05);
        setCharRotation(bonesMap.CC_Base_R_Clavicle, -0.03 + gasp * 0.042, -0.05, 0.05);

        // Head turned slightly left on the pillow (+ry) with sluggish tracking of camera azimuth
        const drowsyYaw = THREE.MathUtils.clamp(
          0.32 + st.azimuth * 0.22 + Math.sin(elapsed * 0.55) * 0.045,
          -0.18,
          0.65
        );
        setCharRotation(
          bonesMap.CC_Base_NeckTwist01,
          0.14 + elevRad * 0.04 - gasp * 0.025,
          drowsyYaw * 0.52,
          0.06
        );
        setCharRotation(
          bonesMap.CC_Base_Head,
          0.14 + elevRad * 0.03 - gasp * 0.048,
          drowsyYaw * 0.48,
          0.04
        );

        if (bonesMap.CC_Base_JawRoot) {
          const jawOpen = 0.13 + gasp * 0.12;
          setCharRotation(bonesMap.CC_Base_JawRoot, jawOpen, 0, 0);
          if (bonesMap.CC_Base_Teeth02) {
            setCharRotation(bonesMap.CC_Base_Teeth02, jawOpen * 0.85, 0, 0);
          }
        }

        if (bonesMap.CC_Base_BrowRelax) {
          setCharRotation(bonesMap.CC_Base_BrowRelax, 0.115 - gasp * 0.02, 0, 0);
        }

        // Heavy opioid-sedated drooping eyelids with periodic weak arousal half-blink flutters
        const flutterPhase = (elapsed % 4.1) / 4.1;
        let arousalLift = 0;
        if (flutterPhase > 0.62 && flutterPhase < 0.84) {
          const fu = (flutterPhase - 0.62) / 0.22;
          arousalLift = Math.sin(fu * Math.PI) * (0.34 + 0.06 * Math.sin(elapsed * 19.0));
        }
        const lidClose = THREE.MathUtils.clamp(0.83 - arousalLift, 0.42, 0.92);
        setCharRotation(bonesMap.CC_Base_L_UpperLid, lidClose * 0.62, 0, 0);
        setCharRotation(bonesMap.CC_Base_R_UpperLid, lidClose * 0.60, 0, 0);
        setCharRotation(bonesMap.CC_Base_L_LowerLid, -lidClose * 0.14, 0, 0);
        setCharRotation(bonesMap.CC_Base_R_LowerLid, -lidClose * 0.14, 0, 0);

        const eyeYaw = THREE.MathUtils.clamp((st.azimuth - drowsyYaw) * 0.45, -0.26, 0.26);
        const eyePitch = THREE.MathUtils.clamp(0.22 - (st.elevation - 0.55) * 0.22, 0.06, 0.30);
        setCharRotation(bonesMap.CC_Base_L_Eye, eyePitch, eyeYaw, 0);
        setCharRotation(bonesMap.CC_Base_R_Eye, eyePitch, eyeYaw, 0);
      }

      // Spherical camera orbit around exact head/face anchor (keeps narrow aspect ratios framed cleanly)
      const aspectBoost = camera.aspect < 1.1 ? 1.1 / Math.max(0.55, camera.aspect) : 1.0;
      const effRadius = st.radius * aspectBoost;
      goalTarget.set(
        headAnchor.x + st.offset[0],
        headAnchor.y + st.offset[1],
        headAnchor.z + st.offset[2]
      );
      smoothTarget.lerp(goalTarget, 0.16);

      const cosEl = Math.cos(st.elevation);
      desiredCamPos.set(
        smoothTarget.x + effRadius * cosEl * Math.sin(st.azimuth),
        smoothTarget.y + effRadius * Math.sin(st.elevation),
        smoothTarget.z + effRadius * cosEl * Math.cos(st.azimuth)
      );
      camera.position.lerp(desiredCamPos, 0.18);
      camera.lookAt(smoothTarget);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      scene.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m?.dispose());
          else o.material?.dispose();
        }
      });
      renderer.dispose();
    };
  }, []);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: isMobile ? '12px' : '252px',
        right: isMobile ? '12px' : hasSideDrawer ? '474px' : 'auto',
        width: isMobile ? undefined : hasSideDrawer ? undefined : 'min(540px, calc(100vw - 280px))',
        top: isMobile ? '64px' : '74px',
        bottom: isMobile ? 'auto' : '116px',
        height: isMobile ? '340px' : undefined,
        minWidth: isMobile ? undefined : '340px',
        zIndex: 31,
        borderRadius: '22px',
        background:
          'radial-gradient(circle at 50% 42%, rgba(28, 54, 43, 0.95) 0%, rgba(10, 19, 16, 0.97) 78%)',
        border: '1.5px solid rgba(232, 176, 75, 0.65)',
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65), 0 0 0 4px rgba(232, 176, 75, 0.12)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Top 3D Inspector Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid rgba(42, 65, 54, 0.8)',
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
              background: 'rgba(232, 176, 75, 0.16)',
              border: '1px solid rgba(232, 176, 75, 0.5)',
              color: '#e8b04b',
              fontSize: '10.5px',
              fontWeight: 800,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <Eye size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '4px' }} />
            3D Cue Inspector
          </span>
          <span
            style={{
              fontSize: '12.5px',
              fontWeight: 800,
              color: '#eaf2ee',
              whiteSpace: 'nowrap',
            }}
          >
            Bedside Patient Distress
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          {Object.entries(CAMERA_VIEWS).map(([key, cfg]) => {
            const active = activePreset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                style={{
                  height: '26px',
                  padding: '0 9px',
                  borderRadius: '999px',
                  background: active ? '#143528' : '#11211a',
                  border: active ? '1px solid #6fd1a9' : '1px solid #2a4136',
                  color: active ? '#6fd1a9' : '#afc6bc',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {cfg.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setAutoSpin((s) => !s)}
            title="Toggle gentle bedside camera sway"
            style={{
              height: '26px',
              padding: '0 9px',
              borderRadius: '999px',
              background: autoSpin ? '#143528' : '#11211a',
              border: autoSpin ? '1px solid #6fd1a9' : '1px solid #2a4136',
              color: autoSpin ? '#6fd1a9' : '#8ca69b',
              fontSize: '10.5px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <RotateCw size={11} /> {autoSpin ? 'Auto' : 'Orbit'}
          </button>

          <button
            type="button"
            onClick={() => {
              interactRef.current.radius = Math.max(0.30, interactRef.current.radius - 0.08);
            }}
            title="Zoom in"
            style={{
              width: '26px',
              height: '26px',
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
            <ZoomIn size={12} />
          </button>

          <button
            type="button"
            onClick={() => {
              interactRef.current.radius = Math.min(1.05, interactRef.current.radius + 0.08);
            }}
            title="Zoom out"
            style={{
              width: '26px',
              height: '26px',
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
            <ZoomOut size={12} />
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Minimize 3D Patient Cue Inspector"
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#11211a',
              border: '1px solid #2a4136',
              color: '#8ca69b',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Interactive 3D WebGL Viewport */}
      <div style={{ position: 'relative', flex: 1, minHeight: '190px' }}>
        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
        {!loaded && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#8ca69b',
              fontSize: '12px',
              fontWeight: 700,
              pointerEvents: 'none',
            }}
          >
            Loading 3D bedside cue model…
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            left: '12px',
            bottom: '10px',
            padding: '4px 10px',
            borderRadius: '999px',
            background: 'rgba(10, 19, 16, 0.78)',
            border: '1px solid rgba(42, 65, 54, 0.85)',
            color: '#9cb6ab',
            fontSize: '10.5px',
            fontWeight: 600,
            pointerEvents: 'none',
          }}
        >
          Drag to orbit bedside view · Scroll to inspect brow sweat & lips
        </div>
      </div>

      {/* Bottom Clinical Action Bar + Separate Live-Action Cinema Launcher */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid rgba(42, 65, 54, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          flexWrap: 'wrap',
          background: 'rgba(8, 16, 13, 0.72)',
        }}
      >
        <div style={{ fontSize: '11.5px', color: '#afc6bc', lineHeight: 1.4, flex: '1 1 180px' }}>
          Observe glistening diaphoretic brow sweat, drooping sedated lids & shallow open-mouth gasping.
        </div>

        {onWatchVideo && (
          <button
            type="button"
            onClick={onWatchVideo}
            style={{
              height: '34px',
              padding: '0 15px',
              borderRadius: '999px',
              background: '#e8b04b',
              border: 'none',
              color: '#0a1310',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <Play size={13} fill="#0a1310" /> Watch Live-Action Film
          </button>
        )}
      </div>
    </div>
  );
}
