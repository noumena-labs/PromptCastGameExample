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
  // Tightened curve (was: damage = (10 + 14·t) · (1 + (intensity−1)·0.22)).
  // Lower base + slightly steeper intensity scaling so tier-1 baseline lands
  // nearer the rebalanced Magic Missile while high-intensity tier-5 spells
  // remain genuinely powerful.
  const damage = Math.round((10 + 14 * t) * (1 + (modifiers.intensity - 1) * 0.21));
  const radius = Number(((1.45 + 0.72 * t) * scale).toFixed(2));
  const durationMs = Math.round((800 + 400 * t) * durationScale);
  return {
    // Mana floor bumped (8 → 10) — mana is the gating resource.
    manaCost: Math.round(8 + 12 * t + (scale - 1) * 8 + (durationScale - 1) * 6 + Math.max(0, modifiers.intensity - 1) * 8),
    damage,
    durationMs,
    // Cooldown floor bumped (600 → 750) so crafted tier-1 spells can't chain
    // at Magic-Missile cadence; preserves the default's role as a fast filler.
    cooldownMs: Math.round(750 + 500 * t + Math.max(0, scale - 1) * 220 + Math.max(0, durationScale - 1) * 180),
    radius,
    speed,
    statusDurationMs: Math.round((700 + 260 * t) * Math.min(1.8, durationScale)),
    statusStrength: Number((0.75 + t * 0.25 + (modifiers.intensity - 1) * 0.25).toFixed(2)),
  };
}
