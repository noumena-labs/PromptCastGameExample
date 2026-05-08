import { getAlignment, type AlignmentDefinition } from "@/game/spells/modules/alignments";
import type { SceneLeaf, SpellScene } from "@/game/spells/sceneNode";
import type { SpellAlignmentId, SpellBuildSpec, SpellShaderId } from "@/game/spells/modules/spellIds";

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
  input: Omit<SceneLeaf, "arrange" | "arrangeCount" | "arrangeRadius" | "particleCount" | "motionSpeed" | "rotation" | "position"> &
    Partial<Pick<SceneLeaf, "arrange" | "arrangeCount" | "arrangeRadius" | "particleCount" | "motionSpeed" | "rotation" | "position">>,
): SceneLeaf => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  motionSpeed: 1,
  arrange: "single",
  arrangeCount: 1,
  arrangeRadius: 0,
  particleCount: 0,
  ...input,
});

export function compileVfxPayload(spec: SpellBuildSpec): { cast: SpellScene; travel: SpellScene; impact: SpellScene } {
  switch (spec.deliveryVehicle) {
    case "projectile_linear":
      return compileLinearProjectileScenes(spec);
    case "projectile_arcing":
      return compileArcingProjectileScenes(spec);
    case "skyfall":
      return compileSkyfallScenes(spec);
    case "instant_hitscan":
      return compileHitscanScenes(spec);
    case "ground_eruption":
      return compileGroundEruptionScenes(spec);
    case "aura_orbit":
      return compileAuraOrbitScenes(spec);
  }
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
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(0.9 * m.intensity),
        size: 0.1 * m.scale,
        motion: "drift",
        motionSpeed: 1.4,
        particleCount: Math.round(48 * m.intensity),
        opacity: 0.6,
      }),
    ],
  };

  const travel: SpellScene = {
    ...node({
      shape: coreShape(spec.vfx.coreMesh),
      shaderId: spec.vfx.shaders.core,
      shaderPhase: "core",
      color: a.palette.primary,
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
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: Number((0.14 * m.scale).toFixed(2)),
        position: [0, 0, -0.55 * m.scale],
        motion: "drift",
        motionSpeed: 1.6,
        particleCount: Math.round(60 * m.intensity),
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

  const impact = compileGenericImpactScene(spec, a, { lingering: spec.vfx.impact.includes("lingering_cloud") || spec.vfx.impact.includes("ground_decal") });
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
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(0.8 * m.intensity),
        size: 0.12 * m.scale,
        motion: "rise",
        motionSpeed: 0.6,
        particleCount: Math.round(36 * m.intensity),
        opacity: 0.55,
      }),
    ],
  };

  const travel: SpellScene = {
    ...node({
      shape: coreShape(spec.vfx.coreMesh === "none" ? "boulder" : spec.vfx.coreMesh),
      shaderId: spec.vfx.shaders.core,
      shaderPhase: "core",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(1.8 * m.intensity),
      size: Number((coreSize(spec) * 1.25).toFixed(2)),
      motion: "spin",
      motionSpeed: 4.2,
      opacity: 0.96,
    }),
    children: [
      // falling dust trail
      node({
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(0.7 * m.intensity),
        size: 0.16 * m.scale,
        position: [0, -0.2 * m.scale, -0.4 * m.scale],
        motion: "fall",
        motionSpeed: 0.6,
        particleCount: Math.round(64 * m.intensity),
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
      // debris kicked up
      node({
        shape: "particle_cloud",
        shaderId: cloudShader(spec),
        shaderPhase: "impact",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(0.7 * m.intensity),
        size: 0.3 * m.scale,
        position: [0, 0.45, 0],
        motion: "rise",
        motionSpeed: 0.9,
        particleCount: Math.round(110 * m.intensity),
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
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: 0.16 * m.scale,
        motion: "rise",
        motionSpeed: 1.2,
        particleCount: Math.round(60 * m.intensity),
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

  const travel: SpellScene = {
    ...node({
      shape: skyfallShape(spec),
      shaderId: skyfallCoreShader(spec),
      shaderPhase: "core",
      color: a.palette.primary,
      emissiveIntensity: clampEmit(2.8 * m.intensity),
      size: Number((1.2 * Math.max(1, m.scale)).toFixed(2)),
      motion: "spin",
      motionSpeed: 3.2,
      opacity: 0.95,
    }),
    children: [
      // streak tail behind meteor (along travel axis -Z)
      node({
        shape: "bar",
        shaderId: skyfallTrailShader(spec),
        shaderPhase: "trail",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(1.8 * m.intensity),
        size: Number((0.5 * m.scale).toFixed(2)),
        position: [0, 0, -0.85 * m.scale],
        rotation: [Math.PI / 2, 0, 0],
        motion: "pulse",
        motionSpeed: 2.4,
        opacity: 0.66,
      }),
      // particle plume
      node({
        shape: "particle_cloud",
        shaderId: skyfallTrailShader(spec),
        shaderPhase: "trail",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(1.6 * m.intensity),
        size: Number((0.22 * m.scale).toFixed(2)),
        position: [0, 0, -0.95 * m.scale],
        motion: "drift",
        motionSpeed: 0.45,
        particleCount: Math.round(150 * m.intensity),
        opacity: 0.82,
      }),
      // glow halo
      node({
        shape: "sphere",
        shaderId: skyfallCoreShader(spec),
        shaderPhase: "core",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(2.6 * m.intensity),
        size: Number((0.6 * m.scale).toFixed(2)),
        motion: "pulse",
        motionSpeed: 2.2,
        opacity: 0.55,
      }),
      // gravity ring
      node({
        shape: "ring",
        shaderId: skyfallRingShader(spec),
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.5 * m.intensity),
        size: Number((0.85 * m.scale).toFixed(2)),
        motion: "spin",
        motionSpeed: 4.4,
        arrange: "ring",
        arrangeCount: 4,
        arrangeRadius: Number((0.5 * m.scale).toFixed(2)),
        opacity: 0.62,
      }),
    ].slice(0, 6),
  };

  // Skyfall crash impact: massive flash + shockwave + crater + debris
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
      node({
        shape: "particle_cloud",
        shaderId: cloudShader(spec),
        shaderPhase: "impact",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(0.8 * m.intensity),
        size: 0.34 * m.scale,
        position: [0, 0.5, 0],
        motion: "rise",
        motionSpeed: 1.0,
        particleCount: Math.round(140 * m.intensity),
        opacity: 0.78,
      }),
    ],
  };

  return { cast, travel, impact };
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
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.0 * m.intensity),
        size: 0.08 * m.scale,
        motion: "drift",
        motionSpeed: 3.0,
        particleCount: Math.round(48 * m.intensity),
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
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.4 * m.intensity),
        size: 0.07 * m.scale,
        motion: "drift",
        motionSpeed: 4.0,
        particleCount: Math.round(72 * m.intensity),
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
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(0.9 * m.intensity),
        size: 0.12 * m.scale,
        motion: "rise",
        motionSpeed: 0.8,
        particleCount: Math.round(40 * m.intensity),
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
      emissiveIntensity: clampEmit(profile.emissive * m.intensity),
      size: Number((profile.size * m.scale).toFixed(2)),
      position: [0, profile.basePivotY, 0],
      rotation: profile.rotation,
      motion: "erupt",
      motionSpeed: 2.4,
      arrange: "ring",
      arrangeCount: eruptCount,
      arrangeRadius: eruptRadius,
      opacity: profile.opacity,
    }),
    children: [
      // central tall pillar / vent
      node({
        shape: profile.centerShape,
        shaderId: profile.centerShader ?? spec.vfx.shaders.core,
        shaderPhase: "core",
        color: a.palette.accent,
        emissiveIntensity: clampEmit((profile.emissive + 0.4) * m.intensity),
        size: Number((profile.centerSize * m.scale).toFixed(2)),
        position: [0, profile.centerPivotY, 0],
        rotation: profile.centerRotation,
        motion: "erupt",
        motionSpeed: 1.8,
        opacity: 0.92,
      }),
      // dust/smoke kicked up by the eruption
      node({
        shape: "particle_cloud",
        shaderId: cloudShader(spec),
        shaderPhase: "impact",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(0.7 * m.intensity),
        size: 0.3 * m.scale,
        position: [0, 0.35, 0],
        motion: "rise",
        motionSpeed: 0.9,
        particleCount: Math.round(120 * m.intensity),
        opacity: 0.7,
      }),
      // shockwave at the base
      node({
        shape: "ring",
        shaderId: "shockwave_ring",
        shaderPhase: "impact",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.3 * m.intensity),
        size: Number((0.95 * m.scale).toFixed(2)),
        position: [0, 0.04, 0],
        motion: "expand",
        motionSpeed: 2.6,
        opacity: 0.62,
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
};

function eruptionProfileFor(alignment: SpellAlignmentId): EruptionProfile {
  switch (alignment) {
    case "earth":
      return {
        shape: "cone",
        size: 0.85,
        basePivotY: 0.4,
        rotation: [0, 0, 0],
        emissive: 0.6,
        opacity: 0.96,
        centerShape: "cone",
        centerSize: 1.4,
        centerPivotY: 0.7,
        centerRotation: [0, 0, 0],
        coreShader: "stone_rune",
        centerShader: "stone_rune",
        decalShader: "stone_rune",
      };
    case "fire":
      return {
        shape: "cone",
        size: 0.75,
        basePivotY: 0.35,
        rotation: [0, 0, 0],
        emissive: 2.4,
        opacity: 0.9,
        centerShape: "cylinder",
        centerSize: 1.3,
        centerPivotY: 0.65,
        centerRotation: [0, 0, 0],
        coreShader: "flame_core",
        centerShader: "flame_core",
        decalShader: "molten_crack",
      };
    case "water_ice":
      return {
        shape: "octa",
        size: 0.72,
        basePivotY: 0.36,
        rotation: [0, 0, 0],
        emissive: 1.8,
        opacity: 0.92,
        centerShape: "octa",
        centerSize: 1.25,
        centerPivotY: 0.62,
        centerRotation: [0, 0, 0],
        coreShader: "frost_crystal",
        centerShader: "ice_glass",
        decalShader: "water_ripple",
      };
    case "lightning":
      return {
        shape: "tetra",
        size: 0.6,
        basePivotY: 0.3,
        rotation: [0, 0, 0],
        emissive: 2.8,
        opacity: 0.88,
        centerShape: "cylinder",
        centerSize: 1.4,
        centerPivotY: 0.7,
        centerRotation: [0, 0, 0],
        coreShader: "plasma_arc",
        centerShader: "storm_core",
        decalShader: "ground_rune",
      };
    case "dark":
      return {
        shape: "tetra",
        size: 0.7,
        basePivotY: 0.35,
        rotation: [0, 0, 0],
        emissive: 1.6,
        opacity: 0.9,
        centerShape: "cylinder",
        centerSize: 1.3,
        centerPivotY: 0.65,
        centerRotation: [0, 0, 0],
        coreShader: "void_swirl",
        centerShader: "shadow_smoke",
        decalShader: "ground_rune",
      };
    case "light":
      return {
        shape: "cylinder",
        size: 0.5,
        basePivotY: 0.5,
        rotation: [0, 0, 0],
        emissive: 2.6,
        opacity: 0.85,
        centerShape: "cylinder",
        centerSize: 1.5,
        centerPivotY: 0.75,
        centerRotation: [0, 0, 0],
        coreShader: "sunbeam_core",
        centerShader: "holy_radiance",
        decalShader: "halo_ring",
      };
    case "meteor_cosmic":
      return {
        shape: "octa",
        size: 0.8,
        basePivotY: 0.4,
        rotation: [0, 0, 0],
        emissive: 2.2,
        opacity: 0.94,
        centerShape: "tetra",
        centerSize: 1.4,
        centerPivotY: 0.7,
        centerRotation: [0, 0, 0],
        coreShader: "meteor_ember",
        centerShader: "starfield_core",
        decalShader: "gravity_lens",
      };
  }
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
        shape: "particle_cloud",
        shaderId: spec.vfx.shaders.trail,
        shaderPhase: "trail",
        color: a.palette.secondary,
        emissiveIntensity: clampEmit(0.6 * m.intensity),
        size: 0.12,
        motion: "swirl",
        motionSpeed: 0.8,
        particleCount: Math.round(80 * m.intensity),
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
  if (spec.vfx.impact.includes("burst_explosion")) {
    children.push(node({
      shape: "particle_cloud",
      shaderId: spec.vfx.shaders.impact,
      shaderPhase: "impact",
      color: a.palette.accent,
      emissiveIntensity: clampEmit(1.4 * m.intensity),
      size: 0.24 * m.scale,
      motion: "expand",
      motionSpeed: 2.2,
      particleCount: Math.round(120 * m.intensity),
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
      shape: "particle_cloud",
      shaderId: cloudShader(spec),
      shaderPhase: "impact",
      color: a.palette.secondary,
      emissiveIntensity: clampEmit(0.6 * m.intensity),
      size: 0.34 * m.scale,
      position: [0, 0.35, 0],
      motion: "swirl",
      motionSpeed: 0.7,
      particleCount: Math.round(90 * m.intensity),
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
        shape: "particle_cloud",
        shaderId: "ember_trail",
        shaderPhase: "trail",
        color: a.palette.accent,
        emissiveIntensity: clampEmit(1.4 * m.intensity),
        size: 0.08 * m.scale,
        position: [0, 0, -0.7 * m.scale],
        motion: "drift",
        motionSpeed: 2.2,
        particleCount: Math.round(40 * m.intensity),
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
      return "particle_cloud";
    case "jagged_crystal":
      return "octa";
    case "boulder":
      return "tetra";
    case "sphere":
      return "sphere";
  }
}

function coreSize(spec: SpellBuildSpec): number {
  const base = spec.vfx.coreMesh === "boulder" ? 0.82 : spec.vfx.coreMesh === "jagged_crystal" ? 0.65 : spec.vfx.coreMesh === "none" ? 0.28 : 0.55;
  return Number((base * spec.modifiers.scale).toFixed(2));
}

function skyfallShape(spec: SpellBuildSpec): SceneLeaf["shape"] {
  if (spec.vfx.coreMesh === "jagged_crystal") return "octa";
  return "tetra";
}

function skyfallCoreShader(spec: SpellBuildSpec): SpellShaderId {
  if (spec.alignment === "meteor_cosmic") return "meteor_ember";
  if (spec.alignment === "fire") return "flame_core";
  return spec.vfx.shaders.core;
}

function skyfallTrailShader(spec: SpellBuildSpec): SpellShaderId {
  if (spec.alignment === "meteor_cosmic") return "comet_flame_trail";
  if (spec.alignment === "fire") return "smoke_fire_trail";
  return spec.vfx.shaders.trail;
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
