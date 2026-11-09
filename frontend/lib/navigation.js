/**
 * navigation.js — Lightweight 2D (XZ-plane) navigation & collision for the RN avatar.
 *
 * - Obstacles are axis-aligned footprints on the floor. Static furniture footprints are
 *   declared here; GLB furniture (e.g. the bed) registers its measured footprint at runtime.
 * - resolveCollisions(): pushes a circle (the nurse) out of walls and obstacles so she slides
 *   along furniture instead of walking through it.
 * - findPath(): grid A* + string-pulling so click-to-walk / station walks route AROUND the bed,
 *   IV pole, monitor stand and EHR cart instead of clipping through them.
 */
import { ROOM } from './roomBounds.js';

export const NURSE_RADIUS = 0.24;

// Walkable envelope (headwall & window wall are solid; the cutaway front/right stay open-ish)
const BOUNDS = {
  minX: ROOM.minX + 0.12,
  maxX: ROOM.maxX - 0.25,
  minZ: ROOM.minZ + 0.12,
  maxZ: ROOM.maxZ - 0.5,
};

/** Static footprints {minX,maxX,minZ,maxZ} — keep in sync with object positions in Room3D. */
const STATIC_OBSTACLES = {
  iv_pole_base: { minX: -1.42, maxX: -0.88, minZ: -0.42, maxZ: 0.12 },
  ventilator_unit: { minX: -2.09, maxX: -1.41, minZ: -1.79, maxZ: -1.11 },
  monitor_stand_base: { minX: 1.28, maxX: 1.92, minZ: -1.02, maxZ: -0.38 },
  ehr_cart: { minX: 1.5, maxX: 2.2, minZ: 0.2, maxZ: 0.9 },
  privacy_curtain: { minX: 2.66, maxX: 2.84, minZ: ROOM.minZ, maxZ: -0.08 },
};

export const NAV = {
  obstacles: new Map(Object.entries(STATIC_OBSTACLES)),
  version: 1,
};

export function registerObstacle(id, box) {
  NAV.obstacles.set(id, box);
  NAV.version++;
}

export function unregisterObstacle(id) {
  if (NAV.obstacles.delete(id)) NAV.version++;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function isFree(x, z, r = NURSE_RADIUS) {
  if (x < BOUNDS.minX + r || x > BOUNDS.maxX - r || z < BOUNDS.minZ + r || z > BOUNDS.maxZ - r) {
    return false;
  }
  for (const o of NAV.obstacles.values()) {
    const cx = clamp(x, o.minX, o.maxX);
    const cz = clamp(z, o.minZ, o.maxZ);
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return true;
}

/** Push a point (THREE.Vector3 or {x,z}) out of walls/obstacles; returns true if it was moved. */
export function resolveCollisions(p, r = NURSE_RADIUS) {
  let moved = false;
  for (let iter = 0; iter < 4; iter++) {
    let changed = false;
    for (const o of NAV.obstacles.values()) {
      const cx = clamp(p.x, o.minX, o.maxX);
      const cz = clamp(p.z, o.minZ, o.maxZ);
      let dx = p.x - cx;
      let dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-10) {
        // Centre inside the footprint: exit through the nearest edge
        const exits = [
          [p.x - o.minX, -1, 0],
          [o.maxX - p.x, 1, 0],
          [p.z - o.minZ, 0, -1],
          [o.maxZ - p.z, 0, 1],
        ].sort((a, b) => a[0] - b[0]);
        const [depth, nx, nz] = exits[0];
        p.x += nx * (depth + r);
        p.z += nz * (depth + r);
      } else {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      }
      changed = true;
    }
    const bx = clamp(p.x, BOUNDS.minX + r, BOUNDS.maxX - r);
    const bz = clamp(p.z, BOUNDS.minZ + r, BOUNDS.maxZ - r);
    if (bx !== p.x || bz !== p.z) {
      p.x = bx;
      p.z = bz;
      changed = true;
    }
    if (!changed) break;
    moved = true;
  }
  return moved;
}

export function segmentClear(ax, az, bx, bz, r = NURSE_RADIUS) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / 0.08));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isFree(ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
  }
  return true;
}

/** Nearest walkable point to (x,z), searching outward in rings. */
export function nearestFree(x, z, r = NURSE_RADIUS) {
  if (isFree(x, z, r)) return { x, z };
  for (let rad = 0.05; rad <= 2.5; rad += 0.05) {
    const n = Math.max(8, Math.round((2 * Math.PI * rad) / 0.05));
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * rad;
      const pz = z + Math.sin(a) * rad;
      if (isFree(px, pz, r)) {
        best = { x: px, z: pz };
        break;
      }
    }
    if (best) return best;
  }
  return { x, z };
}

const GRID = 0.2;

/**
 * Returns an array of {x,z} waypoints (excluding the start) from start to goal that avoids
 * obstacles. Falls back to [goal] when the straight line is clear.
 */
export function findPath(start, goalIn, r = NURSE_RADIUS) {
  const s = isFree(start.x, start.z, r) ? { x: start.x, z: start.z } : nearestFree(start.x, start.z, r);
  const goal = nearestFree(goalIn.x, goalIn.z, r);
  if (segmentClear(s.x, s.z, goal.x, goal.z, r)) return [goal];

  const nx = Math.floor((BOUNDS.maxX - BOUNDS.minX) / GRID) + 1;
  const nz = Math.floor((BOUNDS.maxZ - BOUNDS.minZ) / GRID) + 1;
  const toX = (i) => BOUNDS.minX + i * GRID;
  const toZ = (j) => BOUNDS.minZ + j * GRID;
  const key = (i, j) => j * nx + i;
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) free[key(i, j)] = isFree(toX(i), toZ(j), r) ? 1 : 0;

  // Connect start/goal to nearby visible free cells
  const nearCells = (p) => {
    const out = [];
    const ci = Math.round((p.x - BOUNDS.minX) / GRID);
    const cj = Math.round((p.z - BOUNDS.minZ) / GRID);
    for (let dj = -3; dj <= 3; dj++)
      for (let di = -3; di <= 3; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz || !free[key(i, j)]) continue;
        if (segmentClear(p.x, p.z, toX(i), toZ(j), r)) out.push(key(i, j));
      }
    return out;
  };
  const startCells = nearCells(s);
  const goalCells = new Set(nearCells(goal));
  if (!startCells.length || !goalCells.size) return [goal];

  const g = new Float32Array(nx * nz).fill(Infinity);
  const came = new Int32Array(nx * nz).fill(-1);
  const open = [];
  const h = (k) => Math.hypot(toX(k % nx) - goal.x, toZ(Math.floor(k / nx)) - goal.z);
  for (const k of startCells) {
    g[k] = Math.hypot(toX(k % nx) - s.x, toZ(Math.floor(k / nx)) - s.z);
    open.push([g[k] + h(k), k]);
  }
  const closed = new Uint8Array(nx * nz);
  let reached = -1;
  while (open.length) {
    let bi = 0;
    for (let q = 1; q < open.length; q++) if (open[q][0] < open[bi][0]) bi = q;
    const [, k] = open.splice(bi, 1)[0];
    if (closed[k]) continue;
    closed[k] = 1;
    if (goalCells.has(k)) {
      reached = k;
      break;
    }
    const i = k % nx;
    const j = Math.floor(k / nx);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const kk = key(ii, jj);
        if (!free[kk] || closed[kk]) continue;
        if (di && dj && (!free[key(i + di, j)] || !free[key(i, j + dj)])) continue; // no corner cutting
        const ng = g[k] + (di && dj ? Math.SQRT2 : 1) * GRID;
        if (ng < g[kk]) {
          g[kk] = ng;
          came[kk] = k;
          open.push([ng + h(kk), kk]);
        }
      }
  }
  if (reached < 0) return [goal];

  const raw = [];
  for (let k = reached; k >= 0; k = came[k]) raw.unshift({ x: toX(k % nx), z: toZ(Math.floor(k / nx)) });
  raw.push(goal);

  // String-pull: skip intermediate points while the straight line stays clear
  const out = [];
  let anchor = s;
  let idx = 0;
  while (idx < raw.length) {
    let far = idx;
    for (let q = raw.length - 1; q > idx; q--) {
      if (segmentClear(anchor.x, anchor.z, raw[q].x, raw[q].z, r)) {
        far = q;
        break;
      }
    }
    out.push(raw[far]);
    anchor = raw[far];
    idx = far + 1;
  }
  return out;
}
