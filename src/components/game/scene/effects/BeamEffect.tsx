"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, Group, MathUtils, MeshBasicMaterial, Vector3 } from "three";
import { pickAccent, type EffectContext } from "./effectTypes";

/**
 * Beam primitive: a glowing cylinder oriented along `ctx.direction` (or +Z
 * by default). Used by `arcane_beam`. We orient via lookAt on a child group
 * so the cylinder runs along the local +Z axis.
 */
export type BeamParams = {
  width: number;
  taper: number;
  glow: number;
};

const FORWARD = new Vector3(0, 0, 1);
const TARGET = new Vector3();
const UP = new Vector3(0, 1, 0);

export function BeamEffect({ params, ctx }: { params: BeamParams; ctx: EffectContext }) {
  const groupRef = useRef<Group>(null);
  const matRef = useRef<MeshBasicMaterial>(null);

  const dir = useMemo<Vector3>(() => {
    const d = ctx.direction ?? [0, 0, 1];
    return new Vector3(d[0], d[1], d[2]).normalize();
  }, [ctx.direction]);

  // Beam length: ~6m default. Recipes that want longer should bake it into
  // the projectile's velocity / lifetime so the beam re-emits each frame.
  const length = 6;
  const radiusBase = MathUtils.clamp(params.width, 0.04, 0.5);
  const radiusTip = radiusBase * MathUtils.clamp(1 - params.taper, 0.05, 1);

  useFrame((state) => {
    if (groupRef.current) {
      // Align the group's +Z to dir.
      TARGET.copy(dir);
      groupRef.current.quaternion.setFromUnitVectors(FORWARD, TARGET);
      // Offset so the beam starts at origin and extends forward.
      groupRef.current.position.set(0, 0, 0);
    }
    if (matRef.current) {
      // Pulse the glow subtly so the beam never feels like a static rod.
      const pulse = 0.85 + Math.sin(state.clock.elapsedTime * 16) * 0.1;
      matRef.current.opacity = 0.65 * pulse;
    }
    // suppress unused warning when destructuring above
    void UP;
  });

  const color = pickAccent(ctx.palette);

  return (
    <group ref={groupRef}>
      {/* Cylinder runs along +Y in geometry-local space; rotate to +Z. */}
      <group rotation-x={Math.PI / 2}>
        {/* Outer glow */}
        <mesh position={[0, length * 0.5, 0]}>
          <cylinderGeometry args={[radiusTip * 1.6, radiusBase * 1.6, length, 16, 1, true]} />
          <meshBasicMaterial
            ref={matRef}
            color={color}
            transparent
            opacity={0.55}
            side={DoubleSide}
            blending={AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
        {/* Bright core */}
        <mesh position={[0, length * 0.5, 0]}>
          <cylinderGeometry args={[radiusTip, radiusBase, length, 12, 1, true]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.95}
            side={DoubleSide}
            blending={AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
        {/* Origin flare */}
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[radiusBase * 1.6, 12, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
