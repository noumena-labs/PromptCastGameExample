"use client";

import { useEffect, useRef } from "react";
import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { BallCollider, RigidBody } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import type { Mesh } from "three";
import { useShallow } from "zustand/react/shallow";
import { useGameStore } from "@/game/state/gameStore";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { DUMMY_GROUPS } from "@/game/physics/collisionGroups";

export function DummyTargets() {
  const targetIds = useGameStore(useShallow((state) => state.dummyTargets.map((t) => t.id)));

  return (
    <group>
      {targetIds.map((id) => (
        <Dummy key={id} id={id} />
      ))}
    </group>
  );
}

function Dummy({ id }: { id: string }) {
  const target = useGameStore((state) => state.dummyTargets.find((t) => t.id === id));
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const fillRef = useRef<Mesh>(null);
  const colliderHandleRef = useRef<number | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || body.numColliders() === 0) return;
    const handle = body.collider(0).handle;
    colliderHandleRef.current = handle;
    colliderRegistry.register(handle, { kind: "dummy", id });
    return () => {
      colliderRegistry.unregister(handle);
      colliderHandleRef.current = null;
    };
  }, [id, target?.respawnAt]);

  useFrame(() => {
    if (!fillRef.current || !target) return;
    const ratio = Math.max(0, Math.min(1, target.health / target.maxHealth));
    fillRef.current.scale.x = ratio;
    fillRef.current.position.x = -0.65 + (1.3 * ratio) / 2;
  });

  if (!target) return null;
  const active = !target.respawnAt;

  return (
    <group visible={active}>
      <RigidBody ref={bodyRef} type="fixed" colliders={false} position={target.position}>
        <mesh castShadow>
          <dodecahedronGeometry args={[0.95, 0]} />
          <meshStandardMaterial color="#ff746c" emissive="#6c1618" emissiveIntensity={0.35} roughness={0.7} />
        </mesh>
        <mesh position={[0, -0.85, 0]}>
          <cylinderGeometry args={[0.65, 0.8, 0.25, 7]} />
          <meshStandardMaterial color="#2c1b1b" roughness={0.9} />
        </mesh>
        {active ? <BallCollider args={[1.05]} collisionGroups={DUMMY_GROUPS} /> : null}
      </RigidBody>
      <Billboard position={[target.position[0], target.position[1] + 1.45, target.position[2]]}>
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[1.3, 0.12]} />
          <meshBasicMaterial color="#381717" />
        </mesh>
        <mesh ref={fillRef} position={[0, 0, 0.01]}>
          <planeGeometry args={[1.3, 0.12]} />
          <meshBasicMaterial color="#ff746c" />
        </mesh>
        <Text position={[0, 0.28, 0]} fontSize={0.22} color="#f4f7e8" anchorX="center" anchorY="middle">
          target
        </Text>
      </Billboard>
    </group>
  );
}
