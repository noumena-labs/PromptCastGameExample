import { z } from "zod";

/**
 * Catalog of named visual archetypes. The concept call selects one of these so
 * we can:
 *   1. Look up a curated default visual recipe (dramatically more reliable
 *      than asking the model to compose primitives from scratch).
 *   2. Bias mechanical defaults (delivery / impact / count) per archetype.
 *
 * "custom" is an escape hatch for when none of the named archetypes fits — the
 * pipeline falls back to the `arcaneOrb` recipe in that case.
 */
export const archetypeKinds = [
  "meteor_strike",
  "meteor_shower",
  "lightning_bolt",
  "lightning_storm",
  "blackhole",
  "fireball",
  "fire_tornado",
  "frost_nova",
  "ice_shard",
  "shadow_orb",
  "nature_thorns",
  "arcane_beam",
  "arcane_orb",
  "shield",
  "custom",
] as const;

export type ArchetypeKind = (typeof archetypeKinds)[number];

export const scaleHints = ["small", "medium", "large", "epic"] as const;
export type ScaleHint = (typeof scaleHints)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Effect primitives — the building blocks the renderer understands.
// ─────────────────────────────────────────────────────────────────────────────

export const effectPrimitiveKinds = [
  "meteor",
  "lightning",
  "blackhole",
  "particles",
  "vortexCone",
  "ringPulse",
  "beam",
  "disc",
  "shockwave",
  "embers",
  "frostShards",
  "vines",
] as const;

export type EffectPrimitiveKind = (typeof effectPrimitiveKinds)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const num = (min: number, max: number, fallback: number) =>
  z.coerce.number().finite().catch(fallback).transform((v) => Math.min(max, Math.max(min, v)));

const meteorParams = z
  .object({
    trailLength: num(0.5, 6, 2.5),
    headRadius: num(0.1, 0.8, 0.3),
    count: num(1, 10, 1),
    scatterRadius: num(0, 8, 0),
  })
  .catch({ trailLength: 2.5, headRadius: 0.3, count: 1, scatterRadius: 0 });

const lightningParams = z
  .object({
    jaggedness: num(0, 1, 0.55),
    segments: num(4, 24, 12),
    branches: num(0, 6, 2),
    flickerHz: num(2, 30, 14),
    length: num(1, 14, 6),
  })
  .catch({ jaggedness: 0.55, segments: 12, branches: 2, flickerHz: 14, length: 6 });

const blackholeParams = z
  .object({
    eventHorizonR: num(0.2, 2.5, 0.7),
    accretionR: num(0.5, 6, 2.2),
    pullStrength: num(0, 1, 0.6),
    lensing: num(0, 1, 0.7),
  })
  .catch({ eventHorizonR: 0.7, accretionR: 2.2, pullStrength: 0.6, lensing: 0.7 });

const particlesParams = z
  .object({
    count: num(8, 200, 64), // hard cap 200 — laptop-friendly
    lifetime: num(0.2, 4, 1.2),
    spread: num(0, 6, 1.5),
    gravity: num(-6, 6, -1.5),
    sizeStart: num(0.02, 0.4, 0.1),
    sizeEnd: num(0, 0.4, 0.02),
  })
  .catch({ count: 64, lifetime: 1.2, spread: 1.5, gravity: -1.5, sizeStart: 0.1, sizeEnd: 0.02 });

const vortexConeParams = z
  .object({
    height: num(0.5, 6, 2.6),
    baseR: num(0.2, 4, 1),
    topR: num(0.05, 2, 0.2),
    spinRate: num(0, 8, 3),
  })
  .catch({ height: 2.6, baseR: 1, topR: 0.2, spinRate: 3 });

const ringPulseParams = z
  .object({
    count: num(1, 6, 3),
    period: num(0.2, 3, 0.9),
    width: num(0.02, 0.4, 0.08),
  })
  .catch({ count: 3, period: 0.9, width: 0.08 });

const beamParams = z
  .object({
    width: num(0.04, 0.5, 0.12),
    taper: num(0, 1, 0.6),
    glow: num(0, 3, 1.5),
  })
  .catch({ width: 0.12, taper: 0.6, glow: 1.5 });

const discParams = z
  .object({
    segments: num(4, 64, 32),
    opacity: num(0.05, 1, 0.32),
  })
  .catch({ segments: 32, opacity: 0.32 });

const shockwaveParams = z
  .object({
    startR: num(0, 4, 0.2),
    endR: num(0.5, 12, 4),
    durationMs: num(120, 2000, 480),
  })
  .catch({ startR: 0.2, endR: 4, durationMs: 480 });

const embersParams = z
  .object({
    count: num(8, 120, 40),
    gravity: num(-6, 6, 2),
    lifetime: num(0.3, 3, 1.4),
  })
  .catch({ count: 40, gravity: 2, lifetime: 1.4 });

const frostShardsParams = z
  .object({
    count: num(2, 24, 8),
    length: num(0.2, 1.6, 0.7),
  })
  .catch({ count: 8, length: 0.7 });

const vinesParams = z
  .object({
    count: num(2, 20, 6),
    length: num(0.5, 4, 1.6),
    segments: num(3, 14, 6),
  })
  .catch({ count: 6, length: 1.6, segments: 6 });

export const effectPrimitiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("meteor"), params: meteorParams }),
  z.object({ kind: z.literal("lightning"), params: lightningParams }),
  z.object({ kind: z.literal("blackhole"), params: blackholeParams }),
  z.object({ kind: z.literal("particles"), params: particlesParams }),
  z.object({ kind: z.literal("vortexCone"), params: vortexConeParams }),
  z.object({ kind: z.literal("ringPulse"), params: ringPulseParams }),
  z.object({ kind: z.literal("beam"), params: beamParams }),
  z.object({ kind: z.literal("disc"), params: discParams }),
  z.object({ kind: z.literal("shockwave"), params: shockwaveParams }),
  z.object({ kind: z.literal("embers"), params: embersParams }),
  z.object({ kind: z.literal("frostShards"), params: frostShardsParams }),
  z.object({ kind: z.literal("vines"), params: vinesParams }),
]);

export type EffectPrimitive = z.infer<typeof effectPrimitiveSchema>;

export const motionKinds = ["fall", "rise", "spiral", "implode", "explode", "linger", "travel"] as const;
export type MotionKind = (typeof motionKinds)[number];

export const visualRecipeSchema = z.object({
  archetype: z.enum(archetypeKinds).catch("arcane_orb"),
  palette: z
    .object({
      primary: hex,
      secondary: hex.optional(),
      accent: hex.optional(),
      emissive: z.coerce.number().finite().min(0).max(3).catch(1.6),
    })
    .catch({ primary: "#9d7cff", emissive: 1.6 }),
  primitives: z.array(effectPrimitiveSchema).min(1).max(6).catch([]),
  motion: z.enum(motionKinds).optional(),
  ambientLight: z
    .object({ color: hex, intensity: z.coerce.number().min(0).max(5).catch(1.2) })
    .optional(),
});

export type VisualRecipe = z.infer<typeof visualRecipeSchema>;
