"use client";

import { useEffect, useState } from "react";
import {
  ensureModelLoaded,
  unsubscribeModelProgress,
  type ModelLoadProgress,
} from "@/game/ai/cogentSpellGenerator";

type LoadState =
  | { phase: "loading"; progress: ModelLoadProgress | null }
  | { phase: "ready" }
  | { phase: "error"; message: string };

const PHASE_VERB: Record<ModelLoadProgress["phase"], string> = {
  metadata: "Reading the runes…",
  download: "Drawing the tome from the aether…",
  store: "Sealing the spell-tongue in the vault…",
  load: "Lighting the Sage's candles…",
};

/**
 * Full-screen splash that blocks the game until the LFM2 model is downloaded
 * and resident in OPFS. On second visit the OPFS-cached load is near-instant
 * and the splash flashes briefly before unmounting.
 */
export function ModelLoader({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LoadState>({ phase: "loading", progress: null });

  useEffect(() => {
    let cancelled = false;
    const listener = (progress: ModelLoadProgress) => {
      if (cancelled) return;
      setState({ phase: "loading", progress });
    };

    (async () => {
      try {
        await ensureModelLoaded(listener);
        if (!cancelled) setState({ phase: "ready" });
      } catch (err) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: err instanceof Error ? err.message : "Unknown error loading the Sage.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeModelProgress(listener);
    };
  }, []);

  if (state.phase === "ready") return <>{children}</>;

  if (state.phase === "error") {
    return (
      <div className="modelLoader" role="status" aria-live="polite">
        <div className="modelLoaderRune">
          <div className="modelLoaderRuneInner" />
          <div className="modelLoaderRuneOuter" />
          <div className="modelLoaderSpark" />
        </div>
        <h1 className="modelLoaderTitle">PromptCast</h1>
        <p className="modelLoaderMessage modelLoaderError">The Sage will not stir.</p>
        <p className="modelLoaderDetail">{state.message}</p>
        <p className="modelLoaderDetail">Refresh the page to try again.</p>
      </div>
    );
  }

  const progress = state.progress;
  const phase = progress?.phase ?? "metadata";
  const isIndeterminate = phase === "metadata" || phase === "load";
  // Pin to 100 % during the WASM-init "load" phase per the locked plan.
  const percentRaw = phase === "load" ? 100 : progress?.percent ?? null;
  const percentClamped = percentRaw === null ? 0 : Math.max(0, Math.min(100, percentRaw));
  const verb = PHASE_VERB[phase];

  return (
    <div className="modelLoader" role="status" aria-live="polite">
      <div className="modelLoaderRune">
        <div className="modelLoaderRuneInner" />
        <div className="modelLoaderRuneOuter" />
        <div className="modelLoaderSpark" />
      </div>
      <h1 className="modelLoaderTitle">PromptCast</h1>
      <p className="modelLoaderMessage">{verb}</p>

      <div
        className="modelLoaderBar"
        data-phase={phase}
        data-indeterminate={isIndeterminate ? "true" : "false"}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percentClamped)}
      >
        <div
          className="modelLoaderBarFill"
          style={{ width: `${percentClamped}%` }}
        />
        <div className="modelLoaderBarShimmer" aria-hidden />
      </div>

      <p className="modelLoaderBarLabel">{formatProgressLabel(progress, phase)}</p>

      <p className="modelLoaderDetail">
        Awakening the Sage on first visit. An LLM is used for dynamic spell creation. Cached locally afterwards.
      </p>
    </div>
  );
}

function formatProgressLabel(progress: ModelLoadProgress | null, phase: ModelLoadProgress["phase"]): string {
  if (phase === "metadata" || !progress) return "Consulting the archives…";
  if (phase === "load") return "100% · Igniting WASM cores…";

  const loadedMb = progress.loadedBytes / 1_048_576;
  const totalMb = progress.totalBytes !== null ? progress.totalBytes / 1_048_576 : null;
  const percent = progress.percent ?? null;

  const sizePart =
    totalMb !== null
      ? `${loadedMb.toFixed(1)} / ${totalMb.toFixed(1)} MB`
      : `${loadedMb.toFixed(1)} MB`;

  const percentPart = percent !== null ? ` · ${Math.round(percent)}%` : "";
  const phaseLabel = phase === "store" ? "Storing" : "Downloading";

  return `${phaseLabel} · ${sizePart}${percentPart}`;
}
