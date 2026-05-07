/**
 * Balance derivation — single `powerTier` knob ∈ 1..5 collapses all numerical
 * balance fields. The LLM's job in the balance call is just to pick the tier;
 * the engine does the rest deterministically.
 *
 * Formula (chosen so tier 3 ≈ today's "standard" spell):
 *   manaCost   = 8  + 12 * t
 *   damage     = 10 + 14 * t
 *   durationMs = 800 + 400 * t
 *   cooldownMs = 600 + 500 * t
 *   radius     = 1.5 + 0.7 * t
 *
 * Speed depends on delivery family, not tier — sky drops are fast, beams are
 * instant-ish, projectiles mid-range, self-cast is stationary.
 */

import type { SpellDeliveryFamily } from "@/game/types";

export type PowerTier = 1 | 2 | 3 | 4 | 5;

export type DerivedStats = {
  manaCost: number;
  damage: number;
  durationMs: number;
  cooldownMs: number;
  radius: number;
  speed: number;
};

export function clampTier(value: number): PowerTier {
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as PowerTier;
}

export function deriveStats(tier: PowerTier, delivery: SpellDeliveryFamily): DerivedStats {
  const t = tier;
  return {
    manaCost: 8 + 12 * t,
    damage: 10 + 14 * t,
    durationMs: 800 + 400 * t,
    cooldownMs: 600 + 500 * t,
    radius: Number((1.5 + 0.7 * t).toFixed(2)),
    speed: speedForDelivery(delivery),
  };
}

function speedForDelivery(delivery: SpellDeliveryFamily): number {
  switch (delivery) {
    case "projectile":
      return 22;
    case "beam":
      return 45;
    case "sky":
      return 30;
    case "self":
      return 0;
  }
}
