import type { CogentEngine } from "cogentlm";
import { CONCEPT_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { conceptSchema, type SpellConcept } from "@/game/spells/spellSchema";

/**
 * Concept call: free-form thinking + tiny JSON tail. The LLM names the spell,
 * picks element + delivery family + impact, lists status effects, and chooses
 * a count for sky / projectile spells.
 *
 * This is the ONLY call where reasoning runs unconstrained — we want the model
 * to think out loud about the player's intent. The grammar applies only to
 * the post-`</think>` body.
 */

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary. The player describes a spell. In this step you grasp the SHAPE of their intent — not the numbers, but the imagery.

Think briefly inside <think>...</think>, then output a single strict JSON object on its own line:

{ "name": "...", "element": "...", "deliveryFamily": "...", "impact": "...", "intent_summary": "...", "cast_imagery": "...", "impact_imagery": "...", "effects": [], "count": 1 }

FIELDS:
- name: short evocative title, 2-4 words, max 32 chars.
- element: fire | ice | lightning | earth | arcane | shadow | nature
- deliveryFamily — how the spell reaches its target:
    projectile — fired forward from the wizard
    beam       — fast straight line from the wizard
    sky        — falls from above onto the aimed point (meteors, lightning storms, hail, judgment)
    self       — centered on the wizard (nova, shield, aura, vine eruption)
- impact — what happens at the destination:
    single | aoe | vortex | wall | trap | burst | none
- intent_summary: one sentence, ≤180 chars, capturing the player's vision.
- cast_imagery: vivid description of the TRAVEL stage — what the player sees while the spell is in flight (the projectile's body, the beam's core, the falling meteor's shape, the self-cast root). Be concrete: shapes, colors, motion, trailing details. ≤220 chars.
- impact_imagery: vivid description of the IMPACT stage — what ERUPTS at the destination point: pillars of flame, expanding shockwave rings, crackling shards, ground sigils, vortex columns, walls of force. The impact must be DRAMATIC and visibly distinct from the cast. ≤220 chars.
- effects: 0-3 of burn, slow, stun, pull, knockback, shield_break, poison.
- count: number of projectiles or impact points.
    sky:        1-10 (4-8 for showers/storms/rain, 1-3 for single strikes)
    projectile: 1-5  (1 for a bolt; 3-5 for a volley)
    beam, self: always 1

EXAMPLES of cast_imagery vs impact_imagery:
  prompt: "black flame"
    cast_imagery:   "A coal-black sphere wreathed in violet smoke, trailing wisps of dark fire as it streaks forward."
    impact_imagery: "A column of black flame erupts upward 3m tall, ringed by a low circle of guttering shadow-fire and curling smoke."
  prompt: "icy meteor shower"
    cast_imagery:   "Jagged shards of pale-blue ice falling from the sky, leaving frost trails behind."
    impact_imagery: "Each shard shatters into a wide ring of frost; a cracked-ice sigil glows on the ground beneath drifting cold mist."
  prompt: "wall of thorns"
    cast_imagery:   "A green pulse of nature energy travelling forward along the ground, low and fast."
    impact_imagery: "A jagged wall of dark-green thorned vines erupts vertically from the earth, spanning 4m wide, twisting in place."

After </think>, output ONLY the JSON object. No fences, no commentary.`;

export type ConceptCallResult = {
  concept: SpellConcept;
  reasoning: string;
  rawOutput: string;
};

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

function extractReasoning(buffer: string): string {
  const open = buffer.indexOf(THINK_OPEN);
  const close = buffer.indexOf(THINK_CLOSE);
  if (close === -1) return "";
  const start = open === -1 ? 0 : open + THINK_OPEN.length;
  return buffer.slice(start, close).trim();
}

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
    maxTokens: 384,
    grammar: CONCEPT_GRAMMAR,
    signal: opts.signal,
    stage: "concept",
    onToken: (token) => opts.onToken?.(token, "concept"),
  });

  const reasoning = extractReasoning(buffer);
  const closeIdx = buffer.indexOf(THINK_CLOSE);
  const tail = closeIdx === -1 ? buffer : buffer.slice(closeIdx + THINK_CLOSE.length);

  const extraction = extractJson(tail);
  if (!extraction.ok) {
    spellLog.failure({
      stage: "concept",
      message: "concept extraction failed",
      rawOutput: buffer,
      cause: extraction.reason,
    });
    throw new SpellGenerationError({
      stage: "concept",
      message: `concept JSON extract failed: ${extraction.reason}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  const parsed = conceptSchema.safeParse(extraction.value);
  if (!parsed.success) {
    spellLog.failure({
      stage: "concept",
      message: "concept zod parse failed",
      rawOutput: buffer,
      cause: parsed.error.message,
    });
    throw new SpellGenerationError({
      stage: "concept",
      message: `concept zod parse failed: ${parsed.error.message}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  spellLog.info("concept", "ok", {
    name: parsed.data.name,
    element: parsed.data.element,
    deliveryFamily: parsed.data.deliveryFamily,
    impact: parsed.data.impact,
    cast_imagery: parsed.data.cast_imagery,
    impact_imagery: parsed.data.impact_imagery,
  });

  return { concept: parsed.data, reasoning, rawOutput: buffer };
}
