// Procedural rock geometries
// -----------------------------------------------------------------------------
// Displaced primitives used for solid VFX bodies (meteors, monoliths, crystals).
// All geometries are CACHED by parameter signature in an LRU map so repeated
// spell casts reuse the same BufferGeometry.
//
// Determinism: a `seed` parameter feeds a hash-based PRNG so the same key
// always produces the same shape. Without a seed, a default seed of 0 is used.
//
// IMPORTANT: callers must NOT dispose() these geometries directly. The LRU
// owns them; eviction handles disposal. (This keeps spell teardown cheap.)

import * as THREE from "three";

// ---------- deterministic PRNG ----------

/**
 * Cheap 32-bit hash -> float in [0,1). Same family as splitmix32; deterministic.
 */
function hash32(seed: number, salt: number): number {
  let x = (seed * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 0xffffffff;
}

function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 1) | 0;
    return hash32(seed, s);
  };
}

// 3D value noise via hash interpolation. Deterministic per seed.
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;

  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);

  const h = (a: number, b: number, c: number) =>
    hash32(seed, ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0);

  const v000 = h(ix, iy, iz);
  const v100 = h(ix + 1, iy, iz);
  const v010 = h(ix, iy + 1, iz);
  const v110 = h(ix + 1, iy + 1, iz);
  const v001 = h(ix, iy, iz + 1);
  const v101 = h(ix + 1, iy, iz + 1);
  const v011 = h(ix, iy + 1, iz + 1);
  const v111 = h(ix + 1, iy + 1, iz + 1);

  const x00 = v000 + (v100 - v000) * sx;
  const x10 = v010 + (v110 - v010) * sx;
  const x01 = v001 + (v101 - v001) * sx;
  const x11 = v011 + (v111 - v011) * sx;
  const y0 = x00 + (x10 - x00) * sy;
  const y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}

function fbm3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise3(x * freq, y * freq, z * freq, seed + i * 17);
    freq *= 2.07;
    amp *= 0.5;
  }
  return v;
}

// ---------- LRU geometry cache ----------

const LRU_MAX = 30;
const _cache = new Map<string, THREE.BufferGeometry>();

function getOrCreate(
  key: string,
  factory: () => THREE.BufferGeometry
): THREE.BufferGeometry {
  const existing = _cache.get(key);
  if (existing) {
    // Refresh recency
    _cache.delete(key);
    _cache.set(key, existing);
    return existing;
  }
  const created = factory();
  _cache.set(key, created);
  if (_cache.size > LRU_MAX) {
    // Evict oldest
    const oldestKey = _cache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) {
      const old = _cache.get(oldestKey);
      _cache.delete(oldestKey);
      old?.dispose();
    }
  }
  return created;
}

// ---------- meteor: displaced icosahedron ----------

export type MeteorGeometryOptions = {
  radius?: number;
  detail?: number; // subdivision detail; 2-3 is plenty
  displacement?: number; // 0..1 strength
  seed?: number;
};

export function makeMeteorGeometry(
  opts: MeteorGeometryOptions = {}
): THREE.BufferGeometry {
  const radius = opts.radius ?? 1;
  const detail = opts.detail ?? 2;
  const displacement = opts.displacement ?? 0.25;
  const seed = opts.seed ?? 0;
  const key = `meteor:${radius.toFixed(3)}:${detail}:${displacement.toFixed(3)}:${seed}`;

  return getOrCreate(key, () => {
    const geom = new THREE.IcosahedronGeometry(radius, detail);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = fbm3(v.x * 1.6, v.y * 1.6, v.z * 1.6, seed, 4);
      // Bias displacement to add craters (negative) and ridges (positive).
      const d = (n - 0.5) * 2 * displacement * radius;
      const len = v.length() || 1;
      v.multiplyScalar(1 + d / len);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    return geom;
  });
}

// ---------- monolith: displaced box pillar ----------

export type MonolithGeometryOptions = {
  width?: number;
  height?: number;
  depth?: number;
  segments?: number;
  displacement?: number;
  seed?: number;
};

export function makeMonolithGeometry(
  opts: MonolithGeometryOptions = {}
): THREE.BufferGeometry {
  const width = opts.width ?? 1;
  const height = opts.height ?? 4;
  const depth = opts.depth ?? 1;
  const segments = opts.segments ?? 4;
  const displacement = opts.displacement ?? 0.1;
  const seed = opts.seed ?? 0;
  const key = `monolith:${width}:${height}:${depth}:${segments}:${displacement}:${seed}`;

  return getOrCreate(key, () => {
    const geom = new THREE.BoxGeometry(
      width,
      height,
      depth,
      segments,
      Math.max(segments, Math.round(segments * (height / Math.max(width, depth)))),
      segments
    );
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Outward displacement along the dominant axis component to keep the
      // pillar rectangular but rough.
      const n = fbm3(v.x * 1.2, v.y * 0.6, v.z * 1.2, seed, 4);
      const d = (n - 0.5) * 2 * displacement;
      const ax = Math.abs(v.x) >= Math.abs(v.z) ? "x" : "z";
      if (ax === "x") v.x += Math.sign(v.x || 1) * d * width;
      else v.z += Math.sign(v.z || 1) * d * depth;
      // Slight vertical jitter on top/bottom faces only.
      if (Math.abs(v.y) > height * 0.45) {
        v.y += Math.sign(v.y || 1) * d * height * 0.2;
      }
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    return geom;
  });
}

// ---------- crystal shard: stretched icosahedron ----------

export type CrystalShardOptions = {
  radius?: number;
  height?: number;
  detail?: number;
  jitter?: number;
  seed?: number;
};

export function makeCrystalShard(
  opts: CrystalShardOptions = {}
): THREE.BufferGeometry {
  const radius = opts.radius ?? 0.4;
  const height = opts.height ?? 1.6;
  const detail = opts.detail ?? 1;
  const jitter = opts.jitter ?? 0.08;
  const seed = opts.seed ?? 0;
  const key = `crystal:${radius}:${height}:${detail}:${jitter}:${seed}`;

  return getOrCreate(key, () => {
    const geom = new THREE.IcosahedronGeometry(radius, detail);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const rng = makeRng(seed);
    // Pre-jitter vertices slightly so facets aren't perfectly regular.
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Stretch along Y to make a shard.
      const t = (v.y / radius + 1) * 0.5; // 0..1 from bottom to top
      v.y *= height / (radius * 2);
      // Taper toward the top.
      const taper = 1 - t * 0.6;
      v.x *= taper;
      v.z *= taper;
      // Add facet jitter
      v.x += (rng() - 0.5) * jitter;
      v.y += (rng() - 0.5) * jitter * 0.5;
      v.z += (rng() - 0.5) * jitter;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    return geom;
  });
}

// ---------- introspection (used by tests / dev preview) ----------

export function _proceduralRockCacheSize(): number {
  return _cache.size;
}

export function _proceduralRockCacheClear(): void {
  for (const g of _cache.values()) g.dispose();
  _cache.clear();
}
