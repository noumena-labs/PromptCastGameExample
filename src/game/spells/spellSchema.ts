import { nanoid } from "nanoid";
import { z } from "zod";
import { clampTier, deriveStats, type PowerTier } from "@/game/spells/balance";
import { clampScene, sceneSchema, type SpellScene } from "@/game/spells/sceneNode";
import type { GeneratedSpell, SpellElement } from "@/game/types";

export const spellElements = ["fire", "ice", "lightning", "earth", "arcane", "shadow", "nature"] as const;
export const spellDeliveryFamilies = ["projectile", "beam", "sky", "self"] as const;
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

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — concept: name, element, delivery family, impact, intent summary.
// No archetype; the LLM is no longer choosing from a fixed catalog.
// ─────────────────────────────────────────────────────────────────────────────

export const conceptSchema = z.object({
  name: z.string().min(1).max(32).catch("Wild Spell"),
  element: z.enum(spellElements).catch("arcane"),
  deliveryFamily: z.enum(spellDeliveryFamilies).catch("projectile"),
  impact: z.enum(spellImpacts).catch("single"),
  intent_summary: z.string().max(200).catch(""),
  cast_imagery: z.string().max(240).catch(""),
  impact_imagery: z.string().max(240).catch(""),
  effects: z.array(z.enum(spellEffects)).max(3).catch([]),
  count: z.coerce.number().int().min(1).max(10).catch(1),
});
export type SpellConcept = z.infer<typeof conceptSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — balance: a single power tier 1..5. Engine derives every stat.
// ─────────────────────────────────────────────────────────────────────────────

export const balanceSchema = z.object({
  powerTier: z.coerce.number().int().min(1).max(5).catch(3),
});
export type SpellBalance = z.infer<typeof balanceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — form: the SpellScene tree (DSL).
// Defined in sceneNode.ts; re-exported here for pipeline call ergonomics.
// ─────────────────────────────────────────────────────────────────────────────

export const formSchema = sceneSchema;
export type SpellForm = SpellScene;

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4 — palette: globally tunes emissive intensity + provides primary
// color when the form call did not commit one. Everything else stays per-node.
// ─────────────────────────────────────────────────────────────────────────────

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const paletteSchema = z.object({
  primary: hexColor.catch("#ffffff"),
  emissiveBoost: z.coerce.number().min(0).max(2).catch(1),
});
export type SpellPalette = z.infer<typeof paletteSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Composer — assembles a final GeneratedSpell from the four stage outputs.
// ─────────────────────────────────────────────────────────────────────────────

export type ComposeInput = {
  prompt: string;
  reasoning?: string;
  concept: SpellConcept;
  balance: SpellBalance;
  castForm: SpellForm;
  impactForm: SpellForm;
  palette: SpellPalette;
};

const titleCase = (value: string) =>
  value
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .slice(0, 32);

export function composeSpell(input: ComposeInput): GeneratedSpell {
  const { concept, balance, castForm, impactForm, palette, prompt, reasoning } = input;

  const tier: PowerTier = clampTier(balance.powerTier);
  const derived = deriveStats(tier, concept.deliveryFamily);
  const impactDurationMs = impactDurationFor(concept.impact, derived.durationMs);

  const countCap =
    concept.deliveryFamily === "sky" ? 10 : concept.deliveryFamily === "projectile" ? 5 : 1;
  const count = Math.max(1, Math.min(countCap, concept.count));

  const castScene = clampScene(applyEmissiveBoost(castForm, palette.emissiveBoost));
  const impactScene = clampScene(applyEmissiveBoost(impactForm, palette.emissiveBoost));

  const color =
    palette.primary || castForm.color || impactForm.color || elementColors[concept.element];

  return {
    id: `spell-${nanoid(8)}`,
    name: titleCase(concept.name || `${concept.element} ${concept.deliveryFamily}`),
    prompt,
    reasoning,
    element: concept.element,
    deliveryFamily: concept.deliveryFamily,
    impact: concept.impact,
    count,
    damage: derived.damage,
    speed: derived.speed,
    radius: derived.radius,
    durationMs: derived.durationMs,
    impactDurationMs,
    cooldownMs: derived.cooldownMs,
    manaCost: derived.manaCost,
    effects: [...new Set(concept.effects)].slice(0, 3),
    color,
    scenes: { cast: castScene, impact: impactScene },
  };
}

function impactDurationFor(impact: SpellConcept["impact"], spellDurationMs: number): number {
  switch (impact) {
    case "single":
      return 800;
    case "burst":
      return 1000;
    case "none":
      return 0;
    case "aoe":
    case "vortex":
    case "wall":
    case "trap":
      return spellDurationMs;
  }
}

function applyEmissiveBoost(form: SpellForm, boost: number): SpellScene {
  return {
    ...form,
    emissiveIntensity: clamp01x4(form.emissiveIntensity * boost),
    children: form.children.map((child) => ({
      ...child,
      emissiveIntensity: clamp01x4(child.emissiveIntensity * boost),
    })),
  };
}

const clamp01x4 = (v: number) => Math.max(0, Math.min(4, v));
