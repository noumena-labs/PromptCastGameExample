"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AURA_THRESHOLD, MAGIC_MISSILE, PLAYER_MAX_HEALTH, PLAYER_MAX_MANA, SANCTUARY_DURATION_MS } from "@/game/config/gameConfig";
import { describeCompat, type CompatResult } from "@/game/compat/deviceCompat";
import { useIsTouchDevice, useApplyMobileHudClass } from "@/game/compat/useIsTouchDevice";
import { useGameStore } from "@/game/state/gameStore";
import {
  queueTouchSanctuary,
  queueTouchSlotCast,
} from "@/game/input/touchInputBus";
import { CornerFlourish } from "./CornerFlourish";

// Display-only labels for the four runestones — the actual key bindings
// (Digit1–Digit4) live in `LocalWizard.tsx`.
const slotRomans = ["I", "II", "III", "IV"];
const MANA_FLASH_MS = 600;
const EVENT_LOG_MAX = 6;
const TALLY_MAX = 5;

/**
 * Format a status-effect id into a short, human-friendly chip label.
 * `slow` -> `Slow`, `damage_over_time` -> `Damage Over Time`.
 */
function formatStatusName(effect: string): string {
  return effect
    .split("_")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

/**
 * Render a kill count as runic tally glyphs (✦) up to TALLY_MAX, then fall
 * back to "✦ × N" so a single grand wizard with a long winning streak still
 * fits the panel.
 */
function renderTally(count: number): string {
  if (count <= 0) return "—";
  if (count <= TALLY_MAX) return "✦".repeat(count);
  return `✦ × ${count}`;
}

export function GameHud() {
  const [currentTime, setCurrentTime] = useState(0);
  const [limitedInfoOpen, setLimitedInfoOpen] = useState(false);
  const [touchMenuOpen, setTouchMenuOpen] = useState(false);
  const isTouch = useIsTouchDevice();
  // Tag <body> with data-mobile / data-orientation for CSS gating of the
  // compact Mobile HUD layout (separate from the touch *input* layer which
  // ships to any coarse-pointer device).
  useApplyMobileHudClass();
  const player = useGameStore((state) => state.players[state.localPlayerId]);
  const playerIds = useGameStore(useShallow((state) => Object.keys(state.players)));
  const log = useGameStore(useShallow((state) => state.log));
  const roomCode = useGameStore((state) => state.roomCode);
  const mode = useGameStore((state) => state.mode);
  const sanctuaryEndsAt = useGameStore((state) => state.sanctuaryEndsAt);
  const sanctuaryPausedRemainingMs = useGameStore((state) => state.sanctuaryPausedRemainingMs);
  const lastManaFailAt = useGameStore((state) => state.lastManaFailAt);
  const resetMatch = useGameStore((state) => state.resetMatch);
  const compat = useGameStore((state) => state.compat);
  const limited = compat != null && !compat.compatible;
  const health = player ? Math.max(0, player.health / PLAYER_MAX_HEALTH) : 0;
  const mana = player ? Math.max(0, player.mana / PLAYER_MAX_MANA) : 0;
  const sanctuaryRemaining = sanctuaryEndsAt
    ? Math.max(0, sanctuaryEndsAt - currentTime)
    : sanctuaryPausedRemainingMs ?? SANCTUARY_DURATION_MS;

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  const baseCooldown = player?.cooldowns[MAGIC_MISSILE.id];
  const baseRemaining = baseCooldown ? Math.max(0, baseCooldown - currentTime) : 0;

  // Mana-empty flash: triggered when a cast is rejected for insufficient mana.
  const manaFlashing =
    lastManaFailAt != null && currentTime > 0 && currentTime - lastManaFailAt < MANA_FLASH_MS;

  const aura = player?.aura ?? 0;
  const sanctuaryReady = aura >= AURA_THRESHOLD;

  return (
    <div className="hud">
      {limited && compat ? (
        <button
          type="button"
          className="limitedModeChip"
          onClick={() => setLimitedInfoOpen(true)}
          aria-label="Limited Mode — click for details"
          title="Limited Mode active"
        >
          <span className="limitedModeChipDot" aria-hidden />
          Limited Mode
        </button>
      ) : null}
      {limitedInfoOpen && compat ? (
        <LimitedModeInfoModal compat={compat} onClose={() => setLimitedInfoOpen(false)} />
      ) : null}
      <div className="topBar">
        <div className="brandMark">
          <span>PromptCast</span>
          <small>{mode === "solo" ? "Solo Practice" : `${mode.toUpperCase()} ${roomCode ?? ""}`}</small>
        </div>
        <aside className="rollOfWizards" aria-label="Roll of Wizards">
          <CornerFlourish position="tl" />
          <CornerFlourish position="tr" />
          <CornerFlourish position="bl" />
          <CornerFlourish position="br" />
          <h3 className="rollEyebrow">~ Roll of Wizards ~</h3>
          <ul className="rollList">
            {playerIds.map((id) => (
              <RollEntry key={id} id={id} />
            ))}
          </ul>
        </aside>
      </div>

      <div className="bottomActions">
        {isTouch ? (
          <div className="touchMenu">
            <button
              type="button"
              className="touchMenuToggle"
              aria-label="Open menu"
              aria-expanded={touchMenuOpen}
              onClick={() => setTouchMenuOpen((v) => !v)}
            >
              ☰
            </button>
            {touchMenuOpen ? (
              <div className="touchMenuPopover" role="menu">
                <div className="touchMenuBrand">
                  <span>PromptCast</span>
                  <small>{mode === "solo" ? "Solo Practice" : `${mode.toUpperCase()} ${roomCode ?? ""}`}</small>
                </div>
                <button
                  type="button"
                  className="sealButton small"
                  onClick={() => {
                    setTouchMenuOpen(false);
                    resetMatch();
                  }}
                >
                  {mode === "client" ? "Recommune" : "Reforge"}
                </button>
                <Link
                  href="/"
                  className="sealButton ghost small"
                  onClick={() => setTouchMenuOpen(false)}
                >
                  To the Threshold
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <button type="button" className="sealButton small" onClick={resetMatch}>
              {mode === "client" ? "Recommune" : "Reforge"}
            </button>
            <Link href="/" className="sealButton ghost small">To the Threshold</Link>
          </>
        )}
      </div>

      <div className="leftPanel">
        <div className="panelHeader">~ Vitals ~</div>
        <div className="meterLabel">
          <span>Health</span>
          <span>{Math.round(player?.health ?? 0)} / {PLAYER_MAX_HEALTH}</span>
        </div>
        <div className="meter health">
          <div style={{ width: `${health * 100}%` }} />
          <span className="meterInlineLabel" aria-hidden>HP</span>
          <span className="meterInlineValue" aria-hidden>
            {Math.round(player?.health ?? 0)}/{PLAYER_MAX_HEALTH}
          </span>
        </div>
        <div className="meterLabel">
          <span>Mana</span>
          <span>{Math.round(player?.mana ?? 0)} / {PLAYER_MAX_MANA}</span>
        </div>
        <div className={`meter mana${manaFlashing ? " manaFail" : ""}`}>
          <div style={{ width: `${mana * 100}%` }} />
          <span className="meterInlineLabel" aria-hidden>MP</span>
          <span className="meterInlineValue" aria-hidden>
            {Math.round(player?.mana ?? 0)}/{PLAYER_MAX_MANA}
          </span>
        </div>
        <div className={`auraRow${sanctuaryReady ? " full" : ""}`}>
          <span>{sanctuaryReady ? "Sanctuary Ready" : "Aura Crystals"}</span>
          <div className="auraPips" aria-label={`${aura} of ${AURA_THRESHOLD} aura crystals`}>
            {Array.from({ length: AURA_THRESHOLD }).map((_, i) => (
              <span
                key={`aura-pip-${i}`}
                className={`auraPip${i < aura ? " filled" : ""}`}
                aria-hidden
              />
            ))}
          </div>
        </div>
        {player?.statusEffects.length ? (
          <div className="statusChips" aria-label="Active status effects">
            {player.statusEffects.map((effect) => {
              const remainingMs = Math.max(0, effect.expiresAt - currentTime);
              return (
                <span key={effect.id} className="statusChip">
                  {formatStatusName(effect.effect)}
                  <small>{(remainingMs / 1000).toFixed(1)}s</small>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className={`rightPanel${isTouch ? " rightPanelTouch" : ""}`}>
        {isTouch ? null : <div className="panelHeader">~ Spell Tome ~</div>}
        {/*
          Magic Missile tile. On desktop this is a passive readout; on
          touch the LMB-equivalent moves to the dedicated `.touchCastButton`
          (see TouchControls.tsx) which also visualises cooldown as a ring,
          so we omit the tile here entirely on touch to declutter.
        */}
        {isTouch ? null : (
          <div className="baseSpell">
            <strong>LMB</strong>
            <span>{MAGIC_MISSILE.name}</span>
            <small>{baseRemaining > 0 ? `${(baseRemaining / 1000).toFixed(1)}s` : "Ready"}</small>
          </div>
        )}
        <div className={`runestones${isTouch ? " runestonesCompact" : ""}`}>
          {player?.spellSlots.map((slot, index) => {
            const cd = slot ? player.cooldowns[slot.id] : undefined;
            const cdRemaining = cd ? Math.max(0, cd - currentTime) : 0;
            const cooling = cdRemaining > 0;
            // Cooldown radial sweep: fraction 0..1 of progress (0 just-cast → 1 ready).
            const sweep = cooling && slot && slot.cooldownMs > 0
              ? 1 - cdRemaining / slot.cooldownMs
              : 1;
            const sweepDeg = Math.round(sweep * 360);
            // On touch, runestones become tappable buttons that enqueue a
            // slot-cast for `LocalWizard` to resolve next frame. On desktop
            // they remain pure display elements (the keyboard `Digit1`–
            // `Digit4` handler is the only cast trigger).
            const interactive = isTouch && slot != null;
            const compactClass = isTouch ? " runestoneCompact" : "";
            const commonClass = `runestone${slot ? "" : " empty"}${cooling ? " cooling" : ""}${interactive ? " runestoneTouch" : ""}${compactClass}`;
            const onTap = interactive
              ? (event: React.PointerEvent) => {
                  event.preventDefault();
                  queueTouchSlotCast(index);
                }
              : undefined;
            // Compact (touch) layout shows only the Roman numeral + spell
            // name + mana cost. Empty slots show just the numeral and a
            // dash so the 2x2 grid reads cleanly without "INSCRIBE IN
            // SANCTUARY" copy fighting the joystick for screen space.
            const innerContent = isTouch ? (
              <>
                <span className="key">{slotRomans[index]}</span>
                <span className="name">{slot?.name ?? "—"}</span>
                {slot ? <span className="meta">{slot.manaCost}</span> : null}
                {cooling ? (
                  <>
                    <span
                      className="cooldownSweep"
                      aria-hidden
                      style={{
                        background: `conic-gradient(rgba(20,12,6,0.55) ${sweepDeg}deg, rgba(20,12,6,0) ${sweepDeg}deg)`,
                      }}
                    />
                    <span className="cooldown">{(cdRemaining / 1000).toFixed(1)}s</span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <span className="key">{slotRomans[index]}</span>
                <span className="name">{slot?.name ?? "Empty"}</span>
                <span className="meta">
                  {slot ? `${slot.manaCost} mana` : "Inscribe in Sanctuary"}
                </span>
                {cooling ? (
                  <>
                    <span
                      className="cooldownSweep"
                      aria-hidden
                      style={{
                        background: `conic-gradient(rgba(20,12,6,0.55) ${sweepDeg}deg, rgba(20,12,6,0) ${sweepDeg}deg)`,
                      }}
                    />
                    <span className="cooldown">{(cdRemaining / 1000).toFixed(1)}s</span>
                  </>
                ) : null}
              </>
            );
            if (interactive) {
              return (
                <button
                  key={`slot-${index}`}
                  type="button"
                  className={commonClass}
                  style={slot ? { borderColor: slot.color } : undefined}
                  onPointerDown={onTap}
                  aria-label={slot ? `Cast ${slot.name}` : "Empty slot"}
                >
                  {innerContent}
                </button>
              );
            }
            return (
              <div
                key={`slot-${index}`}
                className={commonClass}
                style={slot ? { borderColor: slot.color } : undefined}
              >
                {innerContent}
              </div>
            );
          })}
        </div>
        {/*
          On touch, Sanctuary lives directly under the 2x2 rune grid as a
          full-width pill so the Spell Tome reads as one self-contained
          panel. The action cluster (Jump + Cast) stays purely physical
          movement / fire actions — Sanctuary is a state change and
          belongs with the spells.
        */}
        {isTouch ? (
          <button
            type="button"
            className={`sanctuaryTapButton${sanctuaryReady ? " ready" : ""}`}
            onPointerDown={(event) => {
              event.preventDefault();
              queueTouchSanctuary();
            }}
            aria-label="Enter Sanctuary"
          >
            <span className="key">E</span>
            <span className="name">Sanctuary</span>
            <span className="meta">{sanctuaryReady ? "Ready" : `${aura} / ${AURA_THRESHOLD}`}</span>
          </button>
        ) : null}
      </div>

      {player?.status === "sanctuary" ? (
        <div className="sanctuaryTimer">
          Sanctuary &middot; {(sanctuaryRemaining / 1000).toFixed(1)}s
          <div>
            <span style={{ width: `${(sanctuaryRemaining / SANCTUARY_DURATION_MS) * 100}%` }} />
          </div>
        </div>
      ) : null}

      {player?.status === "dead" ? <div className="deathBanner">~ Reforming at the leyline ~</div> : null}

      {/*
        Activity / event log. Hidden on touch devices — the panel competes
        with on-screen controls for thumb space and isn't critical for the
        moment-to-moment loop. Desktop players keep the parchment scroll.
      */}
      {isTouch ? null : (
        <div className="eventLog">
          {log.slice(0, EVENT_LOG_MAX).map((entry, index) => {
            // Fade older entries: newest is fully opaque, older entries ramp down.
            const opacity = 1 - (index / EVENT_LOG_MAX) * 0.7;
            return (
              <div key={`${entry}-${index}`} style={{ opacity }}>
                {index === 0 ? "» " : ""}{entry}
              </div>
            );
          })}
        </div>
      )}

      {/*
        Bottom-edge keyboard hint footer. Low opacity, italic flavor — meant to
        be read once and then ignored by veteran players. `pointer-events: none`
        so it never blocks gameplay clicks. Hidden entirely on touch devices,
        where the on-screen joystick / look-pad / runestone buttons make these
        keyboard reminders both useless and visually noisy.
      */}
      {isTouch ? null : (
        <div className="hudFooter" aria-label="Controls">
          <span><kbd>WASD</kbd> wander</span>
          <span><kbd>Space</kbd> leap</span>
          <span><kbd>LMB</kbd> missile</span>
          <span><kbd>E</kbd> Sanctuary</span>
          <span><kbd>I</kbd>–<kbd>IV</kbd> bound spells</span>
          <span><kbd>Esc</kbd> release pointer</span>
        </div>
      )}
    </div>
  );
}

function RollEntry({ id }: { id: string }) {
  const name = useGameStore((state) => state.players[id]?.name);
  const color = useGameStore((state) => state.players[id]?.color);
  const score = useGameStore((state) => state.players[id]?.score);
  if (name == null) return null;
  const tally = renderTally(score ?? 0);
  return (
    <li className="rollEntry">
      <span className="rollSigil" style={{ background: color }} aria-hidden />
      <span className="rollName">{name}</span>
      <span className="rollTally" title={`${score ?? 0} kill${score === 1 ? "" : "s"}`}>{tally}</span>
    </li>
  );
}

/**
 * Compact in-game variant of the landing-page CompatibilityModal. Shares the
 * `describeCompat()` copy so phrasing matches across both surfaces. ESC
 * closes the panel but does NOT pause the match — Limited Mode players are
 * still in active gameplay.
 */
function LimitedModeInfoModal({
  compat,
  onClose,
}: {
  compat: CompatResult;
  onClose: () => void;
}) {
  const copy = describeCompat(compat);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Stop propagation so the canvas pointer-lock release handler doesn't
        // also fire on the same Escape press.
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="modalBackdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="limitedModeInfoTitle"
      onClick={onClose}
    >
      <div className="modalPanel browserRequirementPanel" onClick={(event) => event.stopPropagation()}>
        <CornerFlourish position="tl" />
        <CornerFlourish position="tr" />
        <CornerFlourish position="bl" />
        <CornerFlourish position="br" />

        <button type="button" className="modalClose" onClick={onClose} aria-label="Close">
          ×
        </button>

        <header className="modalHeader">
          <div className="heroEyebrow">{copy.eyebrow}</div>
          <h2 id="limitedModeInfoTitle" className="modalTitle">{copy.title}</h2>
        </header>

        <div className="browserRequirementBody">
          {copy.bullets.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>

        <div className="modalActions browserRequirementActions">
          {copy.showInstallChrome ? (
            <a className="sealButton" href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
              Install Chrome
            </a>
          ) : null}
          <button type="button" className="sealButton ghost" onClick={onClose}>
            Return to the Meadow
          </button>
        </div>
      </div>
    </div>
  );
}
