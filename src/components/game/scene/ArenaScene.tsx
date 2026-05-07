"use client";

import { ContactShadows, Stars } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import { Euler } from "three";
import { ARENA_RADIUS } from "@/game/config/gameConfig";
import { PLATFORMS } from "@/game/arena/terrain";
import { Crystals } from "@/components/game/scene/Crystals";
import { DummyTargets } from "@/components/game/scene/DummyTargets";
import { GameplaySystems } from "@/components/game/systems/GameplaySystems";
import { LocalWizard } from "@/components/game/scene/LocalWizard";
import { RemoteWizards } from "@/components/game/scene/RemoteWizards";
import { SpellEntities } from "@/components/game/scene/SpellEntities";

function Trees() {
  const trees = useMemo(
    () =>
      Array.from({ length: 78 }, (_, index) => {
        const angle = (index / 78) * Math.PI * 2;
        const radius = ARENA_RADIUS + 2 + (index % 5) * 1.1;
        return {
          id: `tree-${index}`,
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
          scale: 0.85 + (index % 4) * 0.18,
          rotation: angle + Math.PI / 7,
        };
      }),
    [],
  );

  return (
    <group>
      {trees.map((tree) => (
        <group key={tree.id} position={[tree.x, 0, tree.z]} rotation-y={tree.rotation} scale={tree.scale}>
          <mesh castShadow position={[0, 1.1, 0]}>
            <cylinderGeometry args={[0.18, 0.26, 2.2, 5]} />
            <meshStandardMaterial color="#2b1a12" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, 2.55, 0]}>
            <coneGeometry args={[1.05, 2.1, 6]} />
            <meshStandardMaterial color="#123f32" roughness={0.8} />
          </mesh>
          <mesh castShadow position={[0, 3.55, 0]}>
            <coneGeometry args={[0.72, 1.55, 6]} />
            <meshStandardMaterial color="#185244" emissive="#0a2e24" emissiveIntensity={0.18} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CastleRuins() {
  const columns = [
    [-18, 2.8, -5, 1.2, 5.6, 1.2],
    [-10, 3.3, 7, 1.2, 6.6, 1.2],
    [18, 2.8, 5, 1.2, 5.6, 1.2],
    [10, 3.3, -7, 1.2, 6.6, 1.2],
    [-4, 3.2, -18, 1, 6.4, 1],
    [4, 2.5, -18, 1, 5, 1],
  ];

  return (
    <group>
      {PLATFORMS.map((platform) => (
        <RigidBody key={platform.id} type="fixed" colliders="cuboid">
          <mesh receiveShadow castShadow position={platform.position}>
            <boxGeometry args={platform.size} />
            <meshStandardMaterial color={platform.color} roughness={0.82} />
          </mesh>
        </RigidBody>
      ))}
      {columns.map(([x, y, z, sx, sy, sz], index) => (
        <RigidBody key={`ruin-column-${index}`} type="fixed" colliders="cuboid">
          <mesh castShadow receiveShadow position={[x, y, z]} rotation-y={index * 0.3}>
            <boxGeometry args={[sx, sy, sz]} />
            <meshStandardMaterial color="#424348" roughness={0.9} />
          </mesh>
        </RigidBody>
      ))}
      <RigidBody type="fixed" colliders="cuboid">
        <mesh castShadow receiveShadow position={[0, 0.85, 0]} rotation={new Euler(0, 0.45, 0)}>
          <boxGeometry args={[5, 1.7, 5]} />
          <meshStandardMaterial color="#282d32" roughness={0.95} />
        </mesh>
      </RigidBody>
    </group>
  );
}

export function ArenaScene() {
  return (
    <>
      <ambientLight intensity={0.34} />
      <directionalLight castShadow position={[-12, 22, 10]} intensity={1.5} color="#9cc8ff" shadow-mapSize={[2048, 2048]} />
      <pointLight position={[0, 7, 0]} intensity={3.5} color="#7cf7da" distance={22} />
      <Stars radius={80} depth={35} count={1200} factor={4} fade speed={0.35} />
      <RigidBody type="fixed" colliders={false}>
        <mesh receiveShadow rotation-x={-Math.PI / 2}>
          <circleGeometry args={[ARENA_RADIUS, 9]} />
          <meshStandardMaterial color="#142920" roughness={0.96} metalness={0.04} />
        </mesh>
        <CuboidCollider args={[ARENA_RADIUS, 0.2, ARENA_RADIUS]} position={[0, -0.22, 0]} />
      </RigidBody>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <ringGeometry args={[ARENA_RADIUS - 0.6, ARENA_RADIUS, 9]} />
        <meshStandardMaterial color="#39d6b5" emissive="#1d8f78" emissiveIntensity={0.75} transparent opacity={0.42} />
      </mesh>
      <CastleRuins />
      <Trees />
      <Crystals />
      <DummyTargets />
      <SpellEntities />
      <RemoteWizards />
      <LocalWizard />
      <GameplaySystems />
      <ContactShadows position={[0, 0.03, 0]} opacity={0.45} scale={55} blur={2.2} far={18} />
    </>
  );
}
