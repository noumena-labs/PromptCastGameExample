"use client";

import { useEffect, useRef } from "react";
import { peerSession } from "@/game/networking/peerSession";
import { useGameStore } from "@/game/state/gameStore";
import type { NetworkMessage } from "@/game/networking/messages";
import { validateGeneratedSpell } from "@/game/spells/spellSchema";

const HOST_SNAPSHOT_INTERVAL_MS = 250;

export function NetworkBridge() {
  const lastTransformAt = useRef(0);
  const transformSequence = useRef(0);
  const lastCastSequence = useRef(0);
  const lastCrystalSequence = useRef(0);
  const lastManaMoteSequence = useRef(0);
  const lastSanctuarySequence = useRef(0);
  const lastSpellBoundSequence = useRef(0);
  const hostSnapshotSequence = useRef(0);
  const lastHostSnapshotAt = useRef(0);

  useEffect(() => {
    const unsubscribe = peerSession.onMessage((message) => handleMessage(message));
    hydrateSessionSnapshot();
    peerSession.requestPlayerList();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const state = useGameStore.getState();
      if (state.mode === "solo") return;
      const session = peerSession.getSnapshot();
      const player = state.players[state.localPlayerId];
      const timestamp = Date.now();
      if (state.mode === "host" && session.role === "host" && session.connected && timestamp - lastHostSnapshotAt.current > HOST_SNAPSHOT_INTERVAL_MS) {
        lastHostSnapshotAt.current = timestamp;
        hostSnapshotSequence.current += 1;
        const snapshot = {
          sequence: hostSnapshotSequence.current,
          serverTime: timestamp,
          players: Object.values(state.players),
          crystals: state.crystals,
          manaMotes: state.manaMotes,
          dummyTargets: state.dummyTargets,
        };
        useGameStore.setState({ hostSnapshotSequence: snapshot.sequence, lastHostSnapshot: { sequence: snapshot.sequence, serverTime: timestamp, receivedAt: timestamp } });
        peerSession.send({ type: "host_state_snapshot", snapshot });
      }
      if (!session.peerId || session.peerId !== state.localPlayerId) return;
      if (!player) return;
      if (timestamp - lastTransformAt.current > 70) {
        lastTransformAt.current = timestamp;
        transformSequence.current += 1;
        peerSession.send({
          type: "player_transform",
          playerId: player.id,
          position: player.position,
          rotationY: player.rotationY,
          velocity: player.velocity,
          timestamp,
          sequence: transformSequence.current,
        });
      }
      if (state.lastLocalCast && state.lastLocalCast.sequence !== lastCastSequence.current) {
        lastCastSequence.current = state.lastLocalCast.sequence;
        peerSession.send({
          type: "player_cast_spell",
          playerId: state.lastLocalCast.playerId,
          spell: state.lastLocalCast.spell,
          origin: state.lastLocalCast.origin,
          direction: state.lastLocalCast.direction,
          targetPoint: state.lastLocalCast.targetPoint,
          timestamp,
          sequence: state.lastLocalCast.sequence,
        });
      }
      if (state.lastCrystalCollect && state.lastCrystalCollect.sequence !== lastCrystalSequence.current) {
        lastCrystalSequence.current = state.lastCrystalCollect.sequence;
        peerSession.send({
          type: "pickup_collect",
          crystalId: state.lastCrystalCollect.crystalId,
          playerId: state.lastCrystalCollect.playerId,
          timestamp,
          sequence: state.lastCrystalCollect.sequence,
        });
      }
      if (state.lastManaMoteCollect && state.lastManaMoteCollect.sequence !== lastManaMoteSequence.current) {
        lastManaMoteSequence.current = state.lastManaMoteCollect.sequence;
        peerSession.send({
          type: "mana_mote_collect",
          moteId: state.lastManaMoteCollect.moteId,
          playerId: state.lastManaMoteCollect.playerId,
          timestamp,
          sequence: state.lastManaMoteCollect.sequence,
        });
      }
      if (state.lastSanctuaryEvent && state.lastSanctuaryEvent.sequence !== lastSanctuarySequence.current) {
        lastSanctuarySequence.current = state.lastSanctuaryEvent.sequence;
        peerSession.send({
          type: "sanctuary_state",
          playerId: state.lastSanctuaryEvent.playerId,
          action: state.lastSanctuaryEvent.action,
          timestamp,
          sequence: state.lastSanctuaryEvent.sequence,
        });
      }
      if (state.lastSpellBound && state.lastSpellBound.sequence !== lastSpellBoundSequence.current) {
        lastSpellBoundSequence.current = state.lastSpellBound.sequence;
        peerSession.send({
          type: "spell_bound",
          playerId: state.lastSpellBound.playerId,
          slot: state.lastSpellBound.slot,
          spell: state.lastSpellBound.spell,
          timestamp,
          sequence: state.lastSpellBound.sequence,
        });
      }
    }, 50);

    return () => window.clearInterval(interval);
  }, []);

  return null;
}

const lastTransformSequences = new Map<string, number>();
const seenCastSequences = new Set<string>();
const seenPickupSequences = new Set<string>();
const seenManaMoteSequences = new Set<string>();
const seenSanctuarySequences = new Set<string>();
const seenSpellBoundSequences = new Set<string>();

function hydrateSessionSnapshot() {
  const snapshot = peerSession.getSnapshot();
  const state = useGameStore.getState();
  if (snapshot.players.length === 0) return;
  state.setLobbyPlayers(snapshot.players, true);
  for (const player of snapshot.players) {
    if (player.id !== state.localPlayerId) {
      state.upsertRemotePlayer({ id: player.id, name: player.name, color: player.color });
    }
  }
}

function handleMessage(message: NetworkMessage) {
  const state = useGameStore.getState();

  if (message.type === "player_list") {
    state.setLobbyPlayers(message.players, true);
    for (const player of message.players) {
      if (player.id !== state.localPlayerId) {
        state.upsertRemotePlayer({ id: player.id, name: player.name, color: player.color });
      }
    }
    return;
  }

  if (message.type === "player_hello") {
    if (message.player.id !== state.localPlayerId) {
      state.upsertRemotePlayer({ id: message.player.id, name: message.player.name, color: message.player.color });
    }
    return;
  }

  if (message.type === "player_transform") {
    if (message.playerId === state.localPlayerId) return;
    const lastSequence = lastTransformSequences.get(message.playerId) ?? 0;
    if (message.sequence <= lastSequence) return;
    lastTransformSequences.set(message.playerId, message.sequence);
    const existing = state.players[message.playerId];
    state.upsertRemotePlayer({
      id: message.playerId,
      name: existing?.name ?? "Remote Wizard",
      color: existing?.color ?? "#b86cff",
      position: message.position,
      rotationY: message.rotationY,
      velocity: message.velocity,
    });
    return;
  }

  if (message.type === "player_cast_spell") {
    if (message.playerId === state.localPlayerId) return;
    const key = `${message.playerId}:${message.sequence}`;
    if (seenCastSequences.has(key)) return;
    seenCastSequences.add(key);
    try {
      state.castSpell(validateGeneratedSpell(message.spell), message.origin, message.direction, message.targetPoint, message.playerId);
    } catch (error) {
      state.addLog(error instanceof Error ? error.message : "Invalid remote spell payload.");
    }
    return;
  }

  if (message.type === "pickup_collect") {
    const key = `${message.playerId}:${message.sequence}`;
    if (seenPickupSequences.has(key)) return;
    seenPickupSequences.add(key);
    if (message.playerId !== state.localPlayerId) {
      state.collectCrystalForPlayer(message.crystalId, message.playerId);
    }
    return;
  }

  if (message.type === "mana_mote_collect") {
    const key = `${message.playerId}:${message.sequence}`;
    if (seenManaMoteSequences.has(key)) return;
    seenManaMoteSequences.add(key);
    if (message.playerId !== state.localPlayerId) {
      state.collectManaMoteForPlayer(message.moteId, message.playerId);
    }
    return;
  }

  if (message.type === "sanctuary_state") {
    const key = `${message.playerId}:${message.sequence}`;
    if (seenSanctuarySequences.has(key)) return;
    seenSanctuarySequences.add(key);
    if (message.playerId !== state.localPlayerId) {
      if (message.action === "enter") state.enterSanctuaryForPlayer(message.playerId);
      else state.exitSanctuaryForPlayer(message.playerId);
    }
    return;
  }

  if (message.type === "spell_bound") {
    const key = `${message.playerId}:${message.sequence}`;
    if (seenSpellBoundSequences.has(key)) return;
    seenSpellBoundSequences.add(key);
    if (message.playerId !== state.localPlayerId) {
      try {
        state.saveGeneratedSpellForPlayer(message.playerId, message.slot, validateGeneratedSpell(message.spell));
      } catch (error) {
        state.addLog(error instanceof Error ? error.message : "Invalid remote bound spell payload.");
      }
    }
    return;
  }

  if (message.type === "pickup_state") {
    state.applyCrystalState(message.crystals);
    return;
  }

  if (message.type === "host_state_snapshot") {
    if (state.mode !== "host") state.applyHostSnapshot(message.snapshot);
    return;
  }

  if (message.type === "player_state") {
    if (message.player.id !== state.localPlayerId) state.upsertRemotePlayer(message.player);
  }
}
