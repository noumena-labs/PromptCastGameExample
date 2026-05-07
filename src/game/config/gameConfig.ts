import type { CrystalState, DummyTarget, GeneratedSpell, Vec3 } from "@/game/types";

export const LOCAL_PLAYER_ID = "local-player";
export const AURA_THRESHOLD = 3;
export const SANCTUARY_DURATION_MS = 15000;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_MANA = 100;
export const MANA_REGEN_PER_SECOND = 9;
export const ARENA_RADIUS = 34;

export const MAGIC_MISSILE: GeneratedSpell = {
  id: "magic_missile",
  name: "Magic Missile",
  prompt: "A reliable arcane bolt for steady pressure.",
  element: "arcane",
  shape: "projectile",
  damage: 15,
  speed: 24,
  radius: 0.42,
  durationMs: 2200,
  cooldownMs: 650,
  manaCost: 0,
  effects: [],
  color: "#9d7cff",
};

export const CRYSTAL_SPAWN_POINTS: Vec3[] = [
  [-20, 1, -18],
  [-8, 1, -23],
  [9, 1, -22],
  [21, 1, -13],
  [24, 1, 8],
  [11, 1, 20],
  [-9, 1, 22],
  [-23, 1, 12],
  [-14, 4, 2],
  [14, 4, -2],
];

export const PLAYER_SPAWN_POINTS: Vec3[] = [
  [0, 2, 18],
  [18, 2, 0],
  [0, 2, -18],
  [-18, 2, 0],
  [13, 2, 13],
  [-13, 2, -13],
];

export const DUMMY_TARGETS: DummyTarget[] = [
  { id: "dummy-1", position: [-11, 1.2, -9], health: 65, maxHealth: 65, respawnAt: null },
  { id: "dummy-2", position: [11, 1.2, -9], health: 65, maxHealth: 65, respawnAt: null },
  { id: "dummy-3", position: [0, 1.2, -18], health: 80, maxHealth: 80, respawnAt: null },
];

export const INITIAL_CRYSTALS: CrystalState[] = CRYSTAL_SPAWN_POINTS.map((position, index) => ({
  id: `crystal-${index + 1}`,
  position,
  active: index < 7,
  respawnAt: index < 7 ? null : Date.now() + 9000 + index * 900,
}));
