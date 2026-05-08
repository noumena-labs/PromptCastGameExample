import type { DeliveryVehicleId, SpellImpactShape } from "@/game/spells/modules/spellIds";

export type DeliveryVehicleDefinition = {
  id: DeliveryVehicleId;
  label: string;
  behavior: string;
  baseSpeed: number;
  defaultCount: number;
  maxCount: number;
  impactShape: SpellImpactShape;
  usesProjectileMotion: boolean;
  attachesToCaster: boolean;
};

export const deliveryVehicleCatalog: Record<DeliveryVehicleId, DeliveryVehicleDefinition> = {
  projectile_linear: {
    id: "projectile_linear",
    label: "Projectile (Linear)",
    behavior: "spawn at caster and travel straight toward the reticle at constant velocity",
    baseSpeed: 24,
    defaultCount: 1,
    maxCount: 5,
    impactShape: "radial",
    usesProjectileMotion: true,
    attachesToCaster: false,
  },
  projectile_arcing: {
    id: "projectile_arcing",
    label: "Projectile (Arcing)",
    behavior: "spawn at caster and lob toward the reticle under gravity",
    baseSpeed: 18,
    defaultCount: 1,
    maxCount: 4,
    impactShape: "radial",
    usesProjectileMotion: true,
    attachesToCaster: false,
  },
  skyfall: {
    id: "skyfall",
    label: "Skyfall",
    behavior: "spawn above target X/Z and descend straight down",
    baseSpeed: 32,
    defaultCount: 1,
    maxCount: 10,
    impactShape: "radial",
    usesProjectileMotion: true,
    attachesToCaster: false,
  },
  instant_hitscan: {
    id: "instant_hitscan",
    label: "Instant / Hitscan",
    behavior: "resolve an immediate line ray from caster to target",
    baseSpeed: 0,
    defaultCount: 1,
    maxCount: 1,
    impactShape: "line",
    usesProjectileMotion: true,
    attachesToCaster: false,
  },
  ground_eruption: {
    id: "ground_eruption",
    label: "Ground Eruption",
    behavior: "spawn directly at target X/Z on the terrain plane",
    baseSpeed: 0,
    defaultCount: 1,
    maxCount: 5,
    impactShape: "radial",
    usesProjectileMotion: false,
    attachesToCaster: false,
  },
  aura_orbit: {
    id: "aura_orbit",
    label: "Aura / Orbit",
    behavior: "attach to caster and follow their transform with orbiting child effects",
    baseSpeed: 0,
    defaultCount: 1,
    maxCount: 1,
    impactShape: "aura",
    usesProjectileMotion: false,
    attachesToCaster: true,
  },
};

export const getDeliveryVehicle = (id: DeliveryVehicleId): DeliveryVehicleDefinition => deliveryVehicleCatalog[id];
