import type {
  ArchetypeKind,
  EffectPrimitive,
  MotionKind,
  VisualRecipe,
} from "@/game/spells/visualRecipe";
import type { SpellDelivery, SpellElement, SpellImpact } from "@/game/types";

/**
 * Curated defaults per archetype. The visual call only needs to choose a
 * palette and (optionally) tune a few params — it does NOT have to invent
 * recipes from scratch. This is the single biggest reliability win in the
 * pipeline because it shrinks the LLM's output surface from "compose a tree
 * of effects" to "fill in a small palette + numeric overrides."
 *
 * Particle counts are kept laptop-friendly (target ~150 particles total per
 * spell; well under our 200/primitive cap).
 */

export type ArchetypeDefaults = {
  delivery: SpellDelivery;
  impact: SpellImpact;
  element: SpellElement;
  /** Suggested count (sky shower etc); pipeline still re-clamps via spellSchema. */
  count: number;
  /** Default visual recipe (mutated/extended by visual call). */
  recipe: Omit<VisualRecipe, "palette"> & {
    palette: VisualRecipe["palette"];
  };
};

const m = (
  primitives: EffectPrimitive[],
  motion: MotionKind | undefined,
  primary: string,
  emissive = 1.6,
  secondary?: string,
  accent?: string,
): VisualRecipe => ({
  archetype: "arcane_orb",
  palette: { primary, secondary, accent, emissive },
  primitives,
  motion,
});

export const archetypeDefaults: Record<ArchetypeKind, ArchetypeDefaults> = {
  meteor_strike: {
    delivery: "sky",
    impact: "burst",
    element: "fire",
    count: 1,
    recipe: m(
      [
        { kind: "meteor", params: { trailLength: 4, headRadius: 0.45, count: 1, scatterRadius: 0 } },
        { kind: "embers", params: { count: 40, gravity: 1.5, lifetime: 1.4 } },
        { kind: "shockwave", params: { startR: 0.3, endR: 5, durationMs: 520 } },
      ],
      "fall",
      "#ff6a2a",
      1.9,
      "#ffae54",
      "#ffe5a0",
    ),
  },
  meteor_shower: {
    delivery: "sky",
    impact: "aoe",
    element: "fire",
    count: 6,
    recipe: m(
      [
        { kind: "meteor", params: { trailLength: 3, headRadius: 0.32, count: 1, scatterRadius: 0 } },
        { kind: "embers", params: { count: 24, gravity: 1.2, lifetime: 1.1 } },
      ],
      "fall",
      "#ff6a2a",
      1.8,
      "#ffae54",
    ),
  },
  lightning_bolt: {
    delivery: "projectile",
    impact: "single",
    element: "lightning",
    count: 1,
    recipe: m(
      [
        { kind: "lightning", params: { jaggedness: 0.7, segments: 14, branches: 2, flickerHz: 18, length: 5 } },
        { kind: "particles", params: { count: 28, lifetime: 0.5, spread: 0.4, gravity: 0, sizeStart: 0.06, sizeEnd: 0.0 } },
      ],
      "travel",
      "#fff36a",
      2.4,
      "#fffbd1",
      "#a4f0ff",
    ),
  },
  lightning_storm: {
    delivery: "sky",
    impact: "aoe",
    element: "lightning",
    count: 5,
    recipe: m(
      [
        { kind: "lightning", params: { jaggedness: 0.85, segments: 16, branches: 4, flickerHz: 22, length: 8 } },
        { kind: "ringPulse", params: { count: 3, period: 0.6, width: 0.1 } },
      ],
      "fall",
      "#fff36a",
      2.2,
      "#a4f0ff",
    ),
  },
  blackhole: {
    delivery: "projectile",
    impact: "vortex",
    element: "shadow",
    count: 1,
    recipe: m(
      [
        { kind: "blackhole", params: { eventHorizonR: 0.65, accretionR: 2.0, pullStrength: 0.7, lensing: 0.8 } },
        { kind: "particles", params: { count: 64, lifetime: 1.5, spread: 2.4, gravity: 0, sizeStart: 0.08, sizeEnd: 0.01 } },
        { kind: "vortexCone", params: { height: 2.4, baseR: 1.1, topR: 0.18, spinRate: 4 } },
      ],
      "implode",
      "#1b0d2c",
      0.6,
      "#8d5aa8",
      "#d6a8ff",
    ),
  },
  fireball: {
    delivery: "projectile",
    impact: "burst",
    element: "fire",
    count: 1,
    recipe: m(
      [
        { kind: "particles", params: { count: 48, lifetime: 0.7, spread: 0.5, gravity: 0.4, sizeStart: 0.16, sizeEnd: 0.02 } },
        { kind: "embers", params: { count: 30, gravity: 1.0, lifetime: 1.0 } },
      ],
      "travel",
      "#ff6a2a",
      2.0,
      "#ffae54",
      "#ffe5a0",
    ),
  },
  fire_tornado: {
    delivery: "self",
    impact: "vortex",
    element: "fire",
    count: 1,
    recipe: m(
      [
        { kind: "vortexCone", params: { height: 3.6, baseR: 1.4, topR: 0.4, spinRate: 6 } },
        { kind: "particles", params: { count: 80, lifetime: 1.6, spread: 1.6, gravity: 1.4, sizeStart: 0.12, sizeEnd: 0.02 } },
        { kind: "embers", params: { count: 40, gravity: 2.0, lifetime: 1.6 } },
        { kind: "ringPulse", params: { count: 2, period: 1.2, width: 0.08 } },
      ],
      "spiral",
      "#ff6a2a",
      2.0,
      "#ffae54",
      "#ffe5a0",
    ),
  },
  frost_nova: {
    delivery: "self",
    impact: "burst",
    element: "ice",
    count: 1,
    recipe: m(
      [
        { kind: "shockwave", params: { startR: 0.2, endR: 6, durationMs: 600 } },
        { kind: "frostShards", params: { count: 12, length: 0.9 } },
        { kind: "particles", params: { count: 56, lifetime: 1.0, spread: 2.5, gravity: -0.4, sizeStart: 0.08, sizeEnd: 0.0 } },
      ],
      "explode",
      "#8ae9ff",
      1.6,
      "#cdf6ff",
      "#ffffff",
    ),
  },
  ice_shard: {
    delivery: "projectile",
    impact: "single",
    element: "ice",
    count: 1,
    recipe: m(
      [
        { kind: "frostShards", params: { count: 4, length: 0.5 } },
        { kind: "particles", params: { count: 16, lifetime: 0.4, spread: 0.2, gravity: -0.2, sizeStart: 0.05, sizeEnd: 0 } },
      ],
      "travel",
      "#8ae9ff",
      1.8,
      "#cdf6ff",
    ),
  },
  shadow_orb: {
    delivery: "projectile",
    impact: "single",
    element: "shadow",
    count: 1,
    recipe: m(
      [
        { kind: "particles", params: { count: 48, lifetime: 1.0, spread: 0.5, gravity: 0, sizeStart: 0.1, sizeEnd: 0.02 } },
        { kind: "ringPulse", params: { count: 2, period: 0.8, width: 0.06 } },
      ],
      "travel",
      "#3d1f5c",
      1.4,
      "#8d5aa8",
      "#d6a8ff",
    ),
  },
  nature_thorns: {
    delivery: "self",
    impact: "trap",
    element: "nature",
    count: 1,
    recipe: m(
      [
        { kind: "vines", params: { count: 8, length: 1.8, segments: 7 } },
        { kind: "particles", params: { count: 28, lifetime: 1.6, spread: 1.4, gravity: -0.2, sizeStart: 0.06, sizeEnd: 0 } },
      ],
      "rise",
      "#62e37b",
      1.4,
      "#a8f3b8",
    ),
  },
  arcane_beam: {
    delivery: "beam",
    impact: "single",
    element: "arcane",
    count: 1,
    recipe: m(
      [
        { kind: "beam", params: { width: 0.18, taper: 0.5, glow: 2.2 } },
        { kind: "particles", params: { count: 24, lifetime: 0.4, spread: 0.18, gravity: 0, sizeStart: 0.05, sizeEnd: 0 } },
      ],
      "travel",
      "#9d7cff",
      2.0,
      "#d6c8ff",
    ),
  },
  arcane_orb: {
    delivery: "projectile",
    impact: "single",
    element: "arcane",
    count: 1,
    recipe: m(
      [
        { kind: "particles", params: { count: 36, lifetime: 0.7, spread: 0.4, gravity: 0, sizeStart: 0.08, sizeEnd: 0.01 } },
        { kind: "ringPulse", params: { count: 2, period: 0.7, width: 0.07 } },
      ],
      "travel",
      "#9d7cff",
      2.0,
      "#d6c8ff",
    ),
  },
  shield: {
    delivery: "self",
    impact: "aoe",
    element: "arcane",
    count: 1,
    recipe: m(
      [
        { kind: "disc", params: { segments: 32, opacity: 0.18 } },
        { kind: "ringPulse", params: { count: 4, period: 1.4, width: 0.08 } },
      ],
      "linger",
      "#9d7cff",
      1.4,
      "#d6c8ff",
    ),
  },
  custom: {
    delivery: "projectile",
    impact: "single",
    element: "arcane",
    count: 1,
    recipe: m(
      [
        { kind: "particles", params: { count: 36, lifetime: 0.7, spread: 0.4, gravity: 0, sizeStart: 0.08, sizeEnd: 0.01 } },
        { kind: "ringPulse", params: { count: 2, period: 0.7, width: 0.07 } },
      ],
      "travel",
      "#9d7cff",
      1.8,
    ),
  },
};

/** Returns a fresh deep-cloned recipe (so callers can mutate without leaking). */
export function recipeForArchetype(kind: ArchetypeKind): VisualRecipe {
  const base = archetypeDefaults[kind] ?? archetypeDefaults.arcane_orb;
  return {
    archetype: kind === "custom" ? "arcane_orb" : kind,
    palette: { ...base.recipe.palette },
    primitives: base.recipe.primitives.map((p) => ({ kind: p.kind, params: { ...p.params } } as EffectPrimitive)),
    motion: base.recipe.motion,
    ambientLight: base.recipe.ambientLight ? { ...base.recipe.ambientLight } : undefined,
  };
}
