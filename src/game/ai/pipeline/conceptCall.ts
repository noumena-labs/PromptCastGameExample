import type { CogentEngine } from "cogentlm";
import { CONCEPT_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { conceptSchema, type SpellConcept } from "@/game/spells/spellSchema";

/**
 * Concept call: free-form thinking + tiny JSON tail. The LLM picks an
 * archetype, an element, a rough scale, and writes a 1-line intent summary.
 *
 * This is the ONLY call where reasoning runs unconstrained — we want the model
 * to think out loud about the player's intent. Grammar is applied to the
 * post-`</think>` body via `assistantPrefix`.
 */

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary. The player describes a spell. Your job in this step is to grasp the SHAPE of their intent — not the numbers.

Think briefly inside <think>...</think>, then output a single strict JSON object with these fields:

{ "archetype": "...", "element": "...", "intent_summary": "...", "scale": "..." }

ARCHETYPE — choose the closest visual archetype:
  meteor_strike     — single fiery rock from sky
  meteor_shower     — multiple rocks rain down
  lightning_bolt    — single lightning strike
  lightning_storm   — multiple lightning strikes
  blackhole         — swirling vortex pulling things in (visual only)
  fireball          — classic forward-flying fire orb
  fire_tornado      — vertical column of swirling flame
  frost_nova        — radial ice burst from caster
  ice_shard         — sharp ice projectile(s)
  shadow_orb        — dark sphere of cursed energy
  nature_thorns     — vines / thorns erupting from ground
  arcane_beam       — straight beam of pure magic
  arcane_orb        — slow heavy orb of arcane power
  shield            — defensive aura around caster
  custom            — none of the above fit cleanly

ELEMENT: fire | ice | lightning | earth | arcane | shadow | nature
SCALE:   small | medium | large | epic   (visual size hint, not damage)
INTENT_SUMMARY: one sentence, max ~140 chars, capturing the player's vision.

After </think>, output ONLY the JSON object on its own line. No fences, no commentary.`;

export type ConceptCallResult = {
  concept: SpellConcept;
  reasoning: string;
  rawOutput: string;
};

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/** Extracts the inner reasoning between <think>...</think> if present. */
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

  // We let reasoning run free; the grammar is loaded for the whole call but
  // GBNF is only consulted once the model starts emitting characters that the
  // grammar accepts. With LFM2.5-Thinking, the chat template wraps reasoning
  // in <think>...</think> automatically — the JSON portion comes after.
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
  // The JSON body lives after </think>, or — if the runtime stripped the
  // wrapper — could be the entire buffer. extractJson() handles both.
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
    archetype: parsed.data.archetype,
    element: parsed.data.element,
    scale: parsed.data.scale,
  });

  return { concept: parsed.data, reasoning, rawOutput: buffer };
}
