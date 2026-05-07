"use client";

import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useRef } from "react";
import { useGameStore } from "@/game/state/gameStore";
import { vec3Distance, vec3DistanceSq } from "@/game/math/vector";
import type { AreaSpellState, GeneratedSpell, Vec3 } from "@/game/types";
import type { World } from "@dimforge/rapier3d-compat";
import { Ray } from "@dimforge/rapier3d-compat";
import { projectileMotion, type ProjectileMotion } from "@/game/state/projectileMotion";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { AIM_RAY_GROUPS } from "@/game/physics/collisionGroups";

// Module-scope reusable ray to avoid per-projectile-per-frame allocations.
let sharedRay: Ray | null = null;

export function GameplaySystems() {
  const accumulator = useRef(0);
  const { world } = useRapier();

  useFrame((_, delta) => {
    const state = useGameStore.getState();
    accumulator.current += delta;

    // Per-frame: motion, pickups (must be tight to avoid missing at sprint speed).
    advanceProjectiles(delta, world);
    collectNearbyAuraCrystals();
    collectNearbyManaMotes();

    // Coarse cadence: respawns, area-of-effect ticks.
    if (accumulator.current > 0.12) {
      accumulator.current = 0;
      state.respawnCrystals();
      state.respawnManaMotes();
      state.tickRespawns();
      state.tickAreas();
      state.tickCooldowns();
      resolveAreas();
    }
  });

  return null;
}

function collectNearbyAuraCrystals() {
  const state = useGameStore.getState();
  const player = state.players[state.localPlayerId];
  if (!player || player.status === "dead") return;

  for (const crystal of state.crystals) {
    if (crystal.active && vec3DistanceSq(player.position, crystal.position) < 2.4 * 2.4) {
      state.collectCrystal(crystal.id);
      break;
    }
  }
}

function collectNearbyManaMotes() {
  const state = useGameStore.getState();
  const player = state.players[state.localPlayerId];
  if (!player || player.status === "dead") return;

  for (const mote of state.manaMotes) {
    if (mote.active && vec3DistanceSq(player.position, mote.position) < 1.4 * 1.4) {
      state.collectManaMote(mote.id);
    }
  }
}

function advanceProjectiles(delta: number, world: World) {
  const state = useGameStore.getState();
  if (state.projectileIds.length === 0) return;

  const timestamp = Date.now();
  const removedIds: string[] = [];
  const bursts: Array<{ motion: ProjectileMotion; position: Vec3; reason: "hit" | "expire" }> = [];

  for (const id of state.projectileIds) {
    const motion = projectileMotion.get(id);
    if (!motion) {
      removedIds.push(id);
      continue;
    }

    if (motion.expiresAt <= timestamp) {
      bursts.push({ motion, position: motion.position, reason: "expire" });
      removedIds.push(id);
      continue;
    }

    const stepDistance = motion.spell.speed * delta;
    const nextPosition: Vec3 = [
      motion.position[0] + motion.direction[0] * stepDistance,
      motion.position[1] + motion.direction[1] * stepDistance,
      motion.position[2] + motion.direction[2] * stepDistance,
    ];

    // Rapier raycast against the physics world (trees, shrine, dummies, wizards).
    // direction is unit, so timeOfImpact = world distance.
    if (!sharedRay) {
      sharedRay = new Ray(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      );
    }
    sharedRay.origin.x = motion.position[0];
    sharedRay.origin.y = motion.position[1];
    sharedRay.origin.z = motion.position[2];
    sharedRay.dir.x = motion.direction[0];
    sharedRay.dir.y = motion.direction[1];
    sharedRay.dir.z = motion.direction[2];

    const hit = world.castRay(
      sharedRay,
      stepDistance,
      true,
      undefined,
      AIM_RAY_GROUPS,
      undefined,
      undefined,
      motion.ownerColliderHandle == null
        ? undefined
        : (collider) => collider.handle !== motion.ownerColliderHandle,
    );
    if (hit) {
      const impact: Vec3 = [
        motion.position[0] + motion.direction[0] * hit.timeOfImpact,
        motion.position[1] + motion.direction[1] * hit.timeOfImpact,
        motion.position[2] + motion.direction[2] * hit.timeOfImpact,
      ];
      const entry = colliderRegistry.get(hit.collider.handle);
      if (entry) {
        if (entry.kind === "dummy") {
          state.damageDummy(entry.id, motion.spell.damage, motion.ownerId);
        } else if (entry.kind === "wizard" && entry.id !== motion.ownerId) {
          state.damagePlayer(entry.id, motion.spell.damage, motion.ownerId);
        }
        // static: no damage, just stop the projectile.
      }
      bursts.push({ motion, position: impact, reason: "hit" });
      removedIds.push(id);
      continue;
    }

    // Mutate motion in place — no zustand churn.
    motion.position[0] = nextPosition[0];
    motion.position[1] = nextPosition[1];
    motion.position[2] = nextPosition[2];
  }

  if (removedIds.length > 0) {
    for (const id of removedIds) projectileMotion.unregister(id);
    useGameStore.setState((s) => ({
      projectileIds: s.projectileIds.filter((id) => !removedIds.includes(id)),
    }));
  }

  for (const burst of bursts) {
    spawnBurst(burst.motion.id, burst.motion.ownerId, burst.motion.spell, burst.position, burst.reason);
  }
}

function spawnBurst(
  projectileId: string,
  ownerId: string,
  spell: GeneratedSpell,
  position: Vec3,
  reason: "hit" | "expire",
) {
  const timestamp = Date.now();
  const isLingering = spell.impact === "aoe" || spell.impact === "vortex" || spell.impact === "wall" || spell.impact === "trap";
  // Single-target spells leave only a small visual flash on impact. Lingering
  // impacts spawn a real area that ticks damage for the spell's duration.
  const durationMs = isLingering ? spell.durationMs : reason === "hit" ? 380 : 260;
  const radius = isLingering ? spell.radius : Math.max(0.7, spell.radius * 1.4);
  // Skip pure single-target "expire" bursts (they hit nothing) so we don't
  // litter the meadow with empty rings.
  if (!isLingering && reason === "expire") return;
  useGameStore.setState((state) => ({
    areas: [
      ...state.areas,
      {
        id: `${projectileId}-${reason}`,
        ownerId,
        spell: { ...spell, durationMs, radius },
        position,
        createdAt: timestamp,
        expiresAt: timestamp + durationMs,
        tickedAt: {},
      },
    ],
  }));
}

function resolveAreas() {
  const state = useGameStore.getState();
  const timestamp = Date.now();
  const nextAreas: AreaSpellState[] = [];

  for (const area of state.areas) {
    if (area.expiresAt <= timestamp) continue;
    const isLingering = area.spell.impact === "aoe" || area.spell.impact === "vortex" || area.spell.impact === "wall" || area.spell.impact === "trap";
    // Single bursts: full damage once. Lingering AOE: 28% damage every 650ms.
    const tickWindow = isLingering ? 650 : area.spell.durationMs;
    const tickDamage = isLingering ? Math.max(4, Math.round(area.spell.damage * 0.28)) : area.spell.damage;
    const tickedAt = { ...area.tickedAt };

    for (const dummy of state.dummyTargets) {
      if (dummy.respawnAt) continue;
      const lastTick = tickedAt[dummy.id] ?? 0;
      if (timestamp - lastTick < tickWindow) continue;
      if (vec3Distance(dummy.position, area.position) <= area.spell.radius + 0.7) {
        state.damageDummy(dummy.id, tickDamage, area.ownerId);
        tickedAt[dummy.id] = timestamp;
      }
    }

    for (const player of Object.values(state.players)) {
      if (player.id === area.ownerId || player.status === "dead") continue;
      const lastTick = tickedAt[player.id] ?? 0;
      if (timestamp - lastTick < tickWindow) continue;
      if (vec3Distance(player.position, area.position) <= area.spell.radius + 0.65) {
        state.damagePlayer(player.id, tickDamage, area.ownerId);
        tickedAt[player.id] = timestamp;
      }
    }

    nextAreas.push({ ...area, tickedAt });
  }

  useGameStore.setState({ areas: nextAreas });
}
