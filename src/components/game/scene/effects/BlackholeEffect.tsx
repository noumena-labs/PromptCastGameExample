"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BackSide, DoubleSide, Mesh } from "three";
import { pickAccent, pickSecondary, type EffectContext } from "./effectTypes";

/**
 * Blackhole primitive: a dark event-horizon sphere wrapped in a swirling
 * accretion disc. Visual ONLY — there's no pull physics here (per the design
 * doc; the gameplay vortex impact already handles attraction).
 */
export type BlackholeParams = {
  eventHorizonR: number;
  accretionR: number;
  pullStrength: number;
  lensing: number;
};

export function BlackholeEffect({ params, ctx }: { params: BlackholeParams; ctx: EffectContext }) {
  const discRef = useRef<Mesh>(null);
  const lensRef = useRef<Mesh>(null);

  // Accretion disc spins on its own axis; speed roughly tied to pullStrength.
  const spinRate = 1.5 + params.pullStrength * 4;

  useFrame((_, delta) => {
    if (discRef.current) {
      discRef.current.rotation.z += delta * spinRate;
    }
    if (lensRef.current) {
      // Gentle counter-rotation on the lensing halo so the swirl reads.
      lensRef.current.rotation.z -= delta * spinRate * 0.4;
    }
  });

  const primary = ctx.palette.primary;
  const secondary = pickSecondary(ctx.palette);
  const accent = pickAccent(ctx.palette);

  return (
    <group>
      {/* Event horizon — pitch black absorbing sphere. We keep it slightly
          darker than the palette primary so it reads as a void even on
          dark backgrounds. */}
      <mesh>
        <sphereGeometry args={[params.eventHorizonR, 24, 16]} />
        <meshBasicMaterial color="#000000" toneMapped={false} />
      </mesh>
      {/* Inner glow halo — gives the void a rim. */}
      <mesh>
        <sphereGeometry args={[params.eventHorizonR * 1.08, 24, 16]} />
        <meshBasicMaterial
          color={primary}
          transparent
          opacity={0.35}
          side={BackSide}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {/* Accretion disc — flat ring, perpendicular to caster's view. */}
      <mesh ref={discRef} rotation-x={Math.PI / 2}>
        <ringGeometry
          args={[params.eventHorizonR * 1.1, params.accretionR, 64, 1]}
        />
        <meshBasicMaterial
          color={secondary}
          transparent
          opacity={0.55}
          side={DoubleSide}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {/* Bright accretion edge — narrower outer band of the accent color. */}
      <mesh rotation-x={Math.PI / 2}>
        <ringGeometry
          args={[params.accretionR * 0.85, params.accretionR, 64, 1]}
        />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={0.75}
          side={DoubleSide}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {/* Gravitational lensing halo — large faint sphere implying distortion. */}
      <mesh ref={lensRef}>
        <sphereGeometry args={[params.accretionR * 1.15, 24, 16]} />
        <meshBasicMaterial
          color={primary}
          transparent
          opacity={0.08 + params.lensing * 0.12}
          side={BackSide}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
