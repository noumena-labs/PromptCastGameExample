import { z } from "zod";
import { generatedSpellSchema } from "@/game/spells/spellSchema";
import { spellStatusEffectIds } from "@/game/spells/modules/spellIds";
import type { CrystalState, DummyTarget, GeneratedSpell, HostStateSnapshot, LobbyPlayer, ManaMoteState, PlayerState, Vec3 } from "@/game/types";

const MAX_PLAYERS = 8;
const MAX_PICKUPS = 160;
const MAX_MESSAGE_TEXT = 96;

const finiteNumber = z.number().finite();
const timestampSchema = finiteNumber.nonnegative();
const sequenceSchema = finiteNumber.int().nonnegative();
const vec3Schema: z.ZodType<Vec3> = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const boundedString = (max: number) => z.string().min(1).max(max);

const lobbyPlayerSchema: z.ZodType<LobbyPlayer> = z.object({
  id: boundedString(96),
  name: z.string().max(24),
  color: z.string().max(32),
  isHost: z.boolean(),
  profileId: boundedString(96).optional(),
}).strict();

const crystalSchema: z.ZodType<CrystalState> = z.object({
  id: boundedString(64),
  position: vec3Schema,
  active: z.boolean(),
  respawnAt: timestampSchema.nullable(),
}).strict();

const manaMoteSchema: z.ZodType<ManaMoteState> = z.object({
  id: boundedString(96),
  position: vec3Schema,
  active: z.boolean(),
  respawnAt: timestampSchema.nullable(),
  decayAt: timestampSchema.nullable(),
  amount: finiteNumber.nonnegative(),
  ephemeral: z.boolean(),
}).strict();

const dummyTargetSchema: z.ZodType<DummyTarget> = z.object({
  id: boundedString(64),
  position: vec3Schema,
  health: finiteNumber.nonnegative(),
  maxHealth: finiteNumber.positive(),
  respawnAt: timestampSchema.nullable(),
}).strict();

const statusEffectSchema = z.object({
  id: boundedString(128),
  effect: z.enum(spellStatusEffectIds),
  ownerId: boundedString(96),
  sourceSpellId: boundedString(128),
  expiresAt: timestampSchema,
  strength: finiteNumber,
  lastTickAt: timestampSchema,
}).strict();

const playerStatePatchSchema = z.object({
  id: boundedString(96),
  name: z.string().max(24),
  color: z.string().max(32),
  position: vec3Schema.optional(),
  rotationY: finiteNumber.optional(),
  velocity: vec3Schema.optional(),
  health: finiteNumber.optional(),
  mana: finiteNumber.optional(),
  aura: finiteNumber.optional(),
  score: finiteNumber.optional(),
  status: z.enum(["alive", "dead", "sanctuary"]).optional(),
  statusEffects: z.array(statusEffectSchema).max(12).optional(),
  isShielded: z.boolean().optional(),
  spellSlots: z.array(generatedSpellSchema.nullable()).length(4).optional(),
  cooldowns: z.record(z.string(), timestampSchema).optional(),
  respawnAt: timestampSchema.nullable().optional(),
}).strict();

const playerSnapshotSchema: z.ZodType<PlayerState> = playerStatePatchSchema.extend({
  position: vec3Schema,
  rotationY: finiteNumber,
  velocity: vec3Schema,
  health: finiteNumber,
  mana: finiteNumber,
  aura: finiteNumber,
  score: finiteNumber,
  status: z.enum(["alive", "dead", "sanctuary"]),
  statusEffects: z.array(statusEffectSchema).max(12),
  isShielded: z.boolean(),
  spellSlots: z.array(generatedSpellSchema.nullable()).length(4),
  cooldowns: z.record(z.string(), timestampSchema),
  respawnAt: timestampSchema.nullable(),
}) as z.ZodType<PlayerState>;

const hostStateSnapshotSchema: z.ZodType<HostStateSnapshot> = z.object({
  sequence: sequenceSchema,
  serverTime: timestampSchema,
  players: z.array(playerSnapshotSchema).max(MAX_PLAYERS),
  crystals: z.array(crystalSchema).max(MAX_PICKUPS),
  manaMotes: z.array(manaMoteSchema).max(MAX_PICKUPS),
  dummyTargets: z.array(dummyTargetSchema).max(16),
}).strict();

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
  sequence: number;
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
  targetPoint: Vec3;
  timestamp: number;
  sequence: number;
};

export type PickupStateMessage = {
  type: "pickup_state";
  crystals: CrystalState[];
};

export type HostStateSnapshotMessage = {
  type: "host_state_snapshot";
  snapshot: HostStateSnapshot;
};

export type PickupCollectMessage = {
  type: "pickup_collect";
  crystalId: string;
  playerId: string;
  timestamp: number;
  sequence: number;
};

export type ManaMoteCollectMessage = {
  type: "mana_mote_collect";
  moteId: string;
  playerId: string;
  timestamp: number;
  sequence: number;
};

export type SanctuaryStateMessage = {
  type: "sanctuary_state";
  playerId: string;
  action: "enter" | "exit";
  timestamp: number;
  sequence: number;
};

export type SpellBoundMessage = {
  type: "spell_bound";
  playerId: string;
  slot: number;
  spell: GeneratedSpell;
  timestamp: number;
  sequence: number;
};

export type PlayerListRequestMessage = {
  type: "player_list_request";
  requesterId: string;
  timestamp: number;
};

export type DebugPingMessage = {
  type: "debug_ping";
  id: string;
  senderId: string;
  timestamp: number;
  note?: string;
};

export type NetworkMessage =
  | PlayerHelloMessage
  | PlayerListMessage
  | PlayerTransformMessage
  | PlayerStateMessage
  | PlayerCastSpellMessage
  | PickupStateMessage
  | PickupCollectMessage
  | ManaMoteCollectMessage
  | SanctuaryStateMessage
  | SpellBoundMessage
  | HostStateSnapshotMessage
  | PlayerListRequestMessage
  | DebugPingMessage;

const networkMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player_hello"), player: lobbyPlayerSchema }).strict(),
  z.object({ type: z.literal("player_list"), players: z.array(lobbyPlayerSchema).max(MAX_PLAYERS) }).strict(),
  z.object({
    type: z.literal("player_transform"),
    playerId: boundedString(96),
    position: vec3Schema,
    rotationY: finiteNumber,
    velocity: vec3Schema,
    timestamp: timestampSchema,
    sequence: sequenceSchema,
  }).strict(),
  z.object({ type: z.literal("player_state"), player: playerStatePatchSchema }).strict(),
  z.object({
    type: z.literal("player_cast_spell"),
    playerId: boundedString(96),
    spell: generatedSpellSchema,
    origin: vec3Schema,
    direction: vec3Schema,
    targetPoint: vec3Schema,
    timestamp: timestampSchema,
    sequence: sequenceSchema,
  }).strict(),
  z.object({ type: z.literal("pickup_state"), crystals: z.array(crystalSchema).max(MAX_PICKUPS) }).strict(),
  z.object({ type: z.literal("host_state_snapshot"), snapshot: hostStateSnapshotSchema }).strict(),
  z.object({
    type: z.literal("pickup_collect"),
    crystalId: boundedString(64),
    playerId: boundedString(96),
    timestamp: timestampSchema,
    sequence: sequenceSchema,
  }).strict(),
  z.object({
    type: z.literal("mana_mote_collect"),
    moteId: boundedString(96),
    playerId: boundedString(96),
    timestamp: timestampSchema,
    sequence: sequenceSchema,
  }).strict(),
  z.object({
    type: z.literal("sanctuary_state"),
    playerId: boundedString(96),
    action: z.enum(["enter", "exit"]),
    timestamp: timestampSchema,
    sequence: sequenceSchema,
  }).strict(),
  z.object({
    type: z.literal("spell_bound"),
    playerId: boundedString(96),
    slot: z.number().int().min(0).max(3),
    spell: generatedSpellSchema,
    timestamp: timestampSchema,
    sequence: sequenceSchema,
  }).strict(),
  z.object({
    type: z.literal("player_list_request"),
    requesterId: boundedString(96),
    timestamp: timestampSchema,
  }).strict(),
  z.object({
    type: z.literal("debug_ping"),
    id: boundedString(96),
    senderId: boundedString(96),
    timestamp: timestampSchema,
    note: z.string().max(MAX_MESSAGE_TEXT).optional(),
  }).strict(),
]);

export function parseNetworkMessage(value: unknown): NetworkMessage | null {
  const parsed = networkMessageSchema.safeParse(value);
  return parsed.success ? parsed.data as NetworkMessage : null;
}

export const isNetworkMessage = (value: unknown): value is NetworkMessage =>
  parseNetworkMessage(value) !== null;
