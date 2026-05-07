import type { CogentEngine } from "cogentlm";
import { z } from "zod";
import { VISUAL_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { recipeForArchetype } from "@/game/spells/archetypeDefaults";
import {
  motionKinds,
  type MotionKind,
  type VisualRecipe,
} from "@/game/spells/visualRecipe";
import type { SpellConcept, SpellMechanics } from "@/game/spells/spellSchema";

/**
 * Visual call: chooses palette + motion + emissive intensity.
 *
 * The LLM does NOT compose primitives — those come from
 * `recipeForArchetype(concept.archetype)`. We only let it tune the look.
 * This shrinks the LLM's output surface ~10x and means a malformed visual
 * call still produces a usable, archetype-correct spell.
 */

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary, choosing the palette and motion for a spell whose form is already decided. Output ONLY a JSON object on its own line. No reasoning, no fences, no commentary.

{ "primary": "#rrggbb", "secondary": "#rrggbb", "accent": "#rrggbb", "emissive": 1.6, "motion": "..." }

FIELDS:
- primary, secondary, accent: hex colors (#rrggbb). primary is the dominant glow / core color. secondary tints the periphery. accent is the highlight / spark color. Pick colors that match the element AND the player's described mood (e.g. "cursed" → desaturated greens / purples; "righteous" → gold / white; "rotten" → sickly greens).
- emissive: 0.0-3.0 — how much the spell self-illuminates. Beams and lightning are usually 2.0-2.8; physical projectiles 1.2-1.8; shadows 0.6-1.2.
- motion: fall | rise | spiral | implode | explode | linger | travel
    fall    — descends from above (sky deliveries / meteors)
    rise    — erupts upward (vines, geysers)
    spiral  — orbits (orbs, vortices)
    implode — converges inward (blackhole, gravity)
    explode — radial outward (novas, bursts)
    linger  — hovers / pulses in place (shields, traps)
    travel  — moves forward in a line (most projectiles)

Match the element's nature: fire is warm (#ff…), ice cool (#8a–b0…ff), lightning bright yellow/white, shadow desaturated dark, nature green, arcane purple/violet, earth ochre/brown.`;

const visualPatchSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  emissive: z.coerce.number().finite().min(0).max(3).catch(1.6),
  motion: z.enum(motionKinds).catch("travel" satisfies MotionKind),
});

export type VisualCallResult = {
  visualRecipe: VisualRecipe;
  rawOutput: string;
};

const PREFIX = "</think>";

function buildUserMessage(prompt: string, concept: SpellConcept, mechanics: SpellMechanics): string {
  return [
    `Player prompt: ${prompt}`,
    "",
    `archetype: ${concept.archetype}`,
    `element:   ${concept.element}`,
    `scale:     ${concept.scale}`,
    `delivery:  ${mechanics.delivery}`,
    `impact:    ${mechanics.impact}`,
    `intent:    ${concept.intent_summary}`,
    "",
    "Output the visual JSON now.",
  ].join("\n");
}

export async function runVisualCall(opts: {
  engine: CogentEngine;
  prompt: string;
  concept: SpellConcept;
  mechanics: SpellMechanics;
  signal?: AbortSignal;
  onToken?: StreamSink;
}): Promise<VisualCallResult> {
  spellLog.info("visual", "start", { archetype: opts.concept.archetype });

  const { buffer } = await runChatCall({
    engine: opts.engine,
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildUserMessage(opts.prompt, opts.concept, opts.mechanics),
    maxTokens: 192,
    grammar: VISUAL_GRAMMAR,
    assistantPrefix: PREFIX,
    signal: opts.signal,
    stage: "visual",
    onToken: (token) => opts.onToken?.(token, "visual"),
  });

  const tail = buffer.startsWith(PREFIX) ? buffer.slice(PREFIX.length) : buffer;
  const extraction = extractJson(tail);
  if (!extraction.ok) {
    spellLog.failure({
      stage: "visual",
      message: "visual extraction failed",
      rawOutput: buffer,
      cause: extraction.reason,
    });
    throw new SpellGenerationError({
      stage: "visual",
      message: `visual JSON extract failed: ${extraction.reason}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  const parsed = visualPatchSchema.safeParse(extraction.value);
  if (!parsed.success) {
    spellLog.failure({
      stage: "visual",
      message: "visual zod parse failed",
      rawOutput: buffer,
      cause: parsed.error.message,
    });
    throw new SpellGenerationError({
      stage: "visual",
      message: `visual zod parse failed: ${parsed.error.message}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  // Merge palette + motion into the archetype's curated recipe. Primitives
  // and structural params remain untouched — only the LOOK is patched.
  const base = recipeForArchetype(opts.concept.archetype);
  const visualRecipe: VisualRecipe = {
    ...base,
    palette: {
      primary: parsed.data.primary,
      secondary: parsed.data.secondary,
      accent: parsed.data.accent,
      emissive: parsed.data.emissive,
    },
    motion: parsed.data.motion,
  };

  spellLog.info("visual", "ok", {
    primary: parsed.data.primary,
    motion: parsed.data.motion,
    primitives: visualRecipe.primitives.length,
  });

  return { visualRecipe, rawOutput: buffer };
}
