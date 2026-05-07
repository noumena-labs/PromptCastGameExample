"use client";

import { useEffect, useRef } from "react";
import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { LOCAL_PLAYER_ID } from "@/game/config/gameConfig";
import { useGameStore } from "@/game/state/gameStore";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { WizardModel } from "@/components/game/scene/WizardModel";

const CAPSULE_HALF_HEIGHT = 0.5;
const CAPSULE_RADIUS = 0.45;
const CAPSULE_FOOT_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

export function RemoteWizards() {
  const localPlayerId = useGameStore((state) => state.localPlayerId);
  const remoteIds = useGameStore(
    useShallow((state) =>
      Object.keys(state.players).filter((id) => id !== localPlayerId && id !== LOCAL_PLAYER_ID),
    ),
  );

  return (
    <group>
      {remoteIds.map((id) => (
        <RemoteWizard key={id} id={id} />
      ))}
    </group>
  );
}

function RemoteWizard({ id }: { id: string }) {
  const player = useGameStore((state) => state.players[id]);
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const visualRef = useRef<Group>(null);
  const colliderHandleRef = useRef<number | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || body.numColliders() === 0) return;
    const handle = body.collider(0).handle;
    colliderHandleRef.current = handle;
    colliderRegistry.register(handle, { kind: "wizard", id });
    return () => {
      colliderRegistry.unregister(handle);
      colliderHandleRef.current = null;
    };
  }, [id]);

  useFrame(() => {
    if (!player) return;
    const body = bodyRef.current;
    if (body) {
      body.setNextKinematicTranslation({
        x: player.position[0],
        y: player.position[1] + CAPSULE_FOOT_OFFSET,
        z: player.position[2],
      });
    }
    if (visualRef.current) {
      visualRef.current.position.set(player.position[0], player.position[1], player.position[2]);
      visualRef.current.rotation.y = player.rotationY;
    }
  });

  if (!player) return null;

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="kinematicPosition"
        colliders={false}
        position={[player.position[0], player.position[1] + CAPSULE_FOOT_OFFSET, player.position[2]]}
        enabledRotations={[false, false, false]}
      >
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
      </RigidBody>
      <group ref={visualRef} position={player.position} rotation-y={player.rotationY}>
        <WizardModel color={player.color} shielded={player.isShielded} />
        <Billboard position={[0, 2.9, 0]}>
          <Text fontSize={0.35} color="#f4f7e8" anchorX="center" anchorY="middle">
            {player.name}
          </Text>
        </Billboard>
      </group>
    </>
  );
}
