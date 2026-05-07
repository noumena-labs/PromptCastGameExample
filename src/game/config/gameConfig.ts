import type { CrystalState, DummyTarget, GeneratedSpell, Vec3 } from "@/game/types";

export const LOCAL_PLAYER_ID = "local-player";
export const AURA_THRESHOLD = 3;
export const SANCTUARY_DURATION_MS = 15000;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_MANA = 100;
export const MANA_REGEN_PER_SECOND = 9;
export const ARENA_RADIUS = 60;
export const PLAYABLE_RADIUS = 52; // inside the hill ring

export const MAGIC_MISSILE: GeneratedSpell = {
  id: "magic_missile",
  name: "Magic Missile",
  prompt: "A reliable arcane bolt for steady pressure.",
  element: "arcane",
  shape: "projectile",
  damage: 15,
  speed: 32,
  radius: 0.42,
  durationMs: 2400,
  cooldownMs: 480,
  manaCost: 0,
  effects: [],
  color: "#c9a85c",
};

const ringPoints = (count: number, radius: number, y: number, offset = 0): Vec3[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = offset + (index / count) * Math.PI * 2;
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  });

export const CRYSTAL_SPAWN_POINTS: Vec3[] = [
  ...ringPoints(6, 14, 1, Math.PI / 6),
  ...ringPoints(6, 32, 1, 0),
  ...ringPoints(4, 44, 1, Math.PI / 4),
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
  active: index < 10,
  respawnAt: index < 10 ? null : Date.now() + 9000 + index * 900,
}));
