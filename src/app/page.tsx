"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { peerSession } from "@/game/networking/peerSession";
import { usePeerSession } from "@/game/networking/usePeerSession";
import { useGameStore } from "@/game/state/gameStore";
import type { NetworkMessage } from "@/game/networking/messages";
import { MultiplayerDebugPanel } from "@/components/game/networking/MultiplayerDebugPanel";

type MantleColor = { value: string; label: string };

const MANTLE_COLORS: MantleColor[] = [
  { value: "#7a1f1f", label: "Crimson" },
  { value: "#365a3a", label: "Forest" },
  { value: "#2c4a7c", label: "Sapphire" },
  { value: "#b88a2c", label: "Amber" },
  { value: "#5a2470", label: "Violet" },
  { value: "#8a4a1c", label: "Ember" },
];

function CornerFlourish({ position }: { position: "tl" | "tr" | "bl" | "br" }) {
  return (
    <svg className={`tomeCorner ${position}`} viewBox="0 0 64 64" fill="none" aria-hidden>
      <path d="M0 32C0 14 14 0 32 0" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 32C8 18 18 8 32 8" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <circle cx="14" cy="14" r="3" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function HeroFlourish() {
  return (
    <svg className="heroFlourish" viewBox="0 0 420 32" fill="none" aria-hidden>
      <path d="M0 16H140" stroke="currentColor" strokeWidth="1.2" />
      <path d="M280 16H420" stroke="currentColor" strokeWidth="1.2" />
      <path d="M150 16C158 8 170 8 178 16C186 24 198 24 206 16C214 8 226 8 234 16C242 24 254 24 262 16C254 8 242 8 234 16" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="210" cy="16" r="3.5" fill="currentColor" />
      <circle cx="148" cy="16" r="2" fill="currentColor" />
      <circle cx="272" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

function HowToPlayModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="howToPlayTitle" onClick={onClose}>
      <div className="modalPanel" onClick={(event) => event.stopPropagation()}>
        <CornerFlourish position="tl" />
        <CornerFlourish position="tr" />
        <CornerFlourish position="bl" />
        <CornerFlourish position="br" />

        <button type="button" className="modalClose" onClick={onClose} aria-label="Close">
          ×
        </button>

        <header className="modalHeader">
          <div className="heroEyebrow">~ The Apprentice&apos;s Primer ~</div>
          <h2 id="howToPlayTitle" className="modalTitle">How to Play</h2>
        </header>

        <ol className="howToPlaySteps">
          <li>
            <h3>1 · Gather</h3>
            <p>
              Roam the meadow. Collect <strong>mana motes</strong> for fuel and <strong>aura crystals</strong> to
              unlock the Sanctuary. Three crystals open one inscription.
            </p>
          </li>
          <li>
            <h3>2 · Inscribe</h3>
            <p>
              Press <kbd>E</kbd> to enter the Sanctuary. Whisper an intent — a single sentence — and a spell is forged
              from your words. Bind it to a runestone <kbd>1</kbd>–<kbd>4</kbd>.
            </p>
          </li>
          <li>
            <h3>3 · Duel</h3>
            <p>
              Click the meadow to lock the camera. Move with <kbd>WASD</kbd>, leap with <kbd>Space</kbd>, loose Magic
              Missile with <kbd>Left Click</kbd>, and unleash bound spells with <kbd>1</kbd>–<kbd>4</kbd>.
            </p>
          </li>
        </ol>

        <div className="modalActions">
          <button type="button" className="sealButton" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const session = usePeerSession();
  const [name, setName] = useState("Apprentice");
  const [roomCode, setRoomCode] = useState("");
  const [color, setColor] = useState(MANTLE_COLORS[0].value);
  const [busy, setBusy] = useState(false);
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
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
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    try {
      await peerSession.joinRoom(code, name || "Guest Wizard", color);
      setMode("client", code);
      router.push(`/game?mode=client&room=${code}`);
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
      <section className="tome" aria-labelledby="heroTitle">
        <CornerFlourish position="tl" />
        <CornerFlourish position="tr" />
        <CornerFlourish position="bl" />
        <CornerFlourish position="br" />

        <div className="heroEyebrow">~ Codex of the Whispering Meadow ~</div>
        <h1 id="heroTitle" className="heroTitle">PromptCast</h1>
        <HeroFlourish />
        <p className="heroBlurb">
          A spellcasting arena where you write your own magic. Gather aura crystals, retreat to the Sanctuary,
          and inscribe new spells with a single sentence. Then return to the meadow and duel.
        </p>
        <div className="heroActions">
          <button type="button" className="sealButton" onClick={startSolo}>
            Start Solo Practice
          </button>
          <button
            type="button"
            className="sealButton ghost"
            onClick={() => setHowToPlayOpen(true)}
            aria-haspopup="dialog"
          >
            How to Play
          </button>
        </div>
        <p className="heroHelper">
          Solo Practice drops you alone in the meadow with crystals, mana motes, and target dummies — perfect for
          experimenting with spell prompts.
        </p>
      </section>

      <section className="cardGrid">
        <div className="tomeCard">
          <h2>Wizard Profile</h2>
          <p>Choose a name and mantle color so allies and rivals may know you in the field.</p>
          <label htmlFor="playerName">Name</label>
          <input id="playerName" value={name} onChange={(event) => setName(event.target.value)} maxLength={18} />
          <span className="fieldLabel" id="mantleLabel">Mantle</span>
          <div className="colorGrid" role="radiogroup" aria-labelledby="mantleLabel">
            {MANTLE_COLORS.map((option) => {
              const active = option.value === color;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? "active" : ""}
                  style={{ background: option.value }}
                  onClick={() => setColor(option.value)}
                  aria-label={option.label}
                  title={option.label}
                />
              );
            })}
          </div>
        </div>

        <div className="tomeCard">
          <h2>Host Multiplayer</h2>
          <p>Open a room and share the code with a friend. They can join from their own browser.</p>
          <button type="button" className="sealButton" onClick={createRoom} disabled={busy || session.role === "host"}>
            {session.role === "host" ? "Room Open" : "Create Room"}
          </button>
          {session.role === "host" ? (
            <div className="roomPanel">
              <span>Room Code</span>
              <strong>{session.roomCode}</strong>
              <button type="button" className="sealButton" onClick={startHostedMatch} disabled={!session.connected}>
                Start Match
              </button>
              <small>
                {session.peerOpen
                  ? session.connectionCount > 0
                    ? `${session.connectionCount} wizard${session.connectionCount === 1 ? "" : "s"} joined`
                    : "Waiting for a wizard to join..."
                  : "Opening room..."}
              </small>
            </div>
          ) : null}
        </div>

        <form className="tomeCard" onSubmit={joinRoom}>
          <h2>Join Multiplayer</h2>
          <p>Got a room code from a friend? Enter it below to step into their meadow.</p>
          <label htmlFor="roomCode">Room Code</label>
          <input
            id="roomCode"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            maxLength={8}
            placeholder="ABCDE"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="sealButton" disabled={busy || !roomCode.trim()}>
            {busy ? "Joining..." : "Join Room"}
          </button>
        </form>
      </section>

      {session.error ? <div className="sessionError">A disturbance in the weave: {session.error}</div> : null}
      {session.players.length > 0 ? (
        <section className="playerList">
          <h2>Wizards Gathered</h2>
          {session.players.map((player) => (
            <span key={player.id} style={{ borderColor: player.color }}>
              {player.name} {player.isHost ? "· Host" : ""}
            </span>
          ))}
        </section>
      ) : null}
      <MultiplayerDebugPanel />
      {howToPlayOpen ? <HowToPlayModal onClose={() => setHowToPlayOpen(false)} /> : null}
    </main>
  );
}
