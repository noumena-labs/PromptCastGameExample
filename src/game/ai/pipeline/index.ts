import type { CogentEngine } from "cogentlm";
import { runConceptCall } from "@/game/ai/pipeline/conceptCall";
import { runBalanceCall } from "@/game/ai/pipeline/balanceCall";
import { runFormCall, type FormAttempt } from "@/game/ai/pipeline/formCall";
import { runPaletteCall } from "@/game/ai/pipeline/paletteCall";
import type { StreamSink } from "@/game/ai/pipeline/callRunner";
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
 * Repair semantics: callers wanting a top-level "try again" loop simply
 * re-invoke `runSpellPipeline`. We do NOT auto-feed broken JSON back in —
 * empirically that's worse than a fresh re-roll.
 */

export type PipelineProgress = {
  stage: SpellStage;
  /** Cumulative reasoning text (only populated during the concept stage). */
  reasoning: string;
  /** "thinking" while inside <think>; "writing" once JSON tokens emit. */
  phase: "thinking" | "writing" | "done";
  /** Populated only during the form stage; null on other stages. */
  formAttempt?: FormAttempt;
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

  // ── Concept ──────────────────────────────────────────────────────────────
  let conceptBuffer = "";
  let conceptPhase: PipelineProgress["phase"] = "thinking";
  const conceptSink: StreamSink = (token) => {
    conceptBuffer += token;
    if (conceptPhase === "thinking" && conceptBuffer.includes(THINK_CLOSE)) {
      conceptPhase = "writing";
    }
    const closeIdx = conceptBuffer.indexOf(THINK_CLOSE);
    const reasoning = closeIdx === -1 ? conceptBuffer : conceptBuffer.slice(0, closeIdx);
    onProgress?.({
      stage: "concept",
      reasoning: stripThinkOpen(reasoning),
      phase: conceptPhase,
    });
  };
  const conceptResult = await runConceptCall({
    engine,
    prompt: cleanPrompt,
    signal,
    onToken: conceptSink,
  });

  // ── Balance ──────────────────────────────────────────────────────────────
  // Balance failure is non-fatal; default to tier 3.
  onProgress?.({ stage: "balance", reasoning: conceptResult.reasoning, phase: "writing" });
  let balance: SpellBalance;
  try {
    const result = await runBalanceCall({
      engine,
      prompt: cleanPrompt,
      concept: conceptResult.concept,
      signal,
    });
    balance = result.balance;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    spellLog.warn("balance", "balance call failed; defaulting to tier 3", {
      cause: (err as Error).message,
    });
    balance = { powerTier: 3 };
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  onProgress?.({ stage: "form", reasoning: conceptResult.reasoning, phase: "writing" });
  const formResult = await runFormCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    signal,
    onAttempt: (attempt) => {
      onProgress?.({
        stage: "form",
        reasoning: conceptResult.reasoning,
        phase: "writing",
        formAttempt: attempt,
      });
    },
  });

  // ── Palette ──────────────────────────────────────────────────────────────
  onProgress?.({ stage: "palette", reasoning: conceptResult.reasoning, phase: "writing" });
  const paletteResult = await runPaletteCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    form: formResult.form,
    signal,
  });

  // ── Compose ──────────────────────────────────────────────────────────────
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

  onProgress?.({ stage: "compose", reasoning: conceptResult.reasoning, phase: "done" });
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
