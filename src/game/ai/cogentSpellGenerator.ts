import type { CogentEngine } from "cogentlm";
import { runSpellPipeline, type PipelineProgress, type PipelineStage } from "@/game/ai/pipeline";
import type { FormAttempt } from "@/game/ai/pipeline/formCall";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import type { GeneratedSpell } from "@/game/types";

/**
 * Public entry point for spell generation.
 *
 * This module owns the singletons (engine + model load promise + progress
 * fan-out) and delegates the actual prompt → spell work to the multi-call
 * pipeline in `./pipeline`. The previous single-call implementation lived
 * here; it was retired when the grammar-driven pipeline landed.
 */

/**
 * Local mirror of cogentlm's `ModelLoadProgress` (not re-exported from the
 * barrel). Keep in sync with `cogentlm/dist/types/model-management/model-types.d.ts`.
 */
export type ModelLoadProgress = {
  phase: "metadata" | "download" | "store" | "load";
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  assetName?: string;
};

/**
 * Hard-coded GGUF model. Loaded once via OPFS-cached download and
 * reused for the lifetime of the page. We deliberately pin the model so the
 * Sage's voice is consistent across players in a P2P match. The Instruct
 * variant is better suited to our grammar-constrained JSON pipeline than the
 * Thinking variant, which tends to leak reasoning tokens into structured calls.
 */
export const MODEL_URL = "https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_K_M.gguf?download=true";

let enginePromise: Promise<CogentEngine> | null = null;
let modelLoadPromise: Promise<void> | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Progress fan-out: many UI surfaces want to observe the single in-flight load.
// ─────────────────────────────────────────────────────────────────────────────
type ProgressListener = (progress: ModelLoadProgress) => void;
const progressListeners = new Set<ProgressListener>();
let lastProgress: ModelLoadProgress | null = null;

function broadcastProgress(progress: ModelLoadProgress): void {
  lastProgress = progress;
  for (const listener of progressListeners) listener(progress);
}

/**
 * Streamed progress shape exposed to the UI. The pipeline emits richer
 * `PipelineProgress` events; we narrow them here so the existing
 * PromptOverlay contract (`reasoning`, `phase`) keeps working.
 */
export type SpellGenerationProgress = {
  /** Reserved for optional explanation text; currently empty for JSON-only calls. */
  reasoning: string;
  /** Phase of the streaming response. */
  phase: "writing" | "done";
  /** Pipeline stage emitting this update. */
  stage: PipelineProgress["stage"];
  /** Newly emitted tokens since the last progress event. */
  tokenDelta: string;
  /** Set on stage start or form retry — UI inserts a header/separator. */
  segmentStart?: { stage: PipelineStage; attempt?: number; retryReason?: string };
  /** Populated only during the form stage; absent on other stages. */
  formAttempt?: FormAttempt;
  /** Snapshot of every completed stage's final raw buffer. */
  outputs: Partial<Record<PipelineStage, string>>;
};

export type SpellGenerationResult = {
  spell: GeneratedSpell;
  /** Full reasoning string captured during streaming. */
  reasoning: string;
};

/** Lazy access to the engine. Caller is expected to await `ensureModelLoaded`. */
export async function getCogentEngine(): Promise<CogentEngine> {
  if (!enginePromise) {
    enginePromise = import("cogentlm").then(({ CogentEngine }) => CogentEngine.create());
  }
  return enginePromise;
}

/**
 * Loads (or no-ops if already loaded) the LFM2 model. Subsequent calls return
 * the same in-flight promise so the loader UI can await this safely from many
 * places without re-downloading. Optional `onProgress` listener receives
 * `ModelLoadProgress` events; if a snapshot already exists it is replayed
 * synchronously before this function returns.
 */
export async function ensureModelLoaded(onProgress?: ProgressListener): Promise<void> {
  if (onProgress) {
    progressListeners.add(onProgress);
    if (lastProgress) onProgress(lastProgress);
  }
  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      const engine = await getCogentEngine();
      if (!engine.models.current()) {
        await engine.models.load(MODEL_URL, { onProgress: broadcastProgress });
      }
    })();
  }
  return modelLoadPromise;
}

/** Detach a progress listener previously passed to `ensureModelLoaded`. */
export function unsubscribeModelProgress(listener: ProgressListener): void {
  progressListeners.delete(listener);
}

/**
 * Streams a spell generation through the multi-call pipeline. Resolves with
 * the final balanced spell. Throws `SpellGenerationError` on any failure;
 * the caller is expected to surface diagnostics and offer a Repair retry.
 */
export async function generateSpellFromPrompt(
  prompt: string,
  onProgress?: (progress: SpellGenerationProgress) => void,
  signal?: AbortSignal,
): Promise<SpellGenerationResult> {
  await ensureModelLoaded();
  const engine = await getCogentEngine();

  spellLog.info("concept", "pipeline begin", { promptLen: prompt.trim().length });

  try {
    const { spell, reasoning } = await runSpellPipeline({
      engine,
      prompt,
      signal,
      onProgress: (progress) => {
        onProgress?.({
          reasoning: progress.reasoning,
          phase: progress.phase,
          stage: progress.stage,
          tokenDelta: progress.tokenDelta,
          segmentStart: progress.segmentStart,
          formAttempt: progress.formAttempt,
          outputs: progress.outputs,
        });
      },
    });
    onProgress?.({
      reasoning,
      phase: "done",
      stage: "compose",
      tokenDelta: "",
      outputs: {},
    });
    return { spell, reasoning };
  } catch (err) {
    if (err instanceof SpellGenerationError) {
      throw err;
    }
    // Anything that escapes the pipeline as a non-typed error (abort, runtime
    // crash, etc.) gets wrapped so the UI has a uniform contract.
    spellLog.failure({
      stage: "concept",
      message: "uncaught pipeline error",
      cause: (err as Error)?.message,
    });
    throw new SpellGenerationError({
      stage: "concept",
      message: (err as Error)?.message ?? "unknown error",
      cause: err,
      canRepair: false,
    });
  }
}
