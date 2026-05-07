"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { useGameStore } from "@/game/state/gameStore";
import { projectileMotion } from "@/game/state/projectileMotion";
import { SceneNodeRenderer } from "@/components/game/scene/SceneNodeRenderer";
import type { Vec3 } from "@/game/types";

/**
 * SpellEntities renders both projectiles (motion-driven) and area spells
 * (static-position-with-radius) using the SceneNode DSL via SceneNodeRenderer.
 *
 * Each spell carries two scenes: `scenes.cast` (used during travel/cast) and
 * `scenes.impact` (used during the impact area's lifetime). Projectiles render
 * the cast scene; area spells render the impact scene.
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
        scene={spell.scenes.cast}
        spellId={spell.id}
        spawnedAt={createdAt}
        lifetimeSeconds={Math.max(0.4, spell.durationMs / 1000)}
        variant="cast"
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
  const rotation = orientationFor(area);

  return (
    <group position={area.position} rotation-y={rotation}>
      <group scale={[radius, 1, radius]}>
        <SceneNodeRenderer
          scene={area.spell.scenes.impact}
          spellId={area.spell.id}
          spawnedAt={area.createdAt}
          lifetimeSeconds={Math.max(0.6, (area.expiresAt - area.createdAt) / 1000)}
          variant="impact"
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

/**
 * Choose a Y-axis rotation for the area's geometry. Walls and beams should
 * face perpendicular to / along the cast direction so they actually feel
 * like a barrier or a line of force. Other impacts get a stable random
 * rotation so identical spells don't all line up the same way.
 */
function orientationFor(area: { id: string; forward: Vec3; spell: { impact: string } }): number {
  const impact = area.spell.impact;
  const f = area.forward;
  const fwLen = Math.hypot(f[0], f[2]);
  if (fwLen > 1e-3 && impact === "wall") {
    // Walls should BLOCK the cast direction: their long axis (segments laid
    // along local +X by arrange='line') runs perpendicular to forward, so
    // the broad face faces the caster. atan2(forward.x, forward.z) yaws so
    // local +Z aligns with forward; offsetting by +π/2 puts local +X
    // perpendicular to forward — exactly what we want.
    return Math.atan2(f[0], f[2]) + Math.PI / 2;
  }
  if (fwLen > 1e-3 && impact === "trap") {
    // Traps are flat sigils on the ground; align their local +X with
    // forward so any directional artwork reads correctly to the caster.
    return Math.atan2(f[0], f[2]);
  }
  return deterministicRotation(area.id);
}

function deterministicRotation(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }
  return (hash / 997) * Math.PI;
}
