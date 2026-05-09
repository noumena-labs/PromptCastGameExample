"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CapsuleCollider, RigidBody } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { Group, MathUtils, Quaternion, Vector3 } from "three";
import { useShallow } from "zustand/react/shallow";
import { LOCAL_PLAYER_ID } from "@/game/config/gameConfig";
import { useGameStore } from "@/game/state/gameStore";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { WIZARD_GROUPS } from "@/game/physics/collisionGroups";
import { WizardModel, type WizardModelHandle } from "@/components/game/scene/WizardModel";
import { WizardNameplate } from "@/components/game/scene/WizardNameplate";
import { useCastPose, type CastPoseTrigger } from "@/components/game/scene/useCastPose";

const CAPSULE_HALF_HEIGHT = 0.5;
const CAPSULE_RADIUS = 0.45;
const CAPSULE_FOOT_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
const POSITION_SMOOTHING = 14;
const ROTATION_SMOOTHING = 12;

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
  const smoothedPosition = useRef(new Vector3());
  const targetPosition = useRef(new Vector3());
  const initialized = useRef(false);
  const alive = player?.status !== "dead";

  // Cast pose plumbing — same shape as LocalWizard. We derive triggers from
  // the CastVfx entries this player has produced; those entries are appended
  // by gameStore.castSpell, which is called both for local casts and for
  // remote casts replicated through NetworkBridge's player_cast_spell handler.
  const wizardModelRef = useRef<WizardModelHandle | null>(null);
  const castTriggerRef = useRef<CastPoseTrigger | null>(null);
  const castTriggerIdRef = useRef(0);
  const lastSeenVfxIdRef = useRef<string | null>(null);
  const tmpInverseQuat = useRef(new Quaternion());
  useCastPose(wizardModelRef, castTriggerRef);

  // Newest cast VFX id for this player. We pull only the id (a stable
  // string) so this selector doesn't cause re-renders every frame; the
  // forward vector is fetched in the effect via getState().
  const latestVfxId = useGameStore((state) => {
    let latestId: string | null = null;
    let latestCreatedAt = -1;
    for (const vfx of state.castVfx) {
      if (vfx.ownerId !== id) continue;
      if (vfx.createdAt > latestCreatedAt) {
        latestCreatedAt = vfx.createdAt;
        latestId = vfx.id;
      }
    }
    return latestId;
  });

  useEffect(() => {
    if (!latestVfxId) return;
    if (latestVfxId === lastSeenVfxIdRef.current) return;
    lastSeenVfxIdRef.current = latestVfxId;
    const group = visualRef.current;
    if (!group) return;
    const vfx = useGameStore.getState().castVfx.find((entry) => entry.id === latestVfxId);
    if (!vfx) return;
    const inv = tmpInverseQuat.current.copy(group.quaternion).invert();
    const local = new Vector3(vfx.forward[0], vfx.forward[1], vfx.forward[2]).applyQuaternion(inv);
    if (local.lengthSq() < 1e-6) local.set(0, 0, -1);
    castTriggerIdRef.current += 1;
    castTriggerRef.current = {
      id: castTriggerIdRef.current,
      startedAt: performance.now(),
      aimDirLocal: local.normalize(),
    };
  }, [latestVfxId]);

  useEffect(() => {
    if (!alive) return;
    const body = bodyRef.current;
    if (!body || body.numColliders() === 0) return;
    const handle = body.collider(0).handle;
    colliderHandleRef.current = handle;
    colliderRegistry.register(handle, { kind: "wizard", id });
    return () => {
      colliderRegistry.unregister(handle);
      colliderHandleRef.current = null;
    };
  }, [alive, id]);

  useFrame((_, delta) => {
    if (!player || player.status === "dead") {
      bodyRef.current = null;
      visualRef.current = null;
      initialized.current = false;
      return;
    }
    if (!initialized.current) {
      initialized.current = true;
      smoothedPosition.current.set(player.position[0], player.position[1], player.position[2]);
    }
    targetPosition.current.set(player.position[0], player.position[1], player.position[2]);
    smoothedPosition.current.lerp(targetPosition.current, 1 - Math.exp(-POSITION_SMOOTHING * delta));
    const body = bodyRef.current;
    if (body && body.numColliders() > 0) {
      body.setNextKinematicTranslation({
        x: smoothedPosition.current.x,
        y: smoothedPosition.current.y + CAPSULE_FOOT_OFFSET,
        z: smoothedPosition.current.z,
      });
    }
    if (visualRef.current) {
      visualRef.current.position.copy(smoothedPosition.current);
      visualRef.current.rotation.y = MathUtils.damp(visualRef.current.rotation.y, player.rotationY, ROTATION_SMOOTHING, delta);
    }
  });

  if (!player) return null;
  if (!alive) return null;

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="kinematicPosition"
        colliders={false}
        position={[player.position[0], player.position[1] + CAPSULE_FOOT_OFFSET, player.position[2]]}
        enabledRotations={[false, false, false]}
      >
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} collisionGroups={WIZARD_GROUPS} />
      </RigidBody>
      <group ref={visualRef} position={player.position} rotation-y={player.rotationY}>
        <WizardModel ref={wizardModelRef} color={player.color} shielded={player.isShielded} />
        <WizardNameplate name={player.name} health={player.health} color={player.color} />
      </group>
    </>
  );
}
