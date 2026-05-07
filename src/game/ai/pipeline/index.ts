import type { CogentEngine } from "cogentlm";
import { runConceptCall } from "@/game/ai/pipeline/conceptCall";
import { runBalanceCall } from "@/game/ai/pipeline/balanceCall";
import { runFormCall, type FormAttempt } from "@/game/ai/pipeline/formCall";
import { runPaletteCall } from "@/game/ai/pipeline/paletteCall";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { composeSpell, type SpellBalance } from "@/game/spells/spellSchema";
import type { GeneratedSpell } from "@/game/types";

/**
 * Pipeline orchestrator.
 *
 * Chains: concept → balance → form → palette → composeSpell. Each call is
 * grammar-constrained so failures are localised. The form call retries up to
 * its internal limit. During pre-release, stage failures surface loudly so we
 * can fix prompts and schemas instead of hiding bad outputs.
 *
 * Token streaming: every stage's tokens flow up to `onProgress` as deltas,
 * coalesced via requestAnimationFrame so React re-renders cap at one per
 * frame. Stage transitions and form retries emit a `segmentStart` marker so
 * the UI can render a header/separator in its transcript.
 */

export type PipelineStage = "concept" | "balance" | "form-cast" | "form-impact" | "palette" | "compose";

export type PipelineProgress = {
  stage: PipelineStage;
  /** "writing" while structured JSON streams, "done" when composed. */
  phase: "writing" | "done";
  /** Reserved for optional explanation text; currently empty for JSON-only calls. */
  reasoning: string;
  /** Newly emitted tokens since the last progress event. */
  tokenDelta: string;
  /** Set on stage start or form retry — UI uses this to insert a header. */
  segmentStart?: { stage: PipelineStage; attempt?: number; retryReason?: string };
  /** Populated only during the form stages; null otherwise. */
  formAttempt?: FormAttempt;
  /** Snapshot of every completed stage's final raw buffer. */
  outputs: Partial<Record<PipelineStage, string>>;
};

export type PipelineResult = {
  spell: GeneratedSpell;
  reasoning: string;
};

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
  const conceptReasoning = "";
  const conceptPhase: PipelineProgress["phase"] = "writing";
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

  const emitSegmentStart = (stage: PipelineStage, attempt?: number, retryReason?: string) => {
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
      phase: "writing",
      reasoning: conceptReasoning,
      tokenDelta: "",
      segmentStart: { stage, attempt, retryReason },
      formAttempt: stage === "form-cast" || stage === "form-impact" ? currentFormAttempt : undefined,
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
      pending += token;
      scheduleFlush();
    },
  });
  outputs.concept = conceptBuffer;
  // Final flush for concept tokens.
  if (pending) flush();

  // ── Balance ──────────────────────────────────────────────────────────────
  currentStage = "balance";
  emitSegmentStart("balance");
  let balance: SpellBalance;
  const balanceResult = await runBalanceCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    signal,
    onToken: (token) => {
      pending += token;
      scheduleFlush();
    },
  });
  balance = balanceResult.balance;
  outputs.balance = balanceResult.rawOutput;
  if (pending) flush();

  // ── Form (cast + impact) ─────────────────────────────────────────────────
  currentStage = "form-cast";
  let lastFormStage: PipelineStage | undefined;
  const formResult = await runFormCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    signal,
    onAttempt: (attempt) => {
      const stageId: PipelineStage = attempt.scene === "cast" ? "form-cast" : "form-impact";
      // Emit a fresh segment header on stage transition or on every retry.
      if (stageId !== lastFormStage || attempt.n > 1) {
        if (pending) flush();
        currentStage = stageId;
        lastFormStage = stageId;
        currentFormAttempt = attempt;
        emitSegmentStart(stageId, attempt.n, attempt.retryReason);
      } else {
        currentStage = stageId;
        currentFormAttempt = attempt;
      }
    },
    onToken: (token) => {
      pending += token;
      scheduleFlush();
    },
  });
  outputs["form-cast"] = formResult.rawOutput.cast;
  outputs["form-impact"] = formResult.rawOutput.impact;
  if (pending) flush();

  // ── Palette ──────────────────────────────────────────────────────────────
  currentStage = "palette";
  currentFormAttempt = undefined;
  emitSegmentStart("palette");
  const paletteResult = await runPaletteCall({
    engine,
    prompt: cleanPrompt,
    concept: conceptResult.concept,
    form: formResult.castForm,
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
      castForm: formResult.castForm,
      impactForm: formResult.impactForm,
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
    placement: spell.placement,
    powerTier: spell.powerTier,
    manaCost: spell.manaCost,
    cooldownMs: spell.cooldownMs,
    impactDurationMs: spell.impactDurationMs,
    formAttempts: formResult.attempts,
  });

  return { spell, reasoning: conceptResult.reasoning };
}
