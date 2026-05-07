import type { CogentEngine } from "cogentlm";
import { MECHANICS_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { mechanicsSchema, type SpellConcept, type SpellMechanics } from "@/game/spells/spellSchema";

/**
 * Mechanics call: deterministic-ish JSON only. We feed the model the concept
 * (archetype + element + scale + intent) so it doesn't re-decide those, and
 * ask it to fill in numerical balance fields.
 *
 * Strategy: pre-feed `</think>{` as the assistant prefix so the grammar is
 * applied immediately. Reasoning is unnecessary here — the concept call
 * already did the thinking.
 */

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary, balancing a spell that has already been conceived. The CONCEPT is given. Your job is to choose mechanics — delivery, impact, count, damage, speed, radius, duration, effects — that BEST express that concept.

Output ONLY a JSON object on its own line. No reasoning, no fences, no commentary.

{ "name": "...", "delivery": "...", "impact": "...", "count": 1, "damage": 25, "speed": 18, "radius": 2.5, "durationMs": 1800, "effects": [] }

FIELDS:
- name: short evocative name, 2-4 words, max 32 chars
- delivery: projectile | beam | sky | self
    projectile — fired forward from the wizard
    beam       — fast straight line from wizard
    sky        — falls from above onto aimed point (meteors / lightning / hail)
    self       — centered on the wizard (nova / shield / aura)
- impact: single | aoe | vortex | wall | trap | burst | none
- count: number of projectiles / impact points
    sky:        1-10 (use 4-8 for shower/storm/rain, 1-3 for single)
    projectile: 1-5  (use 1 bolt; 3-5 for volley/barrage/missiles)
    beam, self: always 1
- damage:     6-70 raw (engine rebalances by count and area)
- speed:      0-60
- radius:     0.5-9 meters
- durationMs: 450-6500
- effects:    0-2 of burn, slow, stun, pull, knockback, shield_break, poison

NEVER include manaCost, cooldownMs, color, or any other field. The engine sets them.

Match the archetype:
- meteor_*      → delivery sky, fire
- lightning_*   → delivery sky for storms, projectile for bolts
- blackhole     → delivery projectile, impact vortex
- fireball      → delivery projectile, impact single or burst
- fire_tornado  → delivery self or projectile, impact vortex
- frost_nova    → delivery self, impact burst
- ice_shard     → delivery projectile
- shadow_orb    → delivery projectile, impact single or aoe
- nature_thorns → delivery self or projectile, impact aoe or wall
- arcane_beam   → delivery beam
- arcane_orb    → delivery projectile
- shield        → delivery self, impact none`;

export type MechanicsCallResult = {
  mechanics: SpellMechanics;
  rawOutput: string;
};

const PREFIX = "</think>";

function buildUserMessage(prompt: string, concept: SpellConcept): string {
  return [
    `Player prompt: ${prompt}`,
    "",
    "CONCEPT:",
    `  archetype: ${concept.archetype}`,
    `  element:   ${concept.element}`,
    `  scale:     ${concept.scale}`,
    `  intent:    ${concept.intent_summary}`,
    "",
    "Output the mechanics JSON now.",
  ].join("\n");
}

export async function runMechanicsCall(opts: {
  engine: CogentEngine;
  prompt: string;
  concept: SpellConcept;
  signal?: AbortSignal;
  onToken?: StreamSink;
}): Promise<MechanicsCallResult> {
  spellLog.info("mechanics", "start", { archetype: opts.concept.archetype });

  const { buffer } = await runChatCall({
    engine: opts.engine,
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildUserMessage(opts.prompt, opts.concept),
    maxTokens: 256,
    grammar: MECHANICS_GRAMMAR,
    assistantPrefix: PREFIX,
    signal: opts.signal,
    stage: "mechanics",
    onToken: (token) => opts.onToken?.(token, "mechanics"),
  });

  // The buffer starts with the </think> sentinel then the JSON. Strip it
  // before extraction; the opening `{` is emitted by the grammar itself.
  const tail = buffer.startsWith(PREFIX) ? buffer.slice(PREFIX.length) : buffer;
  const extraction = extractJson(tail);
  if (!extraction.ok) {
    spellLog.failure({
      stage: "mechanics",
      message: "mechanics extraction failed",
      rawOutput: buffer,
      cause: extraction.reason,
    });
    throw new SpellGenerationError({
      stage: "mechanics",
      message: `mechanics JSON extract failed: ${extraction.reason}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  const parsed = mechanicsSchema.safeParse(extraction.value);
  if (!parsed.success) {
    spellLog.failure({
      stage: "mechanics",
      message: "mechanics zod parse failed",
      rawOutput: buffer,
      cause: parsed.error.message,
    });
    throw new SpellGenerationError({
      stage: "mechanics",
      message: `mechanics zod parse failed: ${parsed.error.message}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  spellLog.info("mechanics", "ok", {
    delivery: parsed.data.delivery,
    impact: parsed.data.impact,
    count: parsed.data.count,
  });

  return { mechanics: parsed.data, rawOutput: buffer };
}
