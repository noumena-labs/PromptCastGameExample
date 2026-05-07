"use client";

import { useMemo } from "react";
import { Euler } from "three";
import { CuboidCollider, CylinderCollider, RigidBody } from "@react-three/rapier";
import { getGroundHeight } from "@/game/arena/terrain";
import { ENVIRONMENT_GROUPS } from "@/game/physics/collisionGroups";

const stoneColor = "#8a8273";
const stoneShadow = "#5e574b";
const mossColor = "#4a6a3c";

/**
 * Pattern: each static piece is its own positioned <RigidBody type="fixed">.
 * Mesh + collider live at LOCAL origin inside the body, so the RigidBody's
 * world transform is the single source of truth. No wrapping <group> with a
 * position (those would offset visuals but not the rapier transform, causing
 * visual/collider drift).
 */
export function Shrine() {
  const groundY = useMemo(() => getGroundHeight(0, 0), []);

  const standingStones = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => {
        const angle = (index / 6) * Math.PI * 2 + Math.PI / 12;
        const radius = 5.4;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const y = getGroundHeight(x, z);
        const tilt = (index % 3) * 0.06 - 0.05;
        return {
          pos: [x, y + 1.65, z] as [number, number, number],
          rot: new Euler(tilt, angle, tilt * 0.6),
          height: 3.2 + (index % 2) * 0.6,
        };
      }),
    [],
  );

  const rubble = useMemo(() => {
    const items: { pos: [number, number, number]; rot: number; size: number }[] = [];
    for (let i = 0; i < 14; i += 1) {
      const angle = ((i * 137.5) % 360) * (Math.PI / 180);
      const radius = 3 + (i % 5) * 0.7;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = getGroundHeight(x, z);
      items.push({
        pos: [x, y + 0.18, z],
        rot: (i * 0.41) % (Math.PI * 2),
        size: 0.4 + (i % 4) * 0.18,
      });
    }
    return items;
  }, []);

  // Arch lives 7.5 units along -Z from origin. Apply offset to each piece
  // directly rather than wrapping in a <group> (which would not move colliders).
  const archOffsetZ = -7.5;
  const archGroundY = getGroundHeight(0, archOffsetZ);
  const obeliskX = 6.5;
  const obeliskZ = 4;
  const obeliskGroundY = getGroundHeight(obeliskX, obeliskZ);

  return (
    <group>
      {/* Dais: low stepped platform — one RigidBody at center with a single cylinder collider. */}
      <RigidBody type="fixed" colliders={false} position={[0, groundY, 0]}>
        <mesh receiveShadow castShadow position={[0, 0.12, 0]}>
          <cylinderGeometry args={[4.6, 4.8, 0.32, 16]} />
          <meshStandardMaterial color={stoneColor} roughness={0.95} />
        </mesh>
        <mesh receiveShadow castShadow position={[0, 0.42, 0]}>
          <cylinderGeometry args={[3.6, 3.8, 0.34, 16]} />
          <meshStandardMaterial color={stoneShadow} roughness={0.95} />
        </mesh>
        <mesh receiveShadow castShadow position={[0, 0.74, 0]}>
          <cylinderGeometry args={[2.4, 2.6, 0.26, 16]} />
          <meshStandardMaterial color={stoneColor} roughness={0.95} />
        </mesh>
        <mesh receiveShadow position={[0, 0.88, 0]}>
          <cylinderGeometry args={[2.2, 2.2, 0.02, 16]} />
          <meshStandardMaterial color={mossColor} roughness={1} />
        </mesh>
        <CylinderCollider args={[0.45, 4.6]} position={[0, 0.45, 0]} collisionGroups={ENVIRONMENT_GROUPS} />
      </RigidBody>

      {/* Standing stones — each is its own RigidBody, mesh + collider at local origin. */}
      {standingStones.map((stone, i) => (
        <RigidBody
          key={`stone-${i}`}
          type="fixed"
          colliders={false}
          position={stone.pos}
          rotation={[stone.rot.x, stone.rot.y, stone.rot.z]}
        >
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.9, stone.height, 0.6]} />
            <meshStandardMaterial color={stoneColor} roughness={0.95} />
          </mesh>
          <CuboidCollider args={[0.45, stone.height / 2, 0.3]} collisionGroups={ENVIRONMENT_GROUPS} />
        </RigidBody>
      ))}

      {/* Broken arch: two pillars + tilted lintel. Each piece is its own positioned RigidBody. */}
      <RigidBody type="fixed" colliders={false} position={[-1.6, archGroundY + 2.2, archOffsetZ]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.8, 4.4, 0.8]} />
          <meshStandardMaterial color={stoneShadow} roughness={0.95} />
        </mesh>
        <CuboidCollider args={[0.4, 2.2, 0.4]} collisionGroups={ENVIRONMENT_GROUPS} />
      </RigidBody>
      <RigidBody
        type="fixed"
        colliders={false}
        position={[1.6, archGroundY + 2.0, archOffsetZ]}
        rotation={[0, 0, -0.08]}
      >
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.8, 4.0, 0.8]} />
          <meshStandardMaterial color={stoneShadow} roughness={0.95} />
        </mesh>
        <CuboidCollider args={[0.4, 2.0, 0.4]} collisionGroups={ENVIRONMENT_GROUPS} />
      </RigidBody>
      <RigidBody
        type="fixed"
        colliders={false}
        position={[0, archGroundY + 4.6, archOffsetZ]}
        rotation={[0, 0, 0.18]}
      >
        <mesh castShadow>
          <boxGeometry args={[3.6, 0.6, 0.9]} />
          <meshStandardMaterial color={stoneColor} roughness={0.95} />
        </mesh>
        <CuboidCollider args={[1.8, 0.3, 0.45]} collisionGroups={ENVIRONMENT_GROUPS} />
      </RigidBody>

      {/* Rubble — visual only (low and walkable). */}
      {rubble.map((piece, i) => (
        <mesh
          key={`rubble-${i}`}
          castShadow
          receiveShadow
          position={piece.pos}
          rotation-y={piece.rot}
        >
          <dodecahedronGeometry args={[piece.size, 0]} />
          <meshStandardMaterial color={i % 2 === 0 ? stoneColor : stoneShadow} roughness={0.95} />
        </mesh>
      ))}

      {/* Leaning obelisk near the back. */}
      <RigidBody
        type="fixed"
        colliders={false}
        position={[obeliskX, obeliskGroundY + 2.6, obeliskZ]}
        rotation={[0.1, 0.4, -0.18]}
      >
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.2, 5.4, 1.2]} />
          <meshStandardMaterial color={stoneColor} roughness={0.95} />
        </mesh>
        <CuboidCollider args={[0.6, 2.7, 0.6]} collisionGroups={ENVIRONMENT_GROUPS} />
      </RigidBody>
    </group>
  );
}
