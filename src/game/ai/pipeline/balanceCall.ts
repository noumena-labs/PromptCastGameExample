import type { CogentEngine } from "cogentlm";
import { BALANCE_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { balanceSchema, type SpellBalance, type SpellConcept } from "@/game/spells/spellSchema";

/**
 * Balance call: collapses every numerical balance dial into a single power
 * tier 1..5. The engine then derives mana cost, damage, duration, cooldown,
 * and radius deterministically (see balance.ts).
 *
 * During pre-release this call is allowed to fail loudly. Silent tier-3
 * fallback made it impossible to tell whether the model actually chose a tier.
 */

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary, weighing how mighty a spell ought to be. The CONCEPT is given. Choose ONE integer power tier from 1 to 5.

Tiers:
  1 — tiny utility / flicker / nuisance; low damage, cheap, brief
  2 — minor combat spell; simple bolt, small shield, short hazard
  3 — normal combat spell; reliable pressure, moderate area or damage
  4 — heavy spell; large impact, strong control, multi-hit, costly
  5 — explicit ultimate / cataclysm / world-shaking spell only

Rules of thumb:
  - Choose tier 1 for small/gentle/weak/flicker/spark/single nuisance.
  - Choose tier 2 for ordinary small attacks and modest defense.
  - Choose tier 3 for standard combat spells with no extreme language.
  - Choose tier 4 for storms, walls, large area denial, many projectiles, strong control.
  - Choose tier 5 only for explicit cataclysm, apocalypse, ultimate, annihilation, world-shaking scale.

Examples:
  "a tiny candle spark" => 1
  "a quick ice dart" => 2
  "a reliable fireball" => 3
  "a meteor shower raining over the arena" => 4
  "an apocalyptic sun that erases everything" => 5

Output ONLY a JSON object on its own line. No reasoning, no fences, no commentary.
Required shape: { "powerTier": <integer 1-5> }
Use the selected integer, not the examples.`;

export type BalanceCallResult = {
  balance: SpellBalance;
  rawOutput: string;
};

function buildUserMessage(prompt: string, concept: SpellConcept): string {
  return [
    `Player prompt: ${prompt}`,
    "",
    "CONCEPT:",
    `  name:           ${concept.name}`,
    `  element:        ${concept.element}`,
    `  deliveryFamily: ${concept.deliveryFamily}`,
    `  impact:         ${concept.impact}`,
    `  placement:      ${concept.placement}`,
    `  count:          ${concept.count}`,
    `  effects:        ${concept.effects.join(", ") || "(none)"}`,
    `  intent:         ${concept.intent_summary}`,
    "",
    "Output the balance JSON now. The first character must be {.",
  ].join("\n");
}

export async function runBalanceCall(opts: {
  engine: CogentEngine;
  prompt: string;
  concept: SpellConcept;
  signal?: AbortSignal;
  onToken?: StreamSink;
}): Promise<BalanceCallResult> {
  spellLog.info("balance", "start", { name: opts.concept.name });

  const { buffer } = await runChatCall({
    engine: opts.engine,
    systemPrompt: SYSTEM_PROMPT,
    prompt: buildUserMessage(opts.prompt, opts.concept),
    maxTokens: 256,
    grammar: BALANCE_GRAMMAR,
    signal: opts.signal,
    stage: "balance",
    onToken: (token) => opts.onToken?.(token, "balance"),
  });

  const extraction = extractJson(buffer);
  if (!extraction.ok) {
    spellLog.failure({
      stage: "balance",
      message: "balance extraction failed",
      rawOutput: buffer,
      cause: extraction.reason,
    });
    throw new SpellGenerationError({
      stage: "balance",
      message: `balance JSON extract failed: ${extraction.reason}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  const parsed = balanceSchema.safeParse(extraction.value);
  if (!parsed.success) {
    spellLog.failure({
      stage: "balance",
      message: "balance zod parse failed",
      rawOutput: buffer,
      cause: parsed.error.message,
    });
    throw new SpellGenerationError({
      stage: "balance",
      message: `balance zod parse failed: ${parsed.error.message}`,
      rawOutput: buffer,
      canRepair: true,
    });
  }

  spellLog.info("balance", "ok", { powerTier: parsed.data.powerTier, rawOutput: buffer });
  return { balance: parsed.data, rawOutput: buffer };
}
