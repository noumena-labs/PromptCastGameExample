/**
 * SceneNode DSL — the engine's VFX compiler emits a small Three.js-flavored scene tree per spell.
 *
 * Constraints:
 *   - Tree depth ≤ 1 (root + up to 6 children; children are leaves).
 *   - 12 shape primitives, 10 motion modes, 5 arrange modes.
 *   - particleCount is only meaningful when shape === "particle_cloud".
 *   - Particle sum across the whole scene is hard-capped at 200 (engine clamps).
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
] as const;
export type SceneShape = (typeof sceneShapes)[number];

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
//   - total particle count ≤ 200 (proportionally scaled down if exceeded)
//   - children array trimmed to 6 (Zod already enforces)
//
// Light cap is enforced at render-time, not here.
// ─────────────────────────────────────────────────────────────────────────────

const PARTICLE_BUDGET = 200;

export function clampScene(scene: SpellScene): SpellScene {
  const children = scene.children.slice(0, 6);

  const allNodes: SceneLeaf[] = [scene, ...children];
  const totalParticles = allNodes.reduce(
    (sum, n) => sum + (n.shape === "particle_cloud" ? n.particleCount : 0),
    0,
  );

  if (totalParticles <= PARTICLE_BUDGET) {
    return { ...scene, children };
  }

  const scale = PARTICLE_BUDGET / totalParticles;
  const scaled = (n: SceneLeaf): SceneLeaf =>
    n.shape === "particle_cloud"
      ? { ...n, particleCount: Math.max(1, Math.floor(n.particleCount * scale)) }
      : n;

  return { ...scaled(scene), children: children.map(scaled) };
}
