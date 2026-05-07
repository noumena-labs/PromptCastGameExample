export type Vec3 = [number, number, number];

export type SpellElement = "fire" | "ice" | "lightning" | "earth" | "arcane" | "shadow" | "nature";

/**
 * High-level composition of a spell:
 *  - delivery: how the spell reaches its target.
 *  - impact: what happens at the destination.
 *  - count: number of projectiles / impact points (e.g. meteor shower = 6).
 *
 * Examples:
 *   bolt           → { delivery: "projectile", impact: "single", count: 1 }
 *   meteor shower  → { delivery: "sky",        impact: "aoe",    count: 6 }
 *   frost nova     → { delivery: "self",       impact: "burst",  count: 1 }
 *   black hole     → { delivery: "projectile", impact: "vortex", count: 1 }
 *   fire wall      → { delivery: "self",       impact: "wall",   count: 1 }
 */
export type SpellDelivery = "projectile" | "beam" | "sky" | "self";
export type SpellImpact = "single" | "aoe" | "vortex" | "wall" | "trap" | "burst" | "none";

export type SpellEffect = "burn" | "slow" | "stun" | "pull" | "knockback" | "shield_break" | "poison";

export type GeneratedSpell = {
  id: string;
  name: string;
  prompt: string;
  reasoning?: string;
  element: SpellElement;
  delivery: SpellDelivery;
  impact: SpellImpact;
  count: number;
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

export type ManaMoteState = {
  id: string;
  position: Vec3;
  active: boolean;
  /** When set, the mote will reappear at this timestamp after being collected. */
  respawnAt: number | null;
  /** When set, the mote will permanently disappear at this timestamp (used for kill drops). */
  decayAt: number | null;
  /** Mana restored on contact. */
  amount: number;
  /** True for kill-drop motes — they decay rather than respawn. */
  ephemeral: boolean;
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
