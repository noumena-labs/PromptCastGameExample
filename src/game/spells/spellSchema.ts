import { nanoid } from "nanoid";
import { z } from "zod";
import { clampTier, deriveStats, type PowerTier } from "@/game/spells/balance";
import { getAlignment } from "@/game/spells/modules/alignments";
import { getDeliveryVehicle } from "@/game/spells/modules/deliveryVehicles";
import { normalizeSpellBuildSpec, spellBuildSpecSchema } from "@/game/spells/modules/spellBuildSpec";
import { clampScene } from "@/game/spells/sceneNode";
import { compileVfxPayload } from "@/game/spells/vfx/compileVfxPayload";
import type { GeneratedSpell } from "@/game/types";
import type { SpellBuildSpec } from "@/game/spells/modules/spellIds";
import { applyIntentConstraints, type IntentCorrection } from "@/game/spells/modules/spellIntent";

export const conceptSchema = spellBuildSpecSchema;
export type SpellConcept = z.infer<typeof conceptSchema>;

export const balanceSchema = z.object({
  powerTier: z.coerce.number().int().min(1).max(5),
});
export type SpellBalance = z.infer<typeof balanceSchema>;

export type ComposeInput = {
  prompt: string;
  reasoning?: string;
  intentLabel?: string;
  intentCorrections?: IntentCorrection[];
  concept: SpellConcept;
  balance: SpellBalance;
};

export function composeSpell(input: ComposeInput): GeneratedSpell {
  const spec = normalizeSpellBuildSpec(input.concept as SpellBuildSpec);
  const tier: PowerTier = clampTier(input.balance.powerTier);
  const alignment = getAlignment(spec.alignment);
  const delivery = getDeliveryVehicle(spec.deliveryVehicle);
  const derived = deriveStats(tier, spec.deliveryVehicle, spec.modifiers);
  const impactDurationMs = impactDurationFor(spec, derived.durationMs);
  const compiledScenes = compileVfxPayload(spec);
  const scenes = {
    cast: clampScene(compiledScenes.cast),
    travel: clampScene(compiledScenes.travel),
    impact: clampScene(compiledScenes.impact),
  };

  return {
    id: `spell-${nanoid(8)}`,
    name: spec.name,
    prompt: input.prompt,
    reasoning: input.reasoning,
    intentLabel: input.intentLabel,
    intentCorrections: input.intentCorrections,
    buildSpec: spec,
    alignment: spec.alignment,
    deliveryVehicle: spec.deliveryVehicle,
    powerTier: tier,
    count: spec.count,
    damage: derived.damage,
    speed: derived.speed,
    radius: derived.radius,
    durationMs: derived.durationMs,
    impactDurationMs,
    cooldownMs: derived.cooldownMs,
    manaCost: derived.manaCost,
    statusEffect: alignment.statusEffect,
    statusDurationMs: derived.statusDurationMs,
    statusStrength: derived.statusStrength,
    color: alignment.palette.primary,
    impactShape: impactShapeFor(spec, delivery.impactShape),
    scenes,
  };
}

export const generatedSpellSchema: z.ZodType<GeneratedSpell> = z.custom<GeneratedSpell>((value) => {
  const spell = value as Partial<GeneratedSpell> | null;
  if (!spell || typeof spell !== "object") return false;
  if (!spell.buildSpec) return false;
  if (typeof spell.id !== "string" || typeof spell.name !== "string" || typeof spell.prompt !== "string") return false;
  if (![1, 2, 3, 4, 5].includes(spell.powerTier ?? 0)) return false;
  return spellBuildSpecSchema.safeParse(spell.buildSpec).success;
});

export function validateGeneratedSpell(value: unknown): GeneratedSpell {
  const incoming = value as Partial<GeneratedSpell> | null;
  const parsed = generatedSpellSchema.safeParse(value);
  const spec = spellBuildSpecSchema.safeParse(incoming?.buildSpec);
  if (!incoming || !parsed.success || !spec.success) throw new Error("Invalid generated spell payload");
  if (typeof incoming.id !== "string" || typeof incoming.name !== "string" || typeof incoming.prompt !== "string") {
    throw new Error("Invalid generated spell identity");
  }
  if (![1, 2, 3, 4, 5].includes(incoming.powerTier ?? 0)) {
    throw new Error("Invalid generated spell power tier");
  }
  const reasoning = typeof incoming.reasoning === "string" ? incoming.reasoning : undefined;
  const constrained = applyIntentConstraints(incoming.prompt, spec.data);
  const incomingCorrections = Array.isArray(incoming.intentCorrections) ? incoming.intentCorrections : undefined;
  const compiled = composeSpell({
    prompt: incoming.prompt,
    reasoning,
    intentLabel: constrained.intent.label,
    intentCorrections: constrained.corrections.length > 0 ? constrained.corrections : incomingCorrections,
    concept: constrained.spec,
    balance: { powerTier: incoming.powerTier as 1 | 2 | 3 | 4 | 5 },
  });
  return {
    ...compiled,
    id: incoming.id,
    name: incoming.name,
  };
}

function impactDurationFor(spec: SpellBuildSpec, spellDurationMs: number): number {
  if (spec.deliveryVehicle === "aura_orbit") return spellDurationMs;
  if (spec.vfx.impact.includes("lingering_cloud") || spec.vfx.impact.includes("ground_decal")) {
    return Math.min(spellDurationMs, 2600);
  }
  return 1200;
}

function impactShapeFor(spec: SpellBuildSpec, fallback: GeneratedSpell["impactShape"]): GeneratedSpell["impactShape"] {
  if (spec.deliveryVehicle === "ground_eruption" && spec.vfx.coreMesh === "boulder") return "wall";
  return fallback;
}
