import { nanoid } from "nanoid";
import { z } from "zod";
import type { GeneratedSpell, SpellElement } from "@/game/types";

export const spellElements = ["fire", "ice", "lightning", "earth", "arcane", "shadow", "nature"] as const;
export const spellShapes = ["projectile", "beam", "aoe", "vortex", "wall", "trap", "burst"] as const;
export const spellEffects = ["burn", "slow", "stun", "pull", "knockback", "shield_break", "poison"] as const;

export const elementColors: Record<SpellElement, string> = {
  fire: "#ff6a2a",
  ice: "#8ae9ff",
  lightning: "#fff36a",
  earth: "#b4834b",
  arcane: "#9d7cff",
  shadow: "#8d5aa8",
  nature: "#62e37b",
};

export const rawSpellSchema = z.object({
  name: z.string().min(1).max(32).catch("Wild Spell"),
  element: z.enum(spellElements).catch("arcane"),
  shape: z.enum(spellShapes).catch("projectile"),
  damage: z.coerce.number().finite().catch(25),
  speed: z.coerce.number().finite().catch(12),
  radius: z.coerce.number().finite().catch(2.5),
  durationMs: z.coerce.number().finite().catch(1800),
  cooldownMs: z.coerce.number().finite().catch(5000),
  manaCost: z.coerce.number().finite().catch(35),
  effects: z.array(z.enum(spellEffects)).max(3).catch([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export type RawSpell = z.infer<typeof rawSpellSchema>;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const titleCase = (value: string) =>
  value
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .slice(0, 32);

export function normalizeSpell(rawInput: unknown, prompt: string): GeneratedSpell {
  const raw = rawSpellSchema.parse(rawInput);
  const effects = [...new Set(raw.effects)].slice(0, 2);
  const crowdControlBudget = effects.reduce((total, effect) => {
    if (effect === "stun") return total + 18;
    if (effect === "pull" || effect === "slow" || effect === "knockback") return total + 10;
    return total + 6;
  }, 0);
  const radius = clamp(raw.radius, 0.6, raw.shape === "projectile" ? 4 : 8);
  const durationMs = clamp(raw.durationMs, 450, 6500);
  const speed = clamp(raw.speed, raw.shape === "aoe" || raw.shape === "vortex" ? 0 : 5, raw.shape === "beam" ? 40 : 32);
  const damageCap = raw.shape === "vortex" ? 38 : raw.shape === "aoe" ? 48 : 62;
  const damage = Math.round(clamp(raw.damage - crowdControlBudget * 0.45, 8, damageCap));
  const areaCost = radius * (raw.shape === "projectile" ? 3 : 6);
  const durationCost = durationMs / 260;
  const damageCost = damage * 0.9;
  const effectCost = crowdControlBudget;
  const manaCost = Math.round(clamp(raw.manaCost * 0.3 + damageCost + areaCost + effectCost, 18, 95));
  const cooldownMs = Math.round(
    clamp(raw.cooldownMs * 0.35 + damage * 55 + radius * 330 + durationCost * 140 + effectCost * 160, 1800, 14000),
  );

  return {
    id: `spell-${nanoid(8)}`,
    name: titleCase(raw.name || `${raw.element} ${raw.shape}`),
    prompt,
    element: raw.element,
    shape: raw.shape,
    damage,
    speed,
    radius: Number(radius.toFixed(2)),
    durationMs: Math.round(durationMs),
    cooldownMs,
    manaCost,
    effects,
    color: raw.color ?? elementColors[raw.element],
  };
}
