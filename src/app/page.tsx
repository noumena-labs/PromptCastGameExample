"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { peerSession } from "@/game/networking/peerSession";
import { usePeerSession } from "@/game/networking/usePeerSession";
import { useGameStore } from "@/game/state/gameStore";

const colors = ["#74f7d0", "#b86cff", "#ffd36e", "#ff746c", "#8ae9ff", "#62e37b"];

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
  const featureCards = useMemo(
    () => [
      ["Prompt Magic", "Collect Aura Crystals, levitate inside a shield, and generate custom spells from natural language."],
      ["Arena Combat", "A dusk low-poly ruin with vertical platforms, crystals, dummy targets, and glowing VFX."],
      ["P2P Rooms", "PeerJS room scaffolding supports host/client data channels for transforms, casts, and pickups."],
    ],
    [],
  );

  const startSolo = () => {
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
      window.setTimeout(() => {
        const peerId = peerSession.getSnapshot().peerId;
        if (peerId) setLocalIdentity(peerId, name || "Guest Wizard", color);
      }, 500);
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
      <section className="heroPanel">
        <div className="heroCopy">
          <div className="eyebrow">Low-poly browser spellcasting prototype</div>
          <h1>PromptCast</h1>
          <p>
            Duel as a wizard in a glowing dusk arena. Cast reliable Magic Missiles, harvest Aura Crystals, then enter Sanctuary to prompt new match-local spells.
          </p>
          <div className="heroActions">
            <button type="button" onClick={startSolo}>
              Play Solo Vertical Slice
            </button>
            <Link href="/game">Open Arena</Link>
          </div>
        </div>
        <div className="orbitalCard">
          <div className="orbitalCore" />
          <span className="orbit orbitOne" />
          <span className="orbit orbitTwo" />
          <span className="orbit orbitThree" />
        </div>
      </section>

      <section className="setupGrid">
        <div className="setupCard">
          <h2>Wizard</h2>
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

        <div className="setupCard">
          <h2>Host Room</h2>
          <p>Create a PeerJS room. Share the room code with another browser tab or machine.</p>
          <button type="button" onClick={createRoom} disabled={busy}>
            Create Room
          </button>
          {session.role === "host" ? (
            <div className="roomPanel">
              <span>Room Code</span>
              <strong>{session.roomCode}</strong>
              <button type="button" onClick={startHostedMatch} disabled={!session.connected}>
                Start Hosted Match
              </button>
            </div>
          ) : null}
        </div>

        <form className="setupCard" onSubmit={joinRoom}>
          <h2>Join Room</h2>
          <label htmlFor="roomCode">Room code</label>
          <input id="roomCode" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} maxLength={8} placeholder="ABCDE" />
          <button type="submit" disabled={busy || !roomCode.trim()}>
            Join Room
          </button>
          {session.role === "client" ? (
            <button type="button" onClick={() => router.push(`/game?mode=client&room=${session.roomCode}`)} disabled={!session.connected}>
              Enter Client Match
            </button>
          ) : null}
        </form>
      </section>

      {session.error ? <div className="sessionError">PeerJS: {session.error}</div> : null}
      {session.players.length > 0 ? (
        <section className="playerList">
          <h2>Room Players</h2>
          {session.players.map((player) => (
            <span key={player.id} style={{ borderColor: player.color }}>
              {player.name} {player.isHost ? "(host)" : ""}
            </span>
          ))}
        </section>
      ) : null}

      <section className="featureGrid">
        {featureCards.map(([title, description]) => (
          <article key={title}>
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
