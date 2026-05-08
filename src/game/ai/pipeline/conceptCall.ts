import type { CogentEngine } from "cogentlm";
import { CONCEPT_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { conceptSchema, type SpellConcept } from "@/game/spells/spellSchema";
import { normalizeSpellBuildSpec } from "@/game/spells/modules/spellBuildSpec";

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary. The player describes a fantasy spell. Select ONLY from the engine's modular spell catalogs and output one strict JSON object.

Output shape:
{ "name": "...", "alignment": "...", "deliveryVehicle": "...", "vfx": { "coreMesh": "...", "travel": [], "impact": [], "shaders": { "core": "...", "trail": "...", "impact": "...", "decal": "...", "aura": "..." } }, "modifiers": { "scale": 1, "speed": 1, "duration": 1, "intensity": 1 }, "count": 1, "intentSummary": "...", "castImagery": "...", "impactImagery": "..." }

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
- impact: 1-4 of burst_explosion, lingering_cloud, ground_decal, flash.
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
- scale 0.5..3.0. Larger visible size and gameplay radius.
- speed 0.5..2.0. Ignored by instant/aura/eruption.
- duration 0.5..3.0. Lingering zones and auras.
- intensity 0.5..3.0. Brightness and damage pressure.

Rules:
- Match prompt intent first, but stay inside the catalogs.
- The LLM never writes raw scene JSON or shader code.
- Use strong common fantasy spell tropes: fireball, frost lance, chain lightning, rock spike, shadow orb, holy beam, meteor strike, poison cloud, force shield, healing aura.
- Output ONLY JSON. First character must be {.`;

export type ConceptCallResult = {
  concept: SpellConcept;
  reasoning: string;
  rawOutput: string;
};

export async function runConceptCall(opts: {
  engine: CogentEngine;
  prompt: string;
  signal?: AbortSignal;
  onToken?: StreamSink;
}): Promise<ConceptCallResult> {
  spellLog.info("concept", "start", { promptLen: opts.prompt.length });
  const { buffer } = await runChatCall({
    engine: opts.engine,
    systemPrompt: SYSTEM_PROMPT,
    prompt: opts.prompt,
    maxTokens: 1536,
    grammar: CONCEPT_GRAMMAR,
    signal: opts.signal,
    stage: "concept",
    onToken: (token) => opts.onToken?.(token, "concept"),
  });
  const extraction = extractJson(buffer);
  if (!extraction.ok) {
    spellLog.failure({ stage: "concept", message: "concept extraction failed", rawOutput: buffer, cause: extraction.reason });
    throw new SpellGenerationError({ stage: "concept", message: `concept JSON extract failed: ${extraction.reason}`, rawOutput: buffer, canRepair: true });
  }
  const parsed = conceptSchema.safeParse(extraction.value);
  if (!parsed.success) {
    spellLog.failure({ stage: "concept", message: "concept zod parse failed", rawOutput: buffer, cause: parsed.error.message });
    throw new SpellGenerationError({ stage: "concept", message: `concept zod parse failed: ${parsed.error.message}`, rawOutput: buffer, canRepair: true });
  }
  let concept: SpellConcept;
  try {
    concept = normalizeSpellBuildSpec(parsed.data);
  } catch (err) {
    const message = (err as Error).message;
    spellLog.failure({ stage: "concept", message: "concept compatibility failed", rawOutput: buffer, cause: message });
    throw new SpellGenerationError({ stage: "concept", message: `concept compatibility failed: ${message}`, rawOutput: buffer, canRepair: true });
  }
  spellLog.info("concept", "ok", {
    name: concept.name,
    alignment: concept.alignment,
    deliveryVehicle: concept.deliveryVehicle,
    coreMesh: concept.vfx.coreMesh,
  });
  return { concept, reasoning: "", rawOutput: buffer };
}
