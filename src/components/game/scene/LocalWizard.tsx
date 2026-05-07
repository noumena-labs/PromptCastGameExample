"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { Group, MathUtils, Vector3 } from "three";
import { LOCAL_PLAYER_ID, MAGIC_MISSILE, PLAYABLE_RADIUS } from "@/game/config/gameConfig";
import { getGroundHeight } from "@/game/arena/terrain";
import { normalizeVec3, toVec3 } from "@/game/math/vector";
import { useGameStore } from "@/game/state/gameStore";
import { WizardModel } from "@/components/game/scene/WizardModel";

type ControlName = "forward" | "backward" | "left" | "right" | "jump";

const PLAYER_HEIGHT = 1.05;
const MOVE_SPEED = 9.5;
const ACCEL = 14;
const JUMP_VELOCITY = 8.4;
const GRAVITY = -22;
const MOUSE_SENSITIVITY = 0.0024;

const CAM_DISTANCE = 8.5;
const CAM_HEIGHT = 3.6;
const PITCH_MIN = -0.85;
const PITCH_MAX = 0.55;

export function LocalWizard() {
  const group = useRef<Group>(null);
  const position = useRef(new Vector3(0, getGroundHeight(0, 18) + PLAYER_HEIGHT, 18));
  const velocity = useRef(new Vector3());
  const yaw = useRef(Math.PI); // facing -Z (toward shrine)
  const pitch = useRef(-0.18);
  const grounded = useRef(false);
  const mouseDown = useRef(false);
  const pointerLocked = useRef(false);
  const lastMagicMissileAt = useRef(0);
  const getControls = useKeyboardControls<ControlName>()[1];
  const { camera, gl } = useThree();
  const player = useGameStore((state) => state.players[state.localPlayerId]);
  const updateLocalTransform = useGameStore((state) => state.updateLocalTransform);
  const castSpell = useGameStore((state) => state.castSpell);
  const castSlot = useGameStore((state) => state.castSlot);
  const enterSanctuary = useGameStore((state) => state.enterSanctuary);
  const exitSanctuary = useGameStore((state) => state.exitSanctuary);
  const promptOpen = useGameStore((state) => state.promptOpen);
  const sanctuaryEndsAt = useGameStore((state) => state.sanctuaryEndsAt);
  const addLog = useGameStore((state) => state.addLog);

  const tmpForward = useRef(new Vector3());
  const tmpRight = useRef(new Vector3());
  const tmpMove = useRef(new Vector3());
  const tmpCamOffset = useRef(new Vector3());
  const tmpLook = useRef(new Vector3());
  const tmpCastDir = useRef(new Vector3());
  const tmpOrigin = useRef(new Vector3());

  // Pointer lock + mouse handlers
  useEffect(() => {
    const canvas = gl.domElement;

    const onCanvasClick = () => {
      if (promptOpen) return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    };

    const onPointerLockChange = () => {
      pointerLocked.current = document.pointerLockElement === canvas;
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!pointerLocked.current) return;
      yaw.current -= event.movementX * MOUSE_SENSITIVITY;
      pitch.current -= event.movementY * MOUSE_SENSITIVITY;
      pitch.current = Math.max(PITCH_MIN, Math.min(PITCH_MAX, pitch.current));
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0) mouseDown.current = true;
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) mouseDown.current = false;
    };

    canvas.addEventListener("click", onCanvasClick);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      canvas.removeEventListener("click", onCanvasClick);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [gl, promptOpen]);

  // Auto-release pointer lock when prompt opens
  useEffect(() => {
    if (promptOpen && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [promptOpen]);

  // Keyboard handlers (skip when in input/textarea or prompt open)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.repeat) return;
      if (promptOpen) return;

      const camDir = computeCastDirection(yaw.current, pitch.current, tmpCastDir.current);
      const origin: [number, number, number] = [position.current.x, position.current.y + 1.25, position.current.z];
      const dir: [number, number, number] = [camDir.x, camDir.y, camDir.z];

      if (event.code === "KeyE") {
        if (!enterSanctuary()) addLog("Collect 3 Aura Crystals before entering Sanctuary.");
      }
      if (event.code === "Digit1") castSlot(0, origin, dir);
      if (event.code === "Digit2") castSlot(1, origin, dir);
      if (event.code === "Digit3") castSlot(2, origin, dir);
      if (event.code === "Digit4") castSlot(3, origin, dir);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addLog, castSlot, enterSanctuary, promptOpen]);

  useFrame((_, delta) => {
    if (!player) return;

    if (promptOpen && sanctuaryEndsAt && sanctuaryEndsAt <= Date.now()) {
      exitSanctuary();
    }

    const sanctuary = player.status === "sanctuary";
    const dead = player.status === "dead";
    const controls = getControls();
    const dt = Math.min(delta, 1 / 30);

    // Forward derived from yaw only (ignore pitch)
    const forward = tmpForward.current.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = tmpRight.current.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    const move = tmpMove.current.set(0, 0, 0);

    if (!sanctuary && !dead && !promptOpen) {
      if (controls.forward) move.add(forward);
      if (controls.backward) move.sub(forward);
      if (controls.right) move.add(right);
      if (controls.left) move.sub(right);
      if (move.lengthSq() > 0) move.normalize();

      velocity.current.x = MathUtils.damp(velocity.current.x, move.x * MOVE_SPEED, ACCEL, dt);
      velocity.current.z = MathUtils.damp(velocity.current.z, move.z * MOVE_SPEED, ACCEL, dt);

      if (controls.jump && grounded.current) {
        velocity.current.y = JUMP_VELOCITY;
        grounded.current = false;
      }
    } else {
      velocity.current.x = MathUtils.damp(velocity.current.x, 0, 12, dt);
      velocity.current.z = MathUtils.damp(velocity.current.z, 0, 12, dt);
    }

    // Gravity / sanctuary float
    velocity.current.y += sanctuary ? Math.sin(Date.now() / 250) * 0.015 : GRAVITY * dt;
    position.current.addScaledVector(velocity.current, dt);

    // Clamp to playable radius (hill ring acts as soft wall)
    const dist = Math.hypot(position.current.x, position.current.z);
    const maxR = PLAYABLE_RADIUS - 1.0;
    if (dist > maxR) {
      const scale = maxR / dist;
      position.current.x *= scale;
      position.current.z *= scale;
      velocity.current.x *= 0.4;
      velocity.current.z *= 0.4;
    }

    // Ground sample
    const ground = getGroundHeight(position.current.x, position.current.z) + PLAYER_HEIGHT;
    const targetY = sanctuary ? ground + 1.6 : ground;
    if (position.current.y <= targetY) {
      position.current.y = targetY;
      if (!sanctuary && velocity.current.y < 0) velocity.current.y = 0;
      if (!sanctuary) grounded.current = true;
    } else if (!sanctuary) {
      grounded.current = false;
    }

    // Wizard yaw follows camera yaw
    const wizardYaw = yaw.current + Math.PI; // model faces +Z by default; flip
    if (group.current) {
      group.current.position.copy(position.current);
      group.current.rotation.y = wizardYaw;
    }

    // Camera: orbit behind player based on yaw + pitch
    const camOffset = tmpCamOffset.current.set(
      Math.sin(yaw.current) * Math.cos(pitch.current) * CAM_DISTANCE,
      CAM_HEIGHT - Math.sin(pitch.current) * CAM_DISTANCE,
      Math.cos(yaw.current) * Math.cos(pitch.current) * CAM_DISTANCE,
    );
    const camTarget = tmpLook.current.set(position.current.x, position.current.y + 1.55, position.current.z);
    camera.position.set(camTarget.x + camOffset.x, camTarget.y + camOffset.y, camTarget.z + camOffset.z);
    camera.lookAt(camTarget);

    // Update store
    updateLocalTransform(
      toVec3(position.current.x, position.current.y, position.current.z),
      wizardYaw,
      toVec3(velocity.current.x, velocity.current.y, velocity.current.z),
    );

    // Click-to-cast Magic Missile
    if (mouseDown.current && !promptOpen && !dead && !sanctuary && pointerLocked.current) {
      const t = Date.now();
      if (t - lastMagicMissileAt.current > MAGIC_MISSILE.cooldownMs) {
        const camDir = computeCastDirection(yaw.current, pitch.current, tmpCastDir.current);
        const originVec = tmpOrigin.current.set(
          position.current.x + camDir.x * 0.8,
          position.current.y + 1.25,
          position.current.z + camDir.z * 0.8,
        );
        const origin: [number, number, number] = [originVec.x, originVec.y, originVec.z];
        const dir = normalizeVec3([camDir.x, camDir.y, camDir.z]);
        if (castSpell(MAGIC_MISSILE, origin, dir)) lastMagicMissileAt.current = t;
      }
    }
  });

  return (
    <group ref={group}>
      <WizardModel color={player?.color ?? "#74f7d0"} shielded={player?.isShielded} />
    </group>
  );
}

function computeCastDirection(yawValue: number, pitchValue: number, target: Vector3) {
  // Camera forward in world: -sin(yaw)cos(pitch), sin(pitch), -cos(yaw)cos(pitch)
  target.set(
    -Math.sin(yawValue) * Math.cos(pitchValue),
    Math.sin(pitchValue),
    -Math.cos(yawValue) * Math.cos(pitchValue),
  );
  return target.normalize();
}

void LOCAL_PLAYER_ID;
