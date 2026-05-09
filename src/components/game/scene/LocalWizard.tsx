"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useKeyboardControls } from "@react-three/drei";
import { CapsuleCollider, RigidBody, useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useRef } from "react";
import { Group, MathUtils, Vector3 } from "three";
import { Ray, type KinematicCharacterController, type World } from "@dimforge/rapier3d-compat";
import { MAGIC_MISSILE, PLAYABLE_RADIUS } from "@/game/config/gameConfig";
import { getGroundHeight } from "@/game/arena/terrain";
import { toVec3 } from "@/game/math/vector";
import type { Vec3 } from "@/game/types";
import { useGameStore } from "@/game/state/gameStore";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { AIM_RAY_GROUPS, WIZARD_GROUPS } from "@/game/physics/collisionGroups";
import { WizardModel } from "@/components/game/scene/WizardModel";
import { WizardNameplate } from "@/components/game/scene/WizardNameplate";
import { audioRuntime } from "@/game/audio/audioRuntime";

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
const CAM_HEIGHT = 4.6;
const PITCH_MIN = -1.85;
const PITCH_MAX = 1.55;

const FALLBACK_SPAWN_X = 0;
const FALLBACK_SPAWN_Z = 42;
const FALLBACK_CENTER_POSITION = [FALLBACK_SPAWN_X, getGroundHeight(FALLBACK_SPAWN_X, FALLBACK_SPAWN_Z) + CAPSULE_FOOT_OFFSET, FALLBACK_SPAWN_Z] as const;

// Aim/cast geometry. Projectiles spawn at the wizard's shoulder, but every
// spell resolves against the centered reticle's world intersection point.
const SHOULDER_OFFSET_Y = 1.7; // above capsule center, ~chest height
const CAST_TARGET_DISTANCE = 125;
const TERRAIN_RAY_STEPS = 80;

type AimTarget = { point: Vec3; source: "rapier-hit" | "terrain-hit" | "front-fallback" };

export function LocalWizard() {
  const visualGroup = useRef<Group>(null);
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const controllerRef = useRef<KinematicCharacterController | null>(null);
  const colliderHandleRef = useRef<number | null>(null);

  // Center of the capsule (not the feet). World position used for movement.
  const center = useRef(new Vector3(...FALLBACK_CENTER_POSITION));
  const velocity = useRef(new Vector3());
  const yaw = useRef(Math.PI);
  const pitch = useRef(-0.18);
  const grounded = useRef(false);
  const mouseDown = useRef(false);
  const pointerLocked = useRef(false);
  const lastMagicMissileAt = useRef(0);
  const lastFootstepAt = useRef(0);
  const wasGroundedRef = useRef(true);
  const footstepIndex = useRef(0);
  const diagLogged = useRef(false);
  const appliedStatusImpulses = useRef(new Set<string>());

  const getControls = useKeyboardControls<ControlName>()[1];
  const { camera, gl } = useThree();
  const { world } = useRapier();
  const localPlayerId = useGameStore((state) => state.localPlayerId);
  const player = useGameStore((state) => state.players[state.localPlayerId]);
  const alive = player != null && player.status !== "dead";
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
  const tmpCastOrigin = useRef(new Vector3());
  const initializedPlayerId = useRef<string | null>(null);

  useEffect(() => {
    if (!player || player.status === "dead" || initializedPlayerId.current === player.id) return;
    initializedPlayerId.current = player.id;
    center.current.set(player.position[0], player.position[1] + CAPSULE_FOOT_OFFSET, player.position[2]);
    velocity.current.set(player.velocity[0], player.velocity[1], player.velocity[2]);
    yaw.current = player.rotationY - Math.PI;
    try {
      bodyRef.current?.setNextKinematicTranslation({
        x: center.current.x,
        y: center.current.y,
        z: center.current.z,
      });
    } catch {
      bodyRef.current = null;
    }
  }, [player]);

  const buildCastGeometry = useCallback((): { origin: Vec3; direction: Vec3; targetPoint: Vec3; targetSource: AimTarget["source"] } => {
    const rayDirection = camera.getWorldDirection(tmpCastDir.current).normalize();
    const shoulder = tmpCastOrigin.current.set(
      center.current.x,
      center.current.y + SHOULDER_OFFSET_Y,
      center.current.z,
    );
    const aim = resolveAimTarget(world, camera.position, rayDirection, shoulder, colliderHandleRef.current);
    const shotDir = tmpForward.current
      .set(aim.point[0] - shoulder.x, aim.point[1] - shoulder.y, aim.point[2] - shoulder.z)
      .normalize();
    if (!Number.isFinite(shotDir.x) || shotDir.lengthSq() < 1e-5) {
      shotDir.copy(rayDirection);
    }
    return {
      origin: [shoulder.x, shoulder.y, shoulder.z],
      direction: [shotDir.x, shotDir.y, shotDir.z],
      targetPoint: aim.point,
      targetSource: aim.source,
    };
  }, [camera, world]);

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

      if (
        event.code === "Digit1" ||
        event.code === "Digit2" ||
        event.code === "Digit3" ||
        event.code === "Digit4"
      ) {
        const current = useGameStore.getState().players[useGameStore.getState().localPlayerId];
        if (current?.statusEffects.some((effect) => effect.effect === "stun" || effect.effect === "crush" || effect.effect === "stagger")) return;
        const slot =
          event.code === "Digit1" ? 0 : event.code === "Digit2" ? 1 : event.code === "Digit3" ? 2 : 3;
        const cast = buildCastGeometry();
        const blinded = current?.statusEffects.some((effect) => effect.effect === "blind") ?? false;
        castSlot(slot, cast.origin, cast.direction, blinded ? jitterTarget(cast.targetPoint) : cast.targetPoint);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addLog, buildCastGeometry, castSlot, enterSanctuary, promptOpen]);

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
    if (!alive) return;
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
  }, [alive, localPlayerId]);

  useFrame((_, delta) => {
    if (!player || player.status === "dead") {
      if (colliderHandleRef.current !== null) {
        colliderRegistry.unregister(colliderHandleRef.current);
        colliderHandleRef.current = null;
      }
      bodyRef.current = null;
      visualGroup.current = null;
      initializedPlayerId.current = null;
      velocity.current.set(0, 0, 0);
      return;
    }
    const body = bodyRef.current;
    const controller = controllerRef.current;
    if (!body || !controller) return;

    if (promptOpen && sanctuaryEndsAt && sanctuaryEndsAt <= Date.now()) {
      exitSanctuary();
    }

    const sanctuary = player.status === "sanctuary";
    const stunned = player.statusEffects.some((effect) => effect.effect === "stun" || effect.effect === "crush" || effect.effect === "stagger");
    const chill = player.statusEffects.find((effect) => effect.effect === "chill");
    const blind = player.statusEffects.some((effect) => effect.effect === "blind");
    const speedMultiplier = stunned ? 0 : chill ? Math.max(0.35, 1 - chill.strength * 0.14) : 1;
    const controls = getControls();
    const dt = Math.min(delta, 1 / 30);

    if (!diagLogged.current) {
      diagLogged.current = true;
      console.log("[LocalWizard] Rapier ready", {
        bodies: world.bodies.len(),
        colliders: world.colliders.len(),
      });
    }

    // Forward derived from yaw only (ignore pitch).
    const forward = tmpForward.current.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = tmpRight.current.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    const move = tmpMove.current.set(0, 0, 0);

    if (!sanctuary && !promptOpen && !stunned) {
      if (controls.forward) move.add(forward);
      if (controls.backward) move.sub(forward);
      if (controls.right) move.add(right);
      if (controls.left) move.sub(right);
      if (move.lengthSq() > 0) move.normalize();

      velocity.current.x = MathUtils.damp(velocity.current.x, move.x * MOVE_SPEED * speedMultiplier, ACCEL, dt);
      velocity.current.z = MathUtils.damp(velocity.current.z, move.z * MOVE_SPEED * speedMultiplier, ACCEL, dt);

      if (controls.jump && grounded.current) {
        velocity.current.y = JUMP_VELOCITY;
        grounded.current = false;
        audioRuntime.play("wizard_jump", { position: player.position, listener: player.position });
      }
    } else {
      velocity.current.x = MathUtils.damp(velocity.current.x, 0, 12, dt);
      velocity.current.z = MathUtils.damp(velocity.current.z, 0, 12, dt);
    }

    for (const effect of player.statusEffects) {
      if (effect.effect !== "stagger" && effect.effect !== "crush") continue;
      if (appliedStatusImpulses.current.has(effect.id)) continue;
      appliedStatusImpulses.current.add(effect.id);
      const owner = useGameStore.getState().players[effect.ownerId];
      if (!owner) continue;
      const dx = center.current.x - owner.position[0];
      const dz = center.current.z - owner.position[2];
      const len = Math.hypot(dx, dz) || 1;
      const force = effect.effect === "crush" ? 8 + effect.strength * 1.5 : 5 + effect.strength;
      velocity.current.x += (dx / len) * force;
      velocity.current.z += (dz / len) * force;
      velocity.current.y = Math.max(velocity.current.y, 2.5);
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

    let corrected: { x: number; y: number; z: number };
    try {
      if (body.numColliders() === 0) return;
      const collider = body.collider(0);
      controller.computeColliderMovement(collider, desired);
      corrected = controller.computedMovement();
    } catch {
      bodyRef.current = null;
      return;
    }

    center.current.x += corrected.x;
    center.current.y += corrected.y;
    center.current.z += corrected.z;

    // Ground state reflects what the controller observed, plus a soft check
    // against the procedural ground height so jumps after walking off ledges
    // still register correctly.
    const computedGrounded = controller.computedGrounded();
    grounded.current = computedGrounded;
    if (computedGrounded && velocity.current.y < 0) velocity.current.y = 0;
    if (!wasGroundedRef.current && grounded.current) {
      audioRuntime.play("wizard_land", { position: player.position, listener: player.position });
    }
    wasGroundedRef.current = grounded.current;

    const horizontalSpeed = Math.hypot(velocity.current.x, velocity.current.z);
    const movingOnGround = grounded.current && horizontalSpeed > 1.4 && !sanctuary && !promptOpen && !stunned;
    if (movingOnGround && Date.now() - lastFootstepAt.current > Math.max(220, 460 - horizontalSpeed * 18)) {
      lastFootstepAt.current = Date.now();
      footstepIndex.current = (footstepIndex.current % 4) + 1;
      const stepCue = footstepIndex.current === 1
        ? "wizard_footstep_grass_01"
        : footstepIndex.current === 2
          ? "wizard_footstep_grass_02"
          : footstepIndex.current === 3
            ? "wizard_footstep_grass_03"
            : "wizard_footstep_grass_04";
      audioRuntime.play(stepCue, { position: player.position, listener: player.position });
    }

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
    try {
      body.setNextKinematicTranslation({
        x: center.current.x,
        y: center.current.y,
        z: center.current.z,
      });
    } catch {
      bodyRef.current = null;
      return;
    }

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
    const camTarget = tmpLook.current.set(center.current.x, center.current.y + 2.2, center.current.z);
    camera.position.set(camTarget.x + camOffset.x, camTarget.y + camOffset.y, camTarget.z + camOffset.z);
    camera.lookAt(camTarget);

    // Update store with the visual ground-level position so other systems
    // (HUD, networking, mote/crystal pickup) work in feet-space.
    updateLocalTransform(
      toVec3(center.current.x, center.current.y - CAPSULE_FOOT_OFFSET, center.current.z),
      wizardYaw,
      toVec3(velocity.current.x, velocity.current.y, velocity.current.z),
    );

    // Click-to-cast Magic Missile. Origin = shoulder; direction = camera
    // forward (which by camera lookAt tuning points at the fixed centered
    // reticle's world target).
    if (mouseDown.current && !promptOpen && !sanctuary && !stunned && pointerLocked.current) {
      const t = Date.now();
      if (t - lastMagicMissileAt.current > MAGIC_MISSILE.cooldownMs) {
        const cast = buildCastGeometry();
        if (castSpell(MAGIC_MISSILE, cast.origin, cast.direction, blind ? jitterTarget(cast.targetPoint) : cast.targetPoint)) lastMagicMissileAt.current = t;
      }
    }
  });

  if (!alive) return null;

  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="kinematicPosition"
        colliders={false}
        position={FALLBACK_CENTER_POSITION}
        enabledRotations={[false, false, false]}
      >
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} collisionGroups={WIZARD_GROUPS} />
      </RigidBody>
      <group ref={visualGroup}>
        <WizardModel color={player?.color ?? "#74f7d0"} shielded={player?.isShielded} />
        <WizardNameplate name={player.name} health={player.health} color={player.color} />
      </group>
    </>
  );
}

function jitterTarget(target: Vec3): Vec3 {
  return [
    target[0] + (Math.random() - 0.5) * 4,
    target[1],
    target[2] + (Math.random() - 0.5) * 4,
  ];
}

function resolveAimTarget(
  world: World,
  rayOrigin: Vector3,
  rayDirection: Vector3,
  fallbackOrigin: Vector3,
  ownerColliderHandle: number | null,
): AimTarget {
  const ray = new Ray(
    { x: rayOrigin.x, y: rayOrigin.y, z: rayOrigin.z },
    { x: rayDirection.x, y: rayDirection.y, z: rayDirection.z },
  );
  const hit = world.castRay(
    ray,
    CAST_TARGET_DISTANCE,
    true,
    undefined,
    AIM_RAY_GROUPS,
    undefined,
    undefined,
    ownerColliderHandle == null ? undefined : (collider) => collider.handle !== ownerColliderHandle,
  );
  if (hit) {
    return {
      source: "rapier-hit",
      point: [
        rayOrigin.x + rayDirection.x * hit.timeOfImpact,
        rayOrigin.y + rayDirection.y * hit.timeOfImpact,
        rayOrigin.z + rayDirection.z * hit.timeOfImpact,
      ],
    };
  }

  const terrainPoint = intersectTerrain(rayOrigin, rayDirection, CAST_TARGET_DISTANCE);
  if (terrainPoint) return { source: "terrain-hit", point: terrainPoint };

  const hx = rayDirection.x;
  const hz = rayDirection.z;
  const hLen = Math.hypot(hx, hz) || 1;
  const x = fallbackOrigin.x + (hx / hLen) * 8;
  const z = fallbackOrigin.z + (hz / hLen) * 8;
  return { source: "front-fallback", point: [x, getGroundHeight(x, z) + 0.05, z] };
}

function intersectTerrain(origin: Vector3, direction: Vector3, maxDistance: number): Vec3 | null {
  let prevDistance = 0;
  let prevAbove = origin.y - getGroundHeight(origin.x, origin.z);
  for (let step = 1; step <= TERRAIN_RAY_STEPS; step += 1) {
    const distance = (step / TERRAIN_RAY_STEPS) * maxDistance;
    const x = origin.x + direction.x * distance;
    const y = origin.y + direction.y * distance;
    const z = origin.z + direction.z * distance;
    const above = y - getGroundHeight(x, z);
    if (above <= 0 && prevAbove >= 0) {
      let lo = prevDistance;
      let hi = distance;
      for (let i = 0; i < 10; i += 1) {
        const mid = (lo + hi) * 0.5;
        const mx = origin.x + direction.x * mid;
        const my = origin.y + direction.y * mid;
        const mz = origin.z + direction.z * mid;
        if (my - getGroundHeight(mx, mz) > 0) lo = mid;
        else hi = mid;
      }
      const hitDistance = hi;
      const hitX = origin.x + direction.x * hitDistance;
      const hitZ = origin.z + direction.z * hitDistance;
      return [hitX, getGroundHeight(hitX, hitZ) + 0.05, hitZ];
    }
    prevDistance = distance;
    prevAbove = above;
  }
  return null;
}
