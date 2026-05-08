import type { CogentEngine } from "cogentlm";
import { BALANCE_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
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
  let buffer = "";
  try {
    const result = await runChatCall({
      engine: opts.engine,
      systemPrompt: SYSTEM_PROMPT,
      prompt: buildUserMessage(opts.prompt, opts.concept),
      maxTokens: 256,
      grammar: BALANCE_GRAMMAR,
      signal: opts.signal,
      stage: "balance",
      onToken: (token) => opts.onToken?.(token, "balance"),
    });
    buffer = result.buffer;
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    spellLog.warn("balance", "balance call failed; using fallback tier", { cause: (err as Error).message });
    const balance = fallbackBalance(opts.prompt, opts.concept);
    spellLog.info("balance", "ok", { powerTier: balance.powerTier, fallback: true });
    return { balance, rawOutput: buffer };
  }
  const extraction = extractJson(buffer);
  if (!extraction.ok) {
    spellLog.warn("balance", "balance extraction failed; using fallback tier", { cause: extraction.reason, rawOutputLen: buffer.length });
    const balance = fallbackBalance(opts.prompt, opts.concept);
    spellLog.info("balance", "ok", { powerTier: balance.powerTier, fallback: true });
    return { balance, rawOutput: buffer };
  }
  const parsed = balanceSchema.safeParse(extraction.value);
  if (!parsed.success) {
    spellLog.warn("balance", "balance zod parse failed; using fallback tier", { cause: parsed.error.message, rawOutputLen: buffer.length });
    const balance = fallbackBalance(opts.prompt, opts.concept);
    spellLog.info("balance", "ok", { powerTier: balance.powerTier, fallback: true });
    return { balance, rawOutput: buffer };
  }
  spellLog.info("balance", "ok", { powerTier: parsed.data.powerTier });
  return { balance: parsed.data, rawOutput: buffer };
}

function fallbackBalance(prompt: string, concept: SpellConcept): SpellBalance {
  const text = prompt.toLowerCase();
  if (/\b(ultimate|cataclysm|apocalypse|annihilate|world-ending)\b/.test(text)) return { powerTier: 5 };
  if (concept.count >= 5 || concept.modifiers.scale >= 2 || concept.modifiers.intensity >= 2) return { powerTier: 4 };
  if (concept.count >= 3 || concept.modifiers.scale >= 1.4 || concept.modifiers.intensity >= 1.4) return { powerTier: 3 };
  return { powerTier: 2 };
}
