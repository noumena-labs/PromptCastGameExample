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
 * Failure here is silent: the caller falls back to tier 3. The tier is the
 * least player-visible knob in the pipeline, so a hiccup must not block the
 * cast. We still log the failure for diagnostics.
 */

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary, weighing how mighty a spell ought to be. The CONCEPT is given. Choose ONE integer power tier from 1 to 5.

Tiers:
  1 — utility / micro flicker (weakest; cheap mana, short cooldown, gentle damage)
  2 — light skirmish spell
  3 — standard combat spell
  4 — heavy spell (significant mana, longer cooldown, large area or damage)
  5 — ultimate / cataclysmic (rare; epic scale)

Rules of thumb:
  - Single-target precise strikes (single bolt, beam): tier 2-4.
  - Multi-projectile volleys / sky storms: tier 3-5 by count and area.
  - Self-cast bursts and shields: tier 2-4.
  - Reserve tier 5 for explicitly cataclysmic, world-shaking, ultimate, or apocalyptic intents.
  - Reserve tier 1 for explicitly small, weak, gentle, or flicker-level intents.

Output ONLY a JSON object on its own line. No reasoning, no fences, no commentary.

{ "powerTier": 3 }`;

export type BalanceCallResult = {
  balance: SpellBalance;
  rawOutput: string;
};

const PREFIX = "</think>";

function buildUserMessage(prompt: string, concept: SpellConcept): string {
  return [
    `Player prompt: ${prompt}`,
    "",
    "CONCEPT:",
    `  name:           ${concept.name}`,
    `  element:        ${concept.element}`,
    `  deliveryFamily: ${concept.deliveryFamily}`,
    `  impact:         ${concept.impact}`,
    `  count:          ${concept.count}`,
    `  effects:        ${concept.effects.join(", ") || "(none)"}`,
    `  intent:         ${concept.intent_summary}`,
    "",
    "Output the balance JSON now.",
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
    maxTokens: 64,
    grammar: BALANCE_GRAMMAR,
    assistantPrefix: PREFIX,
    signal: opts.signal,
    stage: "balance",
    onToken: (token) => opts.onToken?.(token, "balance"),
  });

  const tail = buffer.startsWith(PREFIX) ? buffer.slice(PREFIX.length) : buffer;
  const extraction = extractJson(tail);
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

  spellLog.info("balance", "ok", { powerTier: parsed.data.powerTier });
  return { balance: parsed.data, rawOutput: buffer };
}
