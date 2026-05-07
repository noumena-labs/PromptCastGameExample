import type { SpellScene } from "@/game/spells/sceneNode";

export type Vec3 = [number, number, number];

export type SpellElement = "fire" | "ice" | "lightning" | "earth" | "arcane" | "shadow" | "nature";

/**
 * Delivery family — how the spell reaches its target. Drives spawn behavior
 * and the speed component of derived stats. Replaces the old `delivery` field.
 *
 *   projectile → travels along the cast ray from the caster.
 *   beam       → near-instant line; brief travel time.
 *   sky        → spawns above the reticle target point and falls.
 *   self       → originates at the caster, stationary or expanding.
 */
export type SpellDeliveryFamily = "projectile" | "beam" | "sky" | "self";

/**
 * Impact family — what happens when the spell resolves. Used by the gameplay
 * layer (damage / status / shape of effect), independent of the visual scene.
 */
export type SpellImpact = "single" | "aoe" | "vortex" | "wall" | "trap" | "burst" | "none";

export type SpellPlacement = "target" | "front" | "self";

export type SpellEffect = "burn" | "slow" | "stun" | "pull" | "knockback" | "shield_break" | "poison";

export type GeneratedSpell = {
  id: string;
  name: string;
  prompt: string;
  reasoning?: string;
  element: SpellElement;
  deliveryFamily: SpellDeliveryFamily;
  impact: SpellImpact;
  placement: SpellPlacement;
  powerTier: 1 | 2 | 3 | 4 | 5;
  count: number;
  damage: number;
  speed: number;
  radius: number;
  durationMs: number;
  /**
   * How long the impact area lingers after the spell resolves. Derived from
   * the impact taxonomy: short flashes for single/burst, full durationMs for
   * lingering impacts (aoe/vortex/wall/trap), 0 for none.
   */
  impactDurationMs: number;
  cooldownMs: number;
  manaCost: number;
  effects: SpellEffect[];
  color: string;
  /**
   * Two-stage visuals. `cast` is what the player sees while the spell
   * travels (projectile body, beam core, sky-meteor, self-cast root). `impact`
   * is the eruption / lingering field that spawns at the resolution point.
   */
  scenes: {
    cast: SpellScene;
    impact: SpellScene;
  };
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
  /**
   * Unit vector pointing in the direction the caster aimed when the area was
   * spawned. Used by the renderer to orient impact-shape-aware geometry —
   * e.g. walls face perpendicular to this, beams stretch along it.
   */
  forward: Vec3;
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
