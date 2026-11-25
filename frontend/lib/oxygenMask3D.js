import * as THREE from 'three';

/**
 * Builds an anatomically contoured 3D Supplemental Oxygen Mask ('simple_mask' | 'non_rebreather')
 * or Over-Cheek Medical Nasal Cannula ('nasal_cannula') directly in `patient.glb` Character-Head Space
 * (`origin = CC_Base_Head` at `PATIENT_SCALE = 1.18`, where `+X` = left cheek, `+Y` = crown/forehead,
 * `+Z` = nose/face forward).
 *
 * Calibrated to exact measured `patient.glb` (`1.18x`) facial skin coordinates:
 *   - Nose bridge (`x = 0, y = +0.104`): skin `z = +0.1514`
 *   - Nose tip    (`x = 0, y = +0.082`): skin `z = +0.1661`
 *   - Lips        (`x = 0, y = +0.035`): skin `z = +0.1653`
 *   - Chin sulcus (`x = 0, y = -0.006`): skin `z = +0.1579`
 *   - Mid cheeks  (`x = ±0.050, y = +0.030..+0.056`): skin `z = +0.131`
 *   - Temples     (`x = ±0.089..±0.105, y = +0.068, z = +0.02..-0.02`)
 *
 * Returns `{ group, portPosition }` where `portPosition` (`[x, y, z]` in `group` space) is the exact
 * barbed connector tip for `0.0mm` live oxygen tubing attachment.
 */
function maskRimPoint(theta, target = new THREE.Vector3()) {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Pear/teardrop vertical span from nose bridge (theta=0 -> y=+0.105) to under-chin (theta=PI -> y=-0.008)
  const y = 0.0485 + 0.0565 * cosT;

  // Narrower across nasal bridge (`cosT -> +1`), wider across cheeks & jaw (`cosT <= 0.2`)
  const pinch = Math.max(0, cosT);
  const halfW = 0.0535 * (1.0 - 0.52 * pinch * pinch);
  const x = halfW * sinT;

  // 3D anatomical saddle depth: dips back to z=+0.133 along cheeks (|sinT|=1), rises to +0.1545 at nose bridge
  // and +0.1605 at chin so the seafoam cushion seals flush against the face with zero clipping!
  const c2 = cosT * cosT;
  const asym = cosT >= 0 ? 0.0215 * c2 : 0.0275 * c2;
  const z = 0.133 + asym;

  return target.set(x, y, z);
}

export function buildOxygenApparatusGroup(o2Device) {
  const group = new THREE.Group();
  const portPosition = new THREE.Vector3(0, 0.018, 0.228);

  if (!o2Device) {
    return { group, portPosition };
  }

  if (o2Device === 'nasal_cannula') {
    const cannulaMat = new THREE.MeshPhysicalMaterial({
      color: '#bbf7d0',
      emissive: '#10b981',
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0.82,
      roughness: 0.2,
      clearcoat: 0.7,
    });
    const sliderMat = new THREE.MeshStandardMaterial({
      color: '#059669',
      roughness: 0.34,
      metalness: 0.08,
    });

    // Over-cheek tubing loop from right ear/temple -> across cheeks & philtrum -> left ear/temple
    const cheekPts = [
      new THREE.Vector3(-0.098, 0.068, -0.005),
      new THREE.Vector3(-0.084, 0.060, 0.058),
      new THREE.Vector3(-0.055, 0.046, 0.136),
      new THREE.Vector3(-0.024, 0.056, 0.164),
      new THREE.Vector3(0.0, 0.060, 0.171),
      new THREE.Vector3(0.024, 0.056, 0.164),
      new THREE.Vector3(0.055, 0.046, 0.136),
      new THREE.Vector3(0.084, 0.060, 0.058),
      new THREE.Vector3(0.098, 0.068, -0.005),
    ];
    const cheekCurve = new THREE.CatmullRomCurve3(cheekPts);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(cheekCurve, 48, 0.0032, 10, false), cannulaMat));

    // Twin descending under-chin lanyard tubes meeting at the adjustable green bolo slider
    [-1, 1].forEach((side) => {
      const dropCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.084, 0.060, 0.058),
        new THREE.Vector3(side * 0.062, 0.008, 0.118),
        new THREE.Vector3(side * 0.022, -0.022, 0.164),
        new THREE.Vector3(side * 0.005, -0.032, 0.176),
      ]);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(dropCurve, 24, 0.0028, 8, false), cannulaMat));

      // Soft curved nasal prongs entering left & right nares
      const prongCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.0075, 0.060, 0.171),
        new THREE.Vector3(side * 0.0075, 0.066, 0.166),
        new THREE.Vector3(side * 0.0070, 0.071, 0.159),
      ]);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(prongCurve, 10, 0.0024, 8, false), cannulaMat));
    });

    // Under-chin green bolo slider + supply stem
    const bolo = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.018, 14), sliderMat);
    bolo.position.set(0, -0.036, 0.178);
    bolo.rotation.x = 0.35;
    group.add(bolo);

    portPosition.set(0, -0.044, 0.181);
    group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.raycast = () => {};
      }
    });
    return { group, portPosition };
  }

  // ---------- Contoured Clear Medical-Vinyl Hudson Oxygen Mask ('simple_mask' | 'non_rebreather') ----------
  // 1. 3D Saddle-Contoured Seafoam-Mint Soft Anatomical Face Cushion Rim
  const rimSampleCount = 64;
  const rimPts = [];
  for (let i = 0; i < rimSampleCount; i++) {
    const theta = (i / rimSampleCount) * Math.PI * 2;
    rimPts.push(maskRimPoint(theta));
  }
  const rimCurve = new THREE.CatmullRomCurve3(rimPts, true, 'catmullrom', 0.5);
  const cushionMat = new THREE.MeshStandardMaterial({
    color: '#2dd4bf',
    emissive: '#0d9488',
    emissiveIntensity: 0.1,
    roughness: 0.42,
    metalness: 0.02,
  });
  group.add(new THREE.Mesh(new THREE.TubeGeometry(rimCurve, 72, 0.0056, 12, true), cushionMat));

  // 2. Sculpted Contoured Translucent Medical-Vinyl Tent Dome (clears nose tip z=+0.1661 by +20..38mm!)
  const segU = 64;
  const segV = 16;
  const positions = [];
  const uvs = [];
  const indices = [];
  const pRim = new THREE.Vector3();
  const apexCenter = new THREE.Vector3(0, 0.044, 0.206);

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    const theta = u * Math.PI * 2;
    maskRimPoint(theta, pRim);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Small elliptical front boss around the 22mm swivel port (`x=0, y=+0.040, z=+0.206`)
    const bossX = 0.012 * sinT;
    const bossY = 0.040 + 0.013 * cosT;
    const bossZ = 0.206;

    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV; // 0 at face cushion rim -> 1 at front swivel boss
      const xyBlend = Math.pow(v, 0.86);
      // Outward convex tent profile so nasal dorsum (`theta~0, v~0.35..0.65`) has generous +22mm clearance
      const zArch = Math.sin(v * Math.PI * 0.5);
      const nasalBridgeBoost = Math.max(0, cosT) * Math.sin(v * Math.PI) * 0.012;

      const px = THREE.MathUtils.lerp(pRim.x, bossX, xyBlend);
      const py = THREE.MathUtils.lerp(pRim.y, bossY, xyBlend);
      const pz = THREE.MathUtils.lerp(pRim.z, bossZ, Math.pow(zArch, 0.78)) + nasalBridgeBoost;

      positions.push(px, py, pz);
      uvs.push(u, v);
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

  const domeGeo = new THREE.BufferGeometry();
  domeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  domeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  domeGeo.setIndex(indices);
  domeGeo.computeVertexNormals();

  const domeMat = new THREE.MeshPhysicalMaterial({
    color: '#ccfbf1',
    emissive: '#14b8a6',
    emissiveIntensity: 0.07,
    transparent: true,
    opacity: 0.62,
    roughness: 0.16,
    metalness: 0.02,
    clearcoat: 0.9,
    clearcoatRoughness: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.renderOrder = 3;
  group.add(domeMesh);

  // 3. Malleable Brushed-Aluminum Nasal Bridge Pinch Strip (`y ~ +0.095, z ~ +0.168`)
  const noseClipCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.021, 0.088, 0.160),
    new THREE.Vector3(-0.011, 0.095, 0.169),
    new THREE.Vector3(0.0, 0.098, 0.172),
    new THREE.Vector3(0.011, 0.095, 0.169),
    new THREE.Vector3(0.021, 0.088, 0.160),
  ]);
  const noseClipMat = new THREE.MeshStandardMaterial({
    color: '#e2e8f0',
    metalness: 0.88,
    roughness: 0.22,
  });
  group.add(new THREE.Mesh(new THREE.TubeGeometry(noseClipCurve, 20, 0.0024, 8, false), noseClipMat));

  // 4. Woven Clinical-Green Elastic Head Strap + Molded Side Flange Tabs (anchors mask visibly to head!)
  const strapMat = new THREE.MeshStandardMaterial({
    color: '#047857',
    roughness: 0.72,
    metalness: 0.02,
  });
  const valveGreenMat = new THREE.MeshStandardMaterial({
    color: '#059669',
    roughness: 0.34,
    metalness: 0.06,
  });
  const flapperWhiteMat = new THREE.MeshStandardMaterial({
    color: '#f8fafc',
    roughness: 0.4,
  });

  [-1, 1].forEach((side) => {
    // Side strap flange eyelet tab on cheek cushion
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.015, 0.014), cushionMat);
    tab.position.set(side * 0.055, 0.048, 0.134);
    tab.rotation.y = side * 0.35;
    group.add(tab);

    // Elastic head strap wrapping cleanly around cheeks & above ears (`+2.5mm` outside measured temple skin)
    const strapCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.055, 0.048, 0.134),
      new THREE.Vector3(side * 0.077, 0.056, 0.096),
      new THREE.Vector3(side * 0.091, 0.064, 0.052),
      new THREE.Vector3(side * 0.102, 0.070, 0.006),
      new THREE.Vector3(side * 0.108, 0.072, -0.036),
    ]);
    const strapTube = new THREE.Mesh(new THREE.TubeGeometry(strapCurve, 24, 0.0038, 8, false), strapMat);
    strapTube.scale.set(0.65, 1.45, 1.0); // flatten into a woven elastic ribbon
    group.add(strapTube);

    // Bilateral exhalation port housing + white one-way silicone flapper disc (for NRB) or vent grille
    const valveGroup = new THREE.Group();
    valveGroup.position.set(side * 0.030, 0.048, 0.180);
    valveGroup.lookAt(apexCenter.x + side * 0.12, 0.052, 0.28);
    const vRing = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.005, 18), valveGreenMat);
    vRing.rotation.x = Math.PI / 2;
    valveGroup.add(vRing);
    if (o2Device === 'non_rebreather') {
      const flap = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.0065, 16), flapperWhiteMat);
      flap.rotation.x = Math.PI / 2;
      valveGroup.add(flap);
    }
    group.add(valveGroup);
  });

  // 5. Front 22mm Green Swivel Manifold + Downward-Angled Barbed Oxygen Supply Stem
  const swivelHousing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0125, 0.014, 0.022, 18),
    valveGreenMat
  );
  swivelHousing.position.set(0, 0.040, 0.209);
  swivelHousing.rotation.x = Math.PI / 2 + 0.18;
  group.add(swivelHousing);

  // Angled barbed supply nipple pointing forward & slightly downward (`portPosition` at exact tip!)
  const barbStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0046, 0.0062, 0.024, 14),
    new THREE.MeshStandardMaterial({ color: '#10b981', roughness: 0.32 })
  );
  barbStem.position.set(0, 0.029, 0.220);
  barbStem.rotation.x = 2.28; // +Y_local points down-and-forward `[0, cos(2.28)=-0.65, sin(2.28)=+0.76]`
  group.add(barbStem);
  portPosition.set(0, 0.021, 0.229);

  // 6. Inflated 1-Liter Non-Rebreather Reservoir Bag + One-Way Check-Valve Collar (drapes down over chin/chest)
  if (o2Device === 'non_rebreather') {
    const neckCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0095, 0.011, 0.024, 16),
      valveGreenMat
    );
    neckCollar.position.set(0, 0.022, 0.208);
    neckCollar.rotation.x = 0.22;
    group.add(neckCollar);

    const bagMat = new THREE.MeshPhysicalMaterial({
      color: '#d1fae5',
      emissive: '#10b981',
      emissiveIntensity: 0.06,
      transparent: true,
      opacity: 0.56,
      roughness: 0.18,
      clearcoat: 0.85,
      depthWrite: false,
    });
    const bagMesh = new THREE.Mesh(new THREE.SphereGeometry(0.046, 22, 18), bagMat);
    bagMesh.position.set(0, -0.036, 0.218);
    bagMesh.rotation.x = 0.24;
    bagMesh.scale.set(0.92, 1.38, 0.58);
    bagMesh.renderOrder = 3;
    group.add(bagMesh);
  }

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.raycast = () => {};
    }
  });

  return { group, portPosition };
}
