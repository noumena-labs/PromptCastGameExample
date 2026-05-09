"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AURA_THRESHOLD, MAGIC_MISSILE, PLAYER_MAX_HEALTH, PLAYER_MAX_MANA, SANCTUARY_DURATION_MS } from "@/game/config/gameConfig";
import { useGameStore } from "@/game/state/gameStore";
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
  const player = useGameStore((state) => state.players[state.localPlayerId]);
  const playerIds = useGameStore(useShallow((state) => Object.keys(state.players)));
  const log = useGameStore(useShallow((state) => state.log));
  const roomCode = useGameStore((state) => state.roomCode);
  const mode = useGameStore((state) => state.mode);
  const sanctuaryEndsAt = useGameStore((state) => state.sanctuaryEndsAt);
  const sanctuaryPausedRemainingMs = useGameStore((state) => state.sanctuaryPausedRemainingMs);
  const lastManaFailAt = useGameStore((state) => state.lastManaFailAt);
  const resetMatch = useGameStore((state) => state.resetMatch);
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
        <button type="button" className="sealButton small" onClick={resetMatch}>
          {mode === "client" ? "Recommune" : "Reforge"}
        </button>
        <Link href="/" className="sealButton ghost small">To the Threshold</Link>
      </div>

      <div className="leftPanel">
        <div className="panelHeader">~ Vitals ~</div>
        <div className="meterLabel">
          <span>Health</span>
          <span>{Math.round(player?.health ?? 0)} / {PLAYER_MAX_HEALTH}</span>
        </div>
        <div className="meter health">
          <div style={{ width: `${health * 100}%` }} />
        </div>
        <div className="meterLabel">
          <span>Mana</span>
          <span>{Math.round(player?.mana ?? 0)} / {PLAYER_MAX_MANA}</span>
        </div>
        <div className={`meter mana${manaFlashing ? " manaFail" : ""}`}>
          <div style={{ width: `${mana * 100}%` }} />
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

      <div className="rightPanel">
        <div className="panelHeader">~ Spell Tome ~</div>
        <div className="baseSpell">
          <strong>LMB</strong>
          <span>{MAGIC_MISSILE.name}</span>
          <small>{baseRemaining > 0 ? `${(baseRemaining / 1000).toFixed(1)}s` : "Ready"}</small>
        </div>
        <div className="runestones">
          {player?.spellSlots.map((slot, index) => {
            const cd = slot ? player.cooldowns[slot.id] : undefined;
            const cdRemaining = cd ? Math.max(0, cd - currentTime) : 0;
            const cooling = cdRemaining > 0;
            // Cooldown radial sweep: fraction 0..1 of progress (0 just-cast → 1 ready).
            const sweep = cooling && slot && slot.cooldownMs > 0
              ? 1 - cdRemaining / slot.cooldownMs
              : 1;
            const sweepDeg = Math.round(sweep * 360);
            return (
              <div
                key={`slot-${index}`}
                className={`runestone${slot ? "" : " empty"}${cooling ? " cooling" : ""}`}
                style={slot ? { borderColor: slot.color } : undefined}
              >
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
              </div>
            );
          })}
        </div>
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

      {/*
        Bottom-edge keyboard hint footer. Low opacity, italic flavor — meant to
        be read once and then ignored by veteran players. `pointer-events: none`
        so it never blocks gameplay clicks.
      */}
      <div className="hudFooter" aria-label="Controls">
        <span><kbd>WASD</kbd> wander</span>
        <span><kbd>Space</kbd> leap</span>
        <span><kbd>LMB</kbd> missile</span>
        <span><kbd>E</kbd> Sanctuary</span>
        <span><kbd>I</kbd>–<kbd>IV</kbd> bound spells</span>
        <span><kbd>Esc</kbd> release pointer</span>
      </div>
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
