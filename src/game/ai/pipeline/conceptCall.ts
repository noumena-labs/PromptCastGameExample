import type { CogentEngine } from "cogentlm";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { conceptSchema, type SpellConcept } from "@/game/spells/spellSchema";
import { alignmentCatalog } from "@/game/spells/modules/alignments";
import { deliveryVehicleCatalog } from "@/game/spells/modules/deliveryVehicles";
import { defaultSpellModifiers } from "@/game/spells/modules/modifiers";
import { normalizeSpellBuildSpec } from "@/game/spells/modules/spellBuildSpec";
import { applyIntentConstraints, describeIntentForPrompt, inferSpellIntent, type IntentCorrection, type SpellIntent } from "@/game/spells/modules/spellIntent";
import {
  coreVisualMeshIds,
  impactVfxIds,
  spellShaderIdSet,
  travelVfxIds,
  type DeliveryVehicleId,
  type SpellAlignmentId,
  type SpellBuildSpec,
  type SpellModifierSet,
  type SpellShaderId,
  type SpellShaderSelection,
  type SpellVfxPayload,
} from "@/game/spells/modules/spellIds";

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary. The player describes a fantasy spell. Select ONLY from the engine's modular spell catalogs and output one strict JSON object.

Output shape:
{ "name": "...", "alignment": "...", "deliveryVehicle": "...", "vfx": { "coreMesh": "...", "travel": [], "impact": [], "shaders": { "core": "...", "trail": "...", "impact": "...", "decal": "...", "aura": "..." } }, "modifiers": { "scale": 1, "speed": 1, "duration": 1, "intensity": 1 }, "count": 1, "intentSummary": "...", "castImagery": "...", "impactImagery": "..." }

Keep name short: 1-32 display characters. If the player prompt is long, summarize it into a compact spell name.

ALIGNMENTS:
- fire: orange/red/yellow, fast damage, burn. Use flame, ember, smoke, molten shaders.
- water_ice: blue/cyan/white, piercing/splashing, chill. Use frost, ice glass, water ripple, mist shaders.
- lightning: yellow/purple/white, instant chains, stun. Use plasma, storm, chain bolt, electric shaders.
- earth: brown/green, debris and geometry, stagger. Use dust, stone rune, moss, sand shaders.
- dark: black/deep purple, void smoke and decay. Use void, shadow, necrotic, leech shaders.
- light: gold/white halos, radiant effects, blind. Use holy, halo, sunbeam, blinding shaders.
- meteor_cosmic: deep red/obsidian/starfield, delayed heavy area, crush. Use meteor, starfield, gravity, cosmic shaders.

DELIVERY VEHICLES:
- projectile_linear: fireballs, ice lances, shadow bolts. Count 1-5.
- projectile_arcing: boulders, lobbed bombs, heavy meteoric chunks. Count 1-4.
- skyfall: meteors, lightning strikes, celestial beams, hail. Count 1-10.
- instant_hitscan: chain lightning, holy ray, psychic lash. Count 1.
- ground_eruption: rock spikes, geysers, tentacles, sigils under target. Count 1-5.
- aura_orbit: healing rings, shields, body auras, orbiting shards. Count 1.

VFX:
- coreMesh: none | sphere | jagged_crystal | boulder.
- travel: 0-3 of particle_trail, core_glow, swirling_vortex.
- impact: 1-5 of burst_explosion, lingering_cloud, ground_decal, flash, terrain_morph.
- Use terrain_morph when the spell should reshape the ground at the impact site: ice/crystal fields, lava pools, water puddles or geysers, jutting rock chunks, scorched glass cracks, tar pools, craters, glowing rune patches. It is alignment-styled automatically; just include it in the impact array.
- shaders: prefer hand-authored preset IDs that fit the alignment and phase. Never invent shader IDs.

SHADER PRESETS:
- fire: flame_core, ember_shell, heat_haze, molten_crack, ember_trail, smoke_fire_trail, comet_flame_trail, blast_flash, sparks_burst
- water_ice: frost_crystal, ice_glass, water_ripple, mist_shell
- lightning: plasma_arc, storm_core, chain_bolt, electric_noise, blinding_flash
- earth: dust_cloud, stone_rune, moss_glow, sand_burst, toxic_bubble, acid_sizzle, spore_cloud, thorn_glow
- dark: void_swirl, shadow_smoke, necrotic_decay, life_leech_tendril, arcane_shimmer
- light: holy_radiance, halo_ring, sunbeam_core, blinding_flash, forcefield_ripple, mana_glass, ward_barrier
- meteor_cosmic: starfield_core, gravity_lens, meteor_ember, cosmic_impact_ring, shockwave_ring, smoke_plume
- generic: soft_glow, additive_sprite, dissolve_fade. ground_rune is only for decal, impact, or aura phases.

MODIFIERS:
- scale 0.5..3.0. Gameplay AoE radius only; object/effect meshes stay authored size.
- speed 0.5..2.0. Ignored by instant/aura/eruption.
- duration 0.5..3.0. Lingering zones and auras.
- intensity 0.5..3.0. Brightness and damage pressure.

Rules:
- Match prompt intent first, but stay inside the catalogs.
- The intent constraints in the user message are HARD rules. Obey them even if another interpretation sounds plausible.
- Required keys: name, alignment, deliveryVehicle, vfx, modifiers, count, intentSummary, castImagery, impactImagery. Do not omit any key.
- vfx MUST be an object with coreMesh, travel, impact, and shaders. shaders MUST include core, trail, impact, decal, and aura.
- modifiers MUST be numeric JSON numbers only, never strings, words, null, NaN, or Infinity. Use 1 for any neutral/ignored modifier.
- Meteor/comet/asteroid/starfall/falling-star prompts MUST use meteor_cosmic + skyfall. Never use instant_hitscan for meteors.
- Meteor shower/raining rocks prompts MUST use meteor_cosmic + skyfall with multiple impacts.
- Holy ray/sunbeam/laser/beam/lash prompts use instant_hitscan unless the prompt explicitly says it falls from the sky.
- Chain lightning uses lightning + instant_hitscan. Lightning called from the sky uses lightning + skyfall.
- Aura/orbit/shield prompts use aura_orbit. Wall/cage/spikes/sigil-under-target prompts use ground_eruption.
- The LLM never writes raw scene JSON or shader code.
- Canonical examples: "Meteor Strike" = meteor_cosmic + skyfall. "Holy Ray" = light + instant_hitscan. "Lightning Strike from the sky" = lightning + skyfall. "Meteor shower of small bright rocks" = meteor_cosmic + skyfall.
- Use only plain ASCII characters in JSON strings. No em dashes, en dashes, curly quotes, ellipses, or accented letters. Keep intentSummary, castImagery, and impactImagery under 200 characters each. Keep name under 32 characters.
- Output ONLY JSON. First character must be {.`;

export type ConceptCallResult = {
  concept: SpellConcept;
  reasoning: string;
  rawOutput: string;
  intent: SpellIntent;
  corrections: IntentCorrection[];
};

function buildUserMessage(prompt: string, intent: SpellIntent): string {
  return [
    `Player prompt: ${prompt}`,
    "",
    "INTENT CONSTRAINTS:",
    describeIntentForPrompt(intent),
    "",
    "If constraints force an alignment or deliveryVehicle, output exactly that value.",
    "Output the concept JSON now. The first character must be {.",
  ].join("\n");
}

export async function runConceptCall(opts: {
  engine: CogentEngine;
  prompt: string;
  signal?: AbortSignal;
  onToken?: StreamSink;
}): Promise<ConceptCallResult> {
  const intent = inferSpellIntent(opts.prompt);
  spellLog.info("concept", "start", {
    promptLen: opts.prompt.length,
    intent: intent.label,
    allowedAlignments: intent.allowedAlignments,
    allowedDeliveryVehicles: intent.allowedDeliveryVehicles,
  });
  let buffer = "";
  try {
    const result = await runChatCall({
      engine: opts.engine,
      systemPrompt: SYSTEM_PROMPT,
      prompt: buildUserMessage(opts.prompt, intent),
      maxTokens: 1536,
      signal: opts.signal,
      stage: "concept",
      onToken: (token) => opts.onToken?.(token, "concept"),
    });
    buffer = result.buffer;
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    spellLog.warn("concept", "concept call failed; using deterministic fallback", {
      cause: (err as Error).message,
    });
  }
  const extraction = extractJson(buffer);
  if (!extraction.ok) {
    spellLog.warn("concept", "concept extraction failed; using deterministic fallback", {
      cause: extraction.reason,
      rawOutputLen: buffer.length,
    });
  }
  const repaired = repairConceptCandidate(extraction.ok ? extraction.value : {}, opts.prompt, intent);
  const parsed = conceptSchema.safeParse(repaired);
  if (!parsed.success) {
    spellLog.failure({ stage: "concept", message: "concept zod parse failed", rawOutput: buffer, cause: parsed.error.message });
    throw new SpellGenerationError({ stage: "concept", message: `concept zod parse failed: ${parsed.error.message}`, rawOutput: buffer, canRepair: true });
  }
  let concept: SpellConcept;
  const constrained = applyIntentConstraints(opts.prompt, parsed.data);
  try {
    concept = normalizeSpellBuildSpec(constrained.spec);
  } catch (err) {
    const message = (err as Error).message;
    spellLog.failure({ stage: "concept", message: "concept compatibility failed", rawOutput: buffer, cause: message });
    throw new SpellGenerationError({ stage: "concept", message: `concept compatibility failed: ${message}`, rawOutput: buffer, canRepair: true });
  }
  if (constrained.corrections.length > 0) {
    spellLog.warn("concept", "intent corrected concept", {
      intent: constrained.intent.label,
      corrections: constrained.corrections,
    });
  }
  spellLog.info("concept", "ok", {
    name: concept.name,
    alignment: concept.alignment,
    deliveryVehicle: concept.deliveryVehicle,
    coreMesh: concept.vfx.coreMesh,
    intent: constrained.intent.label,
    correctionCount: constrained.corrections.length,
  });
  return { concept, reasoning: "", rawOutput: buffer, intent: constrained.intent, corrections: constrained.corrections };
}

function repairConceptCandidate(value: unknown, prompt: string, intent: SpellIntent): SpellBuildSpec {
  const input = isRecord(value) ? value : {};
  const alignment = pickAlignment(input.alignment, intent);
  const deliveryVehicle = pickDeliveryVehicle(input.deliveryVehicle, intent);
  const alignmentDefaults = alignmentCatalog[alignment];
  const deliveryDefaults = deliveryVehicleCatalog[deliveryVehicle];
  const vfxInput = isRecord(input.vfx) ? input.vfx : {};
  const modifiersInput = isRecord(input.modifiers) ? input.modifiers : {};

  return {
    name: coerceString(input.name, fallbackName(prompt)).slice(0, 96),
    alignment,
    deliveryVehicle,
    vfx: repairVfx(vfxInput, alignmentDefaults.defaultCoreMesh, alignmentDefaults.defaultTravel, alignmentDefaults.defaultImpact, alignmentDefaults.defaultShaders),
    modifiers: repairModifiers(modifiersInput),
    count: clampInteger(input.count, 1, deliveryDefaults.maxCount, deliveryDefaults.defaultCount),
    intentSummary: coerceString(input.intentSummary, intent.reason).slice(0, 200),
    castImagery: coerceString(input.castImagery, `${alignmentDefaults.label} energy gathers around the caster.`).slice(0, 240),
    impactImagery: coerceString(input.impactImagery, `${alignmentDefaults.label} force erupts on impact.`).slice(0, 240),
  };
}

function repairVfx(
  input: Record<string, unknown>,
  defaultCoreMesh: SpellVfxPayload["coreMesh"],
  defaultTravel: SpellVfxPayload["travel"],
  defaultImpact: SpellVfxPayload["impact"],
  defaultShaders: SpellShaderSelection,
): SpellVfxPayload {
  const shadersInput = isRecord(input.shaders) ? input.shaders : {};
  return {
    coreMesh: pickEnum(input.coreMesh, coreVisualMeshIds, defaultCoreMesh),
    travel: pickEnumArray(input.travel, travelVfxIds, defaultTravel, 3),
    impact: pickEnumArray(input.impact, impactVfxIds, defaultImpact, 5),
    shaders: {
      core: pickShader(shadersInput.core, defaultShaders.core),
      trail: pickShader(shadersInput.trail, defaultShaders.trail),
      impact: pickShader(shadersInput.impact, defaultShaders.impact),
      decal: pickShader(shadersInput.decal, defaultShaders.decal),
      aura: pickShader(shadersInput.aura, defaultShaders.aura),
    },
  };
}

function repairModifiers(input: Record<string, unknown>): SpellModifierSet {
  return {
    scale: clampNumber(input.scale, 0.5, 3, defaultSpellModifiers.scale),
    speed: clampNumber(input.speed, 0.5, 2, defaultSpellModifiers.speed),
    duration: clampNumber(input.duration, 0.5, 3, defaultSpellModifiers.duration),
    intensity: clampNumber(input.intensity, 0.5, 3, defaultSpellModifiers.intensity),
  };
}

function pickAlignment(value: unknown, intent: SpellIntent): SpellAlignmentId {
  const raw = typeof value === "string" ? value : undefined;
  if (intent.forcedAlignment) return intent.forcedAlignment;
  if (raw && raw in alignmentCatalog && (!intent.allowedAlignments?.length || intent.allowedAlignments.includes(raw as SpellAlignmentId))) return raw as SpellAlignmentId;
  return intent.allowedAlignments?.[0] ?? "fire";
}

function pickDeliveryVehicle(value: unknown, intent: SpellIntent): DeliveryVehicleId {
  const raw = typeof value === "string" ? value : undefined;
  if (intent.forcedDeliveryVehicle) return intent.forcedDeliveryVehicle;
  if (raw && raw in deliveryVehicleCatalog && (!intent.allowedDeliveryVehicles?.length || intent.allowedDeliveryVehicles.includes(raw as DeliveryVehicleId))) return raw as DeliveryVehicleId;
  return intent.allowedDeliveryVehicles?.[0] ?? "projectile_linear";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function pickEnumArray<T extends string>(value: unknown, allowed: readonly T[], fallback: readonly T[], max: number): T[] {
  if (!Array.isArray(value)) return [...fallback].slice(0, max);
  const picked = value.filter((item): item is T => typeof item === "string" && allowed.includes(item as T));
  return (picked.length > 0 ? picked : [...fallback]).slice(0, max);
}

function pickShader(value: unknown, fallback: SpellShaderId): SpellShaderId {
  return typeof value === "string" && spellShaderIdSet.has(value) ? (value as SpellShaderId) : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(next) ? next : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const next = Math.round(finiteNumber(value, fallback));
  return Math.max(min, Math.min(max, next));
}

function fallbackName(prompt: string): string {
  const name = prompt.replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return (name || "Arcane Spell").slice(0, 32);
}
