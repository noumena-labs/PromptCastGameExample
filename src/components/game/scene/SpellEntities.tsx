"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { useGameStore } from "@/game/state/gameStore";
import { projectileMotion } from "@/game/state/projectileMotion";
import { recipeForArchetype } from "@/game/spells/archetypeDefaults";
import { EffectComposer } from "./effects/EffectComposer";

/**
 * SpellEntities renders both projectiles (motion-driven) and area spells
 * (static-position-with-radius) using the recipe-driven `EffectComposer`.
 *
 * Per design: the composer reads the spell's `visualRecipe` (always present
 * post-pipeline) and dispatches to primitive R3F components. Legacy spells
 * without a recipe fall back to `recipeForArchetype(archetype)`.
 */

export function SpellEntities() {
  const projectileIds = useGameStore(useShallow((state) => state.projectileIds));
  const areaIds = useGameStore(useShallow((state) => state.areas.map((a) => a.id)));

  return (
    <group>
      {projectileIds.map((id) => (
        <Projectile key={id} id={id} />
      ))}
      {areaIds.map((id) => (
        <AreaSpell key={id} areaId={id} />
      ))}
    </group>
  );
}

function Projectile({ id }: { id: string }) {
  const groupRef = useRef<Group>(null);
  const [motionSnapshot] = useState(() => projectileMotion.get(id));

  useFrame(() => {
    const m = projectileMotion.get(id);
    if (!groupRef.current || !m) return;
    groupRef.current.position.set(m.position[0], m.position[1], m.position[2]);
  });

  if (!motionSnapshot) return null;
  const { spell, direction, createdAt } = motionSnapshot;
  // Recipe is required on `GeneratedSpell` post-pipeline; the fallback is
  // defensive in case an upstream consumer (e.g. test harness, network sync)
  // strips it.
  const recipe = spell.visualRecipe ?? recipeForArchetype(spell.archetype);

  return (
    <group ref={groupRef} position={motionSnapshot.position}>
      <EffectComposer
        recipe={recipe}
        spawnedAt={createdAt}
        lifetimeSeconds={Math.max(0.4, spell.durationMs / 1000)}
        direction={direction}
      />
    </group>
  );
}

function AreaSpell({ areaId }: { areaId: string }) {
  const area = useGameStore((state) => state.areas.find((item) => item.id === areaId));
  // `now` ticks once a frame so age-driven effects (shockwave, ring pulse)
  // re-render their internal timing inside the composer. The composer itself
  // already reads age via useFrame, so we don't actually need to force renders
  // — but we DO need the visual to track the area's lifetime in case a
  // future enhancement wants to fade it on expiry.
  const [, setTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => setTick((n) => (n + 1) & 0xffff), 250);
    return () => clearInterval(handle);
  }, []);

  const recipe = useMemo(() => {
    if (!area) return null;
    return area.spell.visualRecipe ?? recipeForArchetype(area.spell.archetype);
  }, [area]);

  if (!area || !recipe) return null;

  // Scale the composer's local 1.0 unit primitives (rings, discs) to the
  // area's actual radius. We do this on the parent group so primitive code
  // stays radius-agnostic.
  const radius = area.spell.radius;
  const rotation = deterministicRotation(area.id);

  return (
    <group position={area.position} rotation-y={rotation}>
      <group scale={[radius, 1, radius]}>
        <EffectComposer
          recipe={recipe}
          spawnedAt={area.createdAt}
          lifetimeSeconds={Math.max(0.6, (area.expiresAt - area.createdAt) / 1000)}
        />
      </group>
      <Billboard position={[0, 0.18, 0]}>
        <Text fontSize={0.32} color={recipe.palette.primary} anchorX="center" anchorY="middle">
          {area.spell.name}
        </Text>
      </Billboard>
    </group>
  );
}

function deterministicRotation(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }
  return (hash / 997) * Math.PI;
}
