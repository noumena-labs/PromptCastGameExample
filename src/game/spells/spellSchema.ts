import { nanoid } from "nanoid";
import { z } from "zod";
import { recipeForArchetype } from "@/game/spells/archetypeDefaults";
import {
  archetypeKinds,
  visualRecipeSchema,
  type ArchetypeKind,
  type VisualRecipe,
} from "@/game/spells/visualRecipe";
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

/**
 * Concept-call output: archetype + element + scale hint + 1-line summary.
 */
export const conceptSchema = z.object({
  archetype: z.enum(archetypeKinds).catch("arcane_orb"),
  element: z.enum(spellElements).catch("arcane"),
  intent_summary: z.string().max(160).catch(""),
  scale: z.enum(["small", "medium", "large", "epic"]).catch("medium"),
});
export type SpellConcept = z.infer<typeof conceptSchema>;

/**
 * Mechanics-call output: pure numerical / categorical balance fields.
 */
export const mechanicsSchema = z.object({
  name: z.string().min(1).max(32).catch("Wild Spell"),
  delivery: z.enum(spellDeliveries).catch("projectile"),
  impact: z.enum(spellImpacts).catch("single"),
  count: z.coerce.number().finite().catch(1),
  damage: z.coerce.number().finite().catch(25),
  speed: z.coerce.number().finite().catch(18),
  radius: z.coerce.number().finite().catch(2.5),
  durationMs: z.coerce.number().finite().catch(1800),
  effects: z.array(z.enum(spellEffects)).max(3).catch([]),
});
export type SpellMechanics = z.infer<typeof mechanicsSchema>;

/**
 * Legacy single-call schema (kept for the repair-loop fallback path which
 * asks the LLM to fix a malformed JSON blob in one shot).
 */
export const rawSpellSchema = z.object({
  name: z.string().min(1).max(32).catch("Wild Spell"),
  reasoning: z.string().max(800).optional(),
  archetype: z.enum(archetypeKinds).optional(),
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
  visualRecipe: visualRecipeSchema.optional(),
});

export type RawSpell = z.infer<typeof rawSpellSchema>;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const titleCase = (value: string) =>
  value
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .slice(0, 32);

// ─────────────────────────────────────────────────────────────────────────────
// Composer: builds a final GeneratedSpell from concept + mechanics + recipe.
//
// `manaCost` and `cooldownMs` are computed deterministically here — neither
// the LLM nor the caller has any business setting them.
// ─────────────────────────────────────────────────────────────────────────────

export type ComposeInput = {
  prompt: string;
  reasoning?: string;
  concept: SpellConcept;
  mechanics: SpellMechanics;
  visualRecipe?: VisualRecipe;
};

export function composeSpell(input: ComposeInput): GeneratedSpell {
  const { concept, mechanics, prompt, reasoning } = input;
  const archetype: ArchetypeKind = concept.archetype;

  const effects = [...new Set(mechanics.effects)].slice(0, 2);
  const crowdControlBudget = effects.reduce((total, effect) => {
    if (effect === "stun") return total + 18;
    if (effect === "pull" || effect === "slow" || effect === "knockback") return total + 10;
    return total + 6;
  }, 0);

  const countMax = mechanics.delivery === "sky" ? 10 : mechanics.delivery === "projectile" ? 5 : 1;
  const count = Math.max(1, Math.min(countMax, Math.round(mechanics.count || 1)));

  const radiusMax =
    mechanics.impact === "single" ? 1.6 :
    mechanics.impact === "wall" ? 9 :
    mechanics.impact === "vortex" ? 7 :
    8;
  const radius = clamp(mechanics.radius, 0.5, radiusMax);

  const durationMs = clamp(mechanics.durationMs, 450, 6500);

  const speed = clamp(
    mechanics.speed,
    mechanics.delivery === "self" ? 0 : mechanics.delivery === "sky" ? 18 : 5,
    mechanics.delivery === "beam" ? 50 : mechanics.delivery === "sky" ? 60 : 38,
  );

  const damageCap =
    mechanics.impact === "single" ? 70 :
    mechanics.impact === "burst" ? 55 :
    mechanics.impact === "aoe" ? 42 :
    mechanics.impact === "vortex" ? 32 :
    36;
  const damage = Math.round(clamp(mechanics.damage - crowdControlBudget * 0.45, 6, damageCap));

  const areaCost = radius * (mechanics.impact === "single" ? 2 : 5);
  const durationCost = durationMs / 260;
  const damageCost = damage * count * 0.85;
  const effectCost = crowdControlBudget;
  const manaCost = Math.round(clamp(damageCost + areaCost + effectCost + 8, 12, 95));

  const cooldownMs = Math.round(
    clamp(
      damage * count * 50 + radius * 280 + durationCost * 130 + effectCost * 150 + 1200,
      1500,
      14000,
    ),
  );

  // Visual recipe: prefer the LLM-tuned recipe, otherwise fall back to the
  // archetype default. Either way we re-stamp the archetype field for safety
  // (the visual call's `archetype` is informational — concept owns it).
  const baseRecipe = input.visualRecipe ?? recipeForArchetype(archetype);
  const visualRecipe: VisualRecipe = { ...baseRecipe, archetype };

  // Color: prefer recipe palette primary, otherwise element default.
  const color = visualRecipe.palette?.primary ?? elementColors[concept.element];

  return {
    id: `spell-${nanoid(8)}`,
    name: titleCase(mechanics.name || `${concept.element} ${mechanics.delivery}`),
    prompt,
    reasoning,
    archetype,
    element: concept.element,
    delivery: mechanics.delivery,
    impact: mechanics.impact,
    count,
    damage,
    speed,
    radius: Number(radius.toFixed(2)),
    durationMs: Math.round(durationMs),
    cooldownMs,
    manaCost,
    effects,
    color,
    visualRecipe,
  };
}

/**
 * Legacy single-blob normalizer. Used by the repair-loop fallback when the
 * pipeline cannot produce concept + mechanics separately. Tries to back-fill
 * archetype + visualRecipe from the element + delivery if missing.
 */
export function normalizeLegacySpell(rawInput: unknown, prompt: string, reasoning?: string): GeneratedSpell {
  const raw = rawSpellSchema.parse(rawInput);
  const archetype: ArchetypeKind = raw.archetype ?? guessArchetype(raw);
  return composeSpell({
    prompt,
    reasoning: reasoning ?? raw.reasoning,
    concept: { archetype, element: raw.element, intent_summary: "", scale: "medium" },
    mechanics: {
      name: raw.name,
      delivery: raw.delivery,
      impact: raw.impact,
      count: raw.count,
      damage: raw.damage,
      speed: raw.speed,
      radius: raw.radius,
      durationMs: raw.durationMs,
      effects: raw.effects,
    },
    visualRecipe: raw.visualRecipe,
  });
}

function guessArchetype(raw: RawSpell): ArchetypeKind {
  if (raw.element === "fire" && raw.delivery === "sky") {
    return raw.count > 1 ? "meteor_shower" : "meteor_strike";
  }
  if (raw.element === "lightning") {
    return raw.delivery === "sky" ? "lightning_storm" : "lightning_bolt";
  }
  if (raw.impact === "vortex" && raw.element === "shadow") return "blackhole";
  if (raw.element === "fire" && raw.impact === "vortex") return "fire_tornado";
  if (raw.element === "fire") return "fireball";
  if (raw.element === "ice" && raw.impact === "burst") return "frost_nova";
  if (raw.element === "ice") return "ice_shard";
  if (raw.element === "shadow") return "shadow_orb";
  if (raw.element === "nature") return "nature_thorns";
  if (raw.delivery === "beam") return "arcane_beam";
  return "arcane_orb";
}
