"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { peerSession, type NetworkDebugEvent } from "@/game/networking/peerSession";
import { usePeerSession } from "@/game/networking/usePeerSession";
import { useGameStore } from "@/game/state/gameStore";

export function MultiplayerDebugPanel() {
  const [queryEnabled, setQueryEnabled] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const enabled = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_MULTIPLAYER_DEBUG === "1" || queryEnabled;
  const session = usePeerSession();
  const [events, setEvents] = useState<NetworkDebugEvent[]>(peerSession.getDebugEvents());
  const [open, setOpen] = useState(false);
  const mode = useGameStore((state) => state.mode);
  const roomCode = useGameStore((state) => state.roomCode);
  const localPlayerId = useGameStore((state) => state.localPlayerId);
  const players = useGameStore((state) => state.players);
  const lobbyPlayers = useGameStore((state) => state.lobbyPlayers);
  const crystals = useGameStore((state) => state.crystals);
  const manaMotes = useGameStore((state) => state.manaMotes);
  const dummyTargets = useGameStore((state) => state.dummyTargets);
  const hostSnapshotSequence = useGameStore((state) => state.hostSnapshotSequence);
  const lastHostSnapshot = useGameStore((state) => state.lastHostSnapshot);
  const playerIds = Object.keys(players);
  const activeCrystals = crystals.filter((crystal) => crystal.active).length;
  const activeMotes = manaMotes.filter((mote) => mote.active).length;
  const ephemeralMotes = manaMotes.filter((mote) => mote.ephemeral).length;
  const downTargets = dummyTargets.filter((target) => target.respawnAt !== null).length;
  const snapshotAge = lastHostSnapshot ? currentTime - lastHostSnapshot.receivedAt : null;

  useEffect(() => peerSession.subscribeDebug(setEvents), []);
  useEffect(() => {
    window.setTimeout(() => {
      setQueryEnabled(new URLSearchParams(window.location.search).get("debugNetwork") === "1");
    }, 0);
  }, []);
  useEffect(() => {
    window.setTimeout(() => setCurrentTime(Date.now()), 0);
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, []);

  if (!enabled) return null;

  return (
    <aside className={`networkDebug${open ? " open" : ""}`}>
      <button type="button" className="networkDebugToggle" onClick={() => setOpen((value) => !value)}>
        Net {session.role}/{session.connected ? "ready" : session.peerOpen ? "peer" : "off"}
      </button>
      {open ? (
        <div className="networkDebugPanel">
          <div className="networkDebugHeader">
            <strong>Multiplayer Debug</strong>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
          <dl>
            <Row label="role" value={session.role} />
            <Row label="peer" value={session.peerId ?? "none"} />
            <Row label="room" value={session.roomCode ?? roomCode ?? "none"} />
            <Row label="peer open" value={String(session.peerOpen)} />
            <Row label="data ready" value={String(session.connected)} />
            <Row label="connections" value={String(session.connectionCount)} />
            <Row label="mode" value={mode} />
            <Row label="local id" value={localPlayerId} />
            <Row label="store players" value={playerIds.join(", ") || "none"} />
            <Row label="lobby players" value={lobbyPlayers.map((player) => player.id).join(", ") || "none"} />
            <Row label="snapshot" value={lastHostSnapshot ? `#${hostSnapshotSequence} age ${snapshotAge}ms` : "none"} />
            <Row label="world" value={`crystals ${activeCrystals}/${crystals.length}, motes ${activeMotes}/${manaMotes.length} (${ephemeralMotes} drops), targets down ${downTargets}/${dummyTargets.length}`} />
            {session.error ? <Row label="error" value={session.error} /> : null}
          </dl>
          <div className="networkDebugActions">
            <button type="button" onClick={() => peerSession.requestPlayerList()} disabled={session.role !== "client"}>Request Roster</button>
            <button type="button" onClick={() => peerSession.rebroadcastPlayerList()} disabled={session.role !== "host"}>Rebroadcast Roster</button>
            <button type="button" onClick={() => peerSession.sendDebugPing("manual")} disabled={session.role === "offline"}>Ping</button>
            <button type="button" onClick={() => peerSession.disconnect()} disabled={session.role === "offline"}>Disconnect</button>
          </div>
          <DebugSection title="Players">
            <table>
              <thead><tr><th>id</th><th>hp</th><th>mana</th><th>aura</th><th>score</th><th>status</th><th>pos</th></tr></thead>
              <tbody>
                {Object.values(players).map((player) => (
                  <tr key={player.id}>
                    <td>{shortId(player.id)}{player.id === localPlayerId ? " *" : ""}</td>
                    <td>{Math.round(player.health)}</td>
                    <td>{Math.round(player.mana)}</td>
                    <td>{player.aura}</td>
                    <td>{player.score}</td>
                    <td>{player.status}{player.isShielded ? "/shield" : ""}</td>
                    <td>{formatVec(player.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DebugSection>
          <DebugSection title="Crystals">
            <div className="networkDebugChips">
              {crystals.map((crystal) => (
                <span key={crystal.id} className={crystal.active ? "ok" : "stale"}>{crystal.id}: {crystal.active ? "up" : formatTimer(crystal.respawnAt, currentTime)}</span>
              ))}
            </div>
          </DebugSection>
          <DebugSection title="Mana Motes">
            <div className="networkDebugChips">
              {manaMotes.slice(0, 40).map((mote) => (
                <span key={mote.id} className={mote.active ? "ok" : "stale"}>{shortId(mote.id)}: {mote.active ? `${mote.amount}${mote.ephemeral ? "e" : ""}` : formatTimer(mote.respawnAt ?? mote.decayAt, currentTime)}</span>
              ))}
              {manaMotes.length > 40 ? <span>+{manaMotes.length - 40} more</span> : null}
            </div>
          </DebugSection>
          <DebugSection title="Targets">
            <table>
              <thead><tr><th>id</th><th>health</th><th>respawn</th><th>pos</th></tr></thead>
              <tbody>
                {dummyTargets.map((target) => (
                  <tr key={target.id}>
                    <td>{target.id}</td>
                    <td>{Math.round(target.health)} / {target.maxHealth}</td>
                    <td>{formatTimer(target.respawnAt, currentTime)}</td>
                    <td>{formatVec(target.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DebugSection>
          <div className="networkDebugEvents">
            {events.length === 0 ? <span>No network events yet.</span> : null}
            {events.map((event) => (
              <div key={event.id} className={`networkDebugEvent ${event.direction}`}>
                <span>{new Date(event.at).toLocaleTimeString()}</span>
                <strong>{event.direction}</strong>
                <code>{event.type}</code>
                {event.peerId ? <small>{event.peerId}</small> : null}
                {event.reason ? <em>{event.reason}</em> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function DebugSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="networkDebugSection">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

function formatVec(position: [number, number, number]) {
  return `${position[0].toFixed(1)},${position[1].toFixed(1)},${position[2].toFixed(1)}`;
}

function formatTimer(timestamp: number | null, now: number) {
  if (!timestamp) return "ready";
  return `${Math.max(0, (timestamp - now) / 1000).toFixed(1)}s`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
