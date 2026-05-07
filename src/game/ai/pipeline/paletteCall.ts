import type { CogentEngine } from "cogentlm";
import { PALETTE_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import {
  paletteSchema,
  type SpellConcept,
  type SpellForm,
  type SpellPalette,
} from "@/game/spells/spellSchema";

/**
 * Palette call: globally tunes the spell's primary signature color and
 * emissive boost. Per-node colors are already chosen by the form call; this
 * stage only sets the headline color (used for HUD glyph + UI tint) and a
 * multiplier on every node's emissive intensity (which the composer applies
 * before clamping).
 */

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary, finishing the spell with its signature glow. The CONCEPT and FORM are already chosen. Output ONLY a JSON object on its own line. No reasoning, no fences, no commentary.

{ "primary": "#rrggbb", "emissiveBoost": 1.0 }

FIELDS:
- primary: hex color "#rrggbb" — the spell's headline color (HUD glyph, slot tint). Match the element's nature and the player's mood:
    fire → warm reds / oranges
    ice → cyan / pale blue
    lightning → bright yellow / white
    earth → ochre / brown
    arcane → violet / magenta
    shadow → desaturated purple / black-tinted
    nature → green / chartreuse
- emissiveBoost: 0.0..2.0 — multiplier applied to every node's emissive intensity.
    0.5 → muted, smoky, cursed.
    1.0 → as the form intended.
    1.5-2.0 → radiant, divine, lightning-bright.`;

export type PaletteCallResult = {
  palette: SpellPalette;
  rawOutput: string;
};

const PREFIX = "</think>";

function buildUserMessage(prompt: string, concept: SpellConcept, form: SpellForm): string {
  const colorHints = [form.color, ...form.children.map((c) => c.color)].slice(0, 4).join(", ");
  return [
    `Player prompt: ${prompt}`,
    "",
    "CONCEPT:",
    `  name:    ${concept.name}`,
    `  element: ${concept.element}`,
    `  intent:  ${concept.intent_summary}`,
    "",
    "FORM:",
    `  rootShape: ${form.shape}`,
    `  children:  ${form.children.length}`,
    `  hues:      ${colorHints}`,
    "",
    "Output the palette JSON now.",
  ].join("\n");
}

export async function runPaletteCall(opts: {
  engine: CogentEngine;
  prompt: string;
  concept: SpellConcept;
  form: SpellForm;
  signal?: AbortSignal;
  onToken?: StreamSink;
}): Promise<PaletteCallResult> {
  spellLog.info("palette", "start", { name: opts.concept.name });

  const { buffer } = await runChatCall({
    engine: opts.engine,
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildUserMessage(opts.prompt, opts.concept, opts.form),
    maxTokens: 128,
    grammar: PALETTE_GRAMMAR,
    assistantPrefix: PREFIX,
    signal: opts.signal,
    stage: "palette",
    onToken: (token) => opts.onToken?.(token, "palette"),
  });

  const tail = buffer.startsWith(PREFIX) ? buffer.slice(PREFIX.length) : buffer;
  const extraction = extractJson(tail);
  if (!extraction.ok) {
    spellLog.failure({
      stage: "palette",
      message: "palette extraction failed",
      rawOutput: buffer,
      cause: extraction.reason,
    });
    throw new SpellGenerationError({
      stage: "palette",
      message: `palette JSON extract failed: ${extraction.reason}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  const parsed = paletteSchema.safeParse(extraction.value);
  if (!parsed.success) {
    spellLog.failure({
      stage: "palette",
      message: "palette zod parse failed",
      rawOutput: buffer,
      cause: parsed.error.message,
    });
    throw new SpellGenerationError({
      stage: "palette",
      message: `palette zod parse failed: ${parsed.error.message}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  spellLog.info("palette", "ok", {
    primary: parsed.data.primary,
    emissiveBoost: parsed.data.emissiveBoost,
  });
  return { palette: parsed.data, rawOutput: buffer };
}
