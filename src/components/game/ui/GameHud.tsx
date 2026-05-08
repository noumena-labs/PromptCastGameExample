"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AURA_THRESHOLD, MAGIC_MISSILE, PLAYER_MAX_HEALTH, PLAYER_MAX_MANA, SANCTUARY_DURATION_MS } from "@/game/config/gameConfig";
import { useGameStore } from "@/game/state/gameStore";

const slotKeys = ["I", "II", "III", "IV"];

export function GameHud() {
  const [currentTime, setCurrentTime] = useState(0);
  const player = useGameStore((state) => state.players[state.localPlayerId]);
  const playerIds = useGameStore(useShallow((state) => Object.keys(state.players)));
  const log = useGameStore(useShallow((state) => state.log));
  const roomCode = useGameStore((state) => state.roomCode);
  const mode = useGameStore((state) => state.mode);
  const sanctuaryEndsAt = useGameStore((state) => state.sanctuaryEndsAt);
  const sanctuaryPausedRemainingMs = useGameStore((state) => state.sanctuaryPausedRemainingMs);
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

  return (
    <div className="hud">
      <div className="topBar">
        <div className="brandMark">
          <span>PromptCast</span>
          <small>{mode === "solo" ? "Solo Practice" : `${mode.toUpperCase()} ${roomCode ?? ""}`}</small>
        </div>
        <div className="scoreBoard">
          {playerIds.map((id) => (
            <ScoreEntry key={id} id={id} />
          ))}
        </div>
      </div>

      <div className="bottomActions">
        <button type="button" onClick={resetMatch}>
          Reset
        </button>
        <Link href="/">Lobby</Link>
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
        <div className="meter mana">
          <div style={{ width: `${mana * 100}%` }} />
        </div>
        <div className="auraRow">
          <span>Aura Crystals (Nam-shub)</span>
          <strong>{player?.aura ?? 0} / {AURA_THRESHOLD}</strong>
        </div>
        {player?.statusEffects.length ? (
          <div className="auraRow">
            <span>Status</span>
            <strong>{player.statusEffects.map((effect) => effect.effect).join(", ")}</strong>
          </div>
        ) : null}
        <div className="hint">
          Click to lock the camera. WASD to move, Space to leap, Left Click to loose Magic Missile, E to enter Sanctuary (3 Aura Crystals), I-IV to wield bound spells.
        </div>
      </div>

      <div className="rightPanel">
        <div className="panelHeader">~ Spell Tome ~</div>
        <div className="baseSpell">
          <strong>Mouse</strong>
          <span>{MAGIC_MISSILE.name}</span>
          <small>{baseRemaining > 0 ? `${(baseRemaining / 1000).toFixed(1)}s` : "Ready"}</small>
        </div>
        <div className="runestones">
          {player?.spellSlots.map((slot, index) => {
            const cd = slot ? player.cooldowns[slot.id] : undefined;
            const cdRemaining = cd ? Math.max(0, cd - currentTime) : 0;
            const cooling = cdRemaining > 0;
            return (
              <div
                key={`slot-${index}`}
                className={`runestone${slot ? "" : " empty"}${cooling ? " cooling" : ""}`}
                style={slot ? { borderColor: slot.color } : undefined}
              >
                <span className="key">{slotKeys[index]}</span>
                <span className="name">{slot?.name ?? "Empty"}</span>
                <span className="meta">
                  {slot ? `${slot.manaCost} mana` : "Inscribe in Sanctuary"}
                </span>
                {cooling ? <span className="cooldown">{(cdRemaining / 1000).toFixed(1)}s</span> : null}
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
        {log.map((entry, index) => (
          <div key={`${entry}-${index}`}>{index === 0 ? "» " : ""}{entry}</div>
        ))}
      </div>
    </div>
  );
}
function ScoreEntry({ id }: { id: string }) {
  const name = useGameStore((state) => state.players[id]?.name);
  const color = useGameStore((state) => state.players[id]?.color);
  const score = useGameStore((state) => state.players[id]?.score);
  if (name == null) return null;
  return (
    <span style={{ borderColor: color, color }}>
      {name}: {score}
    </span>
  );
}
