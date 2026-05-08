"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { peerSession } from "@/game/networking/peerSession";
import { usePeerSession } from "@/game/networking/usePeerSession";
import { useGameStore } from "@/game/state/gameStore";
import type { NetworkMessage } from "@/game/networking/messages";
import { MultiplayerDebugPanel } from "@/components/game/networking/MultiplayerDebugPanel";

const colors = ["#7a1f1f", "#365a3a", "#2c4a7c", "#b88a2c", "#5a2470", "#8a4a1c"];

function CornerFlourish() {
  return (
    <svg className="tomeCorner tl" viewBox="0 0 64 64" fill="none">
      <path d="M0 32C0 14 14 0 32 0" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 32C8 18 18 8 32 8" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <circle cx="14" cy="14" r="3" fill="currentColor" opacity="0.7" />
      <path d="M22 4L26 8L22 12L18 8Z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function HeroFlourish() {
  return (
    <svg className="heroFlourish" viewBox="0 0 420 32" fill="none">
      <path d="M0 16H140" stroke="currentColor" strokeWidth="1.2" />
      <path d="M280 16H420" stroke="currentColor" strokeWidth="1.2" />
      <path d="M150 16C158 8 170 8 178 16C186 24 198 24 206 16C214 8 226 8 234 16C242 24 254 24 262 16C254 8 242 8 234 16" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="210" cy="16" r="3.5" fill="currentColor" />
      <circle cx="148" cy="16" r="2" fill="currentColor" />
      <circle cx="272" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

export default function Home() {
  const router = useRouter();
  const session = usePeerSession();
  const [name, setName] = useState("Apprentice");
  const [roomCode, setRoomCode] = useState("");
  const [color, setColor] = useState(colors[0]);
  const [busy, setBusy] = useState(false);
  const setLocalIdentity = useGameStore((state) => state.setLocalIdentity);
  const setLocalPlayerProfile = useGameStore((state) => state.setLocalPlayerProfile);
  const setMode = useGameStore((state) => state.setMode);
  const localPlayerId = useGameStore((state) => state.localPlayerId);
  const localIdentityApplied = useRef<string | null>(null);

  useEffect(() => {
    if (!session.peerId || session.role === "offline" || localIdentityApplied.current === session.peerId || localPlayerId === session.peerId) return;
    localIdentityApplied.current = session.peerId;
    setLocalIdentity(session.peerId, name || (session.role === "host" ? "Host Wizard" : "Guest Wizard"), color);
  }, [color, localPlayerId, name, session.peerId, session.role, setLocalIdentity]);

  useEffect(() => {
    const unsubscribe = peerSession.onMessage((message: NetworkMessage) => {
      if (message.type !== "match_start") return;
      setMode("client", message.roomCode);
      router.push(`/game?mode=client&room=${message.roomCode}`);
    });
    return () => unsubscribe();
  }, [router, setMode]);

  const startSolo = () => {
    peerSession.disconnect();
    setLocalPlayerProfile(name || "Apprentice", color);
    setMode("solo", null);
    router.push("/game");
  };

  const createRoom = async () => {
    setBusy(true);
    try {
      const code = await peerSession.createHost(name || "Host Wizard", color);
      const hostId = peerSession.getSnapshot().peerId;
      if (hostId) setLocalIdentity(hostId, name || "Host Wizard", color);
      setMode("host", code);
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault();
    if (!roomCode.trim()) return;
    setBusy(true);
    try {
      await peerSession.joinRoom(roomCode, name || "Guest Wizard", color);
      setMode("client", roomCode.toUpperCase());
    } finally {
      setBusy(false);
    }
  };

  const startHostedMatch = () => {
    peerSession.startMatch();
    router.push(`/game?mode=host&room=${session.roomCode}`);
  };

  return (
    <main className="landing">
      <section className="tome">
        <CornerFlourish />
        <svg className="tomeCorner tr" viewBox="0 0 64 64" fill="none">
          <path d="M0 32C0 14 14 0 32 0" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 32C8 18 18 8 32 8" stroke="currentColor" strokeWidth="1" opacity="0.6" />
          <circle cx="14" cy="14" r="3" fill="currentColor" opacity="0.7" />
        </svg>
        <svg className="tomeCorner bl" viewBox="0 0 64 64" fill="none">
          <path d="M0 32C0 14 14 0 32 0" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 32C8 18 18 8 32 8" stroke="currentColor" strokeWidth="1" opacity="0.6" />
          <circle cx="14" cy="14" r="3" fill="currentColor" opacity="0.7" />
        </svg>
        <svg className="tomeCorner br" viewBox="0 0 64 64" fill="none">
          <path d="M0 32C0 14 14 0 32 0" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 32C8 18 18 8 32 8" stroke="currentColor" strokeWidth="1" opacity="0.6" />
          <circle cx="14" cy="14" r="3" fill="currentColor" opacity="0.7" />
        </svg>

        <div className="heroEyebrow">~ Codex of the Whispering Meadow ~</div>
        <h1 className="heroTitle">PromptCast</h1>
        <HeroFlourish />
        <p className="heroBlurb">
          Beneath the gilded sun of an endless meadow, wizards gather where ancient stones still hum with forgotten power.
          Gather aura crystals, retreat to the sanctuary, and inscribe new spells with naught but words. Then return — and let the duel begin.
        </p>
        <div className="heroActions">
          <button type="button" className="sealButton" onClick={startSolo}>
            Enter the Meadow
          </button>
          <button type="button" className="sealButton ghost" onClick={startSolo}>
            Practice Grounds
          </button>
        </div>
      </section>

      <section className="cardGrid">
        <div className="tomeCard">
          <h2>The Wizard</h2>
          <p>Choose thy name and the color of thy mantle, that allies and rivals may know thee in the field.</p>
          <label htmlFor="playerName">Name</label>
          <input id="playerName" value={name} onChange={(event) => setName(event.target.value)} maxLength={18} />
          <div className="colorGrid" aria-label="Wizard color">
            {colors.map((option) => (
              <button
                key={option}
                type="button"
                className={option === color ? "active" : ""}
                style={{ background: option }}
                onClick={() => setColor(option)}
                aria-label={`Choose ${option}`}
              />
            ))}
          </div>
        </div>

        <div className="tomeCard">
          <h2>Open a Circle</h2>
          <p>Cast forth a sigil-room. Share its name with a fellow wizard and they may step through.</p>
          <button type="button" className="sealButton" onClick={createRoom} disabled={busy}>
            Inscribe Sigil
          </button>
          {session.role === "host" ? (
            <div className="roomPanel">
              <span>Sigil</span>
              <strong>{session.roomCode}</strong>
              <button type="button" className="sealButton" onClick={startHostedMatch} disabled={!session.connected}>
                Begin the Duel
              </button>
              <small>{session.peerOpen ? `${session.connectionCount} joined` : "Opening sigil..."}</small>
            </div>
          ) : null}
        </div>

        <form className="tomeCard" onSubmit={joinRoom}>
          <h2>Answer a Sigil</h2>
          <p>Hast thou received a sigil? Speak it here and walk to thy companion&apos;s meadow.</p>
          <label htmlFor="roomCode">Sigil</label>
          <input id="roomCode" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} maxLength={8} placeholder="ABCDE" />
          <button type="submit" className="sealButton" disabled={busy || !roomCode.trim()}>
            Cross the Threshold
          </button>
          {session.role === "client" ? (
            <button
              type="button"
              className="sealButton ghost"
              onClick={() => router.push(`/game?mode=client&room=${session.roomCode}`)}
              disabled={!session.connected}
              style={{ marginTop: 10 }}
            >
              Step Through
            </button>
          ) : null}
        </form>
      </section>

      {session.error ? <div className="sessionError">A disturbance in the weave: {session.error}</div> : null}
      {session.players.length > 0 ? (
        <section className="playerList">
          <h2>Wizards Gathered</h2>
          {session.players.map((player) => (
            <span key={player.id} style={{ borderColor: player.color }}>
              {player.name} {player.isHost ? "- Hostkeeper" : ""}
            </span>
          ))}
        </section>
      ) : null}
      <MultiplayerDebugPanel />
    </main>
  );
}
