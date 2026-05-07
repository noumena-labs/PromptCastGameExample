import type { CogentEngine } from "cogentlm";
import { spellLog, type SpellStage } from "@/game/ai/spellLog";

/**
 * Streaming token sink shared by every pipeline call. Lets the UI surface the
 * Sage's structured output in real time across all calls.
 */
export type StreamSink = (token: string, stage: string) => void;

export type PipelineCallOptions = {
  engine: CogentEngine;
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  grammar?: string;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  /**
   * Stage label used for telemetry. When supplied, runChatCall emits a
   * `spellLog.warn(stage, "token budget near limit")` once the streamed
   * buffer crosses ~85% of `maxTokens` (estimated at 4 chars/token), and a
   * follow-up `error` if it exceeds the budget — almost always the cause of
   * a truncated JSON tail.
   */
  stage?: SpellStage;
};

/**
 * Rough char→token estimate. Llama-family tokenizers average ~3.7 chars per
 * token for English JSON; 4 is a safe upper bound for budgeting.
 */
const CHARS_PER_TOKEN = 4;
const WARN_RATIO = 0.85;

export type PipelineCallResult = {
  text: string;
  /** Complete streamed assistant output. */
  buffer: string;
};

/**
 * Issues a grammar-constrained chat completion against cogentlm.
 */
export async function runChatCall(opts: PipelineCallOptions): Promise<PipelineCallResult> {
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.prompt },
  ];

  let buffer = "";
  const warnAtChars = Math.floor(opts.maxTokens * CHARS_PER_TOKEN * WARN_RATIO);
  const budgetChars = opts.maxTokens * CHARS_PER_TOKEN;
  let warned = false;
  const reply = await opts.engine.chat(messages, {
    maxTokens: opts.maxTokens,
    signal: opts.signal,
    grammar: opts.grammar,
    onToken: (token: string) => {
      buffer += token;
      if (opts.stage && !warned && buffer.length >= warnAtChars) {
        warned = true;
        spellLog.warn(opts.stage, "token budget near limit", {
          maxTokens: opts.maxTokens,
          bufferChars: buffer.length,
          ratio: WARN_RATIO,
        });
      }
      opts.onToken?.(token);
    },
  });

  if (opts.stage && buffer.length >= budgetChars) {
    spellLog.error(opts.stage, "token budget exceeded; output likely truncated", {
      maxTokens: opts.maxTokens,
      bufferChars: buffer.length,
    });
  }

  return { text: reply || buffer, buffer };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tolerant JSON extraction. Order:
//   1. Try parsing the entire text directly (works when grammar is enforced).
//   2. Try a fenced ```json block.
//   3. Fall back to the first balanced {...} substring.
//
// Returns the raw object plus the substring we actually parsed (so callers can
// surface it on failure).
// ─────────────────────────────────────────────────────────────────────────────

export type ExtractionResult =
  | { ok: true; value: unknown; source: "direct" | "fenced" | "scan"; substring: string }
  | { ok: false; reason: string; substring?: string };

export function extractJson(text: string): ExtractionResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty buffer" };

  // 1) Direct parse
  try {
    return { ok: true, value: JSON.parse(trimmed), source: "direct", substring: trimmed };
  } catch {
    // fall through
  }

  // 2) Fenced block
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try {
      return { ok: true, value: JSON.parse(fenced), source: "fenced", substring: fenced };
    } catch (err) {
      return { ok: false, reason: `fenced JSON.parse failed: ${(err as Error).message}`, substring: fenced };
    }
  }

  // 3) Balanced brace scan (greedy first match)
  const candidate = scanFirstBalancedObject(trimmed);
  if (!candidate) return { ok: false, reason: "no { … } match" };
  try {
    return { ok: true, value: JSON.parse(candidate), source: "scan", substring: candidate };
  } catch (err) {
    return { ok: false, reason: `scan JSON.parse failed: ${(err as Error).message}`, substring: candidate };
  }
}

function scanFirstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
