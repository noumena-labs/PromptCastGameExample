"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import { Quaternion, Vector3 } from "three";

import type { WizardModelHandle } from "@/components/game/scene/WizardModel";

/**
 * One cast event consumed by the pose driver.
 *
 * `aimDirLocal` is currently unused by the Gandalf-style raise (the staff
 * goes straight up regardless of aim) but is preserved on the trigger so we
 * can reintroduce aim-aligned poses later without changing call sites.
 */
export type CastPoseTrigger = {
  /** Monotonic cast id; new id => new cast. */
  id: number;
  /** Wall clock ms (performance.now()) when the cast was initiated. */
  startedAt: number;
  /** Unit aim direction in wizard-local space (currently unused). */
  aimDirLocal: Vector3;
};

// Longer, weighty animation: ~700ms total.
//   windup : staff dips slightly downward, gem dims a touch
//   raise  : staff translates to wizard center + lifts above the head,
//            standing fully vertical, gem flares
//   hold   : crystal floats over the head with gem at peak emissive
//   settle : staff returns to the grip
const WINDUP_MS = 110;
const RAISE_MS = 240;
const HOLD_MS = 130;
const SETTLE_MS = 240;
const TOTAL_MS = WINDUP_MS + RAISE_MS + HOLD_MS + SETTLE_MS;

const PEAK_EMISSIVE = 6.6;
const IDLE_EMISSIVE = 1.6;

// Pivot-local crystal offset (must match WizardModel's CRYSTAL_LOCAL). Used
// to compute where the pivot needs to sit so that the crystal floats centered
// above the wizard's head when the staff is held vertically.
const CRYSTAL_LOCAL_X = 0.18;
const CRYSTAL_LOCAL_Y = 0.67;
const CRYSTAL_LOCAL_Z = -0.14;

// Where the crystal should float at peak (in wizard-local space).
// Hat tip is roughly y = 2.05 + 0.95/2 ≈ 2.5; place the gem above that.
const CRYSTAL_PEAK_X = 0.16;
const CRYSTAL_PEAK_Y = 3.0;
const CRYSTAL_PEAK_Z = 0;

// Windup: pivot dips slightly below idle.
const WINDUP_DROP_Y = -0.06;
const WINDUP_TILT_Z_DELTA = -0.08; // a touch more outward tilt before raise

type ActivePose = {
  trigger: CastPoseTrigger;
  // Captured at trigger time so retriggers blend smoothly.
  startPos: Vector3;
  startQuat: Quaternion;
  startEmissive: number;
};

const tmpVec = new Vector3();
const tmpQuatA = new Quaternion();
const tmpQuatB = new Quaternion();

function easeOutCubic(t: number) {
  const c = 1 - t;
  return 1 - c * c * c;
}
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeInCubic(t: number) {
  return t * t * t;
}

/**
 * Drives the wizard's staff pivot through a 4-phase Gandalf-style raise
 * (windup → raise → hold → settle) in response to triggers pushed into
 * `triggerRef`.
 *
 * - Windup: small downward dip + slight outward tilt.
 * - Raise: staff translates to wizard center and lifts so the crystal
 *          floats over the head; pivot rotation goes to identity (vertical).
 * - Hold: crystal hovers, gem at peak emissive.
 * - Settle: staff returns to grip + idle tilt.
 *
 * While active, sets `castActive.current = true` on the model handle so
 * the model's idle useFrame stops fighting our writes.
 */
export function useCastPose(
  modelRef: MutableRefObject<WizardModelHandle | null>,
  triggerRef: MutableRefObject<CastPoseTrigger | null>,
) {
  const activeRef = useRef<ActivePose | null>(null);
  const lastConsumedIdRef = useRef<number>(-1);

  useFrame(() => {
    const handle = modelRef.current;
    if (!handle) return;
    const pivot = handle.staffPivot;
    if (!pivot) return;

    // Pick up a new trigger if the parent has stamped one.
    const trig = triggerRef.current;
    if (trig && trig.id !== lastConsumedIdRef.current) {
      lastConsumedIdRef.current = trig.id;
      activeRef.current = {
        trigger: trig,
        startPos: new Vector3().copy(pivot.position),
        startQuat: new Quaternion().copy(pivot.quaternion),
        startEmissive: handle.crystalMaterial?.emissiveIntensity ?? IDLE_EMISSIVE,
      };
      handle.castActive.current = true;
    }

    const active = activeRef.current;
    if (!active) return;

    const elapsed = performance.now() - active.trigger.startedAt;
    const mat = handle.crystalMaterial;

    if (elapsed >= TOTAL_MS) {
      // Restore exact idle baseline and release control.
      pivot.position.set(handle.idleBasePosition.x, handle.idleBasePosition.y, handle.idleBasePosition.z);
      pivot.rotation.set(0, 0, handle.idleBaseRotationZ);
      if (mat) mat.emissiveIntensity = IDLE_EMISSIVE;
      activeRef.current = null;
      handle.castActive.current = false;
      return;
    }

    // Pre-computed targets in wizard-local space.
    const idleX = handle.idleBasePosition.x;
    const idleY = handle.idleBasePosition.y;
    const idleZ = handle.idleBasePosition.z;
    const idleTilt = handle.idleBaseRotationZ;

    // Pivot position at peak: staff vertical (rotation = 0), so the crystal
    // sits at pivot + (CRYSTAL_LOCAL_X, CRYSTAL_LOCAL_Y, CRYSTAL_LOCAL_Z).
    // Solve pivot = peakCrystal - crystalLocal.
    const peakX = CRYSTAL_PEAK_X - CRYSTAL_LOCAL_X;
    const peakY = CRYSTAL_PEAK_Y - CRYSTAL_LOCAL_Y;
    const peakZ = CRYSTAL_PEAK_Z - CRYSTAL_LOCAL_Z;

    // Windup target: small dip below the grip, slightly more outward tilt.
    const windupX = idleX;
    const windupY = idleY + WINDUP_DROP_Y;
    const windupZ = idleZ;
    const windupTilt = idleTilt + WINDUP_TILT_Z_DELTA;

    if (elapsed < WINDUP_MS) {
      // Phase 1: idle/start -> windup.
      const t = easeInCubic(elapsed / WINDUP_MS);
      pivot.position.set(
        active.startPos.x + (windupX - active.startPos.x) * t,
        active.startPos.y + (windupY - active.startPos.y) * t,
        active.startPos.z + (windupZ - active.startPos.z) * t,
      );
      // Blend rotation as a quaternion slerp from start to windup euler.
      tmpQuatB.setFromAxisAngle(tmpVec.set(0, 0, 1), windupTilt);
      pivot.quaternion.copy(active.startQuat).slerp(tmpQuatB, t);
      if (mat) {
        const target = IDLE_EMISSIVE * 0.55; // dim slightly during windup
        mat.emissiveIntensity = active.startEmissive + (target - active.startEmissive) * t;
      }
      return;
    }

    if (elapsed < WINDUP_MS + RAISE_MS) {
      // Phase 2: windup -> peak (vertical, above head).
      const t = easeOutCubic((elapsed - WINDUP_MS) / RAISE_MS);
      pivot.position.set(
        windupX + (peakX - windupX) * t,
        windupY + (peakY - windupY) * t,
        windupZ + (peakZ - windupZ) * t,
      );
      tmpQuatA.setFromAxisAngle(tmpVec.set(0, 0, 1), windupTilt);
      tmpQuatB.identity(); // peak: fully vertical
      pivot.quaternion.copy(tmpQuatA).slerp(tmpQuatB, t);
      if (mat) {
        const startE = IDLE_EMISSIVE * 0.55;
        mat.emissiveIntensity = startE + (PEAK_EMISSIVE - startE) * t;
      }
      return;
    }

    if (elapsed < WINDUP_MS + RAISE_MS + HOLD_MS) {
      // Phase 3: hold the crystal aloft.
      pivot.position.set(peakX, peakY, peakZ);
      pivot.quaternion.identity();
      if (mat) mat.emissiveIntensity = PEAK_EMISSIVE;
      return;
    }

    // Phase 4: settle peak -> idle (grip + tilt).
    const t = easeInOutCubic((elapsed - WINDUP_MS - RAISE_MS - HOLD_MS) / SETTLE_MS);
    pivot.position.set(
      peakX + (idleX - peakX) * t,
      peakY + (idleY - peakY) * t,
      peakZ + (idleZ - peakZ) * t,
    );
    tmpQuatA.identity();
    tmpQuatB.setFromAxisAngle(tmpVec.set(0, 0, 1), idleTilt);
    pivot.quaternion.copy(tmpQuatA).slerp(tmpQuatB, t);
    if (mat) {
      mat.emissiveIntensity = PEAK_EMISSIVE + (IDLE_EMISSIVE - PEAK_EMISSIVE) * t;
    }
  });
}
