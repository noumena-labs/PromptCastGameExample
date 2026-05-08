/**
 * SceneNode DSL — the engine's VFX compiler emits a small Three.js-flavored scene tree per spell.
 *
 * Constraints:
 *   - Tree depth ≤ 1 (root + up to 6 children; children are leaves).
 *   - 17 shape primitives, 10 motion modes, 5 arrange modes.
 *   - particleCount is only meaningful when shape === "particle_cloud".
 *   - Legacy particle_cloud sum across the whole scene is hard-capped at 200.
 *   - quarks_emitter nodes are budgeted SEPARATELY (QUARKS_BUDGET=800), gated
 *     by preset weight. See `clampScene` below.
 *   - Light-emitting nodes (emissiveIntensity > 0) are limited to 2 per scene
 *     (renderer enforces; not validated here so the LLM has slack).
 *
 * The renderer is responsible for actually instantiating Three.js objects from
 * this declarative tree. This module owns ONLY the schema + a particle budget clamp.
 */

import { z } from "zod";
import { shaderPhaseIds, spellShaderIds } from "@/game/spells/modules/spellIds";

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations
// ─────────────────────────────────────────────────────────────────────────────

export const sceneShapes = [
  "sphere",
  "box",
  "cylinder",
  "cone",
  "torus",
  "ring",
  "plane",
  "tetra",
  "octa",
  "bar",
  "disc",
  "particle_cloud",
  // Procedural rock primitives (Phase 2). Composers pick these for solid VFX
  // bodies: meteor heads, eruption monoliths, crystal spires, debris piles.
  "displaced_meteor",
  "monolith",
  "crystal_cluster",
  "rock_chunks",
  // three.quarks-backed particle emitter; the actual look comes from
  // `quarksPreset` (see QuarksPresetId in components/game/scene/quarks/presets.ts).
  "quarks_emitter",
] as const;
export type SceneShape = (typeof sceneShapes)[number];

/**
 * IDs of the three.quarks presets the renderer can spawn for a `quarks_emitter`
 * shape. Kept as a string union here (not imported from presets.ts) so the
 * spell schema stays a pure data module with no THREE.js dependencies.
 * MUST be kept in sync with QuarksPresetId in
 * `src/components/game/scene/quarks/presets.ts`.
 */
export const quarksPresetIds = [
  "smoke_plume_dark",
  "smoke_plume_dust",
  "embers_rising",
  "sparks_burst",
  "fire_core",
  "debris_chunks",
  "dust_puff",
  "lava_droplets",
  "lightning_arcs",
  "debug_alpha_test",
] as const;
export type QuarksPresetIdSchema = (typeof quarksPresetIds)[number];

export const sceneMotions = [
  "static",
  "spin",
  "orbit",
  "pulse",
  "drift",
  "fall",
  "rise",
  "swirl",
  "expand",
  "shake",
  "erupt",
] as const;
export type SceneMotion = (typeof sceneMotions)[number];

export const sceneArranges = ["single", "ring", "line", "stack", "random"] as const;
export type SceneArrange = (typeof sceneArranges)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/**
 * Leaf node — depth 1. No `children` field.
 */
export const sceneLeafSchema = z.object({
  shape: z.enum(sceneShapes),
  shaderId: z.enum(spellShaderIds),
  shaderPhase: z.enum(shaderPhaseIds),
  color: hexColor,
  emissiveIntensity: z.coerce.number().min(0).max(4),
  size: z.coerce.number().min(0.05).max(8),
  position: vec3,
  rotation: vec3,
  motion: z.enum(sceneMotions),
  motionSpeed: z.coerce.number().min(0).max(8),
  arrange: z.enum(sceneArranges),
  arrangeCount: z.coerce.number().int().min(1).max(12),
  arrangeRadius: z.coerce.number().min(0).max(8),
  particleCount: z.coerce.number().int().min(0).max(200),
  opacity: z.coerce.number().min(0).max(1),
  // ── Optional Phase 2 extensions ──────────────────────────────────────────
  /**
   * Quarks preset id — only meaningful when shape === "quarks_emitter".
   * Defaults to "smoke_plume_dark" if missing on a quarks_emitter node.
   */
  quarksPreset: z.enum(quarksPresetIds).optional(),
  /**
   * Optional secondary color (alignment colorB / accent) used by procedural
   * rocks (crack glow), quarks presets (gradient end), and some shaders.
   * Falls back to `color` when omitted.
   */
  colorB: hexColor.optional(),
  /**
   * Deterministic shape/PRNG seed for procedural rock geometries and any
   * preset that randomizes orientation. Defaults to 0.
   */
  seed: z.coerce.number().int().min(0).max(0xffffffff).optional(),
  /**
   * Quarks emission intensity multiplier (LOD friendly). 0..2, default 1.
   * Renderer scales emissionOverTime / burst counts by this value.
   */
  intensity: z.coerce.number().min(0).max(2).optional(),
});
export type SceneLeaf = z.infer<typeof sceneLeafSchema>;

/**
 * Root node — same shape as a leaf, plus optional `children` (≤ 6 leaves).
 */
export const sceneRootSchema = sceneLeafSchema.extend({
  children: z.array(sceneLeafSchema).max(6),
});
export type SceneRoot = z.infer<typeof sceneRootSchema>;

export const sceneSchema = sceneRootSchema;
export type SpellScene = SceneRoot;

// ─────────────────────────────────────────────────────────────────────────────
// Clamp
//
// Defensive pass that runs after Zod parsing. Zod handles per-field bounds;
// this enforces global invariants the schema can't express:
//   - total legacy particle_cloud count ≤ PARTICLE_BUDGET (200), proportionally scaled
//   - quarks_emitter nodes' weighted-intensity sum ≤ QUARKS_BUDGET (800),
//     proportionally scaled via `intensity`
//   - children array trimmed to 6 (Zod already enforces)
//
// Light cap is enforced at render-time, not here.
// ─────────────────────────────────────────────────────────────────────────────

const PARTICLE_BUDGET = 200;
/**
 * Total quarks "particle slots" the scene may consume in aggregate. Each
 * preset has a baseline particle count; we approximate cost as
 * baselineCount * (intensity ?? 1). Renderer applies the same scale on
 * emissionOverTime so visuals match the budget.
 */
export const QUARKS_BUDGET = 800;

/**
 * Approximate per-preset baseline particle count. Used solely for budget
 * accounting in clampScene. Mirrors the maxParticle defaults in presets.ts
 * (which the runtime no longer takes; quarks auto-grows). If a preset is
 * missing here it's treated as 60.
 */
const QUARKS_PRESET_BASELINE: Record<string, number> = {
  smoke_plume_dark: 80,
  smoke_plume_dust: 120,
  embers_rising: 160,
  sparks_burst: 120,
  fire_core: 60,
  debris_chunks: 40,
  dust_puff: 60,
  lava_droplets: 80,
  lightning_arcs: 60,
};

function quarksCost(node: SceneLeaf): number {
  if (node.shape !== "quarks_emitter") return 0;
  const baseline =
    QUARKS_PRESET_BASELINE[node.quarksPreset ?? "smoke_plume_dark"] ?? 60;
  const intensity = node.intensity ?? 1;
  return baseline * intensity;
}

export function clampScene(scene: SpellScene): SpellScene {
  const children = scene.children.slice(0, 6);
  const allNodes: SceneLeaf[] = [scene, ...children];

  // -- legacy particle_cloud budget --
  const totalParticles = allNodes.reduce(
    (sum, n) => sum + (n.shape === "particle_cloud" ? n.particleCount : 0),
    0,
  );
  const particleScale =
    totalParticles > PARTICLE_BUDGET ? PARTICLE_BUDGET / totalParticles : 1;

  // -- quarks budget --
  const totalQuarks = allNodes.reduce((sum, n) => sum + quarksCost(n), 0);
  const quarksScale =
    totalQuarks > QUARKS_BUDGET ? QUARKS_BUDGET / totalQuarks : 1;

  if (particleScale === 1 && quarksScale === 1) {
    return { ...scene, children };
  }

  const scaled = (n: SceneLeaf): SceneLeaf => {
    let next = n;
    if (next.shape === "particle_cloud" && particleScale < 1) {
      next = {
        ...next,
        particleCount: Math.max(1, Math.floor(next.particleCount * particleScale)),
      };
    }
    if (next.shape === "quarks_emitter" && quarksScale < 1) {
      const current = next.intensity ?? 1;
      next = {
        ...next,
        intensity: Math.max(0.05, current * quarksScale),
      };
    }
    return next;
  };

  return { ...scaled(scene), children: children.map(scaled) };
}
