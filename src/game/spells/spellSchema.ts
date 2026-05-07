import { nanoid } from "nanoid";
import { z } from "zod";
import type { GeneratedSpell, SpellElement } from "@/game/types";

export const spellElements = ["fire", "ice", "lightning", "earth", "arcane", "shadow", "nature"] as const;
export const spellDeliveries = ["projectile", "beam", "sky", "self"] as const;
export const spellImpacts = ["single", "aoe", "vortex", "wall", "trap", "burst", "none"] as const;
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
  reasoning: z.string().max(800).optional(),
  element: z.enum(spellElements).catch("arcane"),
  delivery: z.enum(spellDeliveries).catch("projectile"),
  impact: z.enum(spellImpacts).catch("single"),
  count: z.coerce.number().finite().catch(1),
  damage: z.coerce.number().finite().catch(25),
  speed: z.coerce.number().finite().catch(18),
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

  // Count is most meaningful for sky / projectile. Beams and self-cast are 1.
  const countMax = raw.delivery === "sky" ? 10 : raw.delivery === "projectile" ? 5 : 1;
  const count = Math.max(1, Math.min(countMax, Math.round(raw.count || 1)));

  // Radius caps depend on impact shape.
  const radiusMax =
    raw.impact === "single" ? 1.6 :
    raw.impact === "wall" ? 9 :
    raw.impact === "vortex" ? 7 :
    8;
  const radius = clamp(raw.radius, 0.5, radiusMax);

  const durationMs = clamp(raw.durationMs, 450, 6500);

  const speed = clamp(
    raw.speed,
    raw.delivery === "self" ? 0 : raw.delivery === "sky" ? 18 : 5,
    raw.delivery === "beam" ? 50 : raw.delivery === "sky" ? 60 : 38,
  );

  // Damage cap scales with how lethal the impact is.
  const damageCap =
    raw.impact === "single" ? 70 :
    raw.impact === "burst" ? 55 :
    raw.impact === "aoe" ? 42 :
    raw.impact === "vortex" ? 32 :
    36;
  const damage = Math.round(clamp(raw.damage - crowdControlBudget * 0.45, 6, damageCap));

  // Cost scales with raw output: damage × count, area, duration, CC.
  const areaCost = radius * (raw.impact === "single" ? 2 : 5);
  const durationCost = durationMs / 260;
  const damageCost = damage * count * 0.85;
  const effectCost = crowdControlBudget;
  const manaCost = Math.round(clamp(raw.manaCost * 0.25 + damageCost + areaCost + effectCost, 12, 95));

  const cooldownMs = Math.round(
    clamp(
      raw.cooldownMs * 0.3 + damage * count * 50 + radius * 280 + durationCost * 130 + effectCost * 150,
      1500,
      14000,
    ),
  );

  return {
    id: `spell-${nanoid(8)}`,
    name: titleCase(raw.name || `${raw.element} ${raw.delivery}`),
    prompt,
    reasoning: raw.reasoning,
    element: raw.element,
    delivery: raw.delivery,
    impact: raw.impact,
    count,
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
