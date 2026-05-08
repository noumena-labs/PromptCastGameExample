import type { DataConnection, Peer, PeerOptions } from "peerjs";
import { nanoid } from "nanoid";
import type { LobbyPlayer, NetworkRole } from "@/game/types";
import { parseNetworkMessage, type NetworkMessage } from "@/game/networking/messages";

type SessionSnapshot = {
  role: NetworkRole;
  peerId: string | null;
  roomCode: string | null;
  peerOpen: boolean;
  connected: boolean;
  connectionCount: number;
  players: LobbyPlayer[];
  error: string | null;
};

export type NetworkDebugEvent = {
  id: string;
  at: number;
  direction: "in" | "out" | "drop" | "system";
  type: string;
  peerId?: string;
  reason?: string;
};

type SessionListener = (snapshot: SessionSnapshot) => void;
type MessageListener = (message: NetworkMessage) => void;
type DebugListener = (events: NetworkDebugEvent[]) => void;

const MAX_DEBUG_EVENTS = 40;
const CONNECT_TIMEOUT_MS = 12000;
const CONNECTION_LABEL = "promptcast-game";
const makeRoomCode = () => nanoid(5).replace(/[^a-z0-9]/gi, "").toUpperCase().padEnd(5, "X").slice(0, 5);
const roomPeerId = (code: string) => `promptcast-${code.toLowerCase()}`;

const sanitizeRoomCode = (code: string) => code.trim().replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8);

function getPeerOptions(): PeerOptions {
  const options: PeerOptions = { debug: peerDebugLevel() };
  const host = process.env.NEXT_PUBLIC_PEER_HOST?.trim();
  const port = Number(process.env.NEXT_PUBLIC_PEER_PORT);
  const path = process.env.NEXT_PUBLIC_PEER_PATH?.trim();
  const secure = process.env.NEXT_PUBLIC_PEER_SECURE?.trim().toLowerCase();

  if (host) options.host = host;
  if (Number.isInteger(port) && port > 0) options.port = port;
  if (path) options.path = path;
  if (secure === "true") options.secure = true;
  if (secure === "false") options.secure = false;
  return options;
}

function peerDebugLevel(): 0 | 1 | 2 | 3 {
  const configured = Number(process.env.NEXT_PUBLIC_PEER_DEBUG);
  if (configured === 0 || configured === 1 || configured === 2 || configured === 3) return configured;
  return process.env.NODE_ENV === "development" ? 1 : 0;
}

function messageActor(message: NetworkMessage): string | null {
  if (message.type === "player_hello") return message.player.id;
  if (message.type === "player_transform") return message.playerId;
  if (message.type === "player_cast_spell") return message.playerId;
  if (message.type === "pickup_collect") return message.playerId;
  if (message.type === "mana_mote_collect") return message.playerId;
  if (message.type === "sanctuary_state") return message.playerId;
  if (message.type === "spell_bound") return message.playerId;
  if (message.type === "player_state") return message.player.id;
  if (message.type === "player_list_request") return message.requesterId;
  if (message.type === "debug_ping") return message.senderId;
  return null;
}

function messageType(value: unknown) {
  if (typeof value === "object" && value !== null && "type" in value && typeof (value as { type: unknown }).type === "string") {
    return (value as { type: string }).type;
  }
  return "invalid";
}

class PeerSession {
  private peer: Peer | null = null;
  private hostConnection: DataConnection | null = null;
  private connections = new Map<string, DataConnection>();
  private snapshot: SessionSnapshot = {
    role: "offline",
    peerId: null,
    roomCode: null,
    peerOpen: false,
    connected: false,
    connectionCount: 0,
    players: [],
    error: null,
  };
  private sessionListeners = new Set<SessionListener>();
  private messageListeners = new Set<MessageListener>();
  private debugListeners = new Set<DebugListener>();
  private debugEvents: NetworkDebugEvent[] = [];
  private sessionToken = 0;

  subscribe(listener: SessionListener) {
    this.sessionListeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.sessionListeners.delete(listener);
    };
  }

  onMessage(listener: MessageListener) {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  subscribeDebug(listener: DebugListener) {
    this.debugListeners.add(listener);
    listener(this.debugEvents);
    return () => {
      this.debugListeners.delete(listener);
    };
  }

  getSnapshot() {
    return this.snapshot;
  }

  getDebugEvents() {
    return this.debugEvents;
  }

  async createHost(playerName: string, color: string) {
    const token = this.beginSession();
    const { Peer } = await import("peerjs");
    if (token !== this.sessionToken) return "";

    const roomCode = makeRoomCode();
    const hostId = roomPeerId(roomCode);
    const hostPlayer: LobbyPlayer = { id: hostId, name: playerName || "Host Wizard", color, isHost: true };
    this.patch({ role: "host", peerId: hostId, roomCode, peerOpen: false, connected: false, players: [hostPlayer], error: null });
    this.recordDebug("system", "host_create", hostId);

    this.peer = new Peer(hostId, getPeerOptions());
    this.peer.on("open", (id) => {
      if (token !== this.sessionToken) return;
      this.patch({ peerId: id, peerOpen: true, connected: true });
      this.recordDebug("system", "peer_open", id);
    });
    this.peer.on("connection", (connection) => {
      if (token !== this.sessionToken) return;
      this.registerConnection(connection, true);
    });
    this.peer.on("error", (error) => {
      if (token !== this.sessionToken) return;
      this.patch({ error: error.message, connected: false });
      this.recordDebug("drop", "peer_error", undefined, error.message);
    });
    this.peer.on("disconnected", () => {
      if (token !== this.sessionToken) return;
      this.patch({ peerOpen: false, connected: false });
      this.recordDebug("system", "peer_disconnected");
    });
    return roomCode;
  }

  async joinRoom(roomCodeInput: string, playerName: string, color: string, profileId?: string) {
    const token = this.beginSession();
    const { Peer } = await import("peerjs");
    if (token !== this.sessionToken) return "";

    const roomCode = sanitizeRoomCode(roomCodeInput);
    this.patch({ role: "client", peerId: null, roomCode, peerOpen: false, connected: false, players: [], error: null });
    this.recordDebug("system", "client_join", roomPeerId(roomCode));

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => fail(new Error("Timed out connecting to host.")), CONNECT_TIMEOUT_MS);

      const finish = (id: string) => {
        if (settled || token !== this.sessionToken) return;
        settled = true;
        clearTimeout(timeout);
        resolve(id);
      };

      const fail = (error: Error) => {
        if (settled || token !== this.sessionToken) return;
        settled = true;
        clearTimeout(timeout);
        this.connections.forEach((connection) => connection.close());
        this.connections.clear();
        this.hostConnection = null;
        this.peer?.destroy();
        this.peer = null;
        this.patch({ role: "offline", peerId: null, peerOpen: false, connected: false, connectionCount: 0, players: [], error: error.message });
        this.recordDebug("drop", "client_join", roomPeerId(roomCode), error.message);
        reject(error);
      };

      this.peer = new Peer(getPeerOptions());
      this.peer.on("open", (id) => {
        if (settled || token !== this.sessionToken) return;
        this.patch({ peerId: id, peerOpen: true, connected: false });
        this.recordDebug("system", "peer_open", id);
        const connection = this.peer?.connect(roomPeerId(roomCode), { reliable: true, label: CONNECTION_LABEL });
        if (!connection) {
          fail(new Error("Unable to create host connection."));
          return;
        }
        this.hostConnection = connection;
        this.registerConnection(connection, false);
        connection.on("open", () => {
          if (settled || token !== this.sessionToken) return;
          this.patch({ connected: true });
          this.send({ type: "player_hello", player: { id, name: playerName || "Guest Wizard", color, isHost: false, profileId } });
          finish(id);
        });
        connection.on("error", (error) => fail(error));
        connection.on("close", () => {
          if (!settled) fail(new Error("Host connection closed before it opened."));
        });
      });
      this.peer.on("error", (error) => {
        if (token !== this.sessionToken) return;
        this.patch({ error: error.message, connected: false });
        this.recordDebug("drop", "peer_error", undefined, error.message);
        fail(error);
      });
      this.peer.on("disconnected", () => {
        if (token !== this.sessionToken) return;
        this.patch({ peerOpen: false, connected: false });
        this.recordDebug("system", "peer_disconnected");
      });
    });
  }

  requestPlayerList() {
    const { peerId } = this.snapshot;
    if (!peerId || this.snapshot.role !== "client") return;
    this.send({ type: "player_list_request", requesterId: peerId, timestamp: Date.now() });
  }

  rebroadcastPlayerList() {
    if (this.snapshot.role !== "host") return;
    this.broadcast({ type: "player_list", players: this.snapshot.players });
  }

  sendDebugPing(note?: string) {
    const { peerId } = this.snapshot;
    if (!peerId || this.snapshot.role === "offline") return;
    this.send({ type: "debug_ping", id: nanoid(8), senderId: peerId, timestamp: Date.now(), note });
  }

  send(message: NetworkMessage) {
    if (this.snapshot.role === "host") {
      this.broadcast(message);
      return;
    }
    if (this.hostConnection?.open) {
      this.sendTo(this.hostConnection, message);
    } else {
      this.recordDebug("drop", message.type, undefined, "host_connection_not_open");
    }
  }

  broadcast(message: NetworkMessage) {
    this.connections.forEach((connection) => this.sendTo(connection, message));
  }

  disconnect() {
    this.sessionToken += 1;
    this.connections.forEach((connection) => connection.close());
    this.connections.clear();
    this.hostConnection = null;
    this.peer?.destroy();
    this.peer = null;
    this.patch({
      role: "offline",
      peerId: null,
      roomCode: null,
      peerOpen: false,
      connected: false,
      connectionCount: 0,
      players: [],
      error: null,
    });
    this.recordDebug("system", "disconnect");
  }

  private beginSession() {
    this.disconnect();
    this.sessionToken += 1;
    return this.sessionToken;
  }

  private registerConnection(connection: DataConnection, hostSide: boolean) {
    if (connection.label && connection.label !== CONNECTION_LABEL) {
      connection.close();
      this.recordDebug("drop", "connection", connection.peer, "unexpected_label");
      return;
    }

    const existing = this.connections.get(connection.peer);
    if (existing && existing !== connection) existing.close();
    this.connections.set(connection.peer, connection);
    this.patchConnectionState();
    this.recordDebug("system", "connection_registered", connection.peer);

    connection.on("open", () => {
      if (this.connections.get(connection.peer) !== connection) return;
      if (!hostSide) this.patch({ connected: true });
      this.patchConnectionState();
      this.recordDebug("system", "connection_open", connection.peer);
    });
    connection.on("data", (data) => this.handleData(data, connection, hostSide));
    connection.on("close", () => this.handleClose(connection));
    connection.on("error", (error) => {
      if (this.connections.get(connection.peer) !== connection) return;
      this.patch({ error: error.message });
      this.recordDebug("drop", "connection_error", connection.peer, error.message);
    });
  }

  private handleData(data: unknown, connection: DataConnection, hostSide: boolean) {
    const message = parseNetworkMessage(data);
    if (!message) {
      this.recordDebug("drop", messageType(data), connection.peer, "invalid_payload");
      return;
    }
    if (!this.authorizeMessage(message, connection, hostSide)) return;

    this.recordDebug("in", message.type, connection.peer);

    if (message.type === "player_hello" && hostSide) {
      const player: LobbyPlayer = { ...message.player, id: connection.peer, isHost: false };
      const replacedIds = this.snapshot.players
        .filter((item) => item.id !== player.id && player.profileId && item.profileId === player.profileId)
        .map((item) => item.id);
      for (const id of replacedIds) {
        const replaced = this.connections.get(id);
        if (!replaced) continue;
        this.connections.delete(id);
        replaced.close();
      }
      if (replacedIds.length > 0) this.patchConnectionState();
      const players = [
        ...this.snapshot.players.filter((item) => item.id !== player.id && (!player.profileId || item.profileId !== player.profileId)),
        player,
      ];
      this.patch({ players });
      this.broadcast({ type: "player_list", players });
      this.emitMessage({ type: "player_list", players });
      this.emitMessage({ type: "player_hello", player });
      return;
    }

    if (message.type === "player_list_request" && hostSide) {
      this.sendTo(connection, { type: "player_list", players: this.snapshot.players });
      return;
    }

    if (message.type === "player_list") {
      this.patch({ players: message.players });
    }

    if (hostSide) {
      this.connections.forEach((other) => {
        if (other.peer !== connection.peer) this.sendTo(other, message);
      });
    }

    this.emitMessage(message);
  }

  private authorizeMessage(message: NetworkMessage, connection: DataConnection, hostSide: boolean) {
    if (!hostSide) {
      return true;
    }

    const actor = messageActor(message);
    if (actor && actor !== connection.peer) {
      this.recordDebug("drop", message.type, connection.peer, `actor_mismatch:${actor}`);
      return false;
    }

    if (
      message.type === "player_list" ||
      message.type === "pickup_state" ||
      message.type === "host_state_snapshot" ||
      message.type === "player_state"
    ) {
      this.recordDebug("drop", message.type, connection.peer, "client_sent_host_authority_message");
      return false;
    }

    return true;
  }

  private handleClose(connection: DataConnection) {
    if (this.connections.get(connection.peer) !== connection) return;
    this.connections.delete(connection.peer);
    if (this.hostConnection === connection) this.hostConnection = null;

    const players = this.snapshot.players.filter((player) => player.id !== connection.peer);
    const connected = this.snapshot.role === "host" ? this.snapshot.peerOpen : false;
    this.patch({ players, connected });
    this.patchConnectionState();
    this.recordDebug("system", "connection_close", connection.peer);
    if (this.snapshot.role === "host") this.broadcast({ type: "player_list", players });
  }

  private sendTo(connection: DataConnection, message: NetworkMessage) {
    if (!connection.open) {
      this.recordDebug("drop", message.type, connection.peer, "connection_not_open");
      return;
    }
    connection.send(message);
    this.recordDebug("out", message.type, connection.peer);
  }

  private patchConnectionState() {
    this.patch({ connectionCount: Array.from(this.connections.values()).filter((connection) => connection.open).length });
  }

  private patch(partial: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    this.sessionListeners.forEach((listener) => listener(this.snapshot));
  }

  private emitMessage(message: NetworkMessage) {
    this.messageListeners.forEach((listener) => {
      try {
        listener(message);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "message_listener_error";
        this.patch({ error: reason });
        this.recordDebug("drop", message.type, undefined, reason);
      }
    });
  }

  private recordDebug(direction: NetworkDebugEvent["direction"], type: string, peerId?: string, reason?: string) {
    this.debugEvents = [
      { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, at: Date.now(), direction, type, peerId, reason },
      ...this.debugEvents,
    ].slice(0, MAX_DEBUG_EVENTS);
    this.debugListeners.forEach((listener) => listener(this.debugEvents));
  }
}

export const peerSession = new PeerSession();
