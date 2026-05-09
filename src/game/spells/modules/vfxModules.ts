import type { CoreVisualMeshId, ImpactVfxId, TravelVfxId } from "@/game/spells/modules/spellIds";

export type CoreVisualMeshDefinition = {
  id: CoreVisualMeshId;
  label: string;
  description: string;
};

export type TravelVfxDefinition = {
  id: TravelVfxId;
  label: string;
  description: string;
};

export type ImpactVfxDefinition = {
  id: ImpactVfxId;
  label: string;
  description: string;
  lingering: boolean;
};

export const coreVisualMeshCatalog: Record<CoreVisualMeshId, CoreVisualMeshDefinition> = {
  none: { id: "none", label: "Pure Energy", description: "no solid mesh; particles and glow define the body" },
  sphere: { id: "sphere", label: "Sphere", description: "smooth glowing orb or compact magical core" },
  jagged_crystal: { id: "jagged_crystal", label: "Jagged Crystal", description: "low-poly shard, ice lance, crystal bolt" },
  boulder: { id: "boulder", label: "Boulder", description: "rough heavy stone or meteor body" },
};

export const travelVfxCatalog: Record<TravelVfxId, TravelVfxDefinition> = {
  particle_trail: { id: "particle_trail", label: "Particle Trail", description: "smoke, sparks, mist, dust, motes trailing behind motion" },
  core_glow: { id: "core_glow", label: "Core Glow", description: "point light and additive halo attached to center" },
  swirling_vortex: { id: "swirling_vortex", label: "Swirling Vortex", description: "orbiting particles or rings rotating around local travel axis" },
};

export const impactVfxCatalog: Record<ImpactVfxId, ImpactVfxDefinition> = {
  burst_explosion: { id: "burst_explosion", label: "Burst Explosion", description: "rapid expanding particles and shock geometry", lingering: false },
  lingering_cloud: { id: "lingering_cloud", label: "Lingering Cloud", description: "billowing zone that stays at the impact point", lingering: true },
  ground_decal: { id: "ground_decal", label: "Ground Decal", description: "scorch, frost, rune, crater, stain, or glowing sigil", lingering: true },
  flash: { id: "flash", label: "Flash", description: "split-second high-intensity point light and burst shell", lingering: false },
  terrain_morph: {
    id: "terrain_morph",
    label: "Terrain Morph",
    description: "alignment-styled ground deformation: ice crystal field, lava pool, water puddle, jutting rock chunks, scorched glass, etc., grown from the impact point",
    lingering: true,
  },
};
