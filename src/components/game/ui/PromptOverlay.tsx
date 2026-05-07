"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { generateSpellFromPrompt } from "@/game/ai/cogentSpellGenerator";
import { useGameStore } from "@/game/state/gameStore";
import { SANCTUARY_DURATION_MS } from "@/game/config/gameConfig";
import type { GeneratedSpell } from "@/game/types";

const examplePrompts = [
  "A massive flaming tornado that pulls enemies in",
  "A fast lightning spear that stuns",
  "A freezing blizzard that slows everyone caught inside",
  "A meteor shower of six fiery stones",
  "A shadow trap that breaks shields",
];

const slotKeys = ["I", "II", "III", "IV"];
const PREVIEW_HOLD_MS = 1200;
const SHATTER_VFX_MS = 800;
const TIMER_TICK_MS = 250;

type Phase =
  | { kind: "compose" }
  | { kind: "thinking"; reasoning: string; startedAt: number }
  | { kind: "previewing"; spell: GeneratedSpell; reasoning: string }
  | { kind: "bound"; spell: GeneratedSpell }
  | { kind: "error"; message: string; lastPrompt: string }
  | { kind: "shattering" };

export function PromptOverlay() {
  const promptOpen = useGameStore((state) => state.promptOpen);
  const sanctuaryEndsAt = useGameStore((state) => state.sanctuaryEndsAt);
  const selectedSlot = useGameStore((state) => state.selectedSlot);
  const setSelectedSlot = useGameStore((state) => state.setSelectedSlot);
  const saveGeneratedSpell = useGameStore((state) => state.saveGeneratedSpell);
  const exitSanctuary = useGameStore((state) => state.exitSanctuary);

  const [prompt, setPrompt] = useState(examplePrompts[0]);
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [now, setNow] = useState(() => Date.now());
  const [thinkingElapsedMs, setThinkingElapsedMs] = useState(0);

  const bindTimer = useRef<number | null>(null);
  const shatterTimer = useRef<number | null>(null);
  const composeTickRef = useRef<number | null>(null);
  const thinkingTickRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    if (bindTimer.current !== null) {
      window.clearTimeout(bindTimer.current);
      bindTimer.current = null;
    }
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

  // Reset internal state and tear down timers whenever the overlay closes so
  // the next entry is clean.
  useEffect(() => {
    if (!promptOpen) {
      clearAllTimers();
      setPhase({ kind: "compose" });
      setThinkingElapsedMs(0);
    }
  }, [promptOpen, clearAllTimers]);

  // Compose-phase shield countdown: while in compose, tick `now` so the timer
  // ring + crack overlay re-render. Stop ticking the moment we leave compose.
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

  // Thinking-phase elapsed counter (display only, no cap).
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

  // Drive the shatter when the shield expires while still composing.
  const shieldRemainingMs =
    sanctuaryEndsAt !== null ? Math.max(0, sanctuaryEndsAt - now) : SANCTUARY_DURATION_MS;
  const shieldDecay =
    sanctuaryEndsAt !== null
      ? Math.max(0, Math.min(1, 1 - shieldRemainingMs / SANCTUARY_DURATION_MS))
      : 0;

  useEffect(() => {
    if (!promptOpen) return;
    if (phase.kind !== "compose") return;
    if (sanctuaryEndsAt === null) return;
    if (shieldRemainingMs > 0) return;

    // Shield shatters: lock input, play VFX, then exit Sanctuary.
    clearComposeTick();
    setPhase({ kind: "shattering" });
    shatterTimer.current = window.setTimeout(() => {
      shatterTimer.current = null;
      exitSanctuary();
    }, SHATTER_VFX_MS);
  }, [promptOpen, phase.kind, sanctuaryEndsAt, shieldRemainingMs, exitSanctuary, clearComposeTick]);

  // Tear-down on unmount.
  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  if (!promptOpen) return null;

  const runChat = async (chatPrompt: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: "thinking", reasoning: "", startedAt: Date.now() });

    try {
      const result = await generateSpellFromPrompt(
        chatPrompt,
        (progress) => {
          setPhase((current) =>
            current.kind === "thinking"
              ? { ...current, reasoning: progress.reasoning }
              : current,
          );
        },
        controller.signal,
      );

      if (controller.signal.aborted) return;
      abortRef.current = null;

      const spell = result.spell;
      const reasoning = spell.reasoning ?? result.reasoning ?? "";
      setPhase({ kind: "previewing", spell, reasoning });

      bindTimer.current = window.setTimeout(() => {
        bindTimer.current = null;
        saveGeneratedSpell(spell);
        setPhase({ kind: "bound", spell });
      }, PREVIEW_HOLD_MS);
    } catch (err) {
      if (controller.signal.aborted) return;
      abortRef.current = null;
      const message = err instanceof Error ? err.message : "The Sage's voice falters.";
      setPhase({ kind: "error", message, lastPrompt: chatPrompt });
    }
  };

  const handleInscribe = (event: FormEvent) => {
    event.preventDefault();
    if (phase.kind !== "compose") return;
    // Submitting halts the compose-phase shield timer permanently for this
    // session — the player has paid their tribute.
    clearComposeTick();
    void runChat(prompt);
  };

  const handleRetry = () => {
    if (phase.kind !== "error") return;
    void runChat(phase.lastPrompt);
  };

  const handleBackToCompose = () => {
    if (phase.kind !== "error") return;
    setPhase({ kind: "compose" });
  };

  const close = () => {
    clearAllTimers();
    exitSanctuary();
  };

  const canDismiss = phase.kind === "compose" || phase.kind === "error" || phase.kind === "bound";
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
          <span className="runeCardEyebrow">Sanctuary &middot; Runestone {slotKeys[selectedSlot]}</span>
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
            <div className="runeCardThinkingIndicator">
              <span className="runeCardThinkingDots" aria-hidden>
                <span /><span /><span />
              </span>
              <span>Sage is divining&hellip;</span>
              <span className="runeCardThinkingElapsed">{formatElapsed(thinkingElapsedMs)}</span>
            </div>
            <div className="runeCardReasoning">
              <div className="runeCardReasoningLabel">Sage&rsquo;s Reasoning</div>
              <div className="runeCardReasoningText">
                {phase.reasoning || "The Sage gathers their thoughts..."}
                <span className="runeCardCursor">▌</span>
              </div>
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
            <div className="runeCardBindingHint">
              Binding to runestone {slotKeys[selectedSlot]}…
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
            <div className="runeCardError">{phase.message}</div>
            <div className="runeCardErrorActions">
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

function SpellPreviewCard({ spell }: { spell: GeneratedSpell }) {
  const composition =
    spell.delivery === "self"
      ? `self · ${spell.impact}`
      : spell.count > 1
        ? `${spell.count}× ${spell.delivery} · ${spell.impact}`
        : `${spell.delivery} · ${spell.impact}`;

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
