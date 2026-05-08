import { getAlignment } from "@/game/spells/modules/alignments";
import type { SceneLeaf, SpellScene } from "@/game/spells/sceneNode";
import type { SpellBuildSpec, SpellShaderId } from "@/game/spells/modules/spellIds";

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
  return {
    cast: compileCastScene(spec),
    travel: compileTravelScene(spec),
    impact: compileImpactScene(spec),
  };
}

function compileCastScene(spec: SpellBuildSpec): SpellScene {
  const alignment = getAlignment(spec.alignment);
  const m = spec.modifiers;
  const root = node({
    shape: "sphere",
    shaderId: spec.deliveryVehicle === "aura_orbit" ? spec.vfx.shaders.aura : spec.vfx.shaders.core,
    shaderPhase: spec.deliveryVehicle === "aura_orbit" ? "aura" : "core",
    color: alignment.palette.primary,
    emissiveIntensity: clampEmit(2.4 * m.intensity),
    size: Number((0.32 * m.scale).toFixed(2)),
    motion: "pulse",
    motionSpeed: 2.2,
    opacity: 0.72,
  });

  const children: SceneLeaf[] = [
    node({
      shape: "particle_cloud",
      shaderId: spec.vfx.shaders.trail,
      shaderPhase: "trail",
      color: alignment.palette.secondary,
      emissiveIntensity: clampEmit(0.8 * m.intensity),
      size: 0.11 * m.scale,
      motion: "rise",
      motionSpeed: 0.8,
      particleCount: Math.round(46 * m.intensity),
      opacity: 0.58,
    }),
    node({
      shape: "ring",
      shaderId: spec.deliveryVehicle === "aura_orbit" ? spec.vfx.shaders.aura : spec.vfx.shaders.decal,
      shaderPhase: spec.deliveryVehicle === "aura_orbit" ? "aura" : "decal",
      color: alignment.palette.accent,
      emissiveIntensity: clampEmit(1.1 * m.intensity),
      size: 0.38 * m.scale,
      motion: "spin",
      motionSpeed: 2.8,
      opacity: 0.48,
    }),
  ];

  if (spec.deliveryVehicle === "aura_orbit") {
    children.push(node({
      shape: "torus",
      shaderId: spec.vfx.shaders.aura,
      shaderPhase: "aura",
      color: alignment.palette.accent,
      emissiveIntensity: clampEmit(1.3 * m.intensity),
      size: 0.65 * m.scale,
      motion: "spin",
      motionSpeed: 1.1,
      opacity: 0.62,
    }));
  }

  return { ...root, children: children.slice(0, 6) };
}

function compileTravelScene(spec: SpellBuildSpec): SpellScene {
  const alignment = getAlignment(spec.alignment);
  const m = spec.modifiers;
  const skyfall = spec.deliveryVehicle === "skyfall";
  const hitscan = spec.deliveryVehicle === "instant_hitscan";
  const root = node({
    shape: hitscan ? "bar" : skyfall ? skyfallShape(spec) : coreShape(spec.vfx.coreMesh),
    shaderId: skyfall ? skyfallCoreShader(spec) : shaderForCore(spec),
    shaderPhase: hitscan ? "trail" : spec.deliveryVehicle === "aura_orbit" ? "aura" : "core",
    color: alignment.palette.primary,
    emissiveIntensity: clampEmit((skyfall ? 2.8 : hitscan ? 2.2 : 1.9) * m.intensity),
    size: travelCoreSize(spec),
    motion: travelRootMotion(spec),
    motionSpeed: skyfall ? 3.2 : 1.4 + m.speed,
    particleCount: spec.vfx.coreMesh === "none" && !hitscan ? Math.round(80 * m.intensity) : 0,
    opacity: spec.vfx.coreMesh === "none" && !skyfall ? 0.28 : 0.95,
  });

  const children: SceneLeaf[] = [];
  if (spec.vfx.travel.includes("particle_trail") || skyfall) {
    children.push(node({
      shape: "particle_cloud",
      shaderId: skyfall ? skyfallTrailShader(spec) : spec.vfx.shaders.trail,
      shaderPhase: "trail",
      color: alignment.palette.secondary,
      emissiveIntensity: clampEmit((skyfall ? 1.6 : 0.9) * m.intensity),
      size: Number(((skyfall ? 0.22 : 0.14) * m.scale).toFixed(2)),
      position: [0, 0, skyfall ? -0.95 * m.scale : -0.48 * m.scale],
      motion: "drift",
      motionSpeed: skyfall ? 0.45 : 1.3,
      particleCount: Math.round((skyfall ? 150 : 58) * m.intensity),
      opacity: skyfall ? 0.82 : 0.72,
    }));
  }
  if (skyfall) {
    children.push(node({
      shape: "bar",
      shaderId: skyfallTrailShader(spec),
      shaderPhase: "trail",
      color: alignment.palette.secondary,
      emissiveIntensity: clampEmit(1.8 * m.intensity),
      size: Number((0.48 * m.scale).toFixed(2)),
      position: [0, 0, -0.82 * m.scale],
      rotation: [Math.PI / 2, 0, 0],
      motion: "pulse",
      motionSpeed: 2.4,
      opacity: 0.64,
    }));
  }
  if (spec.vfx.travel.includes("core_glow") || skyfall) {
    children.push(node({
      shape: "sphere",
      shaderId: skyfall ? skyfallCoreShader(spec) : spec.vfx.shaders.core,
      shaderPhase: "core",
      color: alignment.palette.accent,
      emissiveIntensity: clampEmit((skyfall ? 2.6 : 2.1) * m.intensity),
      size: Number(((skyfall ? 0.55 : 0.42) * m.scale).toFixed(2)),
      motion: "pulse",
      motionSpeed: skyfall ? 2.2 : 1.8,
      opacity: skyfall ? 0.54 : 0.42,
    }));
  }
  if (spec.vfx.travel.includes("swirling_vortex") || skyfall) {
    children.push(node({
      shape: "ring",
      shaderId: skyfall ? skyfallRingShader(spec) : spec.vfx.shaders.trail,
      shaderPhase: "trail",
      color: alignment.palette.accent,
      emissiveIntensity: clampEmit((skyfall ? 1.5 : 1.2) * m.intensity),
      size: Number(((skyfall ? 0.8 : 0.55) * m.scale).toFixed(2)),
      motion: "spin",
      motionSpeed: skyfall ? 4.4 : 3.2,
      arrange: "ring",
      arrangeCount: skyfall ? 4 : 3,
      arrangeRadius: Number(((skyfall ? 0.5 : 0.42) * m.scale).toFixed(2)),
      opacity: skyfall ? 0.62 : 0.74,
    }));
  }
  if (hitscan) {
    children.push(node({
      shape: "particle_cloud",
      shaderId: spec.vfx.shaders.trail,
      shaderPhase: "trail",
      color: alignment.palette.accent,
      emissiveIntensity: clampEmit(1.4 * m.intensity),
      size: 0.08 * m.scale,
      motion: "drift",
      motionSpeed: 3.6,
      particleCount: Math.round(72 * m.intensity),
      opacity: 0.8,
    }));
  }

  return { ...root, children: children.slice(0, 6) };
}

function compileImpactScene(spec: SpellBuildSpec): SpellScene {
  const alignment = getAlignment(spec.alignment);
  const m = spec.modifiers;
  const lingering = spec.vfx.impact.includes("lingering_cloud") || spec.vfx.impact.includes("ground_decal") || spec.deliveryVehicle === "aura_orbit";
  const root = node({
    shape: rootImpactShape(spec),
    shaderId: rootImpactShader(spec),
    shaderPhase: spec.deliveryVehicle === "aura_orbit" ? "aura" : "impact",
    color: alignment.palette.primary,
    emissiveIntensity: clampEmit((lingering ? 1.1 : 2.4) * m.intensity),
    size: impactRootSize(spec),
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
      color: alignment.palette.accent,
      emissiveIntensity: clampEmit(3.4 * m.intensity),
      size: 0.8 * m.scale,
      motion: "expand",
      motionSpeed: 3.2,
      opacity: 0.38,
    }));
  }
  if (spec.vfx.impact.includes("burst_explosion")) {
    children.push(node({
      shape: "particle_cloud",
      shaderId: spec.vfx.shaders.impact,
      shaderPhase: "impact",
      color: alignment.palette.accent,
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
      color: alignment.palette.secondary,
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
      color: alignment.palette.secondary,
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
      color: alignment.palette.primary,
      emissiveIntensity: clampEmit(0.9 * m.intensity),
      size: 0.9 * m.scale,
      position: [0, 0.025, 0],
      motion: "pulse",
      motionSpeed: 0.45,
      opacity: 0.58,
    }));
  }
  if (spec.deliveryVehicle === "aura_orbit") {
    children.push(node({
      shape: "sphere",
      shaderId: spec.vfx.shaders.aura,
      shaderPhase: "aura",
      color: alignment.palette.accent,
      emissiveIntensity: clampEmit(1.2 * m.intensity),
      size: 0.16 * m.scale,
      motion: "orbit",
      motionSpeed: 1.5,
      arrange: "ring",
      arrangeCount: 6,
      arrangeRadius: 1.1 * m.scale,
      opacity: 0.85,
    }));
  }

  return { ...root, children: children.slice(0, 6) };
}

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

function travelCoreSize(spec: SpellBuildSpec): number {
  if (spec.deliveryVehicle === "skyfall") return Number((1.18 * Math.max(1, spec.modifiers.scale)).toFixed(2));
  if (spec.deliveryVehicle === "instant_hitscan") return Number((0.34 * spec.modifiers.scale).toFixed(2));
  return Number((coreSize(spec) * 1.18).toFixed(2));
}

function rootCastMotion(spec: SpellBuildSpec): SceneLeaf["motion"] {
  if (spec.deliveryVehicle === "projectile_arcing" || spec.deliveryVehicle === "skyfall") return "spin";
  if (spec.deliveryVehicle === "aura_orbit") return "pulse";
  if (spec.deliveryVehicle === "instant_hitscan") return "pulse";
  return "spin";
}

function travelRootMotion(spec: SpellBuildSpec): SceneLeaf["motion"] {
  if (spec.deliveryVehicle === "instant_hitscan") return "pulse";
  if (spec.deliveryVehicle === "skyfall" || spec.deliveryVehicle === "projectile_arcing") return "spin";
  return rootCastMotion(spec);
}

function skyfallShape(spec: SpellBuildSpec): SceneLeaf["shape"] {
  if (spec.vfx.coreMesh === "jagged_crystal") return "octa";
  return "tetra";
}

function rootImpactShape(spec: SpellBuildSpec): SceneLeaf["shape"] {
  if (spec.deliveryVehicle === "aura_orbit") return "torus";
  if (spec.deliveryVehicle === "instant_hitscan") return "bar";
  if (spec.vfx.impact.includes("ground_decal")) return "ring";
  return spec.vfx.impact.includes("lingering_cloud") ? "cylinder" : "sphere";
}

function impactRootSize(spec: SpellBuildSpec): number {
  const base = spec.deliveryVehicle === "instant_hitscan" ? 1.5 : spec.deliveryVehicle === "aura_orbit" ? 1.1 : 1.15;
  return Number((base * spec.modifiers.scale).toFixed(2));
}

function shaderForCore(spec: SpellBuildSpec): SpellShaderId {
  return spec.deliveryVehicle === "aura_orbit" ? spec.vfx.shaders.aura : spec.vfx.shaders.core;
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

function rootImpactShader(spec: SpellBuildSpec): SpellShaderId {
  return spec.deliveryVehicle === "aura_orbit" ? spec.vfx.shaders.aura : spec.vfx.shaders.impact;
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
