"use client";

import { useEffect, useState } from "react";
import {
  ensureModelLoaded,
  unsubscribeModelProgress,
  type ModelLoadProgress,
} from "@/game/ai/cogentSpellGenerator";
import { useGameStore } from "@/game/state/gameStore";
import { markRuntimeIncompatible } from "@/game/compat/deviceCompat";
import { ShatteredCrystalScene } from "@/components/game/ui/ShatteredCrystalScene";

type LoadState =
  | { phase: "loading"; progress: ModelLoadProgress | null; phaseStartedAt: number }
  | { phase: "ready" }
  | { phase: "demoting"; message: string }
  | { phase: "error"; message: string };

/**
 * How long to linger on the shattered-crystal interstitial after a runtime
 * cogentlm failure before falling through to the Limited-Mode game shell.
 * Long enough for the burst animation to read; short enough that the player
 * isn't stuck staring at a frozen splash.
 */
const DEMOTE_INTERSTITIAL_MS = 1200;

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
  const compat = useGameStore((state) => state.compat);
  // Limited Mode: cogentlm cannot run on this device. Skip the entire model
  // download/load pipeline — the player is restricted to Magic Missile and
  // never reaches an inscription flow that would need the Sage.
  const limited = compat != null && !compat.compatible;

  const [state, setState] = useState<LoadState>({ phase: "loading", progress: null, phaseStartedAt: 0 });
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (limited) return;
    let cancelled = false;
    let currentPhase: ModelLoadProgress["phase"] | null = null;
    let currentPhaseStartedAt = Date.now();
    const listener = (progress: ModelLoadProgress) => {
      if (cancelled) return;
      if (progress.phase !== currentPhase) {
        currentPhase = progress.phase;
        currentPhaseStartedAt = Date.now();
      }
      setState({ phase: "loading", progress, phaseStartedAt: currentPhaseStartedAt });
    };

    (async () => {
      try {
        await ensureModelLoaded(listener);
        if (!cancelled) setState({ phase: "ready" });
      } catch (err) {
        if (cancelled) return;
        // Runtime cogentlm init failure — pre-flight detection said this
        // device looked compatible, but the engine couldn't actually start.
        // Demote to Limited Mode: persist a runtime-failure verdict so the
        // page reload (and future visits) skip the model pipeline entirely,
        // and update the live store so the rest of the UI (HUD capsule,
        // PromptOverlay shattered-crystal panel) reflects it without a
        // refresh. We linger briefly on a shattered-crystal interstitial so
        // the transition reads as in-world rather than a flicker.
        const message = err instanceof Error ? err.message : "Unknown error loading the Sage.";
        try {
          const result = markRuntimeIncompatible(err);
          useGameStore.getState().setCompat(result);
        } catch {
          // If even the demotion bookkeeping throws (e.g. localStorage
          // sealed off), fall back to the legacy error splash below.
          setState({ phase: "error", message });
          return;
        }
        setState({ phase: "demoting", message });
        window.setTimeout(() => {
          if (!cancelled) setState({ phase: "ready" });
        }, DEMOTE_INTERSTITIAL_MS);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeModelProgress(listener);
    };
  }, [limited]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Demotion interstitial: rendered for ~1.2s after a runtime cogentlm
  // init failure. We deliberately check this *before* the `limited` bypass
  // because `markRuntimeIncompatible` flips `compat` in the store, which
  // would otherwise immediately short-circuit to `<>{children}</>` and skip
  // the shattered-crystal beat entirely.
  if (state.phase === "demoting") {
    return (
      <div className="modelLoader" role="status" aria-live="polite">
        <ShatteredCrystalScene />
        <h1 className="modelLoaderTitle">PromptCast</h1>
        <p className="modelLoaderMessage modelLoaderError">The Sage faltered.</p>
        <p className="modelLoaderDetail">
          The Inscription Crystal could not hold. Entering Limited Mode…
        </p>

        <p className="text-[11pt]">
          <i>Refresh this page when ready</i>
        </p>
      </div>
    );
  }

  // Limited Mode bypasses the splash entirely and renders the game shell.
  if (limited) return <>{children}</>;

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
  const phaseElapsedMs = state.phase === "loading" && state.phaseStartedAt > 0 && now > 0 ? now - state.phaseStartedAt : 0;
  const longPhaseHint = getLongPhaseHint(phase, phaseElapsedMs);

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

      {longPhaseHint ? <p className="modelLoaderDetail">{longPhaseHint}</p> : null}

      <p className="modelLoaderDetail">
        Awakening the Sage on first visit. An LLM is used for dynamic spell creation. Cached locally afterwards.
      </p>
    </div>
  );
}

function getLongPhaseHint(phase: ModelLoadProgress["phase"], elapsedMs: number): string | null {
  if (elapsedMs < 30_000) return null;
  if (phase === "store") {
    return "Still sealing the local model cache. If this remains here, open with ?debugCogent=1 and send the browser console diagnostics.";
  }
  if (phase === "load") {
    return "Still lighting the local runtime. If this remains here, open with ?debugCogent=1 and send the browser console diagnostics.";
  }
  return null;
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
