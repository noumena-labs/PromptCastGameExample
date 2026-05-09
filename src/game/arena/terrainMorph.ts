import type { SpellAlignmentId, SpellBuildSpec } from "@/game/spells/modules/spellIds";
import type { AreaSpellState, Vec3 } from "@/game/types";

export type TerrainMorphSource = {
  position: Vec3;
  alignment: SpellAlignmentId;
  radius: number;
  powerTier: number;
  intensity: number;
  createdAt: number;
  expiresAt: number;
  seed: number;
};

export type TerrainMorphSample = {
  displacement: number;
  mask: number;
  signedStrength: number;
  style: number;
  colorA: readonly [number, number, number];
  colorB: readonly [number, number, number];
};

type TerrainMorphProfile = {
  radiusMultiplier: number;
  amplitude: number;
  maxDown: number;
  maxUp: number;
};

export function shouldTerrainMorph(spec: Pick<SpellBuildSpec, "deliveryVehicle" | "vfx">): boolean {
  switch (spec.deliveryVehicle) {
    case "projectile_arcing":
    case "skyfall":
    case "ground_eruption":
      return true;
    case "projectile_linear":
    case "instant_hitscan":
      return spec.vfx.impact.includes("terrain_morph");
    case "aura_orbit":
      return false;
  }
}

export function terrainMorphSeed(spec: SpellBuildSpec): number {
  let h = 2166136261 >>> 0;
  const s = `${spec.name}|${spec.alignment}|${spec.deliveryVehicle}|terrain_morph`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function terrainMorphWorldRadius(alignment: SpellAlignmentId, impactRadius: number): number {
  const profile = terrainMorphProfileFor(alignment);
  return Number(Math.max(5.2, impactRadius * profile.radiusMultiplier).toFixed(2));
}

export function terrainMorphSourceFromArea(area: AreaSpellState): TerrainMorphSource | null {
  if (!shouldTerrainMorph(area.spell.buildSpec)) return null;
  if (area.attachedToId) return null;
  return {
    position: area.position,
    alignment: area.spell.alignment,
    radius: terrainMorphWorldRadius(area.spell.alignment, area.spell.radius),
    powerTier: area.spell.powerTier,
    intensity: area.spell.buildSpec.modifiers.intensity,
    createdAt: area.createdAt,
    expiresAt: area.expiresAt,
    seed: mixSeedWithPosition(terrainMorphSeed(area.spell.buildSpec), area.position),
  };
}

export function terrainMorphDisplacementAt(x: number, z: number, source: TerrainMorphSource, nowMs: number): number {
  return terrainMorphSampleAt(x, z, source, nowMs).displacement;
}

export function terrainMorphSampleAt(x: number, z: number, source: TerrainMorphSource, nowMs: number): TerrainMorphSample {
  const dx = x - source.position[0];
  const dz = z - source.position[2];
  const distance = Math.hypot(dx, dz);
  if (distance >= source.radius) return emptyTerrainMorphSample;

  const profile = terrainMorphProfileFor(source.alignment);
  const t = distance / source.radius;
  const angle = Math.atan2(dz, dx);
  const duration = Math.max(1, source.expiresAt - source.createdAt);
  const life = clamp01((nowMs - source.createdAt) / duration);
  const ageSec = Math.max(0, (nowMs - source.createdAt) / 1000);
  const lifeAlpha = smoothstep(0, 0.16, life) * (1 - smoothstep(0.78, 1, life));
  if (lifeAlpha <= 0) return emptyTerrainMorphSample;

  const edge = 1 - smoothstep(0.78, 1, t);
  const center = 1 - smoothstep(0, 0.58, t);
  const rim = ring(t, 0.58, 0.11);
  const outerRing = ring(t, 0.82, 0.08);
  const noise = valueNoise(x * 0.42, z * 0.42, source.seed) - 0.5;
  const ridges = ridgeSpokes(angle, source.seed, ridgeCountFor(source.alignment)) * edge;
  const wave = Math.sin(t * Math.PI * 8 - ageSec * 5.2 + (source.seed & 31) * 0.1) * edge;

  let shape: number;
  switch (source.alignment) {
    case "fire":
      shape = -0.95 * center + 0.95 * rim + 0.28 * ridges + 0.2 * wave + 0.26 * noise * edge;
      break;
    case "water_ice":
      shape = 0.52 * Math.sin(t * Math.PI * 5.5 - ageSec * 2.1) * edge + 0.7 * ring(t, 0.42, 0.12) + 0.24 * ridges - 0.2 * center;
      break;
    case "lightning":
      shape = 0.78 * ring(t, 0.28 + Math.sin(ageSec * 3.5) * 0.035, 0.055) + 0.66 * ring(t, 0.56, 0.07) + 0.36 * ridges - 0.18 * center;
      break;
    case "earth":
      shape = 0.5 * center + 0.95 * ridges + 0.7 * ring(t, 0.38, 0.13) - 0.28 * outerRing + 0.34 * noise * edge;
      break;
    case "dark":
      shape = -1.2 * center + 0.95 * rim - 0.34 * ring(t, 0.28, 0.12) + 0.18 * wave + 0.3 * noise * edge;
      break;
    case "light":
      shape = 0.34 * center + 0.72 * ring(t, 0.34, 0.08) + 0.58 * ring(t, 0.64, 0.08) + 0.22 * ridges + 0.18 * wave;
      break;
    case "meteor_cosmic":
      shape = -1.35 * center + 1.1 * rim + 0.42 * outerRing + 0.26 * ridges + 0.22 * noise * edge;
      break;
  }

  const powerScale = 0.86 + source.powerTier * 0.08;
  const intensityScale = 0.85 + Math.max(0, source.intensity - 1) * 0.45;
  const displacement = shape * profile.amplitude * powerScale * intensityScale * lifeAlpha;
  const clamped = clamp(displacement, -profile.maxDown, profile.maxUp);
  // Shader semantics are meter-based: 0 = neutral, +1 = visibly raised,
  // -1 = visibly depressed. This keeps the visual language consistent across
  // alignments even though each profile has different physical max offsets.
  const signedStrength = clamp(clamped, -1.25, 1.25);
  const mask = clamp01(Math.abs(signedStrength) * 0.9 + edge * lifeAlpha * 0.22);
  const colors = terrainMorphColorsFor(source.alignment);
  return {
    displacement: clamped,
    mask,
    signedStrength: clamp(signedStrength, -1, 1),
    style: terrainMorphStyleId(source.alignment),
    colorA: colors.colorA,
    colorB: colors.colorB,
  };
}

export function terrainMorphProfileFor(alignment: SpellAlignmentId): TerrainMorphProfile {
  switch (alignment) {
    case "fire":
      return { radiusMultiplier: 2.15, amplitude: 1.55, maxDown: 1.65, maxUp: 1.45 };
    case "water_ice":
      return { radiusMultiplier: 2.05, amplitude: 1.28, maxDown: 0.85, maxUp: 1.5 };
    case "lightning":
      return { radiusMultiplier: 2.25, amplitude: 1.18, maxDown: 0.65, maxUp: 1.35 };
    case "earth":
      return { radiusMultiplier: 2.35, amplitude: 1.65, maxDown: 0.95, maxUp: 2.0 };
    case "dark":
      return { radiusMultiplier: 2.2, amplitude: 1.45, maxDown: 1.9, maxUp: 1.25 };
    case "light":
      return { radiusMultiplier: 2.1, amplitude: 1.2, maxDown: 0.55, maxUp: 1.45 };
    case "meteor_cosmic":
      return { radiusMultiplier: 2.55, amplitude: 1.72, maxDown: 2.25, maxUp: 1.65 };
  }
}

function terrainMorphStyleId(alignment: SpellAlignmentId): number {
  switch (alignment) {
    case "fire":
      return 1;
    case "water_ice":
      return 2;
    case "lightning":
      return 3;
    case "earth":
      return 4;
    case "dark":
      return 5;
    case "light":
      return 6;
    case "meteor_cosmic":
      return 7;
  }
}

function terrainMorphColorsFor(alignment: SpellAlignmentId): {
  colorA: readonly [number, number, number];
  colorB: readonly [number, number, number];
} {
  switch (alignment) {
    case "fire":
      return { colorA: [0.11, 0.035, 0.012], colorB: [1.0, 0.34, 0.08] };
    case "water_ice":
      return { colorA: [0.52, 0.92, 1.0], colorB: [0.92, 1.0, 1.0] };
    case "lightning":
      return { colorA: [0.14, 0.11, 0.36], colorB: [1.0, 0.95, 0.25] };
    case "earth":
      return { colorA: [0.38, 0.27, 0.16], colorB: [0.82, 0.63, 0.36] };
    case "dark":
      return { colorA: [0.06, 0.02, 0.08], colorB: [0.64, 0.34, 0.8] };
    case "light":
      return { colorA: [0.58, 0.44, 0.16], colorB: [1.0, 0.92, 0.48] };
    case "meteor_cosmic":
      return { colorA: [0.06, 0.025, 0.09], colorB: [0.96, 0.52, 0.22] };
  }
}

const emptyTerrainMorphSample: TerrainMorphSample = {
  displacement: 0,
  mask: 0,
  signedStrength: 0,
  style: 0,
  colorA: [0, 0, 0],
  colorB: [0, 0, 0],
};

function mixSeedWithPosition(seed: number, position: Vec3): number {
  let h = seed >>> 0;
  h ^= Math.imul(Math.round(position[0] * 10), 374761393) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= Math.imul(Math.round(position[2] * 10), 668265263) >>> 0;
  return Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
}

function ridgeCountFor(alignment: SpellAlignmentId): number {
  switch (alignment) {
    case "earth":
      return 9;
    case "lightning":
      return 13;
    case "light":
      return 10;
    case "meteor_cosmic":
      return 11;
    default:
      return 7;
  }
}

function ridgeSpokes(angle: number, seed: number, count: number): number {
  const phase = (seed & 1023) * 0.006135923;
  const raw = Math.abs(Math.sin(angle * count + phase));
  return Math.pow(raw, 5.5) * 1.35 - 0.18;
}

function ring(t: number, center: number, width: number): number {
  const d = (t - center) / width;
  return Math.exp(-d * d * 2.4);
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const sx = smooth(fx);
  const sz = smooth(fz);
  return a * (1 - sx) * (1 - sz) + b * sx * (1 - sz) + c * (1 - sx) * sz + d * sx * sz;
}

function hash2(ix: number, iz: number, seed: number): number {
  const h = Math.sin(ix * 127.1 + iz * 311.7 + (seed & 0xffff) * 0.017) * 43758.5453;
  return h - Math.floor(h);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
