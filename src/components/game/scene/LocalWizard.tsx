"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { CapsuleCollider, RigidBody, useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import { Group, MathUtils, Vector3 } from "three";
import type { KinematicCharacterController } from "@dimforge/rapier3d-compat";
import { LOCAL_PLAYER_ID, MAGIC_MISSILE, PLAYABLE_RADIUS } from "@/game/config/gameConfig";
import { getGroundHeight } from "@/game/arena/terrain";
import { normalizeVec3, toVec3 } from "@/game/math/vector";
import { useGameStore } from "@/game/state/gameStore";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { WizardModel } from "@/components/game/scene/WizardModel";

type ControlName = "forward" | "backward" | "left" | "right" | "jump";

// Capsule: total height = 2*halfHeight + 2*radius = 2*0.5 + 2*0.45 = 1.9
const CAPSULE_HALF_HEIGHT = 0.5;
const CAPSULE_RADIUS = 0.45;
// Distance from capsule center to feet.
const CAPSULE_FOOT_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

const MOVE_SPEED = 9.5;
const ACCEL = 14;
const JUMP_VELOCITY = 8.4;
const GRAVITY = -22;
const MOUSE_SENSITIVITY = 0.0024;

const CAM_DISTANCE = 8.5;
const CAM_HEIGHT = 3.6;
const PITCH_MIN = -0.85;
const PITCH_MAX = 0.55;

const SPAWN_X = 0;
const SPAWN_Z = 18;

export function LocalWizard() {
  const visualGroup = useRef<Group>(null);
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const controllerRef = useRef<KinematicCharacterController | null>(null);
  const colliderHandleRef = useRef<number | null>(null);

  // Center of the capsule (not the feet). World position used for movement.
  const center = useRef(new Vector3(SPAWN_X, getGroundHeight(SPAWN_X, SPAWN_Z) + CAPSULE_FOOT_OFFSET, SPAWN_Z));
  const velocity = useRef(new Vector3());
  const yaw = useRef(Math.PI);
  const pitch = useRef(-0.18);
  const grounded = useRef(false);
  const mouseDown = useRef(false);
  const pointerLocked = useRef(false);
  const lastMagicMissileAt = useRef(0);
  const diagLogged = useRef(false);

  const getControls = useKeyboardControls<ControlName>()[1];
  const { camera, gl } = useThree();
  const { world } = useRapier();
  const localPlayerId = useGameStore((state) => state.localPlayerId);
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

  // Pointer lock + mouse handlers.
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

  useEffect(() => {
    if (promptOpen && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [promptOpen]);

  // Keyboard handlers.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.repeat) return;
      if (promptOpen) return;

      const camDir = computeCastDirection(yaw.current, pitch.current, tmpCastDir.current);
      const origin: [number, number, number] = [center.current.x, center.current.y - 0.4 + 1.55, center.current.z];
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

  // Create the character controller once Rapier is ready.
  useEffect(() => {
    const controller = world.createCharacterController(0.05);
    controller.setSlideEnabled(true);
    controller.setApplyImpulsesToDynamicBodies(false);
    controller.enableAutostep(0.4, 0.2, true);
    controller.enableSnapToGround(0.5);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    controllerRef.current = controller;
    return () => {
      world.removeCharacterController(controller);
      controllerRef.current = null;
    };
  }, [world]);

  // Register collider with the entity registry once it's mounted.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || body.numColliders() === 0) return;
    const collider = body.collider(0);
    const handle = collider.handle;
    colliderHandleRef.current = handle;
    colliderRegistry.register(handle, { kind: "wizard", id: localPlayerId });
    return () => {
      colliderRegistry.unregister(handle);
      colliderHandleRef.current = null;
    };
  }, [localPlayerId]);

  useFrame((_, delta) => {
    if (!player) return;
    const body = bodyRef.current;
    const controller = controllerRef.current;
    if (!body || !controller) return;

    if (promptOpen && sanctuaryEndsAt && sanctuaryEndsAt <= Date.now()) {
      exitSanctuary();
    }

    const sanctuary = player.status === "sanctuary";
    const dead = player.status === "dead";
    const controls = getControls();
    const dt = Math.min(delta, 1 / 30);

    if (!diagLogged.current) {
      diagLogged.current = true;
      // eslint-disable-next-line no-console
      console.log("[LocalWizard] Rapier ready", {
        bodies: world.bodies.len(),
        colliders: world.colliders.len(),
      });
    }

    // Forward derived from yaw only (ignore pitch).
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

    // Gravity / sanctuary float.
    if (sanctuary) {
      velocity.current.y = Math.sin(Date.now() / 250) * 0.6;
    } else {
      velocity.current.y += GRAVITY * dt;
    }

    // Desired translation for this frame.
    const desired = {
      x: velocity.current.x * dt,
      y: velocity.current.y * dt,
      z: velocity.current.z * dt,
    };

    const collider = body.collider(0);
    controller.computeColliderMovement(collider, desired);
    const corrected = controller.computedMovement();

    center.current.x += corrected.x;
    center.current.y += corrected.y;
    center.current.z += corrected.z;

    // Ground state reflects what the controller observed, plus a soft check
    // against the procedural ground height so jumps after walking off ledges
    // still register correctly.
    const wasGrounded = controller.computedGrounded();
    grounded.current = wasGrounded;
    if (wasGrounded && velocity.current.y < 0) velocity.current.y = 0;

    // If the controller blocked vertical motion (ceiling or hard ground), zero
    // residual velocity to prevent integration creep.
    if (Math.abs(corrected.y) < Math.abs(desired.y) - 1e-4) {
      if (desired.y > 0 && corrected.y < desired.y) velocity.current.y = 0;
    }

    // Clamp to playable radius (hill ring acts as soft wall).
    const dist = Math.hypot(center.current.x, center.current.z);
    const maxR = PLAYABLE_RADIUS - 1.0;
    if (dist > maxR) {
      const scale = maxR / dist;
      center.current.x *= scale;
      center.current.z *= scale;
      velocity.current.x *= 0.4;
      velocity.current.z *= 0.4;
    }

    // Failsafe: never sink below procedural ground (the meadow has no rapier
    // collider yet, so the controller treats it as void).
    const groundY = getGroundHeight(center.current.x, center.current.z) + CAPSULE_FOOT_OFFSET;
    if (sanctuary) {
      const target = groundY + 1.6;
      center.current.y = MathUtils.damp(center.current.y, target, 4, dt);
    } else if (center.current.y < groundY) {
      center.current.y = groundY;
      if (velocity.current.y < 0) velocity.current.y = 0;
      grounded.current = true;
    }

    // Push the kinematic body to its new position.
    body.setNextKinematicTranslation({
      x: center.current.x,
      y: center.current.y,
      z: center.current.z,
    });

    // Visual group tracks center but renders the wizard model with feet on ground.
    const wizardYaw = yaw.current + Math.PI;
    if (visualGroup.current) {
      visualGroup.current.position.set(
        center.current.x,
        center.current.y - CAPSULE_FOOT_OFFSET,
        center.current.z,
      );
      visualGroup.current.rotation.y = wizardYaw;
    }

    // Camera: orbit behind player.
    const camOffset = tmpCamOffset.current.set(
      Math.sin(yaw.current) * Math.cos(pitch.current) * CAM_DISTANCE,
      CAM_HEIGHT - Math.sin(pitch.current) * CAM_DISTANCE,
      Math.cos(yaw.current) * Math.cos(pitch.current) * CAM_DISTANCE,
    );
    const camTarget = tmpLook.current.set(center.current.x, center.current.y + 0.5, center.current.z);
    camera.position.set(camTarget.x + camOffset.x, camTarget.y + camOffset.y, camTarget.z + camOffset.z);
    camera.lookAt(camTarget);

    // Update store with the visual ground-level position so other systems
    // (HUD, networking, mote/crystal pickup) work in feet-space.
    updateLocalTransform(
      toVec3(center.current.x, center.current.y - CAPSULE_FOOT_OFFSET, center.current.z),
      wizardYaw,
      toVec3(velocity.current.x, velocity.current.y, velocity.current.z),
    );

    // Click-to-cast Magic Missile.
    if (mouseDown.current && !promptOpen && !dead && !sanctuary && pointerLocked.current) {
      const t = Date.now();
      if (t - lastMagicMissileAt.current > MAGIC_MISSILE.cooldownMs) {
        const camDir = computeCastDirection(yaw.current, pitch.current, tmpCastDir.current);
        const originVec = tmpOrigin.current.set(
          center.current.x + camDir.x * 0.8,
          center.current.y + 0.2,
          center.current.z + camDir.z * 0.8,
        );
        const origin: [number, number, number] = [originVec.x, originVec.y, originVec.z];
        const dir = normalizeVec3([camDir.x, camDir.y, camDir.z]);
        if (castSpell(MAGIC_MISSILE, origin, dir)) lastMagicMissileAt.current = t;
      }
    }
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="kinematicPosition"
        colliders={false}
        position={[center.current.x, center.current.y, center.current.z]}
        enabledRotations={[false, false, false]}
      >
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
      </RigidBody>
      <group ref={visualGroup}>
        <WizardModel color={player?.color ?? "#74f7d0"} shielded={player?.isShielded} />
      </group>
    </>
  );
}

function computeCastDirection(yawValue: number, pitchValue: number, target: Vector3) {
  target.set(
    -Math.sin(yawValue) * Math.cos(pitchValue),
    Math.sin(pitchValue),
    -Math.cos(yawValue) * Math.cos(pitchValue),
  );
  return target.normalize();
}

void LOCAL_PLAYER_ID;
