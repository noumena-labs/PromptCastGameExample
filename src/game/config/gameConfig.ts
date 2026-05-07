import type { CrystalState, DummyTarget, GeneratedSpell, ManaMoteState, Vec3 } from "@/game/types";
import { scatterPositions } from "@/game/arena/terrain";

export const LOCAL_PLAYER_ID = "local-player";
export const AURA_THRESHOLD = 3;
export const SANCTUARY_DURATION_MS = 120000;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_MANA = 100;
/** Mana now comes from collecting motes; passive regen is disabled. */
export const MANA_REGEN_PER_SECOND = 0;
export const ARENA_RADIUS = 60;
export const PLAYABLE_RADIUS = 52; // inside the hill ring

export const MANA_MOTE_VALUE = 15;
export const MANA_MOTE_RESPAWN_MIN_MS = 9000;
export const MANA_MOTE_RESPAWN_MAX_MS = 14000;
export const MANA_MOTE_DROP_DECAY_MS = 12000;
export const MANA_MOTE_DROP_COUNT = 3;

export const MAGIC_MISSILE: GeneratedSpell = {
  id: "magic_missile",
  name: "Magic Missile",
  prompt: "A reliable arcane bolt for steady pressure.",
  element: "arcane",
  deliveryFamily: "projectile",
  impact: "single",
  count: 1,
  damage: 15,
  speed: 32,
  radius: 0.42,
  durationMs: 2400,
  cooldownMs: 280,
  manaCost: 4,
  effects: [],
  color: "#c9a85c",
  scene: {
    shape: "sphere",
    color: "#c9a85c",
    emissiveIntensity: 1.8,
    size: 0.45,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    motion: "spin",
    motionSpeed: 2,
    arrange: "single",
    arrangeCount: 1,
    arrangeRadius: 0,
    particleCount: 0,
    opacity: 1,
    children: [
      {
        shape: "particle_cloud",
        color: "#fff0b8",
        emissiveIntensity: 0.6,
        size: 0.12,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        motion: "drift",
        motionSpeed: 1.2,
        arrange: "single",
        arrangeCount: 1,
        arrangeRadius: 0,
        particleCount: 24,
        opacity: 0.85,
      },
    ],
  },
};

const ringPoints = (count: number, radius: number, y: number, offset = 0): Vec3[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = offset + (index / count) * Math.PI * 2;
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  });

/** Aura Crystals are rare and sparse — only 8 across the meadow. */
export const CRYSTAL_SPAWN_POINTS: Vec3[] = [
  ...ringPoints(3, 14, 1, Math.PI / 6),
  ...ringPoints(3, 28, 1, 0),
  ...ringPoints(2, 42, 1, Math.PI / 4),
];

export const PLAYER_SPAWN_POINTS: Vec3[] = ringPoints(6, 38, 2, Math.PI / 12);

export const DUMMY_TARGETS: DummyTarget[] = [
  { id: "dummy-1", position: [-22, 1.2, -10], health: 65, maxHealth: 65, respawnAt: null },
  { id: "dummy-2", position: [22, 1.2, -10], health: 65, maxHealth: 65, respawnAt: null },
  { id: "dummy-3", position: [0, 1.2, -28], health: 80, maxHealth: 80, respawnAt: null },
  { id: "dummy-4", position: [-30, 1.2, 18], health: 65, maxHealth: 65, respawnAt: null },
  { id: "dummy-5", position: [30, 1.2, 18], health: 65, maxHealth: 65, respawnAt: null },
];

export const INITIAL_CRYSTALS: CrystalState[] = CRYSTAL_SPAWN_POINTS.map((position, index) => ({
  id: `crystal-${index + 1}`,
  position,
  active: true,
  respawnAt: null,
}));

/**
 * Mana motes: numerous, scattered across the playable meadow. Deterministic
 * positions via the terrain scatter helper so every client agrees.
 */
const MANA_MOTE_COUNT = 28;
export const INITIAL_MANA_MOTES: ManaMoteState[] = scatterPositions(MANA_MOTE_COUNT, 6, PLAYABLE_RADIUS - 4, 911).map((spot, index) => ({
  id: `mana-mote-${index + 1}`,
  position: [spot.x, spot.y + 0.9, spot.z] as Vec3,
  active: true,
  respawnAt: null,
  decayAt: null,
  amount: MANA_MOTE_VALUE,
  ephemeral: false,
}));
