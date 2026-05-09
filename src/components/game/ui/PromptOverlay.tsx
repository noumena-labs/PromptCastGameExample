"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, startTransition } from "react";
import { generateSpellFromPrompt } from "@/game/ai/cogentSpellGenerator";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import type { SpellStage } from "@/game/ai/spellLog";
import type { PipelineStage } from "@/game/ai/pipeline";
import { useGameStore } from "@/game/state/gameStore";
import { SANCTUARY_DURATION_MS } from "@/game/config/gameConfig";
import type { GeneratedSpell } from "@/game/types";
import type { SceneLeaf, SpellScene } from "@/game/spells/sceneNode";
import { getAlignment } from "@/game/spells/modules/alignments";
import { getDeliveryVehicle } from "@/game/spells/modules/deliveryVehicles";
import { ShatteredCrystalScene } from "@/components/game/ui/ShatteredCrystalScene";

const examplePrompts = [
  "A roaring fireball that arcs toward the enemy as if thrown",
  "A jagged lightning bolt that strikes the target instantly",
  "A spinning ring of three icy shards that orbit me",
  "A meteor of red-hot rock that crashes down from the sky",
  "A wave of stone spikes erupting from the ground in a line",
  "A golden sunbeam that lances forward in a straight line",
  "A shadowy aura of decay that clings to me and rots nearby foes",
  "A halo of radiant light that bursts outward in all directions",
];

const slotKeys = ["1", "2", "3", "4"];
// Display labels — Roman numerals look better on runestones; the actual
// keybindings remain Digit1–Digit4 in `LocalWizard.tsx`.
const slotRomans = ["I", "II", "III", "IV"];
const SHATTER_VFX_MS = 800;
const TIMER_TICK_MS = 250;

const PIPELINE_STAGES = [
  "concept",
  "balance",
  "compose",
] as const;
type StageStatus = "pending" | "active" | "done";
type StageProgress = Record<PipelineStage, StageStatus>;

const STAGE_LABEL: Record<PipelineStage, string> = {
  concept: "Concept",
  balance: "Balance",
  compose: "Compose",
};

/**
 * Friendly label lookup that covers every `SpellStage` value (broader than
 * `PipelineStage`). Used in the error block where the stage may be `load`,
 * `validate`, or `repair`. Falls back to the raw string if a future stage is
 * added without an entry here.
 */
const STAGE_FRIENDLY_LABEL: Record<SpellStage, string> = {
  load: "Awakening the Sage",
  concept: "Concept",
  balance: "Balance",
  compose: "Compose",
  validate: "Validation",
  repair: "Repair",
};

function friendlyStageLabel(stage: SpellStage): string {
  return STAGE_FRIENDLY_LABEL[stage] ?? String(stage);
}

function makeInitialStages(): StageProgress {
  return {
    concept: "active",
    balance: "pending",
    compose: "pending",
  };
}

function advanceStages(prev: StageProgress, nextStage: PipelineStage): StageProgress {
  const next = { ...prev };
  let crossed = false;
  for (const s of PIPELINE_STAGES) {
    if (s === nextStage) {
      next[s] = "active";
      crossed = true;
    } else if (!crossed) {
      next[s] = "done";
    } else {
      next[s] = "pending";
    }
  }
  return next;
}

// ─── Transcript model ────────────────────────────────────────────────────────

type TranscriptSegment =
  | { kind: "header"; stage: PipelineStage; attempt?: number; retryReason?: string; key: number }
  | { kind: "tokens"; stage: PipelineStage; attempt: number; text: string; key: number };

type ErrorDetails = {
  message: string;
  stage: SpellStage;
  rawOutput?: string;
  canRepair: boolean;
  technical?: string;
};

type PreviewMeta = {
  elapsedMs: number;
  outputs: Partial<Record<PipelineStage, string>>;
};

type Phase =
  | { kind: "compose" }
  | {
      kind: "thinking";
      startedAt: number;
      currentStage: PipelineStage;
      stages: StageProgress;
      transcript: TranscriptSegment[];
      outputs: Partial<Record<PipelineStage, string>>;
      reasoning: string;
    }
  | {
      kind: "previewing";
      spell: GeneratedSpell;
      reasoning: string;
      meta: PreviewMeta;
    }
  | { kind: "bound"; spell: GeneratedSpell }
  | { kind: "error"; details: ErrorDetails; lastPrompt: string }
  | { kind: "shattering" };

export function PromptOverlay() {
  const promptOpen = useGameStore((state) => state.promptOpen);
  const sanctuaryEndsAt = useGameStore((state) => state.sanctuaryEndsAt);
  const sanctuaryPausedRemainingMs = useGameStore((state) => state.sanctuaryPausedRemainingMs);
  const selectedSlot = useGameStore((state) => state.selectedSlot);
  const setSelectedSlot = useGameStore((state) => state.setSelectedSlot);
  const saveGeneratedSpell = useGameStore((state) => state.saveGeneratedSpell);
  const pauseSanctuaryTimer = useGameStore((state) => state.pauseSanctuaryTimer);
  const resumeSanctuaryTimer = useGameStore((state) => state.resumeSanctuaryTimer);
  const exitSanctuary = useGameStore((state) => state.exitSanctuary);
  const compat = useGameStore((state) => state.compat);
  const limited = compat != null && !compat.compatible;

  const [prompt, setPrompt] = useState(examplePrompts[0]);
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [now, setNow] = useState(() => Date.now());
  const [thinkingElapsedMs, setThinkingElapsedMs] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [showPreviewDetails, setShowPreviewDetails] = useState(false);

  const shatterTimer = useRef<number | null>(null);
  const composeTickRef = useRef<number | null>(null);
  const thinkingTickRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const segmentKeyRef = useRef(0);

  const clearComposeTick = useCallback(() => {
    if (composeTickRef.current !== null) {
      window.clearInterval(composeTickRef.current);
      composeTickRef.current = null;
    }
  }, []);

  const clearThinkingTick = useCallback(() => {
    if (thinkingTickRef.current !== null) {
      window.clearInterval(thinkingTickRef.current);
      thinkingTickRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    if (shatterTimer.current !== null) {
      window.clearTimeout(shatterTimer.current);
      shatterTimer.current = null;
    }
    clearComposeTick();
    clearThinkingTick();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [clearComposeTick, clearThinkingTick]);

  useEffect(() => {
    if (!promptOpen) {
      clearAllTimers();
      startTransition(() => {
        setPhase({ kind: "compose" });
        setThinkingElapsedMs(0);
        setShowPreviewDetails(false);
      });
    }
  }, [promptOpen, clearAllTimers]);

  useEffect(() => {
    if (!promptOpen) return;
    if (phase.kind === "compose") {
      resumeSanctuaryTimer();
    } else if (
      phase.kind === "thinking" ||
      phase.kind === "previewing" ||
      phase.kind === "bound" ||
      phase.kind === "error"
    ) {
      pauseSanctuaryTimer();
    }
  }, [promptOpen, phase.kind, pauseSanctuaryTimer, resumeSanctuaryTimer]);

  useEffect(() => {
    if (!promptOpen) return;
    if (phase.kind !== "compose") {
      clearComposeTick();
      return;
    }
    window.setTimeout(() => setNow(Date.now()), 0);
    composeTickRef.current = window.setInterval(() => setNow(Date.now()), TIMER_TICK_MS);
    return () => clearComposeTick();
  }, [promptOpen, phase.kind, clearComposeTick]);

  useEffect(() => {
    if (phase.kind !== "thinking") {
      clearThinkingTick();
      return;
    }
    const startedAt = phase.startedAt;
    window.setTimeout(() => setThinkingElapsedMs(Date.now() - startedAt), 0);
    thinkingTickRef.current = window.setInterval(() => {
      setThinkingElapsedMs(Date.now() - startedAt);
    }, TIMER_TICK_MS);
    return () => clearThinkingTick();
  }, [phase, clearThinkingTick]);

  const shieldRemainingMs =
    sanctuaryEndsAt !== null
      ? Math.max(0, sanctuaryEndsAt - now)
      : sanctuaryPausedRemainingMs ?? SANCTUARY_DURATION_MS;
  const shieldDecay = Math.max(0, Math.min(1, 1 - shieldRemainingMs / SANCTUARY_DURATION_MS));

  useEffect(() => {
    if (!promptOpen) return;
    if (phase.kind !== "compose") return;
    if (sanctuaryEndsAt === null) return;
    if (shieldRemainingMs > 0) return;

    clearComposeTick();
    startTransition(() => setPhase({ kind: "shattering" }));
    shatterTimer.current = window.setTimeout(() => {
      shatterTimer.current = null;
      exitSanctuary();
    }, SHATTER_VFX_MS);
  }, [promptOpen, phase.kind, sanctuaryEndsAt, shieldRemainingMs, exitSanctuary, clearComposeTick]);

  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  if (!promptOpen) return null;

  // Limited Mode: cogentlm cannot run on this device. The Sanctuary still
  // opens (so the player can read the lore and feel the world's response),
  // but the Inscription Crystal is depicted as shattered — no compose form,
  // no Sage, no spell binding. The only way out is "Leave Sanctuary".
  if (limited) {
    return (
      <div className="runeOverlay">
        <div
          className="runeCard"
          role="dialog"
          aria-modal="true"
          aria-label="Shattered Inscription Crystal"
        >
          <button type="button" className="runeCardClose" onClick={exitSanctuary} aria-label="Close Sanctuary">
            ×
          </button>

          <div className="runeCardHeader">
            <span className="runeCardEyebrow">Sanctuary</span>
            <h1 className="runeCardTitle">A Shattered Crystal</h1>
          </div>

          <div className="runeCardCrackOverlay" aria-hidden />

          <div className="runeCardBody shatteredCrystalBody">
            <ShatteredCrystalScene />
            <p className="shatteredCrystalProse">
              The Inscription Crystal lies sundered upon its plinth. Threads of
              gold-leaf script smoulder where the Sage&rsquo;s voice once
              gathered, and the runes refuse to take an edge.
            </p>
            <p className="shatteredCrystalProse">
              No new spells may be bound here. Wander the meadow with what you
              already wield &mdash; your Magic Missile remains true.
            </p>
            <p className="shatteredCrystalAside">
              The local Sage cannot be summoned on this device.
            </p>
            <div className="shatteredCrystalActions">
              <button type="button" className="runeCardDismiss" onClick={exitSanctuary}>
                Leave Sanctuary
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const runChat = async (chatPrompt: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    segmentKeyRef.current = 0;
    setPhase({
      kind: "thinking",
      startedAt,
      currentStage: "concept",
      stages: makeInitialStages(),
      transcript: [],
      outputs: {},
      reasoning: "",
    });
    setShowDetails(false);
    setShowPreviewDetails(false);

    try {
      const result = await generateSpellFromPrompt(
        chatPrompt,
        (progress) => {
          setPhase((current) => {
            if (current.kind !== "thinking") return current;

            const pipelineStage = progress.stage;
            const stages =
              current.currentStage !== pipelineStage
                ? advanceStages(current.stages, pipelineStage)
                : current.stages;

            let transcript = current.transcript;
            if (progress.segmentStart) {
              const k = ++segmentKeyRef.current;
              transcript = [
                ...transcript,
                {
                  kind: "header",
                  stage: progress.segmentStart.stage,
                  attempt: progress.segmentStart.attempt,
                  retryReason: progress.segmentStart.retryReason,
                  key: k,
                },
              ];
            }
            if (progress.tokenDelta) {
              const attempt = 1;
              const last = transcript[transcript.length - 1];
              if (
                last &&
                last.kind === "tokens" &&
                last.stage === pipelineStage &&
                last.attempt === attempt
              ) {
                const updated: TranscriptSegment = {
                  ...last,
                  text: last.text + progress.tokenDelta,
                };
                transcript = [...transcript.slice(0, -1), updated];
              } else {
                const k = ++segmentKeyRef.current;
                transcript = [
                  ...transcript,
                  {
                    kind: "tokens",
                    stage: pipelineStage,
                    attempt,
                    text: progress.tokenDelta,
                    key: k,
                  },
                ];
              }
            }

            return {
              ...current,
              currentStage: pipelineStage,
              stages,
              transcript,
              outputs: progress.outputs,
              reasoning: progress.reasoning || current.reasoning,
            };
          });
        },
        controller.signal,
      );

      if (controller.signal.aborted) return;
      abortRef.current = null;

      const spell = result.spell;
      const reasoning = spell.reasoning ?? result.reasoning ?? "";

      setPhase((current) => {
        const outputs =
          current.kind === "thinking" ? current.outputs : {};
        return {
          kind: "previewing",
          spell,
          reasoning,
          meta: {
            elapsedMs: Date.now() - startedAt,
            outputs,
          },
        };
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      abortRef.current = null;

      const details: ErrorDetails =
        err instanceof SpellGenerationError
          ? {
              message: err.userMessage,
              stage: err.stage,
              rawOutput: err.rawOutput,
              canRepair: err.canRepair,
              technical: err.message,
            }
          : {
              message: err instanceof Error ? err.message : "The Sage's voice falters.",
              stage: "concept",
              canRepair: false,
              technical: err instanceof Error ? err.message : String(err),
            };

      setPhase({
        kind: "error",
        details,
        lastPrompt: chatPrompt,
      });
    }
  };

  const handleInscribe = (event: FormEvent) => {
    event.preventDefault();
    if (phase.kind !== "compose") return;
    pauseSanctuaryTimer();
    clearComposeTick();
    void runChat(prompt);
  };

  const handleRetry = () => {
    if (phase.kind !== "error") return;
    void runChat(phase.lastPrompt);
  };

  const handleRepair = () => {
    if (phase.kind !== "error") return;
    void runChat(phase.lastPrompt);
  };

  const handleBackToCompose = () => {
    if (phase.kind !== "error") return;
    setPhase({ kind: "compose" });
  };

  /**
   * Cancel the in-flight chat request and return to compose. Aborting the
   * controller short-circuits both the streaming progress callback and the
   * await on `generateSpellFromPrompt`, so we explicitly reset phase here
   * rather than waiting for the rejected promise to resolve.
   */
  const handleCancelThinking = () => {
    if (phase.kind !== "thinking") return;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    clearThinkingTick();
    setPhase({ kind: "compose" });
  };

  /**
   * "Inscribe Another" — return to compose without leaving the Sanctuary, so
   * the wizard can bind a second spell within the same shield window.
   */
  const handleInscribeAnother = () => {
    if (phase.kind !== "bound") return;
    setPrompt(examplePrompts[0]);
    setPhase({ kind: "compose" });
  };

  /**
   * Apply an example prompt, but if the textarea already contains user-typed
   * content that differs from both the current example and the new one, ask
   * the wizard to confirm the overwrite first.
   */
  const applyExamplePrompt = (example: string) => {
    const current = prompt.trim();
    const isExample = examplePrompts.includes(current);
    if (current.length > 0 && !isExample && current !== example) {
      const ok = window.confirm("Replace your current prompt with this example?");
      if (!ok) return;
    }
    setPrompt(example);
  };

  const handleBind = () => {
    if (phase.kind !== "previewing") return;
    saveGeneratedSpell(phase.spell);
    setPhase({ kind: "bound", spell: phase.spell });
  };

  const close = () => {
    clearAllTimers();
    exitSanctuary();
  };

  const canDismiss =
    phase.kind === "compose" ||
    phase.kind === "error" ||
    phase.kind === "bound" ||
    phase.kind === "previewing";
  const composing = phase.kind === "compose";

  const cardClassName =
    phase.kind === "shattering" ? "runeCard runeCardShatter" : "runeCard";

  return (
    <div className="runeOverlay">
      <div
        className={cardClassName}
        role="dialog"
        aria-modal="true"
        aria-label="Inscribe a spell"
        data-thinking={phase.kind === "thinking" ? "true" : "false"}
        style={{ "--shieldDecay": shieldDecay.toFixed(3) } as React.CSSProperties}
      >
        {canDismiss ? (
          <button type="button" className="runeCardClose" onClick={close} aria-label="Close Sanctuary">
            ×
          </button>
        ) : null}

        <div className="runeCardHeader">
          <span className="runeCardEyebrow">
            {phase.kind === "bound" || phase.kind === "previewing"
              ? `Sanctuary · Runestone ${slotRomans[selectedSlot]}`
              : "Sanctuary"}
          </span>
          <h1 className="runeCardTitle">
            {phase.kind === "bound"
              ? `Bound: ${phase.spell.name}`
              : phase.kind === "previewing"
                ? phase.spell.name
                : phase.kind === "error"
                  ? "The Sage Stumbles"
                  : phase.kind === "shattering"
                    ? "The Shield Shatters"
                    : "Inscribe a Spell"}
          </h1>
          {composing ? (
            <ShieldTimer remainingMs={shieldRemainingMs} decay={shieldDecay} />
          ) : phase.kind === "thinking" || phase.kind === "previewing" || phase.kind === "bound" || phase.kind === "error" ? (
            <PausedShieldIndicator remainingMs={shieldRemainingMs} />
          ) : null}
        </div>

        <div className="runeCardCrackOverlay" aria-hidden />

        {composing ? (
          <form onSubmit={handleInscribe} className="runeCardBody">
            <label htmlFor="spellPrompt">Whisper your intent</label>
            <textarea
              id="spellPrompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={240}
              autoFocus
              rows={3}
            />

            <div className="runeCardExamples">
              {examplePrompts.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => applyExamplePrompt(example)}
                >
                  &ldquo;{example}&rdquo;
                </button>
              ))}
            </div>

            <button
              type="submit"
              className="runeCardInscribe"
              disabled={prompt.trim().length < 3}
            >
              Inscribe
            </button>
          </form>
        ) : null}

        {phase.kind === "thinking" ? (
          <div className="runeCardBody">
            <StageRail
              stages={phase.stages}
              elapsedMs={thinkingElapsedMs}
            />
            <SageStream transcript={phase.transcript} />
            <div className="runeCardErrorActions">
              <button
                type="button"
                className="runeCardDismiss"
                onClick={handleCancelThinking}
              >
                Forsake
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "previewing" ? (
          <div className="runeCardBody">
            {phase.reasoning ? (
              <div className="runeCardReasoning">
                <div className="runeCardReasoningLabel">Sage&rsquo;s Reasoning</div>
                <div className="runeCardReasoningText">{phase.reasoning}</div>
              </div>
            ) : null}
            <SpellPreviewCard spell={phase.spell} />

            <button
              type="button"
              className="runeCardErrorDetailsToggle"
              onClick={() => setShowPreviewDetails((v) => !v)}
            >
              {showPreviewDetails ? "Furl the codex" : "Unfurl the codex"}
            </button>
            {showPreviewDetails ? (
              <SpellDebugPanel spell={phase.spell} meta={phase.meta} />
            ) : null}

            <div className="runeCardBindBlock">
              <div className="runeCardBindLabel">Choose a Runestone</div>
              <div className="runeCardSlotPicker" aria-label="Spell slot">
                {[0, 1, 2, 3].map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className={slot === selectedSlot ? "selected" : ""}
                    onClick={() => setSelectedSlot(slot)}
                  >
                    {slotRomans[slot]}
                  </button>
                ))}
              </div>
              <button type="button" className="runeCardInscribe" onClick={handleBind}>
                Bind to Runestone {slotRomans[selectedSlot]}
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "bound" ? (
          <div className="runeCardBody">
            <SpellPreviewCard spell={phase.spell} />
            <div className="runeCardBoundHint">
              Bound to runestone {slotRomans[selectedSlot]}. Press {slotKeys[selectedSlot]} on the
              keyboard to cast.
            </div>
            <div className="runeCardErrorActions">
              <button type="button" className="runeCardInscribe" onClick={handleInscribeAnother}>
                Inscribe Another
              </button>
              <button type="button" className="runeCardDismiss" onClick={close}>
                Leave Sanctuary
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "error" ? (
          <div className="runeCardBody">
            <div className="runeCardError">
              <div className="runeCardErrorMessage">{phase.details.message}</div>
              <div className="runeCardErrorStage">Stage: {friendlyStageLabel(phase.details.stage)}</div>
              {phase.details.technical || phase.details.rawOutput ? (
                <button
                  type="button"
                  className="runeCardErrorDetailsToggle"
                  onClick={() => setShowDetails((v) => !v)}
                >
                  {showDetails ? "Furl the codex" : "Unfurl the codex"}
                </button>
              ) : null}
              {showDetails ? (
                <div className="runeCardErrorDetails">
                  {phase.details.technical ? (
                    <div className="runeCardErrorTechnical">
                      <strong>Technical:</strong> {phase.details.technical}
                    </div>
                  ) : null}
                  {phase.details.rawOutput ? (
                    <pre className="runeCardErrorRaw">{phase.details.rawOutput}</pre>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="runeCardErrorActions">
              {phase.details.canRepair ? (
                <button type="button" className="runeCardInscribe" onClick={handleRepair}>
                  Repair
                </button>
              ) : null}
              <button type="button" className="runeCardInscribe" onClick={handleRetry}>
                Retry
              </button>
              <button type="button" className="runeCardDismiss" onClick={handleBackToCompose}>
                Re-compose
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "shattering" ? (
          <div className="runeCardBody">
            <div className="runeCardShatterMessage">
              Your aura shield could not hold. The Sanctuary collapses…
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ShieldTimer({ remainingMs, decay }: { remainingMs: number; decay: number }) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  const stateAttr = decay > 0.75 ? "critical" : decay > 0.5 ? "warning" : "calm";
  return (
    <div className="runeCardTimer" data-state={stateAttr} aria-live="polite">
      <span className="runeCardTimerLabel">Aura Shield</span>
      <span className="runeCardTimerValue">
        {mm}:{ss.toString().padStart(2, "0")}
      </span>
    </div>
  );
}

/**
 * Displayed during thinking/previewing/bound/error phases when the sanctuary
 * timer is paused. Clarifies to the wizard that the shield is not draining
 * while the Sage works (or while reviewing a spell). Mirrors `ShieldTimer`'s
 * shape so the header doesn't reflow when phases change.
 */
function PausedShieldIndicator({ remainingMs }: { remainingMs: number }) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return (
    <div className="runeCardTimer" data-state="paused" aria-live="polite">
      <span className="runeCardTimerLabel">Shield Paused</span>
      <span className="runeCardTimerValue">
        {mm}:{ss.toString().padStart(2, "0")}
      </span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function StageRail({
  stages,
  elapsedMs,
}: {
  stages: StageProgress;
  elapsedMs: number;
}) {
  return (
    <div className="runeCardStageBlock">
      <ol className="runeCardStageRail" aria-label="Spell generation pipeline">
        {PIPELINE_STAGES.map((stage, i) => {
          const status = stages[stage];
          return (
            <li
              key={stage}
              className="runeCardStagePill"
              data-status={status}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="runeCardStagePillIndex">{i + 1}</span>
              <span className="runeCardStagePillLabel">{STAGE_LABEL[stage]}</span>
            </li>
          );
        })}
      </ol>
      <div className="runeCardStageElapsed">
        <span className="runeCardThinkingDots" aria-hidden>
          <span /><span /><span />
        </span>
        <span className="runeCardThinkingElapsed">{formatElapsed(elapsedMs)}</span>
      </div>
    </div>
  );
}

/**
 * Sage's Stream — small fixed-height viewport that always pins to the latest
 * tokens as they stream in. No scrollbars; gradient fades on top & bottom soften
 * the edges so older lines just dissolve out of view.
 */
function SageStream({ transcript }: { transcript: TranscriptSegment[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Always pin to the bottom on every update.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript]);

  return (
    <div className="runeCardStream" aria-label="Sage's stream of thought">
      <div className="runeCardStreamScroll" ref={scrollRef}>
        {transcript.length === 0 ? (
          <div className="runeCardStreamEmpty">The Sage gathers their thoughts…</div>
        ) : (
          transcript.map((seg) => {
            if (seg.kind === "header") {
              const label = seg.attempt && seg.attempt > 1
                ? `[${seg.stage} · retry ${seg.attempt}${seg.retryReason ? ` · ${seg.retryReason}` : ""}]`
                : `[${seg.stage}]`;
              return (
                <div key={seg.key} className="runeCardStreamHeader">
                  {label}
                </div>
              );
            }
            return (
              <span
                key={seg.key}
                className="runeCardStreamTokens"
                data-stage={seg.stage}
                data-attempt={seg.attempt}
              >
                {seg.text}
              </span>
            );
          })
        )}
        <span className="runeCardStreamCursor" aria-hidden>▌</span>
      </div>
      <div className="runeCardStreamFadeTop" aria-hidden />
      <div className="runeCardStreamFadeBottom" aria-hidden />
    </div>
  );
}

function SpellPreviewCard({ spell }: { spell: GeneratedSpell }) {
  const alignment = getAlignment(spell.alignment);
  const delivery = getDeliveryVehicle(spell.deliveryVehicle);
  const composition = spell.count > 1 ? `${spell.count}x ${delivery.label}` : delivery.label;
  const shaders = spell.buildSpec.vfx.shaders;

  return (
    <div className="runeCardSpell" style={{ borderColor: spell.color }}>
      <div className="runeCardSpellHead">
        <span className="runeCardSpellSwatch" style={{ background: spell.color }} aria-hidden />
        <div>
          <strong>{alignment.label.toUpperCase()}</strong>
          <span>&middot; {composition}</span>
        </div>
      </div>

      <p className="runeCardSpellPrompt">&ldquo;{spell.prompt}&rdquo;</p>

      <dl className="runeCardSpellStats">
        <div><dt>Damage</dt><dd>{spell.damage}{spell.count > 1 ? ` × ${spell.count}` : ""}</dd></div>
        <div><dt>Tier</dt><dd>{spell.powerTier}</dd></div>
        <div><dt>Speed</dt><dd>{spell.speed}</dd></div>
        <div><dt>Radius</dt><dd>{spell.radius.toFixed(1)}</dd></div>
        <div><dt>Duration</dt><dd>{(spell.durationMs / 1000).toFixed(1)}s</dd></div>
        <div><dt>Cooldown</dt><dd>{(spell.cooldownMs / 1000).toFixed(1)}s</dd></div>
        <div><dt>Mana</dt><dd>{spell.manaCost}</dd></div>
        <div><dt>Status</dt><dd>{spell.statusEffect}</dd></div>
      </dl>

      <div className="runeCardSpellEffects">
        <span>{spell.buildSpec.vfx.coreMesh.replaceAll("_", " ")}</span>
        {spell.buildSpec.vfx.travel.map((effect) => <span key={effect}>{effect.replaceAll("_", " ")}</span>)}
        {spell.buildSpec.vfx.impact.map((effect) => <span key={effect}>{effect.replaceAll("_", " ")}</span>)}
      </div>
      <div className="runeCardSpellEffects">
        <span>{shaders.core}</span>
        <span>{shaders.trail}</span>
        <span>{shaders.impact}</span>
      </div>
    </div>
  );
}

type DebugTab = "summary" | "buildSpec" | "scenes" | "stageOutputs" | "fullJson";

const DEBUG_TABS: { id: DebugTab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "buildSpec", label: "Build Spec" },
  { id: "scenes", label: "Scenes" },
  { id: "stageOutputs", label: "Stage Outputs" },
  { id: "fullJson", label: "Full JSON" },
];

function SpellDebugPanel({ spell, meta }: { spell: GeneratedSpell; meta: PreviewMeta }) {
  const [tab, setTab] = useState<DebugTab>("summary");
  const castSummary = describeScene(spell.scenes.cast);
  const travelSummary = describeScene(spell.scenes.travel);
  const impactSummary = describeScene(spell.scenes.impact);

  return (
    <div className="runeCardErrorDetails">
      <div className="runeCardDebugTabs" role="tablist" aria-label="Spell debug sections">
        {DEBUG_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`runeCardDebugTab${tab === entry.id ? " active" : ""}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <>
          <div className="runeCardErrorTechnical">
            <strong>Pipeline:</strong> elapsed {(meta.elapsedMs / 1000).toFixed(1)}s
          </div>
          <div className="runeCardErrorTechnical">
            <strong>Alignment:</strong> {spell.alignment} · <strong>Delivery:</strong> {spell.deliveryVehicle}
            {" · "}<strong>Impact shape:</strong> {spell.impactShape}
            {" · "}<strong>Tier:</strong> {spell.powerTier}
            {" · "}<strong>Count:</strong> {spell.count}
            {" · "}<strong>Impact dur:</strong> {spell.impactDurationMs}ms
          </div>
          {spell.intentLabel && (
            <div className="runeCardErrorTechnical">
              <strong>Intent:</strong> {spell.intentLabel}
              {spell.intentCorrections?.length ? ` · Corrections: ${spell.intentCorrections.length}` : ""}
            </div>
          )}
          {spell.intentCorrections?.length ? (
            <pre className="runeCardErrorRaw">{JSON.stringify(spell.intentCorrections, null, 2)}</pre>
          ) : null}
        </>
      ) : null}

      {tab === "buildSpec" ? (
        <pre className="runeCardErrorRaw">{JSON.stringify(spell.buildSpec, null, 2)}</pre>
      ) : null}

      {tab === "scenes" ? (
        <>
          <div className="runeCardErrorTechnical"><strong>Cast scene:</strong></div>
          <pre className="runeCardErrorRaw">{castSummary}</pre>
          <div className="runeCardErrorTechnical"><strong>Travel scene:</strong></div>
          <pre className="runeCardErrorRaw">{travelSummary}</pre>
          <div className="runeCardErrorTechnical"><strong>Impact scene:</strong></div>
          <pre className="runeCardErrorRaw">{impactSummary}</pre>
        </>
      ) : null}

      {tab === "stageOutputs" ? (
        <>
          {(["concept", "balance"] as const).map((stage) => {
            const out = meta.outputs[stage];
            if (!out) {
              return (
                <div key={stage} className="runeCardErrorTechnical">
                  <strong>{STAGE_LABEL[stage]}:</strong> <em>(no output captured)</em>
                </div>
              );
            }
            return (
              <details key={stage} className="runeCardStageOutput" open>
                <summary>{STAGE_LABEL[stage]} output</summary>
                <pre className="runeCardErrorRaw">{out}</pre>
              </details>
            );
          })}
        </>
      ) : null}

      {tab === "fullJson" ? (
        <pre className="runeCardErrorRaw">{JSON.stringify(spell, null, 2)}</pre>
      ) : null}
    </div>
  );
}

function describeScene(scene: SpellScene): string {
  const lines: string[] = [];
  lines.push(describeNode(scene, 0));
  for (const child of scene.children ?? []) {
    lines.push(describeNode(child, 1));
  }
  return lines.join("\n");
}

function describeNode(node: SceneLeaf, depth: number): string {
  const pad = depth === 0 ? "▸ " : "  ├─ ";
  const parts = [
    `${node.shape}`,
    `shader=${node.shaderId}`,
    node.color,
    `emit=${node.emissiveIntensity.toFixed(2)}`,
    `size=${node.size.toFixed(2)}`,
    `motion=${node.motion}@${node.motionSpeed.toFixed(1)}`,
  ];
  if (node.arrange !== "single") {
    parts.push(`arrange=${node.arrange}×${node.arrangeCount}/r${node.arrangeRadius.toFixed(1)}`);
  }
  if (node.shape === "particle_cloud") {
    parts.push(`particles=${node.particleCount}`);
  }
  if (node.opacity < 1) {
    parts.push(`alpha=${node.opacity.toFixed(2)}`);
  }
  return pad + parts.join("  ");
}


