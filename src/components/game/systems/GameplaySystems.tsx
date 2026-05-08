"use client";

import { useFrame } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useRef } from "react";
import { Ray, type World } from "@dimforge/rapier3d-compat";
import { useGameStore } from "@/game/state/gameStore";
import { vec3Distance, vec3DistanceSq } from "@/game/math/vector";
import type { AreaSpellState, GeneratedSpell, Vec3 } from "@/game/types";
import { projectileMotion, type ProjectileMotion } from "@/game/state/projectileMotion";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { AIM_RAY_GROUPS } from "@/game/physics/collisionGroups";

let sharedRay: Ray | null = null;
const ARC_GRAVITY = -18;

export function GameplaySystems() {
  const accumulator = useRef(0);
  const { world } = useRapier();

  useFrame((_, delta) => {
    const state = useGameStore.getState();
    accumulator.current += delta;

    advanceProjectiles(delta, world);
    collectNearbyAuraCrystals();
    collectNearbyManaMotes();

    if (accumulator.current > 0.12) {
      accumulator.current = 0;
      state.respawnCrystals();
      state.respawnManaMotes();
      state.tickRespawns();
      state.tickStatusEffects();
      state.tickCastVfx();
      state.tickAreas();
      state.tickCooldowns();
      resolveStatusTicks();
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
    if (timestamp < motion.createdAt) continue;

    if (motion.mode === "hitscan_visual" && motion.resolvedAt === null) {
      const hitPosition = resolveHitscan(motion, world);
      bursts.push({ motion, position: hitPosition, reason: "hit" });
      motion.resolvedAt = timestamp;
    }

    if (motion.mode === "skyfall") {
      const previous: Vec3 = [motion.position[0], motion.position[1], motion.position[2]];
      integrateMotion(motion, delta);
      if (timestamp >= motion.travelEndsAt || skyfallReachedGround(previous, motion)) {
        motion.position[0] = motion.targetPoint[0];
        motion.position[1] = motion.targetPoint[1];
        motion.position[2] = motion.targetPoint[2];
        motion.resolvedAt = timestamp;
        bursts.push({ motion, position: motion.targetPoint, reason: "hit" });
        removedIds.push(id);
      }
      continue;
    }

    if (motion.expiresAt <= timestamp) {
      if (motion.resolvedAt === null) bursts.push({ motion, position: motion.position, reason: "expire" });
      removedIds.push(id);
      continue;
    }

    if (motion.mode === "hitscan_visual") {
      motion.position[0] = motion.targetPoint[0];
      motion.position[1] = motion.targetPoint[1];
      motion.position[2] = motion.targetPoint[2];
      continue;
    }

    const previous: Vec3 = [motion.position[0], motion.position[1], motion.position[2]];
    integrateMotion(motion, delta);
    const stepDirection = directionBetween(previous, motion.position);
    const stepDistance = vec3Distance(previous, motion.position);
    if (stepDistance <= 0) continue;

    const hit = raycastStep(world, previous, stepDirection, stepDistance, motion.ownerColliderHandle);
    if (hit) {
      const impact: Vec3 = [
        previous[0] + stepDirection[0] * hit.timeOfImpact,
        previous[1] + stepDirection[1] * hit.timeOfImpact,
        previous[2] + stepDirection[2] * hit.timeOfImpact,
      ];
      resolveDirectHit(hit.collider.handle, motion.spell, motion.ownerId);
      bursts.push({ motion, position: impact, reason: "hit" });
      removedIds.push(id);
      continue;
    }

    if (segmentReachesTarget(previous, motion, stepDistance)) {
      bursts.push({ motion, position: motion.targetPoint, reason: "hit" });
      removedIds.push(id);
    }
  }

  if (removedIds.length > 0) {
    for (const id of removedIds) projectileMotion.unregister(id);
    useGameStore.setState((s) => ({ projectileIds: s.projectileIds.filter((id) => !removedIds.includes(id)) }));
  }

  for (const burst of bursts) {
    spawnImpactArea(burst.motion.id, burst.motion.ownerId, burst.motion.spell, burst.position, burst.motion.direction, burst.reason);
  }
}

function integrateMotion(motion: ProjectileMotion, delta: number) {
  if (motion.mode === "arc") motion.velocity[1] += ARC_GRAVITY * delta;
  motion.position[0] += motion.velocity[0] * delta;
  motion.position[1] += motion.velocity[1] * delta;
  motion.position[2] += motion.velocity[2] * delta;
  motion.direction = directionBetween([0, 0, 0], motion.velocity);
}

function resolveHitscan(motion: ProjectileMotion, world: World): Vec3 {
  const distance = vec3Distance(motion.position, motion.targetPoint);
  const hit = raycastStep(world, motion.position, motion.direction, distance, motion.ownerColliderHandle);
  if (!hit) return motion.targetPoint;
  resolveDirectHit(hit.collider.handle, motion.spell, motion.ownerId);
  return [
    motion.position[0] + motion.direction[0] * hit.timeOfImpact,
    motion.position[1] + motion.direction[1] * hit.timeOfImpact,
    motion.position[2] + motion.direction[2] * hit.timeOfImpact,
  ];
}

function raycastStep(world: World, origin: Vec3, direction: Vec3, distance: number, ownerColliderHandle: number | null) {
  if (!sharedRay) sharedRay = new Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  sharedRay.origin.x = origin[0];
  sharedRay.origin.y = origin[1];
  sharedRay.origin.z = origin[2];
  sharedRay.dir.x = direction[0];
  sharedRay.dir.y = direction[1];
  sharedRay.dir.z = direction[2];
  return world.castRay(
    sharedRay,
    distance,
    true,
    undefined,
    AIM_RAY_GROUPS,
    undefined,
    undefined,
    ownerColliderHandle == null ? undefined : (collider) => collider.handle !== ownerColliderHandle,
  );
}

function resolveDirectHit(colliderHandle: number, spell: GeneratedSpell, ownerId: string) {
  const state = useGameStore.getState();
  const entry = colliderRegistry.get(colliderHandle);
  if (!entry) return;
  if (entry.kind === "dummy") {
    state.damageDummy(entry.id, spell.damage, ownerId);
  } else if (entry.kind === "wizard" && entry.id !== ownerId) {
    state.damagePlayer(entry.id, spell.damage, ownerId);
    state.applyStatusEffect(entry.id, spell.statusEffect, ownerId, spell.id, spell.statusDurationMs, spell.statusStrength);
  }
}

function segmentReachesTarget(previous: Vec3, motion: ProjectileMotion, stepDistance: number): boolean {
  const toTarget: Vec3 = [
    motion.targetPoint[0] - previous[0],
    motion.targetPoint[1] - previous[1],
    motion.targetPoint[2] - previous[2],
  ];
  const dir = directionBetween(previous, motion.position);
  const along = toTarget[0] * dir[0] + toTarget[1] * dir[1] + toTarget[2] * dir[2];
  if (along < 0 || along > stepDistance) return false;
  const closest: Vec3 = [previous[0] + dir[0] * along, previous[1] + dir[1] * along, previous[2] + dir[2] * along];
  return vec3Distance(closest, motion.targetPoint) <= Math.max(0.45, motion.spell.radius * 0.3);
}

function skyfallReachedGround(previous: Vec3, motion: ProjectileMotion): boolean {
  if (motion.velocity[1] >= 0) return vec3Distance(motion.position, motion.targetPoint) <= 0.25;
  return previous[1] >= motion.targetPoint[1] && motion.position[1] <= motion.targetPoint[1] + 0.05;
}

function spawnImpactArea(projectileId: string, ownerId: string, spell: GeneratedSpell, position: Vec3, direction: Vec3, reason: "hit" | "expire") {
  const timestamp = Date.now();
  const durationMs = spell.impactDurationMs;
  if (durationMs <= 0) return;
  if (reason === "expire" && durationMs < spell.durationMs) return;
  const radius = hasLingeringImpact(spell) ? spell.radius : Math.max(0.7, spell.radius * 1.35);
  const forward = horizontalForward(direction);
  useGameStore.setState((state) => ({
    areas: [
      ...state.areas,
      {
        id: `${projectileId}-${reason}`,
        ownerId,
        spell: { ...spell, radius },
        position,
        forward,
        attachedToId: null,
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
    const attached = area.attachedToId ? state.players[area.attachedToId] : null;
    const areaPosition = attached ? attached.position : area.position;
    const lingering = hasLingeringImpact(area.spell);
    const tickWindow = lingering ? 650 : area.expiresAt - area.createdAt + 1;
    const tickDamage = lingering ? Math.max(4, Math.round(area.spell.damage * 0.28)) : area.spell.damage;
    const tickedAt = { ...area.tickedAt };

    for (const dummy of state.dummyTargets) {
      if (dummy.respawnAt) continue;
      const lastTick = tickedAt[dummy.id] ?? 0;
      if (timestamp - lastTick < tickWindow) continue;
      if (targetInsideArea(dummy.position, areaPosition, area.forward, area.spell)) {
        state.damageDummy(dummy.id, tickDamage, area.ownerId);
        tickedAt[dummy.id] = timestamp;
      }
    }

    for (const player of Object.values(state.players)) {
      if (player.id === area.ownerId || player.status === "dead") continue;
      const lastTick = tickedAt[player.id] ?? 0;
      if (timestamp - lastTick < tickWindow) continue;
      if (targetInsideArea(player.position, areaPosition, area.forward, area.spell)) {
        state.damagePlayer(player.id, tickDamage, area.ownerId);
        state.applyStatusEffect(player.id, area.spell.statusEffect, area.ownerId, area.spell.id, area.spell.statusDurationMs, area.spell.statusStrength);
        tickedAt[player.id] = timestamp;
      }
    }

    nextAreas.push({ ...area, position: areaPosition, tickedAt });
  }

  useGameStore.setState({ areas: nextAreas });
}

function resolveStatusTicks() {
  const state = useGameStore.getState();
  const timestamp = Date.now();
  for (const player of Object.values(state.players)) {
    for (const effect of player.statusEffects) {
      if (effect.effect !== "burn" && effect.effect !== "decay") continue;
      if (timestamp - effect.lastTickAt < 700) continue;
      const damage = effect.effect === "burn" ? Math.max(2, Math.round(effect.strength * 2.4)) : Math.max(1, Math.round(effect.strength * 1.6));
      state.damagePlayer(player.id, damage, effect.ownerId);
      markStatusTick(player.id, effect.id, timestamp);
    }
  }
}

function hasLingeringImpact(spell: GeneratedSpell): boolean {
  return (
    spell.deliveryVehicle === "aura_orbit" ||
    spell.buildSpec.vfx.impact.includes("lingering_cloud") ||
    spell.buildSpec.vfx.impact.includes("ground_decal")
  );
}

function markStatusTick(playerId: string, effectId: string, timestamp: number) {
  useGameStore.setState((state) => {
    const player = state.players[playerId];
    if (!player) return state;
    return {
      players: {
        ...state.players,
        [playerId]: {
          ...player,
          statusEffects: player.statusEffects.map((effect) =>
            effect.id === effectId ? { ...effect, lastTickAt: timestamp } : effect,
          ),
        },
      },
    };
  });
}

function targetInsideArea(target: Vec3, origin: Vec3, forward: Vec3, spell: GeneratedSpell): boolean {
  if (spell.impactShape === "line") return pointNearLine(target, origin, forward, spell.radius * 3.5, Math.max(0.8, spell.radius * 0.42));
  if (spell.impactShape === "wall") return pointInsideWall(target, origin, forward, spell.radius * 2.6, Math.max(0.6, spell.radius * 0.5));
  return vec3Distance(target, origin) <= spell.radius + 0.7;
}

function pointNearLine(point: Vec3, origin: Vec3, forward: Vec3, length: number, width: number): boolean {
  const dx = point[0] - origin[0];
  const dz = point[2] - origin[2];
  const along = dx * forward[0] + dz * forward[2];
  if (along < 0 || along > length) return false;
  const px = origin[0] + forward[0] * along;
  const pz = origin[2] + forward[2] * along;
  return Math.hypot(point[0] - px, point[2] - pz) <= width;
}

function pointInsideWall(point: Vec3, origin: Vec3, forward: Vec3, halfWidth: number, halfDepth: number): boolean {
  const right: Vec3 = [forward[2], 0, -forward[0]];
  const dx = point[0] - origin[0];
  const dz = point[2] - origin[2];
  const side = Math.abs(dx * right[0] + dz * right[2]);
  const depth = Math.abs(dx * forward[0] + dz * forward[2]);
  return side <= halfWidth && depth <= halfDepth;
}

function directionBetween(a: Vec3, b: Vec3): Vec3 {
  const x = b[0] - a[0];
  const y = b[1] - a[1];
  const z = b[2] - a[2];
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function horizontalForward(direction: Vec3): Vec3 {
  if (Math.abs(direction[1]) > 0.95) return [0, 0, 1];
  const x = direction[0];
  const z = direction[2];
  const len = Math.hypot(x, z) || 1;
  return [x / len, 0, z / len];
}
