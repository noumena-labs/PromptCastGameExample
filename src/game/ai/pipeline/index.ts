import type { CogentEngine } from "cogentlm";
import { runConceptCall } from "@/game/ai/pipeline/conceptCall";
import { runMechanicsCall } from "@/game/ai/pipeline/mechanicsCall";
import { runVisualCall } from "@/game/ai/pipeline/visualCall";
import type { StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog, type SpellStage } from "@/game/ai/spellLog";
import { composeSpell } from "@/game/spells/spellSchema";
import type { GeneratedSpell } from "@/game/types";

/**
 * Pipeline orchestrator.
 *
 * Chains: concept → mechanics → visual → composeSpell. Each call is grammar-
 * constrained so failures are localised to a single stage. On stage failure
 * we throw a `SpellGenerationError` carrying the offending raw output — the
 * UI can show diagnostics and offer a Repair retry.
 *
 * Repair semantics: callers wanting a "try again with the cracked output"
 * loop can simply re-invoke `runSpellPipeline` after surfacing the error.
 * The model is non-deterministic; a fresh roll usually fixes it. We do NOT
 * implement auto-correction by feeding the broken JSON back in — empirically
 * that's worse than just re-rolling.
 */

export type PipelineProgress = {
  stage: SpellStage;
  /** Cumulative reasoning text (only populated during the concept stage). */
  reasoning: string;
  /** "thinking" while inside <think>; "writing" once JSON tokens emit. */
  phase: "thinking" | "writing" | "done";
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
    // Switch to "writing" once the model closes its think block.
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
  const conceptResult = await runConceptCall({ engine, prompt: cleanPrompt, signal, onToken: conceptSink });

  // ── Mechanics ────────────────────────────────────────────────────────────
  onProgress?.({ stage: "mechanics", reasoning: conceptResult.reasoning, phase: "writing" });
  const mechanicsResult = await runMechanicsCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    signal,
    onToken: () => {
      // No reasoning to stream — UI keeps showing the concept-stage thoughts.
    },
  });

  // ── Visual ───────────────────────────────────────────────────────────────
  onProgress?.({ stage: "visual", reasoning: conceptResult.reasoning, phase: "writing" });
  const visualResult = await runVisualCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    mechanics: mechanicsResult.mechanics,
    signal,
  });

  // ── Compose ──────────────────────────────────────────────────────────────
  let spell: GeneratedSpell;
  try {
    spell = composeSpell({
      prompt: cleanPrompt,
      reasoning: conceptResult.reasoning,
      concept: conceptResult.concept,
      mechanics: mechanicsResult.mechanics,
      visualRecipe: visualResult.visualRecipe,
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
    archetype: spell.archetype,
    delivery: spell.delivery,
    manaCost: spell.manaCost,
    cooldownMs: spell.cooldownMs,
  });

  return { spell, reasoning: conceptResult.reasoning };
}

function stripThinkOpen(text: string): string {
  const open = text.indexOf("<think>");
  return (open === -1 ? text : text.slice(open + "<think>".length)).trim();
}
