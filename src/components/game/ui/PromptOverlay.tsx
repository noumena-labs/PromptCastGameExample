"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { generateSpellFromPrompt } from "@/game/ai/cogentSpellGenerator";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import type { SpellStage } from "@/game/ai/spellLog";
import type { FormAttempt } from "@/game/ai/pipeline/formCall";
import type { PipelineStage } from "@/game/ai/pipeline";
import { useGameStore } from "@/game/state/gameStore";
import { SANCTUARY_DURATION_MS } from "@/game/config/gameConfig";
import type { GeneratedSpell } from "@/game/types";
import type { SceneLeaf, SpellScene } from "@/game/spells/sceneNode";

const examplePrompts = [
  "A cage of obsidian bars that drops onto the target",
  "Three orbiting violet shards that crackle with shadow",
  "A pillar of black flame that vents straight up",
  "A wall of thorns rising in a curved row",
  "A frost nova that bursts outward and slows the whole arena",
  "A meteor shower of small bright rocks raining down",
];

const slotKeys = ["I", "II", "III", "IV"];
const SHATTER_VFX_MS = 800;
const TIMER_TICK_MS = 250;

const PIPELINE_STAGES = [
  "concept",
  "balance",
  "form-cast",
  "form-impact",
  "palette",
  "compose",
] as const;
type StageStatus = "pending" | "active" | "done";
type StageProgress = Record<PipelineStage, StageStatus>;

const STAGE_LABEL: Record<PipelineStage, string> = {
  concept: "Concept",
  balance: "Balance",
  "form-cast": "Form · Cast",
  "form-impact": "Form · Impact",
  palette: "Palette",
  compose: "Compose",
};

function makeInitialStages(): StageProgress {
  return {
    concept: "active",
    balance: "pending",
    "form-cast": "pending",
    "form-impact": "pending",
    palette: "pending",
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
  formAttempts?: number;
  outputs: Partial<Record<PipelineStage, string>>;
};

type Phase =
  | { kind: "compose" }
  | {
      kind: "thinking";
      startedAt: number;
      currentStage: PipelineStage;
      stages: StageProgress;
      formAttempt?: FormAttempt;
      maxFormAttempt: number;
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
      setPhase({ kind: "compose" });
      setThinkingElapsedMs(0);
      setShowPreviewDetails(false);
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
    setNow(Date.now());
    composeTickRef.current = window.setInterval(() => setNow(Date.now()), TIMER_TICK_MS);
    return () => clearComposeTick();
  }, [promptOpen, phase.kind, clearComposeTick]);

  useEffect(() => {
    if (phase.kind !== "thinking") {
      clearThinkingTick();
      return;
    }
    const startedAt = phase.startedAt;
    setThinkingElapsedMs(Date.now() - startedAt);
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
    setPhase({ kind: "shattering" });
    shatterTimer.current = window.setTimeout(() => {
      shatterTimer.current = null;
      exitSanctuary();
    }, SHATTER_VFX_MS);
  }, [promptOpen, phase.kind, sanctuaryEndsAt, shieldRemainingMs, exitSanctuary, clearComposeTick]);

  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  if (!promptOpen) return null;

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
      maxFormAttempt: 0,
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

            const maxFormAttempt = progress.formAttempt
              ? Math.max(current.maxFormAttempt, progress.formAttempt.n)
              : current.maxFormAttempt;

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
              const attempt = progress.formAttempt?.n ?? 1;
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
              formAttempt: progress.formAttempt,
              maxFormAttempt,
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
        const maxFormAttempt =
          current.kind === "thinking" ? current.maxFormAttempt : 0;
        const outputs =
          current.kind === "thinking" ? current.outputs : {};
        return {
          kind: "previewing",
          spell,
          reasoning,
          meta: {
            elapsedMs: Date.now() - startedAt,
            formAttempts: maxFormAttempt > 0 ? maxFormAttempt : undefined,
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
              ? `Sanctuary · Runestone ${slotKeys[selectedSlot]}`
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
                  onClick={() => setPrompt(example)}
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
              formAttempt={phase.formAttempt}
              elapsedMs={thinkingElapsedMs}
            />
            <SageStream transcript={phase.transcript} />
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
              {showPreviewDetails ? "Hide details" : "Show details"}
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
                    {slotKeys[slot]}
                  </button>
                ))}
              </div>
              <button type="button" className="runeCardInscribe" onClick={handleBind}>
                Bind to Runestone {slotKeys[selectedSlot]}
              </button>
            </div>
          </div>
        ) : null}

        {phase.kind === "bound" ? (
          <div className="runeCardBody">
            <SpellPreviewCard spell={phase.spell} />
            <div className="runeCardBoundHint">
              Bound to runestone {slotKeys[selectedSlot]}. Press {slotKeys[selectedSlot]} on the
              keyboard to cast.
            </div>
            <button type="button" className="runeCardInscribe" onClick={close}>
              Leave Sanctuary
            </button>
          </div>
        ) : null}

        {phase.kind === "error" ? (
          <div className="runeCardBody">
            <div className="runeCardError">
              <div className="runeCardErrorMessage">{phase.details.message}</div>
              <div className="runeCardErrorStage">Stage: {phase.details.stage}</div>
              {phase.details.technical || phase.details.rawOutput ? (
                <button
                  type="button"
                  className="runeCardErrorDetailsToggle"
                  onClick={() => setShowDetails((v) => !v)}
                >
                  {showDetails ? "Hide details" : "Show details"}
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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function StageRail({
  stages,
  formAttempt,
  elapsedMs,
}: {
  stages: StageProgress;
  formAttempt?: FormAttempt;
  elapsedMs: number;
}) {
  return (
    <div className="runeCardStageBlock">
      <ol className="runeCardStageRail" aria-label="Spell generation pipeline">
        {PIPELINE_STAGES.map((stage, i) => {
          const status = stages[stage];
          const isForm = stage === "form-cast" || stage === "form-impact";
          const detail =
            isForm && status === "active" && formAttempt && formAttempt.n > 1
              ? `${formAttempt.n}/${formAttempt.total}`
              : null;
          return (
            <li
              key={stage}
              className="runeCardStagePill"
              data-status={status}
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="runeCardStagePillIndex">{i + 1}</span>
              <span className="runeCardStagePillLabel">{STAGE_LABEL[stage]}</span>
              {detail ? <span className="runeCardStagePillDetail">{detail}</span> : null}
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
  const composition =
    spell.deliveryFamily === "self"
      ? `self · ${spell.impact} · ${spell.placement}`
      : spell.count > 1
        ? `${spell.count}× ${spell.deliveryFamily} · ${spell.impact} · ${spell.placement}`
        : `${spell.deliveryFamily} · ${spell.impact} · ${spell.placement}`;

  return (
    <div className="runeCardSpell" style={{ borderColor: spell.color }}>
      <div className="runeCardSpellHead">
        <span className="runeCardSpellSwatch" style={{ background: spell.color }} aria-hidden />
        <div>
          <strong>{spell.element.toUpperCase()}</strong>
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
      </dl>

      {spell.effects.length > 0 ? (
        <div className="runeCardSpellEffects">
          {spell.effects.map((effect) => (
            <span key={effect}>{effect.replace("_", " ")}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SpellDebugPanel({ spell, meta }: { spell: GeneratedSpell; meta: PreviewMeta }) {
  const castSummary = describeScene(spell.scenes.cast);
  const impactSummary = describeScene(spell.scenes.impact);
  return (
    <div className="runeCardErrorDetails">
      <div className="runeCardErrorTechnical">
        <strong>Pipeline:</strong>{" "}
        elapsed {(meta.elapsedMs / 1000).toFixed(1)}s
        {meta.formAttempts && meta.formAttempts > 1
          ? ` · form attempts: ${meta.formAttempts}`
          : ""}
      </div>
      <div className="runeCardErrorTechnical">
        <strong>Delivery:</strong> {spell.deliveryFamily} · <strong>Impact:</strong> {spell.impact}
        {" · "}<strong>Placement:</strong> {spell.placement}
        {" · "}<strong>Tier:</strong> {spell.powerTier}
        {" · "}<strong>Count:</strong> {spell.count}
        {" · "}<strong>Impact dur:</strong> {spell.impactDurationMs}ms
      </div>
      <div className="runeCardErrorTechnical">
        <strong>Cast scene:</strong>
      </div>
      <pre className="runeCardErrorRaw">{castSummary}</pre>
      <div className="runeCardErrorTechnical">
        <strong>Impact scene:</strong>
      </div>
      <pre className="runeCardErrorRaw">{impactSummary}</pre>

      {(["concept", "balance", "form-cast", "form-impact", "palette"] as const).map((stage) => {
        const out = meta.outputs[stage];
        if (!out) return null;
        return (
          <details key={stage} className="runeCardStageOutput">
            <summary>{STAGE_LABEL[stage]} output</summary>
            <pre className="runeCardErrorRaw">{out}</pre>
          </details>
        );
      })}

      <details className="runeCardStageOutput">
        <summary>Full spell JSON</summary>
        <pre className="runeCardErrorRaw">{JSON.stringify(spell, null, 2)}</pre>
      </details>
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
