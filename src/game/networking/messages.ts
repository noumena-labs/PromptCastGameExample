import type { CrystalState, GeneratedSpell, LobbyPlayer, PlayerState, Vec3 } from "@/game/types";

export type PlayerHelloMessage = {
  type: "player_hello";
  player: LobbyPlayer;
};

export type PlayerListMessage = {
  type: "player_list";
  players: LobbyPlayer[];
};

export type PlayerTransformMessage = {
  type: "player_transform";
  playerId: string;
  position: Vec3;
  rotationY: number;
  velocity: Vec3;
  timestamp: number;
};

export type PlayerStateMessage = {
  type: "player_state";
  player: Partial<PlayerState> & Pick<PlayerState, "id" | "name" | "color">;
};

export type PlayerCastSpellMessage = {
  type: "player_cast_spell";
  playerId: string;
  spell: GeneratedSpell;
  origin: Vec3;
  direction: Vec3;
  timestamp: number;
};

export type PickupStateMessage = {
  type: "pickup_state";
  crystals: CrystalState[];
};

export type PickupCollectMessage = {
  type: "pickup_collect";
  crystalId: string;
  playerId: string;
  timestamp: number;
};

export type MatchStartMessage = {
  type: "match_start";
  roomCode: string;
};

export type NetworkMessage =
  | PlayerHelloMessage
  | PlayerListMessage
  | PlayerTransformMessage
  | PlayerStateMessage
  | PlayerCastSpellMessage
  | PickupStateMessage
  | PickupCollectMessage
  | MatchStartMessage;

export const isNetworkMessage = (value: unknown): value is NetworkMessage =>
  typeof value === "object" && value !== null && "type" in value && typeof (value as { type: unknown }).type === "string";
