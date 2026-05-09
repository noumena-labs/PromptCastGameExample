"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, MeshStandardMaterial } from "three";

import type { Vec3 } from "@/game/types";

type WizardModelProps = {
  color: string;
  shielded?: boolean;
  position?: Vec3;
  rotationY?: number;
};

export type WizardModelHandle = {
  /**
   * Local-space pivot at the wizard's grip point. The cast-pose hook writes
   * both `position` and `quaternion` on this group during a cast (Gandalf-style
   * raise: staff translates to center + lifts up, fully vertical at peak).
   * When no cast is active, the idle sway runs.
   */
  staffPivot: Group | null;
  /** Direct material handle so cast poses can pulse the gem's emissive. */
  crystalMaterial: MeshStandardMaterial | null;
  /** Idle base position the pivot relaxes to. */
  idleBasePosition: { x: number; y: number; z: number };
  /** Idle base rotation (Z tilt) the pivot relaxes to. */
  idleBaseRotationZ: number;
  /**
   * Set to true by the cast-pose hook while a cast is animating. When true,
   * the model's idle useFrame skips writing to the pivot so the cast hook has
   * sole authority over position/rotation/emissive. Set back to false on settle.
   */
  castActive: { current: boolean };
};

// Pivot anchored near the wizard's grip (where the hand "holds" the staff).
// Children meshes are positioned so the geometry matches the original
// hardcoded layout when staffPivot rotation is zero.
const STAFF_PIVOT_POS: Vec3 = [0.48, 1.05, -0.04];
// Original staff cylinder world position [0.48, 1.2, -0.08] -> local: [0, 0.15, -0.04]
// Original crystal world position       [0.66, 1.72, -0.18] -> local: [0.18, 0.67, -0.14]
// Idle Z tilt to keep the original staff angle.
const STAFF_IDLE_TILT_Z = -0.45;
const CRYSTAL_LOCAL: Vec3 = [0.0, 0.8, -0.05];

export const WizardModel = forwardRef<WizardModelHandle, WizardModelProps>(function WizardModel(
  { color, shielded = false, position = [0, 0, 0], rotationY = 0 },
  ref,
) {
  const staffPivotRef = useRef<Group | null>(null);
  const crystalMaterialRef = useRef<MeshStandardMaterial | null>(null);
  const castActiveRef = useRef({ current: false });

  useImperativeHandle(
    ref,
    () => ({
      get staffPivot() {
        return staffPivotRef.current;
      },
      get crystalMaterial() {
        return crystalMaterialRef.current;
      },
      idleBasePosition: { x: STAFF_PIVOT_POS[0], y: STAFF_PIVOT_POS[1], z: STAFF_PIVOT_POS[2] },
      idleBaseRotationZ: STAFF_IDLE_TILT_Z,
      castActive: castActiveRef.current,
    }),
    [],
  );

  // Idle staff sway + crystal breathing. Skipped while a cast is animating
  // so the cast-pose hook has sole authority over the staff transform.
  useFrame((state) => {
    if (castActiveRef.current.current) return;
    const t = state.clock.elapsedTime;
    const pivot = staffPivotRef.current;
    if (pivot) {
      pivot.position.set(STAFF_PIVOT_POS[0], STAFF_PIVOT_POS[1], STAFF_PIVOT_POS[2]);
      pivot.rotation.z = STAFF_IDLE_TILT_Z + Math.sin(t * 0.8) * 0.04;
      pivot.rotation.x = Math.sin(t * 0.6 + 1.3) * 0.025;
      pivot.rotation.y = 0;
    }
    const mat = crystalMaterialRef.current;
    if (mat) {
      // Slow emissive breathing baseline.
      mat.emissiveIntensity = 1.4 + Math.sin(t * 1.6) * 0.35;
    }
  });

  return (
    <group position={position} rotation-y={rotationY}>
      {/* Robe / body */}
      <mesh castShadow position={[0, 0.65, 0]}>
        <cylinderGeometry args={[0.38, 0.48, 1.25, 6]} />
        <meshStandardMaterial color={color} roughness={0.62} emissive={color} emissiveIntensity={0.08} />
      </mesh>
      {/* Head */}
      <mesh castShadow position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.34, 10, 8]} />
        <meshStandardMaterial color="#f0d1aa" roughness={0.7} />
      </mesh>
      {/* Hat */}
      <mesh castShadow position={[0, 2.05, 0]} rotation-z={0.08}>
        <coneGeometry args={[0.58, 0.95, 7]} />
        <meshStandardMaterial color="#202038" roughness={0.58} emissive="#24114d" emissiveIntensity={0.14} />
      </mesh>

      {/* Staff pivot — translates + rotates as a unit. Idle: tucked at the
          grip with the original tilt. Cast peak: lifted to wizard center
          and held vertical, crystal floating above the head. */}
      <group ref={staffPivotRef} position={STAFF_PIVOT_POS} rotation-z={STAFF_IDLE_TILT_Z}>
        <mesh castShadow position={[0, 0.15, -0.04]}>
          <cylinderGeometry args={[0.07, 0.09, 1.2, 6]} />
          <meshStandardMaterial color="#4b2d19" roughness={0.8} />
        </mesh>
        <mesh position={CRYSTAL_LOCAL}>
          <sphereGeometry args={[0.13, 8, 8]} />
          <meshStandardMaterial
            ref={(mat) => {
              crystalMaterialRef.current = mat as MeshStandardMaterial | null;
            }}
            color="#9d7cff"
            emissive="#9d7cff"
            emissiveIntensity={1.6}
          />
        </mesh>
      </group>

      {shielded ? (
        <mesh position={[0, 1.08, 0]}>
          <sphereGeometry args={[1.15, 18, 12]} />
          <meshStandardMaterial color="#74f7d0" emissive="#55ffc9" emissiveIntensity={0.75} transparent opacity={0.22} roughness={0.2} />
        </mesh>
      ) : null}
    </group>
  );
});
