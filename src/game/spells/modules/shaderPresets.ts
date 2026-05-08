import type { ShaderPhaseId, SpellAlignmentId, SpellShaderId } from "@/game/spells/modules/spellIds";

export type SpellShaderBlendMode = "opaque" | "alpha" | "additive" | "multiply";

export type SpellShaderPreset = {
  id: SpellShaderId;
  label: string;
  compatibleAlignments: SpellAlignmentId[];
  compatiblePhases: ShaderPhaseId[];
  blendMode: SpellShaderBlendMode;
  depthWrite: boolean;
  colorA: string;
  colorB: string;
  intensity: number;
  distortion: number;
  speed: number;
  opacity: number;
};

const allAlignments: SpellAlignmentId[] = ["fire", "water_ice", "lightning", "earth", "dark", "light", "meteor_cosmic"];
const allPhases: ShaderPhaseId[] = ["core", "trail", "impact", "decal", "aura"];

const preset = (
  id: SpellShaderId,
  label: string,
  colorA: string,
  colorB: string,
  compatibleAlignments: SpellAlignmentId[],
  compatiblePhases: ShaderPhaseId[],
  blendMode: SpellShaderBlendMode = "additive",
  depthWrite = false,
  intensity = 1.3,
  distortion = 0.45,
  speed = 1,
  opacity = 0.9,
): SpellShaderPreset => ({
  id,
  label,
  compatibleAlignments,
  compatiblePhases,
  blendMode,
  depthWrite,
  colorA,
  colorB,
  intensity,
  distortion,
  speed,
  opacity,
});

export const shaderPresetCatalog: Record<SpellShaderId, SpellShaderPreset> = {
  flame_core: preset("flame_core", "Flame Core", "#ff6a2a", "#ffd66b", ["fire", "meteor_cosmic"], ["core", "impact"]),
  ember_shell: preset("ember_shell", "Ember Shell", "#ff3d1f", "#3b0f08", ["fire"], ["core", "aura"]),
  heat_haze: preset("heat_haze", "Heat Haze", "#ffb14a", "#ffffff", ["fire", "meteor_cosmic"], ["trail", "impact", "aura"], "alpha", false, 0.7, 1.0, 0.8, 0.55),
  molten_crack: preset("molten_crack", "Molten Crack", "#ff6a2a", "#1a0702", ["fire", "meteor_cosmic"], ["decal", "impact"], "additive", false, 1.4, 0.65),
  ember_trail: preset("ember_trail", "Ember Trail", "#ff7a26", "#301006", ["fire", "meteor_cosmic"], ["trail"]),
  smoke_fire_trail: preset("smoke_fire_trail", "Smoke Fire Trail", "#6b2a1c", "#ff9d4a", ["fire"], ["trail", "impact"], "alpha", false, 0.9, 0.8, 0.7, 0.65),
  comet_flame_trail: preset("comet_flame_trail", "Comet Flame Trail", "#ffcf82", "#b41e13", ["fire", "meteor_cosmic"], ["trail"]),
  blast_flash: preset("blast_flash", "Blast Flash", "#ffffff", "#ff7a1f", ["fire", "lightning", "meteor_cosmic"], ["impact"]),
  shockwave_ring: preset("shockwave_ring", "Shockwave Ring", "#ffffff", "#ffb65f", allAlignments, ["impact", "decal"], "additive", false, 1.2, 0.25),
  smoke_plume: preset("smoke_plume", "Smoke Plume", "#25212b", "#8a7a68", ["fire", "earth", "dark", "meteor_cosmic"], ["impact", "trail"], "alpha", false, 0.7, 0.9, 0.55, 0.72),
  sparks_burst: preset("sparks_burst", "Sparks Burst", "#ffe59b", "#ff641c", ["fire", "lightning", "meteor_cosmic"], ["impact", "trail"]),
  holy_radiance: preset("holy_radiance", "Holy Radiance", "#ffffff", "#ffe58a", ["light"], ["core", "impact", "aura"]),
  halo_ring: preset("halo_ring", "Halo Ring", "#fff2a8", "#ffffff", ["light"], ["decal", "aura", "impact"]),
  sunbeam_core: preset("sunbeam_core", "Sunbeam Core", "#ffffff", "#ffc857", ["light"], ["core", "trail"]),
  blinding_flash: preset("blinding_flash", "Blinding Flash", "#ffffff", "#ffeaa6", ["light", "lightning"], ["impact"]),
  arcane_shimmer: preset("arcane_shimmer", "Arcane Shimmer", "#b96cff", "#ffffff", ["dark", "light"], allPhases),
  forcefield_ripple: preset("forcefield_ripple", "Forcefield Ripple", "#7fd7ff", "#ffffff", ["light", "dark"], ["core", "impact", "aura"], "alpha", false, 1.1, 0.8, 0.75, 0.72),
  mana_glass: preset("mana_glass", "Mana Glass", "#9be7ff", "#c68cff", ["light"], ["core", "aura"], "alpha", false, 1.0, 0.35, 0.7, 0.75),
  ward_barrier: preset("ward_barrier", "Ward Barrier", "#ffe58a", "#7fd7ff", ["light"], ["impact", "aura", "decal"], "alpha", false, 1.1, 0.55, 0.6, 0.78),
  plasma_arc: preset("plasma_arc", "Plasma Arc", "#fff36a", "#b96cff", ["lightning"], ["core", "impact"]),
  storm_core: preset("storm_core", "Storm Core", "#ffffff", "#5a3dff", ["lightning"], ["core", "decal", "aura"]),
  chain_bolt: preset("chain_bolt", "Chain Bolt", "#fff36a", "#ffffff", ["lightning"], ["trail", "core"]),
  electric_noise: preset("electric_noise", "Electric Noise", "#fff36a", "#7f4cff", ["lightning"], ["impact", "trail"]),
  frost_crystal: preset("frost_crystal", "Frost Crystal", "#8ae9ff", "#ffffff", ["water_ice"], ["core", "impact"], "alpha", false, 1.15, 0.28, 0.55, 0.82),
  ice_glass: preset("ice_glass", "Ice Glass", "#aef5ff", "#2f9fff", ["water_ice"], ["core", "impact", "aura"], "alpha", false, 1.0, 0.25, 0.45, 0.7),
  water_ripple: preset("water_ripple", "Water Ripple", "#4fd4ff", "#ffffff", ["water_ice"], ["decal", "impact"], "alpha", false, 0.9, 0.8, 0.75, 0.68),
  mist_shell: preset("mist_shell", "Mist Shell", "#c8f8ff", "#5b9dff", ["water_ice"], ["trail", "impact", "aura"], "alpha", false, 0.75, 0.95, 0.5, 0.6),
  dust_cloud: preset("dust_cloud", "Dust Cloud", "#b4834b", "#3a2515", ["earth"], ["trail", "impact"], "alpha", false, 0.72, 0.85, 0.6, 0.72),
  stone_rune: preset("stone_rune", "Stone Rune", "#d1ae72", "#4d3320", ["earth"], ["core", "decal", "impact"], "alpha", false, 0.95, 0.2, 0.35, 0.88),
  moss_glow: preset("moss_glow", "Moss Glow", "#72dd66", "#2d5226", ["earth"], ["aura", "core", "decal"], "alpha", false, 0.9, 0.5, 0.45, 0.78),
  sand_burst: preset("sand_burst", "Sand Burst", "#e0c08a", "#6c4524", ["earth"], ["impact", "trail"], "alpha", false, 0.85, 0.75, 0.8, 0.75),
  void_swirl: preset("void_swirl", "Void Swirl", "#8d5aa8", "#050109", ["dark"], ["core", "impact", "aura"]),
  shadow_smoke: preset("shadow_smoke", "Shadow Smoke", "#1b0824", "#8d5aa8", ["dark"], ["trail", "impact"], "alpha", false, 0.82, 1.0, 0.55, 0.72),
  necrotic_decay: preset("necrotic_decay", "Necrotic Decay", "#a35fcd", "#19111c", ["dark"], ["impact", "decal"], "alpha", false, 1.0, 0.9, 0.65, 0.74),
  life_leech_tendril: preset("life_leech_tendril", "Life Leech Tendril", "#d8a2ff", "#2b123a", ["dark"], ["trail", "aura", "impact"]),
  starfield_core: preset("starfield_core", "Starfield Core", "#ffffff", "#160b24", ["meteor_cosmic"], ["core", "trail", "aura"]),
  gravity_lens: preset("gravity_lens", "Gravity Lens", "#8b6dff", "#02030a", ["meteor_cosmic"], ["decal", "impact", "aura"], "alpha", false, 1.0, 1.1, 0.45, 0.7),
  meteor_ember: preset("meteor_ember", "Meteor Ember", "#c73522", "#ffcf82", ["meteor_cosmic"], ["core", "trail"]),
  cosmic_impact_ring: preset("cosmic_impact_ring", "Cosmic Impact Ring", "#ffcf82", "#311848", ["meteor_cosmic"], ["impact", "decal"]),
  toxic_bubble: preset("toxic_bubble", "Toxic Bubble", "#8cff42", "#264a15", ["earth", "dark"], ["core", "impact", "aura"], "alpha", false, 0.95, 0.85, 0.55, 0.68),
  acid_sizzle: preset("acid_sizzle", "Acid Sizzle", "#c7ff3d", "#3c5a12", ["earth", "dark"], ["impact", "decal"], "alpha", false, 1.1, 0.9, 0.9, 0.72),
  spore_cloud: preset("spore_cloud", "Spore Cloud", "#94e65a", "#5d2d71", ["earth", "dark"], ["trail", "impact"], "alpha", false, 0.78, 0.95, 0.45, 0.65),
  thorn_glow: preset("thorn_glow", "Thorn Glow", "#73d155", "#331b12", ["earth", "dark"], ["core", "impact", "aura"]),
  soft_glow: preset("soft_glow", "Soft Glow", "#ffffff", "#7fd7ff", allAlignments, allPhases, "alpha", false, 0.85, 0.25, 0.45, 0.72),
  additive_sprite: preset("additive_sprite", "Additive Sprite", "#ffffff", "#ffe58a", allAlignments, allPhases),
  ground_rune: preset("ground_rune", "Ground Rune", "#ffffff", "#7fd7ff", allAlignments, ["decal", "impact", "aura"], "alpha", false, 1.05, 0.35, 0.35, 0.78),
  dissolve_fade: preset("dissolve_fade", "Dissolve Fade", "#ffffff", "#19111c", allAlignments, allPhases, "alpha", false, 0.75, 1.0, 0.5, 0.68),
};

export const getShaderPreset = (id: SpellShaderId): SpellShaderPreset => shaderPresetCatalog[id];
