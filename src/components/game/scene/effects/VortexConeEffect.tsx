"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, Mesh } from "three";
import { pickSecondary, type EffectContext } from "./effectTypes";

/**
 * VortexCone primitive: a swirling cone (point at top, base at bottom) used
 * for tornados and vortex visuals. Y-axis is "up" along the vortex.
 */
export type VortexConeParams = {
  height: number;
  baseR: number;
  topR: number;
  spinRate: number;
};

export function VortexConeEffect({
  params,
  ctx,
}: {
  params: VortexConeParams;
  ctx: EffectContext;
}) {
  const innerRef = useRef<Mesh>(null);
  const outerRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (innerRef.current) innerRef.current.rotation.y += delta * params.spinRate;
    if (outerRef.current) outerRef.current.rotation.y -= delta * params.spinRate * 0.6;
  });

  return (
    <group position={[0, params.height * 0.5, 0]}>
      {/* Outer translucent shell */}
      <mesh ref={outerRef}>
        <cylinderGeometry args={[params.topR, params.baseR, params.height, 24, 1, true]} />
        <meshBasicMaterial
          color={ctx.palette.primary}
          transparent
          opacity={0.32}
          side={DoubleSide}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {/* Inner brighter core */}
      <mesh ref={innerRef} scale={[0.62, 1, 0.62]}>
        <cylinderGeometry args={[params.topR, params.baseR, params.height * 0.96, 18, 1, true]} />
        <meshBasicMaterial
          color={pickSecondary(ctx.palette)}
          transparent
          opacity={0.55}
          side={DoubleSide}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
