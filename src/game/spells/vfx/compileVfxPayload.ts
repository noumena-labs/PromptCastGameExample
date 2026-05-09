import { getAlignment, type AlignmentDefinition } from "@/game/spells/modules/alignments";
import type { SceneLeaf, SpellScene } from "@/game/spells/sceneNode";
import type { SpellAlignmentId, SpellBuildSpec, SpellShaderId } from "@/game/spells/modules/spellIds";
import {
  shouldTerrainMorph,
  TERRAIN_MORPH_REPRESENTATIVE_IMPACT_RADIUS,
  terrainMorphSeed,
  terrainMorphWorldRadius,
} from "@/game/arena/terrainMorph";

/**
 * Deterministic VFX compiler.
 *
 * Each delivery vehicle has its own cast/travel/impact compiler. The fantasy
 * for each vehicle is enforced here, in code — the LLM never authors scenes:
 *
 *   - projectile_linear : shot from caster, directional core+trail, muzzle flash
 *   - projectile_arcing : heavy lob, spinning core, falling dust, crater impact
 *   - skyfall           : descends straight from sky with telegraph + crash
 *   - instant_hitscan   : visible caster→target beam, instant resolve
 *   - ground_eruption   : geometry rises out of the ground (cones, spikes, pillars)
 *   - aura_orbit        : layered shells/rings/orbiting motes attached to caster
 */

const node = (
  input: Omit<SceneLeaf, "arrange" | "arrangeCount" | "arrangeRadius" | "particleCount" | "motionSpeed" | "rotation" | "position" | "emissiveIntensity" | "motion" | "opacity"> &
    Partial<Pick<SceneLeaf, "arrange" | "arrangeCount" | "arrangeRadius" | "particleCount" | "motionSpeed" | "rotation" | "position" | "emissiveIntensity" | "motion" | "opacity">>,
): SceneLeaf => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  motion: "static",
  motionSpeed: 1,
  arrange: "single",
  arrangeCount: 1,
  arrangeRadius: 0,
  particleCount: 0,
  emissiveIntensity: 0,
  opacity: 1,
  ...input,
});

export function compileVfxPayload(spec: SpellBuildSpec): { cast: SpellScene; travel: SpellScene; impact: SpellScene } {
  // Gameplay `modifiers.scale` is consumed by deriveStats() as AoE radius.
  // Keep rendered spell objects at fixed authored size so large AoEs don't
  // stretch rocks, particles, billboards, or procedural geometry.
  const visualSpec = fixedVisualScale(spec);
  const scenes = compileScenesForVehicle(visualSpec);
  return injectTerrainMorph(visualSpec, scenes);
}

function compileScenesForVehicle(visualSpec: SpellBuildSpec) {
  switch (visualSpec.deliveryVehicle) {
    case "projectile_linear":
      return compileLinearProjectileScenes(visualSpec);
    case "projectile_arcing":
      return compileArcingProjectileScenes(visualSpec);
    case "skyfall":
      return compileSkyfallScenes(visualSpec);
    case "instant_hitscan":
      return compileHitscanScenes(visualSpec);
    case "ground_eruption":
      return compileGroundEruptionScenes(visualSpec);
    case "aura_orbit":
      return compileAuraOrbitScenes(visualSpec);
  }
}

/**
 * Post-processor that injects an alignment-styled `terrain_morph_field` leaf
 * into the impact scene whenever the spell physically lands on the ground.
 *
 * The compiler — not the LLM — decides this:
 *   - `projectile_arcing`, `skyfall`, `ground_eruption` ALWAYS terraform the
 *     ground (lobbed bombs crater the dirt, meteors leave craters, eruptions
 *     fracture the surface).
 *   - `projectile_linear` and `instant_hitscan` only morph the ground when
 *     the LLM explicitly opted in with the `terrain_morph` impact module
 *     (they often resolve in mid-air against a player).
 *   - `aura_orbit` is skipped — the impact scene follows the caster and a
 *     terrain patch dragging behind a moving body looks broken.
 *
 * The morph leaf is PREPENDED into `children` so the 6-leaf cap doesn't drop
 * it; if the cap is already at 6, the last child (lowest-priority decal/dust)
 * gets replaced.
 */
function injectTerrainMorph(
  spec: SpellBuildSpec,
  scenes: { cast: SpellScene; travel: SpellScene; impact: SpellScene },
): { cast: SpellScene; travel: SpellScene; impact: SpellScene } {
  if (!shouldTerrainMorph(spec)) return scenes;
  const a = getAlignment(spec.alignment);
  const morph = terrainMorphLeaf(spec, a);
  const existing = scenes.impact.children;
  const next = [morph, ...existing].slice(0, 6);
  return {
    ...scenes,
    impact: { ...scenes.impact, children: next },
  };
}

/**
 * Build the alignment-styled ground-deformation leaf. The renderer reads
 * `shaderId` + `color/colorB` to pick sub-style (crystal field / lava pool /
 * water puddle / rock juts / scorched glass / tar pool / cosmic crater).
 * `size` is the patch radius in meters; `arrangeCount` drives element density;
 * `motionSpeed` drives shader animation rate; `seed` is deterministic per spec.
 */
function terrainMorphLeaf(spec: SpellBuildSpec, a: AlignmentDefinition): SceneLeaf {
  const profile = terrainMorphProfileFor(spec.alignment);
  const seed = terrainMorphSeed(spec);
  const radius = terrainMorphWorldRadius(spec.alignment, TERRAIN_MORPH_REPRESENTATIVE_IMPACT_RADIUS);
  return node({
    shape: "terrain_morph_field",
    shaderId: profile.shaderId,
    shaderPhase: "decal",
    color: profile.useDarkBase ? a.palette.dark : a.palette.primary,
    colorB: profile.accent === "accent" ? a.palette.accent : a.palette.secondary,
    emissiveIntensity: clampEmit(profile.emissive * spec.modifiers.intensity),
    size: radius,
    position: [0, 1.02, 0],
    // Terrain morph visuals are ground-anchored. `motionSpeed` still drives
    // material animation in TerrainMorphField, but transform motion would make
    // the decal/crystals float away from the deformed terrain.
    motion: "static",
    motionSpeed: profile.motionSpeed,
    arrange: "single",
    arrangeCount: profile.density,
    arrangeRadius: 0,
    opacity: profile.opacity,
    seed,
    intensity: profile.shaderIntensity,
  });
}

type TerrainMorphProfile = {
  /** Visual sub-style key — renderer dispatches on this via shaderId / colors. */
  shaderId: SpellShaderId;
  /** "primary" base for solid styles, "dark" base for liquid/scorch styles. */
  useDarkBase: boolean;
  accent: "accent" | "secondary";
  /** Element density 1..12 (crystals, rock chunks, ripples, etc.). */
  density: number;
  emissive: number;
  opacity: number;
  motionSpeed: number;
  /** Multiplier (0..2) used by the renderer shader for animation amplitude. */
  shaderIntensity: number;
};

function terrainMorphProfileFor(alignment: SpellAlignmentId): TerrainMorphProfile {
  switch (alignment) {
    case "fire":
      return {
        shaderId: "molten_crack",
        useDarkBase: true,
        accent: "accent",
        density: 6,
        emissive: 1.6,
        opacity: 0.92,
        motionSpeed: 1.4,
        shaderIntensity: 1.2,
      };
    case "water_ice":
      return {
        shaderId: "ice_glass",
        useDarkBase: false,
        accent: "accent",
        density: 9,
        emissive: 0.8,
        opacity: 0.9,
        motionSpeed: 0.9,
        shaderIntensity: 1.1,
      };
    case "lightning":
      return {
        shaderId: "ground_rune",
        useDarkBase: true,
        accent: "accent",
        density: 8,
        emissive: 1.4,
        opacity: 0.88,
        motionSpeed: 2.6,
        shaderIntensity: 1.3,
      };
    case "earth":
      return {
        shaderId: "stone_rune",
        useDarkBase: false,
        accent: "secondary",
        density: 7,
        emissive: 0.4,
        opacity: 1.0,
        motionSpeed: 0.8,
        shaderIntensity: 0.9,
      };
    case "dark":
      return {
        shaderId: "necrotic_decay",
        useDarkBase: true,
        accent: "secondary",
        density: 4,
        emissive: 0.6,
        opacity: 0.95,
        motionSpeed: 0.6,
        shaderIntensity: 1.0,
      };
    case "light":
      return {
        shaderId: "ground_rune",
        useDarkBase: false,
        accent: "accent",
        density: 6,
        emissive: 1.5,
        opacity: 0.82,
        motionSpeed: 1.0,
        shaderIntensity: 1.1,
      };
    case "meteor_cosmic":
      return {
        shaderId: "starfield_core",
        useDarkBase: true,
        accent: "accent",
        density: 8,
        emissive: 1.0,
        opacity: 0.95,
        motionSpeed: 0.5,
        shaderIntensity: 1.0,
      };
  }
}

function fixedVisualScale(spec: SpellBuildSpec): SpellBuildSpec {
  if (spec.modifiers.scale === 1) return spec;
  return {
    ...spec,
    modifiers: {
      ...spec.modifiers,
      scale: 1,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// projectile_linear — shot from caster, directional silhouette
// ─────────────────────────────────────────────────────────────────────────────

function compileLinearProjectileScenes(spec: SpellBuildSpec) {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;

  const cast: SpellScene = {
    ...node({
      shape: "sphere",
      shaderId: spec.vfx.shaders.core,
      shaderPhase: "core",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(2.6 * m.intensity),
      size: Number((0.34 * m.scale).toFixed(2)),
      motion: "pulse",
      motionSpeed: 2.6,
      opacity: 0.78,
    }),
    children: [
      // muzzle flash — projects forward along local +Z
      node({
        shape: "cone",
        shaderId: spec.vfx.shaders.impact,
        shaderPhase: "impact",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(2.2 * m.intensity),
        size: Number((0.42 * m.scale).toFixed(2)),
        position: [0, 0, 0.45 * m.scale],
        rotation: [-Math.PI / 2, 0, 0],
        motion: "expand",
        motionSpeed: 3.4,
        opacity: 0.55,
      }),
      node({
        shape: "ring",
        shaderId: spec.vfx.shaders.decal,
        shaderPhase: "decal",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: Number((0.42 * m.scale).toFixed(2)),
        motion: "spin",
        motionSpeed: 3.0,
        opacity: 0.5,
      }),
      node({
        shape: "quarks_emitter",
        quarksPreset: castBurstPresetFor(spec),
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        colorB: a.palette.accent,
        emissiveIntensity: clampEmit(0.9 * m.intensity),
        size: 0.45 * m.scale,
        motion: "drift",
        motionSpeed: 1.4,
        intensity: 0.85 * m.intensity,
        opacity: 0.6,
      }),
    ],
  };

  const travel: SpellScene = {
    ...node({
      shape: travelCoreShape(spec.vfx.coreMesh),
      shaderId: spec.vfx.shaders.core,
      shaderPhase: "core",
      color: a.palette.primary,
      colorB: a.palette.accent,
      seed: sceneSeed(spec, "linear-travel"),
      emissiveIntensity: clampEmit(2.0 * m.intensity),
      size: Number((coreSize(spec) * 1.1).toFixed(2)),
      motion: "spin",
      motionSpeed: 1.6 + m.speed,
      particleCount: spec.vfx.coreMesh === "none" ? Math.round(70 * m.intensity) : 0,
      opacity: spec.vfx.coreMesh === "none" ? 0.32 : 0.95,
    }),
    children: [
      // trail behind body
      node({
        shape: "quarks_emitter",
        quarksPreset: travelTrailPresetFor(spec),
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        colorB: a.palette.dark,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: Number((0.55 * m.scale).toFixed(2)),
        position: [0, 0, -0.55 * m.scale],
        motion: "drift",
        motionSpeed: 1.6,
        intensity: 1.05 * m.intensity,
        opacity: 0.72,
      }),
      // outer halo
      node({
        shape: "sphere",
        shaderId: spec.vfx.shaders.core,
        shaderPhase: "core",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(2.1 * m.intensity),
        size: Number((0.46 * m.scale).toFixed(2)),
        motion: "pulse",
        motionSpeed: 2.0,
        opacity: 0.4,
      }),
      ...alignmentTravelExtras(spec, a, "linear"),
    ].slice(0, 6),
  };

  const impact = compileGenericImpactScene(spec, a, { lingering: spec.vfx.impact.includes("lingering_cloud") || spec.vfx.impact.includes("ground_decal") || spec.vfx.impact.includes("terrain_morph") });
  return { cast, travel, impact };
}

// ─────────────────────────────────────────────────────────────────────────────
// projectile_arcing — heavy lob, spinning core, dust trail, crater impact
// ─────────────────────────────────────────────────────────────────────────────

function compileArcingProjectileScenes(spec: SpellBuildSpec) {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;

  const cast: SpellScene = {
    ...node({
      shape: "sphere",
      shaderId: spec.vfx.shaders.core,
      shaderPhase: "core",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(2.2 * m.intensity),
      size: Number((0.42 * m.scale).toFixed(2)),
      motion: "pulse",
      motionSpeed: 1.6,
      opacity: 0.78,
    }),
    children: [
      // wind-up — heavy rotating ring beneath
      node({
        shape: "torus",
        shaderId: spec.vfx.shaders.decal,
        shaderPhase: "decal",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(1.2 * m.intensity),
        size: Number((0.55 * m.scale).toFixed(2)),
        position: [0, -0.18, 0],
        rotation: [Math.PI / 2, 0, 0],
        motion: "spin",
        motionSpeed: 2.2,
        opacity: 0.55,
      }),
      node({
        shape: "quarks_emitter",
        quarksPreset: castBurstPresetFor(spec),
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        colorB: a.palette.secondary,
        emissiveIntensity: clampEmit(0.8 * m.intensity),
        size: 0.5 * m.scale,
        motion: "rise",
        motionSpeed: 0.6,
        intensity: 0.75 * m.intensity,
        opacity: 0.55,
      }),
    ],
  };

  const travel: SpellScene = {
    ...node({
      shape: travelCoreShape(spec.vfx.coreMesh === "none" ? "boulder" : spec.vfx.coreMesh),
      shaderId: spec.vfx.shaders.core,
      shaderPhase: "core",
      color: a.palette.primary,
      colorB: a.palette.accent,
      seed: sceneSeed(spec, "arcing-travel"),
      emissiveIntensity: clampEmit(1.8 * m.intensity),
      size: Number((coreSize(spec) * 1.25).toFixed(2)),
      motion: "spin",
      motionSpeed: 4.2,
      opacity: 0.96,
    }),
    children: [
      // falling dust trail
      node({
        shape: "quarks_emitter",
        quarksPreset: travelTrailPresetFor(spec),
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        colorB: a.palette.dark,
        emissiveIntensity: clampEmit(0.7 * m.intensity),
        size: 0.65 * m.scale,
        position: [0, -0.2 * m.scale, -0.4 * m.scale],
        motion: "fall",
        motionSpeed: 0.6,
        intensity: 1.0 * m.intensity,
        opacity: 0.7,
      }),
      // outer rim
      node({
        shape: "ring",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: Number((0.5 * m.scale).toFixed(2)),
        motion: "spin",
        motionSpeed: 3.4,
        opacity: 0.55,
      }),
      ...alignmentTravelExtras(spec, a, "arcing"),
    ].slice(0, 6),
  };

  const impact: SpellScene = {
    ...node({
      shape: "ring",
      shaderId: spec.vfx.shaders.decal,
      shaderPhase: "decal",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(1.4 * m.intensity),
      size: Number((1.25 * m.scale).toFixed(2)),
      position: [0, 0.03, 0],
      motion: "expand",
      motionSpeed: 2.4,
      opacity: 0.78,
    }),
    children: [
      // shockwave
      node({
        shape: "ring",
        shaderId: "shockwave_ring",
        shaderPhase: "impact",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(1.6 * m.intensity),
        size: Number((1.05 * m.scale).toFixed(2)),
        position: [0, 0.05, 0],
        motion: "expand",
        motionSpeed: 3.0,
        opacity: 0.7,
      }),
      // burst flash
      node({
        shape: "sphere",
        shaderId: spec.vfx.shaders.impact,
        shaderPhase: "impact",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(2.6 * m.intensity),
        size: 0.85 * m.scale,
        motion: "expand",
        motionSpeed: 2.6,
        opacity: 0.55,
      }),
      ...impactGeometryAccentFor(spec, a, "arcing-impact", spec.vfx.coreMesh === "none" ? "boulder" : spec.vfx.coreMesh),
      // textured dust kicked up
      node({
        shape: "quarks_emitter",
        quarksPreset: impactBurstPresetFor(spec),
        shaderId: cloudShader(spec),
        shaderPhase: "impact",
        color: a.palette.secondary,
        colorB: a.palette.dark,
        emissiveIntensity: clampEmit(0.7 * m.intensity),
        size: 0.9 * m.scale,
        position: [0, 0.45, 0],
        motion: "rise",
        motionSpeed: 0.9,
        intensity: 1.15 * m.intensity,
        opacity: 0.7,
      }),
      // ground decal crater
      node({
        shape: "disc",
        shaderId: spec.vfx.shaders.decal,
        shaderPhase: "decal",
        color: a.palette.dark,
        emissiveIntensity: clampEmit(0.5 * m.intensity),
        size: 1.0 * m.scale,
        position: [0, 0.025, 0],
        motion: "pulse",
        motionSpeed: 0.4,
        opacity: 0.62,
      }),
    ].slice(0, 6),
  };

  return { cast, travel, impact };
}

// ─────────────────────────────────────────────────────────────────────────────
// skyfall — descends from above with telegraph (telegraph itself is rendered
// in SpellEntities.SkyfallTelegraph; here we author the meteor body and crash)
// ─────────────────────────────────────────────────────────────────────────────

function compileSkyfallScenes(spec: SpellBuildSpec) {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;

  // Deterministic seed so meteor displacement is stable across recompiles
  // for a given (alignment, scale) pair.
  const seed = skyfallSeed(spec);

  // Cast telegraph stays on existing shader-driven shapes — it is rendered as
  // a brief precursor on the caster, not the falling body.
  const cast: SpellScene = {
    ...node({
      shape: "ring",
      shaderId: spec.vfx.shaders.decal,
      shaderPhase: "decal",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(1.6 * m.intensity),
      size: Number((0.55 * m.scale).toFixed(2)),
      motion: "spin",
      motionSpeed: 3.0,
      opacity: 0.7,
    }),
    children: [
      node({
        shape: "quarks_emitter",
        quarksPreset: castBurstPresetFor(spec),
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        colorB: a.palette.secondary,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: 0.55 * m.scale,
        motion: "rise",
        motionSpeed: 1.2,
        intensity: 0.9 * m.intensity,
        opacity: 0.7,
      }),
      node({
        shape: "sphere",
        shaderId: spec.vfx.shaders.core,
        shaderPhase: "core",
        color: a.palette.primary,
        emissiveIntensity: clampEmit(2.4 * m.intensity),
        size: 0.36 * m.scale,
        motion: "pulse",
        motionSpeed: 2.6,
        opacity: 0.7,
      }),
    ],
  };

  // Travel body: alignment-specific procedural geometry replaces the old
  // primitive (tetra/octa). Quarks emitters provide the trail (smoke + heat
  // + alignment-specific accents). Existing shader-driven halo/ring stays
  // as a compatibility fallback for any frame before quarks kicks in.
  const body = skyfallBodyShape(spec);
  const travel: SpellScene = {
    ...node({
      shape: body.shape,
      shaderId: skyfallCoreShader(spec),
      shaderPhase: "core",
      color: a.palette.primary,
      colorB: a.palette.accent,
      seed,
      size: Number((body.size * Math.max(1, m.scale)).toFixed(2)),
      emissiveIntensity: clampEmit(body.emissive * m.intensity),
      motion: "spin",
      motionSpeed: body.spin,
      opacity: 1.0,
    }),
    children: [
      // ── Quarks trail: dark smoke plume trailing along -Z ──
      node({
        shape: "quarks_emitter",
        quarksPreset: "smoke_plume_dark",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        colorB: a.palette.dark,
        intensity: 1.25 * m.intensity,
        position: [0, 0, -0.6 * m.scale],
        size: 1.0 * m.scale,
      }),
      // ── Quarks trail accent: alignment-specific (embers / lightning / mist) ──
      ...skyfallTrailAccent(spec),
      // ── Glow halo (legacy shader-driven, keeps light contribution) ──
      node({
        shape: "sphere",
        shaderId: skyfallCoreShader(spec),
        shaderPhase: "core",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(2.6 * m.intensity),
        size: Number((0.55 * m.scale).toFixed(2)),
        motion: "pulse",
        motionSpeed: 2.2,
        opacity: 0.45,
      }),
      // ── Gravity lens ring (cosmic) or generic warning ring ──
      node({
        shape: "ring",
        shaderId: skyfallRingShader(spec),
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.4 * m.intensity),
        size: Number((0.95 * m.scale).toFixed(2)),
        motion: "spin",
        motionSpeed: 4.2,
        opacity: 0.55,
      }),
    ].slice(0, 6),
  };

  // Impact: flash + shockwave + crater decal + quarks dust/debris/embers.
  const impact: SpellScene = {
    ...node({
      shape: "sphere",
      shaderId: spec.vfx.shaders.impact,
      shaderPhase: "impact",
      color: a.palette.accent,
      emissiveIntensity: clampEmit(3.4 * m.intensity),
      size: Number((1.4 * m.scale).toFixed(2)),
      motion: "expand",
      motionSpeed: 3.0,
      opacity: 0.6,
    }),
    children: [
      node({
        shape: "ring",
        shaderId: "shockwave_ring",
        shaderPhase: "impact",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(2.0 * m.intensity),
        size: Number((1.4 * m.scale).toFixed(2)),
        position: [0, 0.05, 0],
        motion: "expand",
        motionSpeed: 3.4,
        opacity: 0.78,
      }),
      node({
        shape: "disc",
        shaderId: spec.vfx.shaders.decal,
        shaderPhase: "decal",
        color: a.palette.dark,
        emissiveIntensity: clampEmit(0.6 * m.intensity),
        size: 1.2 * m.scale,
        position: [0, 0.025, 0],
        motion: "pulse",
        motionSpeed: 0.35,
        opacity: 0.7,
      }),
      ...impactGeometryAccentFor(spec, a, "skyfall-impact", spec.vfx.coreMesh === "none" ? "boulder" : spec.vfx.coreMesh),
      // ── Quarks dust puff ground ring ──
      node({
        shape: "quarks_emitter",
        quarksPreset: "dust_puff",
        shaderId: cloudShader(spec),
        shaderPhase: "impact",
        color: a.palette.secondary,
        colorB: a.palette.dark,
        intensity: 1.45 * m.intensity,
        position: [0, 0.1, 0],
        size: 1.4 * m.scale,
      }),
      // ── Quarks debris chunks (mesh particles) ──
      node({
        shape: "quarks_emitter",
        quarksPreset: "debris_chunks",
        shaderId: cloudShader(spec),
        shaderPhase: "impact",
        color: a.palette.dark,
        colorB: a.palette.secondary,
        intensity: 1.15 * m.intensity,
        position: [0, 0.2, 0],
        size: 1.0 * m.scale,
      }),
      // ── Quarks alignment accent on impact (embers / sparks / lava) ──
      ...skyfallImpactAccent(spec),
    ].slice(0, 6),
  };

  return { cast, travel, impact };
}

/**
 * Stable per-spec seed for procedural displacement. Keeps the same meteor
 * silhouette across reroll-free recompiles, but varies between alignments.
 */
function skyfallSeed(spec: SpellBuildSpec): number {
  return sceneSeed(spec, "skyfall");
}

function sceneSeed(spec: SpellBuildSpec, salt: string): number {
  let h = 2166136261;
  const s = `${salt}|${spec.alignment}|${spec.vfx.coreMesh}|${spec.modifiers.scale}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Picks the procedural body shape for the falling skyfall object.
 * Returns shape + base size + spin + emissive multiplier.
 */
function skyfallBodyShape(spec: SpellBuildSpec): {
  shape: SceneLeaf["shape"];
  size: number;
  spin: number;
  emissive: number;
} {
  switch (spec.alignment) {
    case "earth":
      // Dropping monolith — slow tumble, big silhouette. Stone is mostly
      // non-emissive; rune cracks read as a subtle accent.
      return { shape: "monolith", size: 1.4, spin: 1.6, emissive: 1.0 };
    case "light":
      // Radiant crystal — strong emissive but kept below bloom-blowout range.
      return { shape: "crystal_cluster", size: 1.1, spin: 4.0, emissive: 2.0 };
    case "water_ice":
      // Icy crystal — cool, glints rather than glows. Lower emissive than light.
      return { shape: "crystal_cluster", size: 1.1, spin: 4.0, emissive: 1.6 };
    case "fire":
    case "meteor_cosmic":
      // Classic glowing meteor — fast spin, hot core.
      return { shape: "displaced_meteor", size: 1.2, spin: 3.4, emissive: 2.8 };
    case "lightning":
      // Charged meteor — extra-fast spin, accent comes from arcs preset.
      return { shape: "displaced_meteor", size: 1.0, spin: 5.2, emissive: 2.4 };
    case "dark":
      // Dark meteor — slow tumble, very subtle violet cracks; bulk reads black.
      return { shape: "displaced_meteor", size: 1.1, spin: 2.6, emissive: 1.6 };
    default:
      return { shape: "displaced_meteor", size: 1.2, spin: 3.2, emissive: 2.6 };
  }
}

/** Quarks accent emitters trailing the body during travel. */
function skyfallTrailAccent(spec: SpellBuildSpec): SceneLeaf[] {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;
  switch (spec.alignment) {
    case "fire":
    case "meteor_cosmic":
      return [
        node({
          shape: "quarks_emitter",
          quarksPreset: "embers_rising",
          shaderId: spec.vfx.shaders.trail,
          shaderPhase: "trail",
          color: a.palette.primary,
          colorB: a.palette.secondary,
          intensity: 1.2 * m.intensity,
          position: [0, 0, -0.4 * m.scale],
          size: 1.0 * m.scale,
        }),
      ];
    case "lightning":
      return [
        node({
          shape: "quarks_emitter",
          quarksPreset: "lightning_arcs",
          shaderId: spec.vfx.shaders.trail,
          shaderPhase: "trail",
          color: a.palette.primary,
          colorB: a.palette.accent,
          intensity: 1.0 * m.intensity,
          position: [0, 0, 0],
          size: 1.0 * m.scale,
        }),
      ];
    case "light":
      return [
        node({
          shape: "quarks_emitter",
          quarksPreset: "sparks_burst",
          shaderId: spec.vfx.shaders.trail,
          shaderPhase: "trail",
          color: a.palette.accent,
          colorB: a.palette.primary,
          intensity: 0.9 * m.intensity,
          position: [0, 0, -0.3 * m.scale],
          size: 1.0 * m.scale,
        }),
      ];
    case "water_ice":
      return [
        node({
          shape: "quarks_emitter",
          quarksPreset: "smoke_plume_dust",
          shaderId: spec.vfx.shaders.trail,
          shaderPhase: "trail",
          color: a.palette.accent,
          colorB: a.palette.secondary,
          intensity: 1.0 * m.intensity,
          position: [0, 0, -0.5 * m.scale],
          size: 1.0 * m.scale,
        }),
      ];
    case "earth":
      return [
        node({
          shape: "quarks_emitter",
          quarksPreset: "smoke_plume_dust",
          shaderId: spec.vfx.shaders.trail,
          shaderPhase: "trail",
          color: a.palette.secondary,
          colorB: a.palette.dark,
          intensity: 1.2 * m.intensity,
          position: [0, 0, -0.5 * m.scale],
          size: 1.2 * m.scale,
        }),
      ];
    case "dark":
      return [];
    default:
      return [];
  }
}

/** Quarks accent emitters spawned at impact site. */
function skyfallImpactAccent(spec: SpellBuildSpec): SceneLeaf[] {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;
  switch (spec.alignment) {
    case "fire":
    case "meteor_cosmic":
      return [
        node({
          shape: "quarks_emitter",
          quarksPreset: "lava_droplets",
          shaderId: spec.vfx.shaders.impact,
          shaderPhase: "impact",
          color: a.palette.primary,
          colorB: a.palette.dark,
          intensity: 1.15 * m.intensity,
          position: [0, 0.15, 0],
          size: 1.0 * m.scale,
        }),
      ];
    case "lightning":
      return [
        node({
          shape: "quarks_emitter",
          quarksPreset: "sparks_burst",
          shaderId: spec.vfx.shaders.impact,
          shaderPhase: "impact",
          color: a.palette.accent,
          colorB: a.palette.primary,
          intensity: 1.15 * m.intensity,
          position: [0, 0.15, 0],
          size: 1.0 * m.scale,
        }),
      ];
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// instant_hitscan — visible caster→target beam, instant resolve
// Travel scene is the beam stylization; the renderer stretches a `bar` mesh
// between the spawn origin and target (see SpellEntities.HitscanBeam).
// ─────────────────────────────────────────────────────────────────────────────

function compileHitscanScenes(spec: SpellBuildSpec) {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;

  const cast: SpellScene = {
    ...node({
      shape: "sphere",
      shaderId: spec.vfx.shaders.core,
      shaderPhase: "core",
      color: a.palette.accent,
      emissiveIntensity: clampEmit(3.0 * m.intensity),
      size: 0.32 * m.scale,
      motion: "pulse",
      motionSpeed: 5.0,
      opacity: 0.85,
    }),
    children: [
      node({
        shape: "ring",
        shaderId: spec.vfx.shaders.decal,
        shaderPhase: "decal",
        color: a.palette.primary,
        emissiveIntensity: clampEmit(1.6 * m.intensity),
        size: 0.52 * m.scale,
        motion: "spin",
        motionSpeed: 4.0,
        opacity: 0.62,
      }),
      node({
        shape: "quarks_emitter",
        quarksPreset: castBurstPresetFor(spec),
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        colorB: a.palette.secondary,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: 0.45 * m.scale,
        motion: "drift",
        motionSpeed: 3.0,
        intensity: 0.8 * m.intensity,
        opacity: 0.7,
      }),
    ],
  };

  // Travel scene authored in beam-local space:
  //   - bar oriented along local +Z, length 1 (renderer scales Z to beam length)
  //   - thin core line + outer glow + sparks
  const travel: SpellScene = {
    ...node({
      shape: "bar",
      shaderId: hitscanBeamShader(spec),
      shaderPhase: "trail",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(2.6 * m.intensity),
      size: Number((0.06 * m.scale).toFixed(2)),
      motion: "pulse",
      motionSpeed: 6.0,
      opacity: 0.95,
    }),
    children: [
      // outer glow sheath
      node({
        shape: "bar",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.8 * m.intensity),
        size: Number((0.14 * m.scale).toFixed(2)),
        motion: "pulse",
        motionSpeed: 3.5,
        opacity: 0.45,
      }),
      // sparks along beam
      node({
        shape: "quarks_emitter",
        quarksPreset: "sparks_burst",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        colorB: a.palette.primary,
        emissiveIntensity: clampEmit(1.4 * m.intensity),
        size: 0.42 * m.scale,
        motion: "drift",
        motionSpeed: 4.0,
        intensity: 1.0 * m.intensity,
        opacity: 0.7,
      }),
    ],
  };

  const impact = compileGenericImpactScene(spec, a, { lingering: false });
  return { cast, travel, impact };
}

// ─────────────────────────────────────────────────────────────────────────────
// ground_eruption — geometry rises out of the ground, alignment-styled.
// The impact scene IS the eruption (cast+travel are brief telegraph cues).
// ─────────────────────────────────────────────────────────────────────────────

function compileGroundEruptionScenes(spec: SpellBuildSpec) {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;

  const profile = eruptionProfileFor(spec.alignment);

  const cast: SpellScene = {
    ...node({
      shape: "ring",
      shaderId: spec.vfx.shaders.decal,
      shaderPhase: "decal",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(1.4 * m.intensity),
      size: Number((0.45 * m.scale).toFixed(2)),
      motion: "spin",
      motionSpeed: 3.2,
      opacity: 0.7,
    }),
    children: [
      node({
        shape: "quarks_emitter",
        quarksPreset: castBurstPresetFor(spec),
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        colorB: a.palette.dark,
        emissiveIntensity: clampEmit(0.9 * m.intensity),
        size: 0.5 * m.scale,
        motion: "rise",
        motionSpeed: 0.8,
        intensity: 0.8 * m.intensity,
        opacity: 0.6,
      }),
    ],
  };

  // Travel is a brief ground rumble telegraph (eruption resolves at target on cast).
  const travel: SpellScene = {
    ...node({
      shape: "ring",
      shaderId: spec.vfx.shaders.decal,
      shaderPhase: "decal",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(1.2 * m.intensity),
      size: Number((0.6 * m.scale).toFixed(2)),
      motion: "expand",
      motionSpeed: 2.0,
      opacity: 0.6,
    }),
    children: [],
  };

  const eruptCount = Math.max(3, Math.min(8, Math.round(3 + m.intensity * 2)));
  const eruptRadius = Number((0.55 * m.scale).toFixed(2));

  const impact: SpellScene = {
    // Rising primary geometry — the actual erupting shape, arranged in a ring.
    ...node({
      shape: profile.shape,
      shaderId: profile.coreShader ?? spec.vfx.shaders.core,
      shaderPhase: "core",
      color: a.palette.primary,
      colorB: a.palette.accent,
      seed: skyfallSeed(spec),
      emissiveIntensity: clampEmit(profile.emissive * m.intensity),
      size: Number((profile.size * m.scale).toFixed(2)),
      position: [0, profile.basePivotY, 0],
      rotation: profile.rotation,
      motion: "erupt",
      motionSpeed: 2.4,
      arrange: "ring",
      arrangeCount: eruptCount + 0,
      arrangeRadius: eruptRadius * 4.6,
      opacity: profile.opacity ,
    }),
    children: [
      // central tall pillar / vent / monolith
      node({
        shape: profile.centerShape,
        shaderId: profile.centerShader ?? spec.vfx.shaders.core,
        shaderPhase: "core",
        color: a.palette.accent,
        colorB: a.palette.primary,
        seed: skyfallSeed(spec) ^ 0x9e3779b1,
        emissiveIntensity: clampEmit((profile.emissive + 0.6) * m.intensity),
        size: Number((profile.centerSize * m.scale * 1.6).toFixed(2)),
        position: [0, profile.centerPivotY+0.2, 0],
        rotation: profile.centerRotation,
        motion: "erupt",
        motionSpeed: 1.8,
        opacity: 0.99,
      }),
      // shockwave at the base
      node({
        shape: "ring",
        shaderId: "shockwave_ring",
        shaderPhase: "impact",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.3 * m.intensity),
        size: Number((0.95 * m.scale).toFixed(2)),
        position: [0, 0.10, 0],
        motion: "expand",
        motionSpeed: 2.6,
        opacity: 0.8,
      }),
      // lingering ground decal — sigil/cracks/frost
      node({
        shape: "disc",
        shaderId: profile.decalShader ?? spec.vfx.shaders.decal,
        shaderPhase: "decal",
        color: a.palette.dark,
        emissiveIntensity: clampEmit(0.6 * m.intensity),
        size: 1.05 * m.scale,
        position: [0, 0.025, 0],
        motion: "pulse",
        motionSpeed: 0.4,
        opacity: 0.7,
      }),
      // alignment-specific quarks accents (smoke / embers / lava / lightning…)
      ...eruptionQuarksAccents(spec, profile),
    ].slice(0, 6),
  };

  return { cast, travel, impact };
}

type EruptionProfile = {
  shape: SceneLeaf["shape"];
  size: number;
  basePivotY: number;
  rotation: SceneLeaf["rotation"];
  emissive: number;
  opacity: number;
  centerShape: SceneLeaf["shape"];
  centerSize: number;
  centerPivotY: number;
  centerRotation: SceneLeaf["rotation"];
  coreShader?: SpellShaderId;
  centerShader?: SpellShaderId;
  decalShader?: SpellShaderId;
  /** Names of quarks accent presets to spawn on impact, with role tags. */
  accents: ReadonlyArray<EruptionAccent>;
};

type EruptionAccent = {
  preset:
    | "smoke_plume_dark"
    | "smoke_plume_dust"
    | "embers_rising"
    | "sparks_burst"
    | "fire_core"
    | "debris_chunks"
    | "dust_puff"
    | "lava_droplets"
    | "lightning_arcs";
  /** intensity multiplier on top of spell intensity. */
  weight: number;
  /** Local Y offset for the emitter. */
  y: number;
  /** Use accent color (true) or secondary (false) for colorA. */
  useAccent?: boolean;
};

function eruptionProfileFor(alignment: SpellAlignmentId): EruptionProfile {
  switch (alignment) {
    case "earth":
      // Stone slab eruption: ring of jagged debris piles + central monolith,
      // lots of dust and smaller chunks flying. Ring rocks are nearly inert
      // (rune cracks barely glow); the monolith centerpiece carries the
      // emissive read with a `+0.6` boost in the renderer.
      return {
        shape: "rock_chunks",
        size: 0.85,
        basePivotY: 0.4,
        rotation: [0, 0, 0],
        emissive: 0.6,
        opacity: 1.0,
        centerShape: "monolith",
        centerSize: 1.6,
        centerPivotY: 0.8,
        centerRotation: [0, 0, 0],
        coreShader: "stone_rune",
        centerShader: "stone_rune",
        decalShader: "stone_rune",
        accents: [
          { preset: "smoke_plume_dust", weight: 1.4, y: 0.3 },
          { preset: "debris_chunks", weight: 1.0, y: 0.3, useAccent: true },
          { preset: "dust_puff", weight: 1.0, y: 0.05 },
        ],
      };
    case "fire":
      // Lava eruption: jagged molten boulders + central glowing vent column,
      // embers rising + lava droplets arcing out.
      return {
        shape: "displaced_meteor",
        size: 0.75,
        basePivotY: 0.35,
        rotation: [0, 0, 0],
        emissive: 2.2,
        opacity: 0.95,
        centerShape: "cylinder",
        centerSize: 1.3,
        centerPivotY: 0.65,
        centerRotation: [0, 0, 0],
        coreShader: "flame_core",
        centerShader: "flame_core",
        decalShader: "molten_crack",
        accents: [
          { preset: "fire_core", weight: 0.8, y: 0.6, useAccent: true },
          { preset: "embers_rising", weight: 1.0, y: 0.4, useAccent: true },
          { preset: "lava_droplets", weight: 1.0, y: 0.3 },
          { preset: "smoke_plume_dark", weight: 0.8, y: 0.5 },
        ],
      };
    case "water_ice":
      // Crystal cluster eruption: shards rise in a ring, central tall cluster.
      // Cool mist instead of dust.
      return {
        shape: "crystal_cluster",
        size: 0.72,
        basePivotY: 0.36,
        rotation: [0, 0, 0],
        emissive: 1.6,
        opacity: 0.95,
        centerShape: "crystal_cluster",
        centerSize: 1.4,
        centerPivotY: 0.7,
        centerRotation: [0, 0, 0],
        coreShader: "frost_crystal",
        centerShader: "ice_glass",
        decalShader: "water_ripple",
        accents: [
          { preset: "smoke_plume_dust", weight: 0.7, y: 0.4, useAccent: true },
          { preset: "sparks_burst", weight: 0.5, y: 0.5, useAccent: true },
        ],
      };
    case "lightning":
      // Charged stone spires + central plasma vent + lightning arcs and sparks.
      return {
        shape: "displaced_meteor",
        size: 0.55,
        basePivotY: 0.3,
        rotation: [0, 0, 0],
        emissive: 2.4,
        opacity: 0.9,
        centerShape: "cylinder",
        centerSize: 1.4,
        centerPivotY: 0.7,
        centerRotation: [0, 0, 0],
        coreShader: "plasma_arc",
        centerShader: "storm_core",
        decalShader: "ground_rune",
        accents: [
          { preset: "lightning_arcs", weight: 1.0, y: 0.6, useAccent: true },
          { preset: "sparks_burst", weight: 1.0, y: 0.4, useAccent: true },
          { preset: "smoke_plume_dust", weight: 0.6, y: 0.3 },
        ],
      };
    case "dark":
      // Twisted black spires + central shadow vent; no embers, dark smoke only.
      return {
        shape: "displaced_meteor",
        size: 0.7,
        basePivotY: 0.35,
        rotation: [0, 0, 0],
        emissive: 1.4,
        opacity: 0.92,
        centerShape: "cylinder",
        centerSize: 1.3,
        centerPivotY: 0.65,
        centerRotation: [0, 0, 0],
        coreShader: "void_swirl",
        centerShader: "shadow_smoke",
        decalShader: "ground_rune",
        accents: [
          { preset: "smoke_plume_dark", weight: 1.4, y: 0.5 },
          { preset: "embers_rising", weight: 0.4, y: 0.4, useAccent: true },
        ],
      };
    case "light":
      // Crystalline pillars of light + radiant center; sparks and bright dust.
      // Emissive is intentionally below `light skyfall` body — eruption stays
      // legible in a complex impact scene without bloom-blowing the camera.
      return {
        shape: "crystal_cluster",
        size: 0.55,
        basePivotY: 0.5,
        rotation: [0, 0, 0],
        emissive: 2.0,
        opacity: 0.9,
        centerShape: "cylinder",
        centerSize: 1.5,
        centerPivotY: 0.75,
        centerRotation: [0, 0, 0],
        coreShader: "sunbeam_core",
        centerShader: "holy_radiance",
        decalShader: "halo_ring",
        accents: [
          { preset: "sparks_burst", weight: 1.0, y: 0.5, useAccent: true },
          { preset: "embers_rising", weight: 0.6, y: 0.4, useAccent: true },
        ],
      };
    case "meteor_cosmic":
      // Meteoritic debris ring + central cosmic crystal; full impact set.
      return {
        shape: "displaced_meteor",
        size: 0.8,
        basePivotY: 0.4,
        rotation: [0, 0, 0],
        emissive: 2.0,
        opacity: 0.95,
        centerShape: "crystal_cluster",
        centerSize: 1.4,
        centerPivotY: 0.7,
        centerRotation: [0, 0, 0],
        coreShader: "meteor_ember",
        centerShader: "starfield_core",
        decalShader: "gravity_lens",
        accents: [
          { preset: "fire_core", weight: 0.7, y: 0.6, useAccent: true },
          { preset: "embers_rising", weight: 1.0, y: 0.4, useAccent: true },
          { preset: "lava_droplets", weight: 0.8, y: 0.3 },
          { preset: "debris_chunks", weight: 0.8, y: 0.3 },
        ],
      };
  }
}

/** Build the quarks_emitter SceneLeaf array for a given eruption profile. */
function eruptionQuarksAccents(
  spec: SpellBuildSpec,
  profile: EruptionProfile,
): SceneLeaf[] {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;
  return profile.accents.map((acc) =>
    node({
      shape: "quarks_emitter",
      quarksPreset: acc.preset,
      shaderId: cloudShader(spec),
      shaderPhase: "impact",
      color: acc.useAccent ? a.palette.accent : a.palette.secondary,
      colorB: a.palette.accent,
      intensity: acc.weight * m.intensity,
      position: [0, acc.y, 0],
      size: 0.2 * m.scale,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// aura_orbit — layered shells/rings/orbiting motes attached to caster.
// Cast and impact are both authored as the aura state itself; impact is what
// renders for the area lifetime (attached to caster via AreaSpellState).
// ─────────────────────────────────────────────────────────────────────────────

function compileAuraOrbitScenes(spec: SpellBuildSpec) {
  const a = getAlignment(spec.alignment);
  const m = spec.modifiers;

  const cast: SpellScene = {
    ...node({
      shape: "torus",
      shaderId: spec.vfx.shaders.aura,
      shaderPhase: "aura",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(1.6 * m.intensity),
      size: Number((0.7 * m.scale).toFixed(2)),
      rotation: [Math.PI / 2, 0, 0],
      motion: "spin",
      motionSpeed: 1.4,
      opacity: 0.7,
    }),
    children: [
      node({
        shape: "sphere",
        shaderId: spec.vfx.shaders.aura,
        shaderPhase: "aura",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.2 * m.intensity),
        size: 0.42 * m.scale,
        motion: "pulse",
        motionSpeed: 2.4,
        opacity: 0.5,
      }),
      node({
        shape: "ring",
        shaderId: spec.vfx.shaders.decal,
        shaderPhase: "decal",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(0.8 * m.intensity),
        size: 0.85 * m.scale,
        position: [0, 0.04, 0],
        motion: "spin",
        motionSpeed: 2.2,
        opacity: 0.55,
      }),
    ],
  };

  // Impact = the aura itself, attached to the caster for the area duration.
  // Layered: outer torus shell, inner glow, orbiting motes, ground ring.
  const impact: SpellScene = {
    ...node({
      shape: "torus",
      shaderId: spec.vfx.shaders.aura,
      shaderPhase: "aura",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(1.4 * m.intensity),
      size: 1.0,
      rotation: [Math.PI / 2, 0, 0],
      motion: "spin",
      motionSpeed: 0.8,
      opacity: 0.7,
    }),
    children: [
      // inner shell glow
      node({
        shape: "sphere",
        shaderId: spec.vfx.shaders.aura,
        shaderPhase: "aura",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: 0.65,
        motion: "pulse",
        motionSpeed: 1.6,
        opacity: 0.32,
      }),
      // orbiting motes
      node({
        shape: "sphere",
        shaderId: spec.vfx.shaders.aura,
        shaderPhase: "aura",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.4 * m.intensity),
        size: 0.16,
        motion: "orbit",
        motionSpeed: 1.6,
        arrange: "ring",
        arrangeCount: 6,
        arrangeRadius: 1.05,
        opacity: 0.85,
      }),
      // ground ring under caster
      node({
        shape: "ring",
        shaderId: spec.vfx.shaders.decal,
        shaderPhase: "decal",
        color: a.palette.primary,
        emissiveIntensity: clampEmit(0.9 * m.intensity),
        size: 1.1,
        position: [0, 0.04, 0],
        motion: "spin",
        motionSpeed: 1.4,
        opacity: 0.6,
      }),
      // soft particle haze
      node({
        shape: "quarks_emitter",
        quarksPreset: auraHazePresetFor(spec),
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        colorB: a.palette.dark,
        emissiveIntensity: clampEmit(0.6 * m.intensity),
        size: 0.45,
        motion: "swirl",
        motionSpeed: 0.8,
        intensity: 0.9 * m.intensity,
        opacity: 0.55,
      }),
    ].slice(0, 6),
  };

  // Travel is unused (aura doesn't travel) but must exist; render a small idle pulse.
  const travel: SpellScene = {
    ...node({
      shape: "sphere",
      shaderId: spec.vfx.shaders.aura,
      shaderPhase: "aura",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(0.6 * m.intensity),
      size: 0.3,
      motion: "pulse",
      motionSpeed: 1.5,
      opacity: 0.4,
    }),
    children: [],
  };

  return { cast, travel, impact };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic impact scene — used by linear/hitscan; arcing/skyfall/eruption/aura
// author their own. Mirrors the original module-driven impact behavior.
// ─────────────────────────────────────────────────────────────────────────────

function compileGenericImpactScene(spec: SpellBuildSpec, a: AlignmentDefinition, opts: { lingering: boolean }): SpellScene {
  const m = spec.modifiers;
  const lingering = opts.lingering;
  const root = node({
    shape: lingering ? "cylinder" : "sphere",
    shaderId: spec.vfx.shaders.impact,
    shaderPhase: "impact",
    color: a.palette.primary,
    emissiveIntensity: clampEmit((lingering ? 1.1 : 2.4) * m.intensity),
    size: Number((1.15 * m.scale).toFixed(2)),
    motion: lingering ? "pulse" : "expand",
    motionSpeed: lingering ? 0.8 : 2.1,
    opacity: lingering ? 0.68 : 0.82,
  });

  const children: SceneLeaf[] = [];

  if (spec.vfx.impact.includes("flash")) {
    children.push(node({
      shape: "sphere",
      shaderId: spec.vfx.shaders.impact,
      shaderPhase: "impact",
      color: a.palette.accent,
      emissiveIntensity: clampEmit(3.4 * m.intensity),
      size: 0.8 * m.scale,
      motion: "expand",
      motionSpeed: 3.2,
      opacity: 0.4,
    }));
  }
  const impactGeometry = impactGeometryAccentFor(spec, a, "generic-impact");
  if (impactGeometry.length > 0) children.push(...impactGeometry);
  if (spec.vfx.impact.includes("burst_explosion")) {
    children.push(node({
      shape: "quarks_emitter",
      quarksPreset: impactBurstPresetFor(spec),
      shaderId: spec.vfx.shaders.impact,
      shaderPhase: "impact",
      color: a.palette.accent,
      colorB: a.palette.secondary,
      emissiveIntensity: clampEmit(1.4 * m.intensity),
      size: 0.75 * m.scale,
      motion: "expand",
      motionSpeed: 2.2,
      intensity: 1.2 * m.intensity,
      opacity: 0.86,
    }));
    children.push(node({
      shape: "ring",
      shaderId: "shockwave_ring",
      shaderPhase: "impact",
      color: a.palette.secondary,
      emissiveIntensity: clampEmit(1.4 * m.intensity),
      size: 0.9 * m.scale,
      motion: "expand",
      motionSpeed: 2.6,
      opacity: 0.62,
    }));
  }
  if (spec.vfx.impact.includes("lingering_cloud")) {
    children.push(node({
      shape: "quarks_emitter",
      quarksPreset: lingeringCloudPresetFor(spec),
      shaderId: cloudShader(spec),
      shaderPhase: "impact",
      color: a.palette.secondary,
      colorB: a.palette.dark,
      emissiveIntensity: clampEmit(0.6 * m.intensity),
      size: 0.9 * m.scale,
      position: [0, 0.35, 0],
      motion: "swirl",
      motionSpeed: 0.7,
      intensity: 1.15 * m.intensity,
      opacity: 0.62,
    }));
  }
  if (spec.vfx.impact.includes("ground_decal")) {
    children.push(node({
      shape: "disc",
      shaderId: spec.vfx.shaders.decal,
      shaderPhase: "decal",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(0.9 * m.intensity),
      size: 0.9 * m.scale,
      position: [0, 0.025, 0],
      motion: "pulse",
      motionSpeed: 0.45,
      opacity: 0.58,
    }));
  }

  return { ...root, children: children.slice(0, 6) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alignment-specific travel extras (linear/arcing) — small flavor children
// ─────────────────────────────────────────────────────────────────────────────

function alignmentTravelExtras(spec: SpellBuildSpec, a: AlignmentDefinition, kind: "linear" | "arcing"): SceneLeaf[] {
  const m = spec.modifiers;
  if (spec.alignment === "lightning") {
    return [
      node({
        shape: "ring",
        shaderId: "chain_bolt",
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.4 * m.intensity),
        size: 0.45 * m.scale,
        motion: "spin",
        motionSpeed: 5.0,
        arrange: "ring",
        arrangeCount: 3,
        arrangeRadius: 0.3 * m.scale,
        opacity: 0.7,
      }),
    ];
  }
  if (spec.alignment === "fire" && kind === "linear") {
    return [
      node({
        shape: "quarks_emitter",
        quarksPreset: "embers_rising",
        shaderId: "ember_trail",
        shaderPhase: "trail",
        color: a.palette.accent,
        colorB: a.palette.primary,
        emissiveIntensity: clampEmit(1.4 * m.intensity),
        size: 0.5 * m.scale,
        position: [0, 0, -0.7 * m.scale],
        motion: "drift",
        motionSpeed: 2.2,
        intensity: 0.9 * m.intensity,
        opacity: 0.78,
      }),
    ];
  }
  if (spec.alignment === "water_ice") {
    return [
      node({
        shape: "octa",
        shaderId: "frost_crystal",
        shaderPhase: "core",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: 0.18 * m.scale,
        motion: "spin",
        motionSpeed: 4.0,
        arrange: "ring",
        arrangeCount: 3,
        arrangeRadius: 0.32 * m.scale,
        opacity: 0.85,
      }),
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function coreShape(mesh: SpellBuildSpec["vfx"]["coreMesh"]): SceneLeaf["shape"] {
  switch (mesh) {
    case "none":
      return "sphere";
    case "jagged_crystal":
      return "octa";
    case "boulder":
      return "tetra";
    case "sphere":
      return "sphere";
  }
}

function travelCoreShape(mesh: SpellBuildSpec["vfx"]["coreMesh"]): SceneLeaf["shape"] {
  switch (mesh) {
    case "boulder":
      return "displaced_meteor";
    case "jagged_crystal":
      return "crystal_cluster";
    default:
      return coreShape(mesh);
  }
}

function impactGeometryAccentFor(
  spec: SpellBuildSpec,
  a: AlignmentDefinition,
  salt: string,
  mesh: SpellBuildSpec["vfx"]["coreMesh"] = spec.vfx.coreMesh,
): SceneLeaf[] {
  if (mesh === "boulder") {
    return [
      node({
        shape: "displaced_meteor",
        shaderId: spec.vfx.shaders.core,
        shaderPhase: "impact",
        color: a.palette.primary,
        colorB: a.palette.accent,
        seed: sceneSeed(spec, salt),
        emissiveIntensity: clampEmit(1.8 * spec.modifiers.intensity),
        size: Number((0.58 * spec.modifiers.scale).toFixed(2)),
        position: [0, 0.28 * spec.modifiers.scale, 0],
        motion: "expand",
        motionSpeed: 2.0,
        opacity: 0.9,
      }),
    ];
  }
  if (mesh === "jagged_crystal") {
    return [
      node({
        shape: "crystal_cluster",
        shaderId: spec.vfx.shaders.core,
        shaderPhase: "impact",
        color: a.palette.primary,
        colorB: a.palette.accent,
        seed: sceneSeed(spec, salt),
        emissiveIntensity: clampEmit(1.7 * spec.modifiers.intensity),
        size: Number((0.62 * spec.modifiers.scale).toFixed(2)),
        position: [0, 0.32 * spec.modifiers.scale, 0],
        motion: "expand",
        motionSpeed: 2.2,
        opacity: 0.88,
      }),
    ];
  }
  return [];
}

function castBurstPresetFor(
  spec: SpellBuildSpec,
): NonNullable<SceneLeaf["quarksPreset"]> {
  switch (spec.alignment) {
    case "fire":
    case "meteor_cosmic":
      return "embers_rising";
    case "lightning":
    case "light":
      return "sparks_burst";
    case "earth":
    case "water_ice":
      return "smoke_plume_dust";
    case "dark":
      return "smoke_plume_dark";
  }
}

function travelTrailPresetFor(
  spec: SpellBuildSpec,
): NonNullable<SceneLeaf["quarksPreset"]> {
  switch (spec.alignment) {
    case "fire":
    case "meteor_cosmic":
      return "embers_rising";
    case "lightning":
    case "light":
      return "sparks_burst";
    case "earth":
    case "water_ice":
      return "smoke_plume_dust";
    case "dark":
      return "smoke_plume_dark";
  }
}

function impactBurstPresetFor(
  spec: SpellBuildSpec,
): NonNullable<SceneLeaf["quarksPreset"]> {
  switch (spec.alignment) {
    case "fire":
    case "meteor_cosmic":
      return "lava_droplets";
    case "lightning":
    case "light":
      return "sparks_burst";
    case "earth":
    case "water_ice":
      return "dust_puff";
    case "dark":
      return "smoke_plume_dark";
  }
}

function lingeringCloudPresetFor(
  spec: SpellBuildSpec,
): NonNullable<SceneLeaf["quarksPreset"]> {
  switch (spec.alignment) {
    case "fire":
    case "meteor_cosmic":
    case "dark":
      return "smoke_plume_dark";
    case "earth":
    case "water_ice":
      return "smoke_plume_dust";
    case "lightning":
    case "light":
      return "embers_rising";
  }
}

function auraHazePresetFor(
  spec: SpellBuildSpec,
): NonNullable<SceneLeaf["quarksPreset"]> {
  switch (spec.alignment) {
    case "fire":
    case "meteor_cosmic":
    case "light":
      return "embers_rising";
    case "lightning":
      return "lightning_arcs";
    case "earth":
    case "water_ice":
      return "smoke_plume_dust";
    case "dark":
      return "smoke_plume_dark";
  }
}

function coreSize(spec: SpellBuildSpec): number {
  const base = spec.vfx.coreMesh === "boulder" ? 0.82 : spec.vfx.coreMesh === "jagged_crystal" ? 0.65 : spec.vfx.coreMesh === "none" ? 0.28 : 0.55;
  return Number((base * spec.modifiers.scale).toFixed(2));
}

function skyfallCoreShader(spec: SpellBuildSpec): SpellShaderId {
  if (spec.alignment === "meteor_cosmic") return "meteor_ember";
  if (spec.alignment === "fire") return "flame_core";
  return spec.vfx.shaders.core;
}

function skyfallRingShader(spec: SpellBuildSpec): SpellShaderId {
  if (spec.alignment === "meteor_cosmic") return "gravity_lens";
  return spec.vfx.shaders.trail;
}

function hitscanBeamShader(spec: SpellBuildSpec): SpellShaderId {
  if (spec.alignment === "lightning") return "chain_bolt";
  if (spec.alignment === "light") return "sunbeam_core";
  if (spec.alignment === "dark") return "life_leech_tendril";
  if (spec.alignment === "fire") return "ember_trail";
  if (spec.alignment === "water_ice") return "frost_crystal";
  return spec.vfx.shaders.core;
}

function cloudShader(spec: SpellBuildSpec): SpellShaderId {
  if (spec.alignment === "fire" || spec.alignment === "meteor_cosmic") return "smoke_plume";
  if (spec.alignment === "earth") return "dust_cloud";
  if (spec.alignment === "dark") return "shadow_smoke";
  if (spec.alignment === "water_ice") return "mist_shell";
  return spec.vfx.shaders.impact;
}

function clampEmit(value: number): number {
  return Number(Math.max(0, Math.min(4, value)).toFixed(2));
}
