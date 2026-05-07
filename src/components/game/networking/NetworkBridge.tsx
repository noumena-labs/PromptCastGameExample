"use client";

import { useEffect, useRef } from "react";
import { peerSession } from "@/game/networking/peerSession";
import { useGameStore } from "@/game/state/gameStore";
import type { NetworkMessage } from "@/game/networking/messages";

export function NetworkBridge() {
  const lastTransformAt = useRef(0);
  const lastCastSequence = useRef(0);
  const lastCrystalSequence = useRef(0);

  useEffect(() => {
    const unsubscribe = peerSession.onMessage((message) => handleMessage(message));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const state = useGameStore.getState();
      if (state.mode === "solo") return;
      const player = state.players[state.localPlayerId];
      if (!player) return;
      const timestamp = Date.now();
      if (timestamp - lastTransformAt.current > 70) {
        lastTransformAt.current = timestamp;
        peerSession.send({
          type: "player_transform",
          playerId: player.id,
          position: player.position,
          rotationY: player.rotationY,
          velocity: player.velocity,
          timestamp,
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
        });
      }
      if (state.lastCrystalCollect && state.lastCrystalCollect.sequence !== lastCrystalSequence.current) {
        lastCrystalSequence.current = state.lastCrystalCollect.sequence;
        peerSession.send({
          type: "pickup_collect",
          crystalId: state.lastCrystalCollect.crystalId,
          playerId: state.lastCrystalCollect.playerId,
          timestamp,
        });
      }
    }, 50);

    return () => window.clearInterval(interval);
  }, []);

  return null;
}

function handleMessage(message: NetworkMessage) {
  const state = useGameStore.getState();

  if (message.type === "match_start") {
    state.setMode(state.mode === "host" ? "host" : "client", message.roomCode);
    return;
  }

  if (message.type === "player_list") {
    state.setLobbyPlayers(message.players);
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
    state.castSpell(message.spell, message.origin, message.direction, message.targetPoint, message.playerId);
    return;
  }

  if (message.type === "pickup_collect") {
    if (message.playerId !== state.localPlayerId) {
      state.collectCrystalForPlayer(message.crystalId, message.playerId);
    }
    return;
  }

  if (message.type === "pickup_state") {
    state.applyCrystalState(message.crystals);
    return;
  }

  if (message.type === "player_state") {
    if (message.player.id !== state.localPlayerId) state.upsertRemotePlayer(message.player);
  }
}
