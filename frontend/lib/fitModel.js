import * as THREE from 'three';

/**
 * Auto-fits a loaded GLB scene to a target dimension (height, width, or
 * longest horizontal axis), centers it on X/Z, floors it on Y=0 (unless
 * floor=false), and enables castShadow / receiveShadow on all meshes.
 */
export function fitModel(source, opts) {
  const o = source.clone(true);
  if (opts.preprocess) opts.preprocess(o);

  const size0 = new THREE.Vector3();
  new THREE.Box3().setFromObject(o).getSize(size0);

  const scale =
    opts.axis === 'height'
      ? opts.target / size0.y
      : opts.axis === 'width'
        ? opts.target / size0.x
        : opts.target / Math.max(size0.x, size0.z);
  o.scale.setScalar(scale);

  if (opts.alignLongestToZ && size0.x >= size0.z) {
    o.rotation.y = Math.PI / 2;
  }

  const box = new THREE.Box3().setFromObject(o);
  const c = new THREE.Vector3();
  box.getCenter(c);
  const center = opts.center !== false;
  const floor = opts.floor !== false;

  o.position.set(
    center ? -c.x : 0,
    floor ? -box.min.y + (opts.lift ?? 0) : center ? -c.y : 0,
    center ? -c.z : 0
  );

  o.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      if (opts.onMesh) opts.onMesh(m);
    }
  });

  return { object: o, scale };
}

/**
 * Filters a BufferGeometry to keep only triangles on one side of Y=0 in local
 * space (used to isolate a single IV pole from iv_pole.glb).
 */
export function keepHalfGeometry(geo, keepPositive = true) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const P = [];
  const N = [];
  const U = [];

  for (let t = 0; t < pos.count; t += 3) {
    const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
    if ((keepPositive && cy >= 0) || (!keepPositive && cy < 0)) {
      for (let k = 0; k < 3; k++) {
        P.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
        if (nor) N.push(nor.getX(t + k), nor.getY(t + k), nor.getZ(t + k));
        if (uv) U.push(uv.getX(t + k), uv.getY(t + k));
      }
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (nor) out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
