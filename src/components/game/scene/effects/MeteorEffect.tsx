"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, Group, MeshBasicMaterial } from "three";
import { pickAccent, pickSecondary, type EffectContext } from "./effectTypes";

/**
 * Meteor primitive: a glowing head with a vertical fire trail above it.
 *
 * Renders at local origin pointing the trail toward +Y (sky). Used by
 * `meteor_strike` and `meteor_shower` archetypes; the parent composer
 * positions it at the projectile's current world location.
 */
export type MeteorParams = {
  trailLength: number;
  headRadius: number;
  count: number;
  scatterRadius: number;
};

export function MeteorEffect({ params, ctx }: { params: MeteorParams; ctx: EffectContext }) {
  const groupRef = useRef<Group>(null);
  const trailMatRef = useRef<MeshBasicMaterial>(null);

  // Subtle flicker on the trail to sell it as flame rather than a static cone.
  useFrame((state) => {
    if (!trailMatRef.current) return;
    const t = state.clock.elapsedTime;
    trailMatRef.current.opacity = 0.5 + Math.sin(t * 18) * 0.08;
  });

  const primary = ctx.palette.primary;
  const secondary = pickSecondary(ctx.palette);
  const accent = pickAccent(ctx.palette);

  return (
    <group ref={groupRef}>
      {/* Burning head */}
      <mesh castShadow>
        <sphereGeometry args={[params.headRadius, 16, 12]} />
        <meshStandardMaterial
          color={accent}
          emissive={primary}
          emissiveIntensity={ctx.palette.emissive * 1.2}
          roughness={0.4}
        />
      </mesh>
      {/* Halo */}
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[params.headRadius * 1.4, 0.04, 8, 24]} />
        <meshBasicMaterial color={accent} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      {/* Vertical fire trail (cylinder pointing up; head at bottom). */}
      <mesh position={[0, params.trailLength * 0.5, 0]}>
        <cylinderGeometry
          args={[params.headRadius * 0.18, params.headRadius * 1.1, params.trailLength, 12, 1, true]}
        />
        <meshBasicMaterial
          ref={trailMatRef}
          color={primary}
          transparent
          opacity={0.55}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {/* Outer trail fade */}
      <mesh position={[0, params.trailLength * 0.35, 0]}>
        <coneGeometry args={[params.headRadius * 1.7, params.trailLength * 0.7, 14]} />
        <meshBasicMaterial color={secondary} transparent opacity={0.32} side={DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}
