"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { useGameStore } from "@/game/state/gameStore";
import { projectileMotion } from "@/game/state/projectileMotion";
import { SceneNodeRenderer } from "@/components/game/scene/SceneNodeRenderer";

/**
 * SpellEntities renders both projectiles (motion-driven) and area spells
 * (static-position-with-radius) using the SceneNode DSL via SceneNodeRenderer.
 *
 * The spell's `scene` field is always present post-pipeline; there is no
 * fallback path. If a spell ever arrives without a scene the renderer simply
 * omits it.
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
  const { spell, createdAt } = motionSnapshot;

  return (
    <group ref={groupRef} position={motionSnapshot.position}>
      <SceneNodeRenderer
        scene={spell.scene}
        spellId={spell.id}
        spawnedAt={createdAt}
        lifetimeSeconds={Math.max(0.4, spell.durationMs / 1000)}
      />
    </group>
  );
}

function AreaSpell({ areaId }: { areaId: string }) {
  const area = useGameStore((state) => state.areas.find((item) => item.id === areaId));
  // Lightweight tick so the billboard label re-evaluates if the spell expires
  // mid-frame. The renderer drives its own per-frame motion via useFrame.
  const [, setTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => setTick((n) => (n + 1) & 0xffff), 250);
    return () => clearInterval(handle);
  }, []);

  if (!area) return null;

  // Scale the scene to the area's radius. Authored sizes are in meters
  // assuming a ~1m unit scene; the renderer's local 1.0 is mapped onto the
  // actual radius here.
  const radius = area.spell.radius;
  const rotation = deterministicRotation(area.id);

  return (
    <group position={area.position} rotation-y={rotation}>
      <group scale={[radius, 1, radius]}>
        <SceneNodeRenderer
          scene={area.spell.scene}
          spellId={area.spell.id}
          spawnedAt={area.createdAt}
          lifetimeSeconds={Math.max(0.6, (area.expiresAt - area.createdAt) / 1000)}
        />
      </group>
      <Billboard position={[0, 0.18, 0]}>
        <Text fontSize={0.32} color={area.spell.color} anchorX="center" anchorY="middle">
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
