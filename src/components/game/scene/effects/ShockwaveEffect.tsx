"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, type Mesh } from "three";
import { pickAccent, type EffectContext } from "./effectTypes";

/**
 * Shockwave primitive: an expanding ring on the ground plane that fades as
 * it grows from `startR` to `endR` over `durationMs`. Plays once per
 * lifetime — once the wave reaches `endR` it stays invisible.
 */
export type ShockwaveParams = {
  startR: number;
  endR: number;
  durationMs: number;
};

export function ShockwaveEffect({
  params,
  ctx,
}: {
  params: ShockwaveParams;
  ctx: EffectContext;
}) {
  const meshRef = useRef<Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    // Drive expansion off the parent's `ageSeconds` so the wave is
    // synchronized with the spell impact rather than the global clock.
    const t = Math.min(1, (ctx.ageSeconds * 1000) / params.durationMs);
    const r = params.startR + (params.endR - params.startR) * t;
    meshRef.current.scale.set(r, r, 1);
    const mat = meshRef.current.material as { opacity: number };
    mat.opacity = (1 - t) * 0.85;
    meshRef.current.visible = t < 1;
  });

  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} position={[0, 0.04, 0]}>
      <ringGeometry args={[0.94, 1.0, 64, 1]} />
      <meshBasicMaterial
        color={pickAccent(ctx.palette)}
        transparent
        opacity={0.85}
        side={DoubleSide}
        blending={AdditiveBlending}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}
