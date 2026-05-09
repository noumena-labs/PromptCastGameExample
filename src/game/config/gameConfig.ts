import type { CrystalState, DummyTarget, GeneratedSpell, ManaMoteState, Vec3 } from "@/game/types";
import type { SpellBuildSpec } from "@/game/spells/modules/spellIds";
import { ARENA_RADIUS, PLAYABLE_RADIUS, getGroundHeight, scatterPositions } from "@/game/arena/terrain";
import { composeSpell } from "@/game/spells/spellSchema";

export { ARENA_RADIUS, PLAYABLE_RADIUS };

export const LOCAL_PLAYER_ID = "local-player";
export const AURA_THRESHOLD = 3;
export const SANCTUARY_DURATION_MS = 120000;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_MANA = 100;
/** Mana now comes from collecting motes; passive regen is disabled. */
export const MANA_REGEN_PER_SECOND = 0;
export const PLAYER_SPAWN_POINTS: Vec3[] = [
  [0, 0, 42],
  [42, 0, 0],
  [0, 0, -42],
  [-42, 0, 0],
];

export const MANA_MOTE_VALUE = 15;
export const MANA_MOTE_RESPAWN_MIN_MS = 9000;
export const MANA_MOTE_RESPAWN_MAX_MS = 14000;
export const MANA_MOTE_DROP_DECAY_MS = 12000;
export const MANA_MOTE_DROP_COUNT = 3;

const magicMissileSpec: SpellBuildSpec = {
  name: "Magic Missile",
  alignment: "light",
  deliveryVehicle: "projectile_linear",
  vfx: {
    coreMesh: "sphere",
    travel: ["particle_trail", "core_glow"],
    impact: ["burst_explosion", "flash"],
    shaders: {
      core: "holy_radiance",
      trail: "sunbeam_core",
      impact: "halo_ring",
      decal: "ground_rune",
      aura: "halo_ring",
    },
  },
  modifiers: { scale: 0.75, speed: 1.35, duration: 0.9, intensity: 0.9 },
  count: 1,
  intentSummary: "A reliable bright bolt for steady pressure.",
  castImagery: "A compact golden mote cuts forward with a clean glimmering tail.",
  impactImagery: "A quick pale-gold pop flashes at the hit point with a tiny shock ring.",
};

export const MAGIC_MISSILE: GeneratedSpell = {
  ...composeSpell({ prompt: "A reliable bright bolt for steady pressure.", concept: magicMissileSpec, balance: { powerTier: 1 } }),
  id: "magic_missile",
  name: "Magic Missile",
  damage: 15,
  speed: 30,
  radius: 0.55,
  durationMs: 2400,
  impactDurationMs: 1200,
  cooldownMs: 280,
  manaCost: 4,
  statusDurationMs: 500,
  statusStrength: 0.4,
};

const ringPoints = (count: number, radius: number, y: number, offset = 0): Vec3[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = offset + (index / count) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    return [x, getGroundHeight(x, z) + y, z];
  });

/** Aura Crystals are sparse, but spread across the larger arena. */
export const CRYSTAL_SPAWN_POINTS: Vec3[] = [
  ...ringPoints(4, 32, 1, Math.PI / 6),
  ...ringPoints(4, 62, 1, Math.PI / 5),
  ...ringPoints(4, 88, 1, Math.PI / 7),
];

export const INITIAL_CRYSTALS: CrystalState[] = CRYSTAL_SPAWN_POINTS.map((position, index) => ({
  id: `crystal-${index + 1}`,
  position,
  active: true,
  respawnAt: null,
}));

export const INITIAL_MANA_MOTES: ManaMoteState[] = scatterPositions(52, 22, 94, 31337).map((position, index) => ({
  id: `mana-${index + 1}`,
  position: [position.x, position.y + 0.4, position.z],
  active: true,
  respawnAt: null,
  decayAt: null,
  amount: MANA_MOTE_VALUE,
  ephemeral: false,
}));

const dummyTarget = (id: string, x: number, z: number): DummyTarget => ({
  id,
  position: [x, getGroundHeight(x, z) + 0.2, z],
  health: 120,
  maxHealth: 120,
  respawnAt: null,
});

export const DUMMY_TARGETS: DummyTarget[] = [
  dummyTarget("dummy-north", 0, -48),
  dummyTarget("dummy-east", 44, -10),
  dummyTarget("dummy-west", -44, -10),
];
