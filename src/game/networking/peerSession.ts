import type { DataConnection, Peer } from "peerjs";
import { nanoid } from "nanoid";
import type { LobbyPlayer, NetworkRole } from "@/game/types";
import { isNetworkMessage, type NetworkMessage } from "@/game/networking/messages";

type SessionSnapshot = {
  role: NetworkRole;
  peerId: string | null;
  roomCode: string | null;
  connected: boolean;
  players: LobbyPlayer[];
  error: string | null;
};

type SessionListener = (snapshot: SessionSnapshot) => void;
type MessageListener = (message: NetworkMessage) => void;

const makeRoomCode = () => nanoid(5).replace(/[^a-z0-9]/gi, "").toUpperCase().padEnd(5, "X").slice(0, 5);
const roomPeerId = (code: string) => `promptcast-${code.toLowerCase()}`;

class PeerSession {
  private peer: Peer | null = null;
  private hostConnection: DataConnection | null = null;
  private connections = new Map<string, DataConnection>();
  private snapshot: SessionSnapshot = { role: "offline", peerId: null, roomCode: null, connected: false, players: [], error: null };
  private sessionListeners = new Set<SessionListener>();
  private messageListeners = new Set<MessageListener>();

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

  getSnapshot() {
    return this.snapshot;
  }

  async createHost(playerName: string, color: string) {
    this.disconnect();
    const { Peer } = await import("peerjs");
    const roomCode = makeRoomCode();
    const hostId = roomPeerId(roomCode);
    const hostPlayer: LobbyPlayer = { id: hostId, name: playerName || "Host Wizard", color, isHost: true };
    this.patch({ role: "host", peerId: hostId, roomCode, connected: false, players: [hostPlayer], error: null });

    this.peer = new Peer(hostId, { debug: 1 });
    this.peer.on("open", (id) => this.patch({ peerId: id, connected: true }));
    this.peer.on("connection", (connection) => this.registerConnection(connection, true));
    this.peer.on("error", (error) => this.patch({ error: error.message, connected: false }));
    return roomCode;
  }

  async joinRoom(roomCodeInput: string, playerName: string, color: string) {
    this.disconnect();
    const { Peer } = await import("peerjs");
    const roomCode = roomCodeInput.trim().toUpperCase();
    this.patch({ role: "client", peerId: null, roomCode, connected: false, players: [], error: null });

    this.peer = new Peer({ debug: 1 });
    this.peer.on("open", (id) => {
      this.patch({ peerId: id, connected: true });
      const connection = this.peer?.connect(roomPeerId(roomCode), { reliable: true, label: "promptcast-game" });
      if (!connection) return;
      this.hostConnection = connection;
      this.registerConnection(connection, false);
      connection.on("open", () => {
        this.send({ type: "player_hello", player: { id, name: playerName || "Guest Wizard", color, isHost: false } });
      });
    });
    this.peer.on("error", (error) => this.patch({ error: error.message, connected: false }));
  }

  startMatch() {
    if (!this.snapshot.roomCode) return;
    this.broadcast({ type: "match_start", roomCode: this.snapshot.roomCode });
    this.emitMessage({ type: "match_start", roomCode: this.snapshot.roomCode });
  }

  send(message: NetworkMessage) {
    if (this.snapshot.role === "host") {
      this.broadcast(message);
      return;
    }
    if (this.hostConnection?.open) {
      this.hostConnection.send(message);
    }
  }

  broadcast(message: NetworkMessage) {
    this.connections.forEach((connection) => {
      if (connection.open) connection.send(message);
    });
  }

  disconnect() {
    this.connections.forEach((connection) => connection.close());
    this.connections.clear();
    this.hostConnection = null;
    this.peer?.destroy();
    this.peer = null;
    this.patch({ role: "offline", peerId: null, roomCode: null, connected: false, players: [], error: null });
  }

  private registerConnection(connection: DataConnection, hostSide: boolean) {
    this.connections.set(connection.peer, connection);
    connection.on("data", (data) => this.handleData(data, connection, hostSide));
    connection.on("close", () => this.handleClose(connection.peer));
    connection.on("error", (error) => this.patch({ error: error.message }));
  }

  private handleData(data: unknown, connection: DataConnection, hostSide: boolean) {
    if (!isNetworkMessage(data)) return;

    if (data.type === "player_hello" && hostSide) {
      const players = [...this.snapshot.players.filter((player) => player.id !== data.player.id), data.player];
      this.patch({ players });
      this.broadcast({ type: "player_list", players });
    }

    if (data.type === "player_list") {
      this.patch({ players: data.players });
    }

    if (data.type === "match_start") {
      this.patch({ roomCode: data.roomCode });
    }

    if (hostSide && data.type !== "player_hello") {
      this.connections.forEach((other) => {
        if (other.peer !== connection.peer && other.open) other.send(data);
      });
    }

    this.emitMessage(data);
  }

  private handleClose(peerId: string) {
    this.connections.delete(peerId);
    const players = this.snapshot.players.filter((player) => player.id !== peerId);
    this.patch({ players });
    if (this.snapshot.role === "host") this.broadcast({ type: "player_list", players });
  }

  private patch(partial: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    this.sessionListeners.forEach((listener) => listener(this.snapshot));
  }

  private emitMessage(message: NetworkMessage) {
    this.messageListeners.forEach((listener) => listener(message));
  }
}

export const peerSession = new PeerSession();
