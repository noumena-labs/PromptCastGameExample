"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useGameStore } from "@/game/state/gameStore";
import { vec3Distance, vec3DistanceSq } from "@/game/math/vector";
import type { AreaSpellState, ProjectileState, Vec3 } from "@/game/types";

export function GameplaySystems() {
  const accumulator = useRef(0);

  useFrame((_, delta) => {
    const state = useGameStore.getState();
    accumulator.current += delta;
    state.regenerateMana(delta);

    if (accumulator.current > 0.12) {
      accumulator.current = 0;
      state.respawnCrystals();
      state.tickRespawns();
      state.tickAreas();
      state.tickCooldowns();
      collectNearbyCrystals();
      resolveAreas();
    }

    advanceProjectiles(delta);
  });

  return null;
}

function collectNearbyCrystals() {
  const state = useGameStore.getState();
  const player = state.players[state.localPlayerId];
  if (!player || player.status === "dead") return;

  for (const crystal of state.crystals) {
    if (crystal.active && vec3DistanceSq(player.position, crystal.position) < 2.1) {
      state.collectCrystal(crystal.id);
      break;
    }
  }
}

function advanceProjectiles(delta: number) {
  const state = useGameStore.getState();
  const timestamp = Date.now();
  const removals = new Set<string>();
  const nextProjectiles: ProjectileState[] = [];

  for (const projectile of state.projectiles) {
    if (projectile.expiresAt <= timestamp) {
      removals.add(projectile.id);
      continue;
    }

    const nextPosition: Vec3 = [
      projectile.position[0] + projectile.direction[0] * projectile.spell.speed * delta,
      projectile.position[1] + projectile.direction[1] * projectile.spell.speed * delta,
      projectile.position[2] + projectile.direction[2] * projectile.spell.speed * delta,
    ];

    const hitDummy = state.dummyTargets.find(
      (dummy) => !dummy.respawnAt && vec3DistanceSq(nextPosition, dummy.position) < Math.pow(projectile.spell.radius + 0.95, 2),
    );
    if (hitDummy) {
      state.damageDummy(hitDummy.id, projectile.spell.damage, projectile.ownerId);
      removals.add(projectile.id);
      spawnBurst(projectile, nextPosition);
      continue;
    }

    const hitPlayer = Object.values(state.players).find(
      (player) =>
        player.id !== projectile.ownerId && player.status !== "dead" && vec3DistanceSq(nextPosition, player.position) < Math.pow(projectile.spell.radius + 0.75, 2),
    );
    if (hitPlayer) {
      state.damagePlayer(hitPlayer.id, projectile.spell.damage, projectile.ownerId);
      removals.add(projectile.id);
      spawnBurst(projectile, nextPosition);
      continue;
    }

    nextProjectiles.push({ ...projectile, position: nextPosition });
  }

  if (nextProjectiles.length !== state.projectiles.length || removals.size > 0) {
    useGameStore.setState({ projectiles: nextProjectiles });
  }
}

function spawnBurst(projectile: ProjectileState, position: Vec3) {
  const spell = projectile.spell;
  if (spell.radius < 1.6 && spell.effects.length === 0) return;
  const timestamp = Date.now();
  useGameStore.setState((state) => ({
    areas: [
      ...state.areas,
      {
        id: `${projectile.id}-impact`,
        ownerId: projectile.ownerId,
        spell: { ...spell, shape: "burst", durationMs: 650, radius: Math.max(1.4, spell.radius) },
        position,
        createdAt: timestamp,
        expiresAt: timestamp + 650,
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
    const tickWindow = area.spell.shape === "burst" ? area.spell.durationMs : 650;
    const tickDamage = area.spell.shape === "burst" ? area.spell.damage : Math.max(4, Math.round(area.spell.damage * 0.28));
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
