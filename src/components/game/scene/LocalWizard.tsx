"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { Group, MathUtils, Vector3 } from "three";
import { ARENA_RADIUS, LOCAL_PLAYER_ID, MAGIC_MISSILE } from "@/game/config/gameConfig";
import { getGroundHeight } from "@/game/arena/terrain";
import { normalizeVec3, toVec3 } from "@/game/math/vector";
import { useGameStore } from "@/game/state/gameStore";
import { WizardModel } from "@/components/game/scene/WizardModel";

type ControlName = "forward" | "backward" | "left" | "right" | "jump";

const cameraOffset = new Vector3(0, 6.2, 9.5);
const cameraLookOffset = new Vector3(0, 1.35, 0);

export function LocalWizard() {
  const group = useRef<Group>(null);
  const position = useRef(new Vector3(0, 1.1, 18));
  const velocity = useRef(new Vector3(0, 0, 0));
  const rotationY = useRef(0);
  const grounded = useRef(false);
  const mouseDown = useRef(false);
  const lastMagicMissileAt = useRef(0);
  const getControls = useKeyboardControls<ControlName>()[1];
  const { camera } = useThree();
  const player = useGameStore((state) => state.players[state.localPlayerId]);
  const updateLocalTransform = useGameStore((state) => state.updateLocalTransform);
  const castSpell = useGameStore((state) => state.castSpell);
  const castSlot = useGameStore((state) => state.castSlot);
  const enterSanctuary = useGameStore((state) => state.enterSanctuary);
  const exitSanctuary = useGameStore((state) => state.exitSanctuary);
  const promptOpen = useGameStore((state) => state.promptOpen);
  const sanctuaryEndsAt = useGameStore((state) => state.sanctuaryEndsAt);
  const addLog = useGameStore((state) => state.addLog);
  const directionVectors = useRef({ forward: new Vector3(), right: new Vector3(), move: new Vector3(), flatCamera: new Vector3(), cast: new Vector3() });

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) mouseDown.current = true;
    };
    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) mouseDown.current = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || promptOpen) return;
      const origin = toVec3(position.current.x, position.current.y + 1.25, position.current.z);
      const direction = getCastDirection(camera, directionVectors.current.cast);
      if (event.code === "KeyE") {
        if (!enterSanctuary()) addLog("Collect 3 Aura Crystals before entering Sanctuary.");
      }
      if (event.code === "Digit1") castSlot(0, origin, direction);
      if (event.code === "Digit2") castSlot(1, origin, direction);
      if (event.code === "Digit3") castSlot(2, origin, direction);
      if (event.code === "Digit4") castSlot(3, origin, direction);
    };
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [addLog, camera, castSlot, enterSanctuary, promptOpen]);

  useFrame((_, delta) => {
    if (!player) return;
    if (player.id === LOCAL_PLAYER_ID && player.position[0] !== position.current.x && player.status === "dead") {
      position.current.set(...player.position);
    }

    if (promptOpen && sanctuaryEndsAt && sanctuaryEndsAt <= Date.now()) {
      exitSanctuary();
    }

    const sanctuary = player.status === "sanctuary";
    const dead = player.status === "dead";
    const controls = getControls();
    const ground = getGroundHeight(position.current.x, position.current.z) + 1.05;

    const vectors = directionVectors.current;
    vectors.flatCamera.setFromMatrixColumn(camera.matrix, 0);
    vectors.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    vectors.forward.y = 0;
    vectors.forward.normalize();
    vectors.right.copy(vectors.flatCamera);
    vectors.right.y = 0;
    vectors.right.normalize();
    vectors.move.set(0, 0, 0);

    if (!sanctuary && !dead && !promptOpen) {
      if (controls.forward) vectors.move.add(vectors.forward);
      if (controls.backward) vectors.move.sub(vectors.forward);
      if (controls.right) vectors.move.add(vectors.right);
      if (controls.left) vectors.move.sub(vectors.right);
      if (vectors.move.lengthSq() > 0) {
        vectors.move.normalize();
        velocity.current.x = MathUtils.damp(velocity.current.x, vectors.move.x * 11, 12, delta);
        velocity.current.z = MathUtils.damp(velocity.current.z, vectors.move.z * 11, 12, delta);
        rotationY.current = Math.atan2(vectors.move.x, vectors.move.z);
      } else {
        velocity.current.x = MathUtils.damp(velocity.current.x, 0, 10, delta);
        velocity.current.z = MathUtils.damp(velocity.current.z, 0, 10, delta);
      }
      if (controls.jump && grounded.current) {
        velocity.current.y = 8.4;
        grounded.current = false;
      }
    } else {
      velocity.current.x = MathUtils.damp(velocity.current.x, 0, 12, delta);
      velocity.current.z = MathUtils.damp(velocity.current.z, 0, 12, delta);
    }

    velocity.current.y += sanctuary ? Math.sin(Date.now() / 250) * 0.015 : -21 * delta;
    position.current.addScaledVector(velocity.current, delta);

    const distance = Math.hypot(position.current.x, position.current.z);
    if (distance > ARENA_RADIUS - 1.4) {
      const scale = (ARENA_RADIUS - 1.4) / distance;
      position.current.x *= scale;
      position.current.z *= scale;
    }

    const targetY = sanctuary ? ground + 1.8 : ground;
    if (position.current.y <= targetY) {
      position.current.y = MathUtils.damp(position.current.y, targetY, sanctuary ? 5 : 20, delta);
      if (!sanctuary) {
        velocity.current.y = 0;
        grounded.current = true;
      }
    }

    if (mouseDown.current && !promptOpen && !dead && Date.now() - lastMagicMissileAt.current > MAGIC_MISSILE.cooldownMs) {
      const origin = toVec3(position.current.x, position.current.y + 1.25, position.current.z);
      const direction = getCastDirection(camera, vectors.cast);
      if (castSpell(MAGIC_MISSILE, origin, direction)) lastMagicMissileAt.current = Date.now();
    }

    group.current?.position.copy(position.current);
    if (group.current) group.current.rotation.y = rotationY.current;
    updateLocalTransform(toVec3(position.current.x, position.current.y, position.current.z), rotationY.current, toVec3(velocity.current.x, velocity.current.y, velocity.current.z));

    const cameraTarget = position.current.clone().add(cameraOffset.clone().applyAxisAngle(new Vector3(0, 1, 0), rotationY.current));
    camera.position.lerp(cameraTarget, 1 - Math.exp(-5 * delta));
    camera.lookAt(position.current.clone().add(cameraLookOffset));
  });

  return (
    <group ref={group}>
      <WizardModel color={player?.color ?? "#74f7d0"} shielded={player?.isShielded} />
    </group>
  );
}

function getCastDirection(camera: { getWorldDirection: (target: Vector3) => Vector3 }, target: Vector3) {
  camera.getWorldDirection(target);
  target.y = Math.max(-0.05, target.y + 0.04);
  return normalizeVec3([target.x, target.y, target.z]);
}
