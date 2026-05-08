export const spellAlignmentIds = [
  "fire",
  "water_ice",
  "lightning",
  "earth",
  "dark",
  "light",
  "meteor_cosmic",
] as const;
export type SpellAlignmentId = (typeof spellAlignmentIds)[number];

export const spellStatusEffectIds = [
  "burn",
  "chill",
  "stun",
  "stagger",
  "decay",
  "blind",
  "crush",
] as const;
export type SpellStatusEffectId = (typeof spellStatusEffectIds)[number];

export const deliveryVehicleIds = [
  "projectile_linear",
  "projectile_arcing",
  "skyfall",
  "instant_hitscan",
  "ground_eruption",
  "aura_orbit",
] as const;
export type DeliveryVehicleId = (typeof deliveryVehicleIds)[number];

export const coreVisualMeshIds = ["none", "sphere", "jagged_crystal", "boulder"] as const;
export type CoreVisualMeshId = (typeof coreVisualMeshIds)[number];

export const travelVfxIds = ["particle_trail", "core_glow", "swirling_vortex"] as const;
export type TravelVfxId = (typeof travelVfxIds)[number];

export const impactVfxIds = ["burst_explosion", "lingering_cloud", "ground_decal", "flash"] as const;
export type ImpactVfxId = (typeof impactVfxIds)[number];

export const spellShaderIds = [
  "flame_core",
  "ember_shell",
  "heat_haze",
  "molten_crack",
  "ember_trail",
  "smoke_fire_trail",
  "comet_flame_trail",
  "blast_flash",
  "shockwave_ring",
  "smoke_plume",
  "sparks_burst",
  "holy_radiance",
  "halo_ring",
  "sunbeam_core",
  "blinding_flash",
  "arcane_shimmer",
  "forcefield_ripple",
  "mana_glass",
  "ward_barrier",
  "plasma_arc",
  "storm_core",
  "chain_bolt",
  "electric_noise",
  "frost_crystal",
  "ice_glass",
  "water_ripple",
  "mist_shell",
  "dust_cloud",
  "stone_rune",
  "moss_glow",
  "sand_burst",
  "void_swirl",
  "shadow_smoke",
  "necrotic_decay",
  "life_leech_tendril",
  "starfield_core",
  "gravity_lens",
  "meteor_ember",
  "cosmic_impact_ring",
  "toxic_bubble",
  "acid_sizzle",
  "spore_cloud",
  "thorn_glow",
  "soft_glow",
  "additive_sprite",
  "ground_rune",
  "dissolve_fade",
] as const;
export type SpellShaderId = (typeof spellShaderIds)[number];

export const spellShaderIdSet = new Set<string>(spellShaderIds);

export const shaderPhaseIds = ["core", "trail", "impact", "decal", "aura"] as const;
export type ShaderPhaseId = (typeof shaderPhaseIds)[number];

export type SpellImpactShape = "radial" | "line" | "wall" | "aura";

export type SpellModifierSet = {
  scale: number;
  speed: number;
  duration: number;
  intensity: number;
};

export type SpellShaderSelection = {
  core: SpellShaderId;
  trail: SpellShaderId;
  impact: SpellShaderId;
  decal: SpellShaderId;
  aura: SpellShaderId;
};

export type SpellVfxPayload = {
  coreMesh: CoreVisualMeshId;
  travel: TravelVfxId[];
  impact: ImpactVfxId[];
  shaders: SpellShaderSelection;
};

export type SpellBuildSpec = {
  name: string;
  alignment: SpellAlignmentId;
  deliveryVehicle: DeliveryVehicleId;
  vfx: SpellVfxPayload;
  modifiers: SpellModifierSet;
  count: number;
  intentSummary: string;
  castImagery: string;
  impactImagery: string;
};
