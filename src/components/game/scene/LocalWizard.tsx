"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { CapsuleCollider, RigidBody, useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import { Group, MathUtils, Vector3 } from "three";
import type { KinematicCharacterController } from "@dimforge/rapier3d-compat";
import { Ray } from "@dimforge/rapier3d-compat";
import { LOCAL_PLAYER_ID, MAGIC_MISSILE, PLAYABLE_RADIUS } from "@/game/config/gameConfig";
import { getGroundHeight } from "@/game/arena/terrain";
import { toVec3 } from "@/game/math/vector";
import { useGameStore } from "@/game/state/gameStore";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { reticleTarget } from "@/game/state/reticleTarget";
import { AIM_RAY_GROUPS, WIZARD_GROUPS } from "@/game/physics/collisionGroups";
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

// Aim/cast geometry. The reticle and projectile both originate at the
// wizard's shoulder, but the *direction* they fly is derived from a camera-
// center "look-at" raycast — NOT from the camera's forward axis directly.
// This decouples aim from camera framing so the reticle hovers over the world
// point the player is looking at instead of disappearing behind the wizard's
// silhouette in the third-person orbit camera.
const SHOULDER_OFFSET_Y = 0.6; // above capsule center, ~chest height
const AIM_MAX_DISTANCE = 80;
const AIM_FALLBACK_DISTANCE = 60;
// Camera-center look-at cast: how far to probe down the player's screen-center
// ray to discover what they're looking at.
const LOOKAT_MAX_DISTANCE = 200;
// Clamp so close-range hits don't invert the shoulder→lookAt direction.
const LOOKAT_MIN_DISTANCE = 5;
// Used when the camera-center ray hits nothing (sky / open air).
const LOOKAT_FALLBACK_DISTANCE = 80;

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
  const tmpAimDir = useRef(new Vector3());
  const tmpCamDir = useRef(new Vector3());
  const tmpLookAt = useRef(new Vector3());
  const aimRay = useRef(new Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }));
  const lookRay = useRef(new Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }));

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

      if (event.code === "KeyE") {
        if (!enterSanctuary()) addLog("Collect 3 Aura Crystals before entering Sanctuary.");
        return;
      }

      // Cast paths read the shared aim state (shoulder origin + aim ray hit
      // point). Updated each frame in useFrame below.
      const o = reticleTarget.origin;
      const d = reticleTarget.direction;
      const tp = reticleTarget.hitPoint;
      const origin: [number, number, number] = [o[0], o[1], o[2]];
      const dir: [number, number, number] = [d[0], d[1], d[2]];
      const targetPoint: [number, number, number] = [tp[0], tp[1], tp[2]];

      if (event.code === "Digit1") castSlot(0, origin, dir, targetPoint);
      if (event.code === "Digit2") castSlot(1, origin, dir, targetPoint);
      if (event.code === "Digit3") castSlot(2, origin, dir, targetPoint);
      if (event.code === "Digit4") castSlot(3, origin, dir, targetPoint);
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

    // ──────────────────────────────────────────────────────────────────────
    // Aim raycasts (TPS over-the-shoulder pattern, two-ray decoupled aim).
    //
    // Cast 1 — "look-at" ray from the CAMERA along its forward axis. This
    //   is where the player's screen center is pointing at in the world.
    // Cast 2 — "aim" ray from the WIZARD'S SHOULDER toward that world point.
    //   This is the projectile's actual flight path; its endpoint is what
    //   the reticle visualizes.
    //
    // Why two rays: with the orbit camera sitting above-and-behind the
    // wizard, a single ray from the shoulder along camera-forward passes
    // through the wizard's body and the reticle gets stuck on the wizard's
    // silhouette. Decoupling the rays lets the reticle hover over whatever
    // the camera is centered on while the projectile honestly originates
    // from the wizard's body.
    // ──────────────────────────────────────────────────────────────────────
    const ownHandle = colliderHandleRef.current;
    const camDir = camera.getWorldDirection(tmpCamDir.current);

    // Cast 1: camera-center → world.
    lookRay.current.origin.x = camera.position.x;
    lookRay.current.origin.y = camera.position.y;
    lookRay.current.origin.z = camera.position.z;
    lookRay.current.dir.x = camDir.x;
    lookRay.current.dir.y = camDir.y;
    lookRay.current.dir.z = camDir.z;

    const lookHit = world.castRay(
      lookRay.current,
      LOOKAT_MAX_DISTANCE,
      true,
      undefined,
      AIM_RAY_GROUPS,
      undefined,
      undefined,
      ownHandle == null ? undefined : (collider) => collider.handle !== ownHandle,
    );
    const lookDistance = lookHit
      ? Math.max(LOOKAT_MIN_DISTANCE, lookHit.timeOfImpact)
      : LOOKAT_FALLBACK_DISTANCE;
    tmpLookAt.current.set(
      camera.position.x + camDir.x * lookDistance,
      camera.position.y + camDir.y * lookDistance,
      camera.position.z + camDir.z * lookDistance,
    );

    // Cast 2: shoulder → look-at point. This direction is the projectile's
    // true flight vector and is what the reticle's hit-point visualizes.
    const shoulderX = center.current.x;
    const shoulderY = center.current.y + SHOULDER_OFFSET_Y;
    const shoulderZ = center.current.z;
    const aimDir = tmpAimDir.current.set(
      tmpLookAt.current.x - shoulderX,
      tmpLookAt.current.y - shoulderY,
      tmpLookAt.current.z - shoulderZ,
    ).normalize();

    aimRay.current.origin.x = shoulderX;
    aimRay.current.origin.y = shoulderY;
    aimRay.current.origin.z = shoulderZ;
    aimRay.current.dir.x = aimDir.x;
    aimRay.current.dir.y = aimDir.y;
    aimRay.current.dir.z = aimDir.z;

    const aimHit = world.castRay(
      aimRay.current,
      AIM_MAX_DISTANCE,
      true,
      undefined,
      AIM_RAY_GROUPS,
      undefined,
      undefined,
      ownHandle == null ? undefined : (collider) => collider.handle !== ownHandle,
    );
    const aimDistance = aimHit && aimHit.timeOfImpact > 0.05 ? aimHit.timeOfImpact : AIM_FALLBACK_DISTANCE;
    const hitX = shoulderX + aimDir.x * aimDistance;
    const hitY = shoulderY + aimDir.y * aimDistance;
    const hitZ = shoulderZ + aimDir.z * aimDistance;

    reticleTarget.origin[0] = shoulderX;
    reticleTarget.origin[1] = shoulderY;
    reticleTarget.origin[2] = shoulderZ;
    reticleTarget.direction[0] = aimDir.x;
    reticleTarget.direction[1] = aimDir.y;
    reticleTarget.direction[2] = aimDir.z;
    reticleTarget.hitPoint[0] = hitX;
    reticleTarget.hitPoint[1] = hitY;
    reticleTarget.hitPoint[2] = hitZ;
    reticleTarget.hasHit = aimHit != null;
    reticleTarget.ready = true;

    // Click-to-cast Magic Missile.
    if (mouseDown.current && !promptOpen && !dead && !sanctuary && pointerLocked.current) {
      const t = Date.now();
      if (t - lastMagicMissileAt.current > MAGIC_MISSILE.cooldownMs) {
        const origin: [number, number, number] = [
          reticleTarget.origin[0],
          reticleTarget.origin[1],
          reticleTarget.origin[2],
        ];
        const dir: [number, number, number] = [
          reticleTarget.direction[0],
          reticleTarget.direction[1],
          reticleTarget.direction[2],
        ];
        const targetPoint: [number, number, number] = [
          reticleTarget.hitPoint[0],
          reticleTarget.hitPoint[1],
          reticleTarget.hitPoint[2],
        ];
        if (castSpell(MAGIC_MISSILE, origin, dir, targetPoint)) lastMagicMissileAt.current = t;
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
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} collisionGroups={WIZARD_GROUPS} />
      </RigidBody>
      <group ref={visualGroup}>
        <WizardModel color={player?.color ?? "#74f7d0"} shielded={player?.isShielded} />
      </group>
    </>
  );
}

void LOCAL_PLAYER_ID;
