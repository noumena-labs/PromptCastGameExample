import type { CogentEngine } from "cogentlm";
import { BALANCE_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { balanceSchema, type SpellBalance, type SpellConcept } from "@/game/spells/spellSchema";

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary, weighing how mighty a modular spell ought to be. Choose ONE integer power tier from 1 to 5.

Tiers:
1 tiny utility / flicker / nuisance
2 minor combat spell
3 normal combat spell
4 heavy spell, large area, strong control, multihit
5 explicit ultimate / cataclysm only

Output ONLY: { "powerTier": <integer 1-5> }`;

export type BalanceCallResult = {
  balance: SpellBalance;
  rawOutput: string;
};

function buildUserMessage(prompt: string, concept: SpellConcept): string {
  return [
    `Player prompt: ${prompt}`,
    "",
    "MODULAR SPEC:",
    `  name: ${concept.name}`,
    `  alignment: ${concept.alignment}`,
    `  deliveryVehicle: ${concept.deliveryVehicle}`,
    `  coreMesh: ${concept.vfx.coreMesh}`,
    `  travel: ${concept.vfx.travel.join(", ") || "none"}`,
    `  impact: ${concept.vfx.impact.join(", ") || "none"}`,
    `  count: ${concept.count}`,
    `  modifiers: scale ${concept.modifiers.scale}, speed ${concept.modifiers.speed}, duration ${concept.modifiers.duration}, intensity ${concept.modifiers.intensity}`,
    `  intent: ${concept.intentSummary}`,
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
    spellLog.failure({ stage: "balance", message: "balance extraction failed", rawOutput: buffer, cause: extraction.reason });
    throw new SpellGenerationError({ stage: "balance", message: `balance JSON extract failed: ${extraction.reason}`, rawOutput: buffer, canRepair: true });
  }
  const parsed = balanceSchema.safeParse(extraction.value);
  if (!parsed.success) {
    spellLog.failure({ stage: "balance", message: "balance zod parse failed", rawOutput: buffer, cause: parsed.error.message });
    throw new SpellGenerationError({ stage: "balance", message: `balance zod parse failed: ${parsed.error.message}`, rawOutput: buffer, canRepair: true });
  }
  spellLog.info("balance", "ok", { powerTier: parsed.data.powerTier });
  return { balance: parsed.data, rawOutput: buffer };
}
