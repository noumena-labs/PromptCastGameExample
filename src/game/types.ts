export type Vec3 = [number, number, number];

export type SpellElement = "fire" | "ice" | "lightning" | "earth" | "arcane" | "shadow" | "nature";

export type SpellShape = "projectile" | "beam" | "aoe" | "vortex" | "wall" | "trap" | "burst";

export type SpellEffect = "burn" | "slow" | "stun" | "pull" | "knockback" | "shield_break" | "poison";

export type GeneratedSpell = {
  id: string;
  name: string;
  prompt: string;
  element: SpellElement;
  shape: SpellShape;
  damage: number;
  speed: number;
  radius: number;
  durationMs: number;
  cooldownMs: number;
  manaCost: number;
  effects: SpellEffect[];
  color: string;
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

export type ProjectileState = {
  id: string;
  ownerId: string;
  spell: GeneratedSpell;
  position: Vec3;
  direction: Vec3;
  createdAt: number;
  expiresAt: number;
  hitIds: string[];
};

export type AreaSpellState = {
  id: string;
  ownerId: string;
  spell: GeneratedSpell;
  position: Vec3;
  createdAt: number;
  expiresAt: number;
  tickedAt: Record<string, number>;
};

export type DummyTarget = {
  id: string;
  position: Vec3;
  health: number;
  maxHealth: number;
  respawnAt: number | null;
};

export type MatchMode = "solo" | "host" | "client";

export type NetworkRole = "offline" | "host" | "client";

export type LobbyPlayer = {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
};

export type CastPayload = {
  playerId: string;
  spell: GeneratedSpell;
  origin: Vec3;
  direction: Vec3;
};

export type SequencedCastPayload = CastPayload & {
  sequence: number;
};

export type SequencedCrystalPayload = {
  sequence: number;
  playerId: string;
  crystalId: string;
};
