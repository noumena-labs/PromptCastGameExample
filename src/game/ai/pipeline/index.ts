import type { CogentEngine } from "cogentlm";
import { runConceptCall } from "@/game/ai/pipeline/conceptCall";
import { runBalanceCall } from "@/game/ai/pipeline/balanceCall";
import { runFormCall, type FormAttempt } from "@/game/ai/pipeline/formCall";
import { runPaletteCall } from "@/game/ai/pipeline/paletteCall";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog, type SpellStage } from "@/game/ai/spellLog";
import { composeSpell, type SpellBalance } from "@/game/spells/spellSchema";
import type { GeneratedSpell } from "@/game/types";

/**
 * Pipeline orchestrator.
 *
 * Chains: concept → balance → form → palette → composeSpell. Each call is
 * grammar-constrained so failures are localised. The form call retries up to
 * 4 times internally; the balance call silently falls back to tier 3 on
 * failure (the player would never notice). All other stages surface a
 * SpellGenerationError on failure.
 *
 * Token streaming: every stage's tokens flow up to `onProgress` as deltas,
 * coalesced via requestAnimationFrame so React re-renders cap at one per
 * frame. Stage transitions and form retries emit a `segmentStart` marker so
 * the UI can render a header/separator in its transcript.
 */

export type PipelineStage = "concept" | "balance" | "form" | "palette" | "compose";

export type PipelineProgress = {
  stage: SpellStage;
  /** "thinking" while inside <think>; "writing" once JSON tokens emit. */
  phase: "thinking" | "writing" | "done";
  /** Cumulative reasoning text (only populated during the concept stage). */
  reasoning: string;
  /** Newly emitted tokens since the last progress event. */
  tokenDelta: string;
  /** Set on stage start or form retry — UI uses this to insert a header. */
  segmentStart?: { stage: PipelineStage; attempt?: number };
  /** Populated only during the form stage; null on other stages. */
  formAttempt?: FormAttempt;
  /** Snapshot of every completed stage's final raw buffer. */
  outputs: Partial<Record<PipelineStage, string>>;
};

export type PipelineResult = {
  spell: GeneratedSpell;
  reasoning: string;
};

const THINK_CLOSE = "</think>";

export async function runSpellPipeline(opts: {
  engine: CogentEngine;
  prompt: string;
  signal?: AbortSignal;
  onProgress?: (progress: PipelineProgress) => void;
}): Promise<PipelineResult> {
  const { engine, prompt, signal, onProgress } = opts;
  const cleanPrompt = prompt.trim().slice(0, 240);
  if (!cleanPrompt) {
    throw new SpellGenerationError({
      stage: "concept",
      message: "empty prompt",
      userMessage: "The Sage hears only silence. Speak your spell.",
      canRepair: false,
    });
  }

  // ── Streaming infrastructure ────────────────────────────────────────────
  const outputs: Partial<Record<PipelineStage, string>> = {};
  let conceptReasoning = "";
  let conceptPhase: PipelineProgress["phase"] = "thinking";
  let currentStage: PipelineStage = "concept";
  let currentFormAttempt: FormAttempt | undefined;
  let pending = "";
  let rafHandle: number | null = null;

  const hasRAF =
    typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";

  const flush = () => {
    rafHandle = null;
    if (!pending && currentStage !== "compose") return;
    const delta = pending;
    pending = "";
    onProgress?.({
      stage: currentStage,
      phase: conceptPhase,
      reasoning: conceptReasoning,
      tokenDelta: delta,
      formAttempt: currentFormAttempt,
      outputs: { ...outputs },
    });
  };

  const scheduleFlush = () => {
    if (rafHandle !== null) return;
    if (hasRAF) {
      rafHandle = window.requestAnimationFrame(flush);
    } else {
      rafHandle = setTimeout(flush, 16) as unknown as number;
    }
  };

  const emitSegmentStart = (stage: PipelineStage, attempt?: number) => {
    // Always flush any pending tokens BEFORE emitting the segment header so
    // the UI gets strict chronological ordering.
    if (pending) flush();
    if (rafHandle !== null) {
      if (hasRAF) window.cancelAnimationFrame(rafHandle);
      else clearTimeout(rafHandle);
      rafHandle = null;
    }
    onProgress?.({
      stage,
      phase: stage === "concept" ? "thinking" : "writing",
      reasoning: conceptReasoning,
      tokenDelta: "",
      segmentStart: { stage, attempt },
      formAttempt: stage === "form" ? currentFormAttempt : undefined,
      outputs: { ...outputs },
    });
  };

  // ── Concept ──────────────────────────────────────────────────────────────
  emitSegmentStart("concept");
  let conceptBuffer = "";
  const conceptResult = await runConceptCall({
    engine,
    prompt: cleanPrompt,
    signal,
    onToken: (token) => {
      conceptBuffer += token;
      if (conceptPhase === "thinking" && conceptBuffer.includes(THINK_CLOSE)) {
        conceptPhase = "writing";
      }
      const closeIdx = conceptBuffer.indexOf(THINK_CLOSE);
      conceptReasoning =
        closeIdx === -1 ? stripThinkOpen(conceptBuffer) : stripThinkOpen(conceptBuffer.slice(0, closeIdx));
      pending += token;
      scheduleFlush();
    },
  });
  outputs.concept = conceptBuffer;
  // Final flush for concept tokens.
  if (pending) flush();

  // ── Balance ──────────────────────────────────────────────────────────────
  // Balance failure is non-fatal; default to tier 3.
  currentStage = "balance";
  emitSegmentStart("balance");
  let balance: SpellBalance;
  let balanceBuffer = "";
  try {
    const result = await runBalanceCall({
      engine,
      prompt: cleanPrompt,
      concept: conceptResult.concept,
      signal,
      onToken: (token) => {
        balanceBuffer += token;
        pending += token;
        scheduleFlush();
      },
    });
    balance = result.balance;
    outputs.balance = result.rawOutput;
    if (pending) flush();
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    spellLog.warn("balance", "balance call failed; defaulting to tier 3", {
      cause: (err as Error).message,
    });
    outputs.balance = balanceBuffer || "(balance call failed; defaulted to tier 3)";
    if (pending) flush();
    balance = { powerTier: 3 };
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  currentStage = "form";
  emitSegmentStart("form", 1);
  const formResult = await runFormCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    signal,
    onAttempt: (attempt) => {
      currentFormAttempt = attempt;
      if (attempt.n > 1) {
        emitSegmentStart("form", attempt.n);
      }
    },
    onToken: (token) => {
      pending += token;
      scheduleFlush();
    },
  });
  outputs.form = formResult.rawOutput;
  if (pending) flush();

  // ── Palette ──────────────────────────────────────────────────────────────
  currentStage = "palette";
  currentFormAttempt = undefined;
  emitSegmentStart("palette");
  const paletteResult = await runPaletteCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    form: formResult.form,
    signal,
    onToken: (token) => {
      pending += token;
      scheduleFlush();
    },
  });
  outputs.palette = paletteResult.rawOutput;
  if (pending) flush();

  // ── Compose ──────────────────────────────────────────────────────────────
  currentStage = "compose";
  emitSegmentStart("compose");
  let spell: GeneratedSpell;
  try {
    spell = composeSpell({
      prompt: cleanPrompt,
      reasoning: conceptResult.reasoning,
      concept: conceptResult.concept,
      balance,
      form: formResult.form,
      palette: paletteResult.palette,
    });
  } catch (err) {
    spellLog.failure({
      stage: "compose",
      message: "compose threw",
      cause: (err as Error).message,
    });
    throw new SpellGenerationError({
      stage: "compose",
      message: `compose failed: ${(err as Error).message}`,
      cause: err,
      canRepair: true,
    });
  }

  onProgress?.({
    stage: "compose",
    phase: "done",
    reasoning: conceptReasoning,
    tokenDelta: "",
    outputs: { ...outputs },
  });
  spellLog.info("compose", "spell ready", {
    name: spell.name,
    deliveryFamily: spell.deliveryFamily,
    impact: spell.impact,
    manaCost: spell.manaCost,
    cooldownMs: spell.cooldownMs,
    formAttempts: formResult.attempts,
  });

  return { spell, reasoning: conceptResult.reasoning };
}

function stripThinkOpen(text: string): string {
  const open = text.indexOf("<think>");
  return (open === -1 ? text : text.slice(open + "<think>".length)).trim();
}
