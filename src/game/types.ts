import type { SpellScene } from "@/game/spells/sceneNode";
import type {
  DeliveryVehicleId,
  SpellAlignmentId,
  SpellBuildSpec,
  SpellImpactShape,
  SpellStatusEffectId,
} from "@/game/spells/modules/spellIds";
import type { IntentCorrection } from "@/game/spells/modules/spellIntent";

export type {
  DeliveryVehicleId,
  SpellAlignmentId,
  SpellBuildSpec,
  SpellImpactShape,
  SpellStatusEffectId,
};

export type Vec3 = [number, number, number];

export type GeneratedSpell = {
  id: string;
  name: string;
  prompt: string;
  reasoning?: string;
  intentLabel?: string;
  intentCorrections?: IntentCorrection[];
  buildSpec: SpellBuildSpec;
  alignment: SpellAlignmentId;
  deliveryVehicle: DeliveryVehicleId;
  powerTier: 1 | 2 | 3 | 4 | 5;
  count: number;
  damage: number;
  speed: number;
  radius: number;
  durationMs: number;
  impactDurationMs: number;
  cooldownMs: number;
  manaCost: number;
  statusEffect: SpellStatusEffectId;
  statusDurationMs: number;
  statusStrength: number;
  color: string;
  impactShape: SpellImpactShape;
  scenes: {
    cast: SpellScene;
    travel: SpellScene;
    impact: SpellScene;
  };
};

export type ActiveStatusEffect = {
  id: string;
  effect: SpellStatusEffectId;
  ownerId: string;
  sourceSpellId: string;
  expiresAt: number;
  strength: number;
  lastTickAt: number;
};

export type SpellSlot = GeneratedSpell | null;

export type PlayerStatus = "alive" | "dead" | "sanctuary";

export type PlayerState = {
  id: string;
  name: string;
  color: string;
  position: Vec3;
  rotationY: number;
  velocity: Vec3;
  health: number;
  mana: number;
  aura: number;
  score: number;
  status: PlayerStatus;
  statusEffects: ActiveStatusEffect[];
  isShielded: boolean;
  spellSlots: SpellSlot[];
  cooldowns: Record<string, number>;
  respawnAt: number | null;
};

export type CrystalState = {
  id: string;
  position: Vec3;
  active: boolean;
  respawnAt: number | null;
};

export type ManaMoteState = {
  id: string;
  position: Vec3;
  active: boolean;
  respawnAt: number | null;
  decayAt: number | null;
  amount: number;
  ephemeral: boolean;
};

export type AreaSpellState = {
  id: string;
  ownerId: string;
  spell: GeneratedSpell;
  position: Vec3;
  forward: Vec3;
  attachedToId: string | null;
  createdAt: number;
  expiresAt: number;
  tickedAt: Record<string, number>;
};

export type CastVfxState = {
  id: string;
  ownerId: string;
  spell: GeneratedSpell;
  position: Vec3;
  forward: Vec3;
  createdAt: number;
  expiresAt: number;
};

export type DummyTarget = {
  id: string;
  position: Vec3;
  health: number;
  maxHealth: number;
  respawnAt: number | null;
};

export type HostStateSnapshot = {
  sequence: number;
  serverTime: number;
  players: PlayerState[];
  crystals: CrystalState[];
  manaMotes: ManaMoteState[];
  dummyTargets: DummyTarget[];
};

export type MatchMode = "solo" | "host" | "client";

export type NetworkRole = "offline" | "host" | "client";

export type LobbyPlayer = {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  profileId?: string;
};

export type CastPayload = {
  playerId: string;
  spell: GeneratedSpell;
  origin: Vec3;
  direction: Vec3;
  targetPoint: Vec3;
};

export type SequencedCastPayload = CastPayload & {
  sequence: number;
};

export type SequencedCrystalPayload = {
  sequence: number;
  playerId: string;
  crystalId: string;
};

export type SequencedManaMotePayload = {
  sequence: number;
  playerId: string;
  moteId: string;
};

export type SequencedSanctuaryPayload = {
  sequence: number;
  playerId: string;
  action: "enter" | "exit";
};

export type SequencedSpellBoundPayload = {
  sequence: number;
  playerId: string;
  slot: number;
  spell: GeneratedSpell;
};

export type AppliedHostSnapshotInfo = {
  sequence: number;
  serverTime: number;
  receivedAt: number;
};
