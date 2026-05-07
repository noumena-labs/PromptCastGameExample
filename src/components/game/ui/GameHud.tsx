"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AURA_THRESHOLD, MAGIC_MISSILE, PLAYER_MAX_HEALTH, PLAYER_MAX_MANA, SANCTUARY_DURATION_MS } from "@/game/config/gameConfig";
import { useGameStore } from "@/game/state/gameStore";

const formatCooldown = (expiresAt: number | undefined, currentTime: number) => {
  if (!expiresAt) return "Ready";
  const remaining = Math.max(0, expiresAt - currentTime);
  return remaining <= 0 ? "Ready" : `${(remaining / 1000).toFixed(1)}s`;
};

export function GameHud() {
  const [currentTime, setCurrentTime] = useState(0);
  const player = useGameStore((state) => state.players[state.localPlayerId]);
  const playersById = useGameStore((state) => state.players);
  const log = useGameStore((state) => state.log);
  const roomCode = useGameStore((state) => state.roomCode);
  const mode = useGameStore((state) => state.mode);
  const sanctuaryEndsAt = useGameStore((state) => state.sanctuaryEndsAt);
  const lastGenerationSource = useGameStore((state) => state.lastGenerationSource);
  const resetMatch = useGameStore((state) => state.resetMatch);
  const health = player ? Math.max(0, player.health / PLAYER_MAX_HEALTH) : 0;
  const mana = player ? Math.max(0, player.mana / PLAYER_MAX_MANA) : 0;
  const sanctuaryRemaining = sanctuaryEndsAt ? Math.max(0, sanctuaryEndsAt - currentTime) : SANCTUARY_DURATION_MS;
  const players = Object.values(playersById);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="hud">
      <div className="topBar">
        <div className="brandMark">
          <span>PromptCast</span>
          <small>{mode === "solo" ? "Solo Prototype" : `${mode.toUpperCase()} ${roomCode ?? ""}`}</small>
        </div>
        <div className="scoreBoard">
          {players.map((entry) => (
            <span key={entry.id} style={{ borderColor: entry.color }}>
              {entry.name}: {entry.score}
            </span>
          ))}
        </div>
      </div>

      <div className="crosshair" />

      <div className="leftPanel panel">
        <div className="meterLabel">
          <span>Health</span>
          <span>{Math.round(player?.health ?? 0)}</span>
        </div>
        <div className="meter">
          <div style={{ width: `${health * 100}%`, background: "linear-gradient(90deg, #ff746c, #ffd36e)" }} />
        </div>
        <div className="meterLabel">
          <span>Mana</span>
          <span>{Math.round(player?.mana ?? 0)}</span>
        </div>
        <div className="meter">
          <div style={{ width: `${mana * 100}%`, background: "linear-gradient(90deg, #5da8ff, #b86cff)" }} />
        </div>
        <div className="auraRow">
          <span>Aura Crystals</span>
          <strong>
            {player?.aura ?? 0}/{AURA_THRESHOLD}
          </strong>
        </div>
        <div className="hint">WASD move, Space jump, Left Click Magic Missile, E Sanctuary, 1-4 quick cast.</div>
        {lastGenerationSource ? <div className="hint">Last spell source: {lastGenerationSource}</div> : null}
      </div>

      <div className="rightPanel panel">
        <div className="spellHeader">Spell Slots</div>
        <div className="baseSpell">
          <strong>Mouse</strong>
          <span>{MAGIC_MISSILE.name}</span>
          <small>{formatCooldown(player?.cooldowns[MAGIC_MISSILE.id], currentTime)}</small>
        </div>
        {player?.spellSlots.map((slot, index) => (
          <div key={`slot-${index}`} className="spellSlot" style={{ borderColor: slot?.color ?? "rgba(255,255,255,0.16)" }}>
            <strong>{index + 1}</strong>
            <span>{slot?.name ?? "Empty"}</span>
            <small>{slot ? `${slot.manaCost} mana | ${formatCooldown(player.cooldowns[slot.id], currentTime)}` : "Prompt in Sanctuary"}</small>
          </div>
        ))}
      </div>

      {player?.status === "sanctuary" ? (
        <div className="sanctuaryTimer">
          Sanctuary Shield {(sanctuaryRemaining / 1000).toFixed(1)}s
          <div>
            <span style={{ width: `${(sanctuaryRemaining / SANCTUARY_DURATION_MS) * 100}%` }} />
          </div>
        </div>
      ) : null}

      {player?.status === "dead" ? <div className="deathBanner">Reforming at the nearest leyline...</div> : null}

      <div className="eventLog panel">
        {log.map((entry, index) => (
          <div key={`${entry}-${index}`}>{entry}</div>
        ))}
      </div>

      <div className="bottomActions">
        <button type="button" onClick={resetMatch}>
          Reset Match
        </button>
        <Link href="/">Lobby</Link>
      </div>
    </div>
  );
}
