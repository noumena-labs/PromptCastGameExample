export const ARENA_RADIUS = 60;
export const PLAYABLE_RADIUS = 52;

// Deterministic value noise — fast, smooth, no dependencies.
function hash2(ix: number, iz: number): number {
  const h = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const sx = smooth(fx);
  const sz = smooth(fz);
  return a * (1 - sx) * (1 - sz) + b * sx * (1 - sz) + c * (1 - sx) * sz + d * sx * sz;
}

function fbm(x: number, z: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += amp * valueNoise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

/**
 * Ground height at world x/z.
 * - Center basin (r < 30) is gently rolling, mostly flat for combat.
 * - Outer ring rises into surrounding hills.
 * - Beyond ARENA_RADIUS keeps rising for a closed horizon.
 */
export function getGroundHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const rolling = (fbm(x * 0.045, z * 0.045) - 0.5) * 1.6; // ±0.8m
  const microRoll = (fbm(x * 0.18, z * 0.18) - 0.5) * 0.35;

  // Hill ring rises sharply between PLAYABLE_RADIUS and ARENA_RADIUS, then keeps climbing.
  let hill = 0;
  if (r > PLAYABLE_RADIUS) {
    const t = Math.min(1, (r - PLAYABLE_RADIUS) / (ARENA_RADIUS - PLAYABLE_RADIUS));
    hill = smooth(t) * 14;
  }
  if (r > ARENA_RADIUS) {
    hill += (r - ARENA_RADIUS) * 0.9;
  }
  // Add noise variation to the hill ring so it isn't a perfect torus.
  const hillNoise = (fbm(x * 0.07 + 31, z * 0.07 + 17) - 0.5) * 4;
  if (r > PLAYABLE_RADIUS - 6) {
    const blend = Math.min(1, Math.max(0, (r - (PLAYABLE_RADIUS - 6)) / 10));
    hill += hillNoise * blend;
  }

  return rolling + microRoll + hill;
}

export type TerrainGeometryData = {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  colors: Float32Array;
  size: number;
  segments: number;
};

/** Build a centered XZ plane geometry data block, displaced by getGroundHeight. */
export function buildTerrainGeometry(size: number, segments: number): TerrainGeometryData {
  const verts = (segments + 1) * (segments + 1);
  const positions = new Float32Array(verts * 3);
  const colors = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const indices = new Uint32Array(segments * segments * 6);
  const half = size / 2;
  const step = size / segments;

  for (let iz = 0; iz <= segments; iz += 1) {
    for (let ix = 0; ix <= segments; ix += 1) {
      const x = -half + ix * step;
      const z = -half + iz * step;
      const y = getGroundHeight(x, z);
      const idx = (iz * (segments + 1) + ix) * 3;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      // Color: meadow gradient, lighter on hills, occasional dirt patch.
      const hillT = Math.max(0, Math.min(1, (Math.hypot(x, z) - (PLAYABLE_RADIUS - 6)) / (ARENA_RADIUS - PLAYABLE_RADIUS + 6)));
      const dirt = (valueNoise(x * 0.2 + 5, z * 0.2 + 9) - 0.4) * 1.2;
      const grassR = 0.32 + dirt * 0.18;
      const grassG = 0.55 + dirt * 0.05 - hillT * 0.18;
      const grassB = 0.22 + dirt * 0.08 - hillT * 0.05;
      const hillR = 0.45;
      const hillG = 0.5;
      const hillB = 0.32;
      colors[idx] = grassR * (1 - hillT) + hillR * hillT;
      colors[idx + 1] = grassG * (1 - hillT) + hillG * hillT;
      colors[idx + 2] = grassB * (1 - hillT) + hillB * hillT;
    }
  }

  let i = 0;
  for (let iz = 0; iz < segments; iz += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const a = iz * (segments + 1) + ix;
      const b = a + 1;
      const c = a + (segments + 1);
      const d = c + 1;
      indices[i++] = a;
      indices[i++] = c;
      indices[i++] = b;
      indices[i++] = b;
      indices[i++] = c;
      indices[i++] = d;
    }
  }

  // Compute normals by averaging triangle normals.
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3;
    const ib = indices[t + 1] * 3;
    const ic = indices[t + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  for (let n = 0; n < normals.length; n += 3) {
    const len = Math.hypot(normals[n], normals[n + 1], normals[n + 2]) || 1;
    normals[n] /= len;
    normals[n + 1] /= len;
    normals[n + 2] /= len;
  }

  return { positions, indices, normals, colors, size, segments };
}

/** Deterministic scatter inside an annulus, avoiding center mask radius. */
export function scatterPositions(
  count: number,
  innerRadius: number,
  outerRadius: number,
  seed: number,
): Array<{ x: number; z: number; y: number; rot: number; scale: number }> {
  const out: Array<{ x: number; z: number; y: number; rot: number; scale: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const r1 = hash2(i + seed, seed * 7.3 + 1);
    const r2 = hash2(i * 1.7 + seed * 3, seed * 11.1 + 9);
    const r3 = hash2(i * 0.91 + seed * 5, seed * 5.7 + 13);
    const r4 = hash2(i * 2.31 + seed * 9, seed * 13.7 + 21);
    const radius = Math.sqrt(r1 * (outerRadius * outerRadius - innerRadius * innerRadius) + innerRadius * innerRadius);
    const angle = r2 * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    out.push({
      x,
      z,
      y: getGroundHeight(x, z),
      rot: r3 * Math.PI * 2,
      scale: 0.7 + r4 * 0.7,
    });
  }
  return out;
}
