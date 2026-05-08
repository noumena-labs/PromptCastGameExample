import type { DeliveryVehicleId, SpellModifierSet } from "@/game/spells/modules/spellIds";
import { getDeliveryVehicle } from "@/game/spells/modules/deliveryVehicles";

export type PowerTier = 1 | 2 | 3 | 4 | 5;

export type DerivedStats = {
  manaCost: number;
  damage: number;
  durationMs: number;
  cooldownMs: number;
  radius: number;
  speed: number;
  statusDurationMs: number;
  statusStrength: number;
};

export function clampTier(value: number): PowerTier {
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as PowerTier;
}

export function deriveStats(tier: PowerTier, deliveryId: DeliveryVehicleId, modifiers: SpellModifierSet): DerivedStats {
  const delivery = getDeliveryVehicle(deliveryId);
  const t = tier;
  const scale = modifiers.scale;
  const durationScale = modifiers.duration;
  const speed = delivery.baseSpeed === 0 ? 0 : Math.round(delivery.baseSpeed * modifiers.speed);
  const damage = Math.round((10 + 14 * t) * (1 + (modifiers.intensity - 1) * 0.22));
  const radius = Number(((1.45 + 0.72 * t) * scale).toFixed(2));
  const durationMs = Math.round((800 + 400 * t) * durationScale);
  return {
    manaCost: Math.round(8 + 12 * t + (scale - 1) * 8 + (durationScale - 1) * 6 + Math.max(0, modifiers.intensity - 1) * 8),
    damage,
    durationMs,
    cooldownMs: Math.round(600 + 500 * t + Math.max(0, scale - 1) * 220 + Math.max(0, durationScale - 1) * 180),
    radius,
    speed,
    statusDurationMs: Math.round((700 + 260 * t) * Math.min(1.8, durationScale)),
    statusStrength: Number((0.75 + t * 0.25 + (modifiers.intensity - 1) * 0.25).toFixed(2)),
  };
}
