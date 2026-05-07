"use client";

import { AdditiveBlending, DoubleSide } from "three";
import { pickSecondary, type EffectContext } from "./effectTypes";

/**
 * Disc primitive: a flat translucent disc on the ground plane. Used for
 * shields and lingering area markers. Static — no per-frame work.
 */
export type DiscParams = {
  segments: number;
  opacity: number;
};

export function DiscEffect({ params, ctx }: { params: DiscParams; ctx: EffectContext }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
      <circleGeometry args={[1, Math.max(8, Math.round(params.segments))]} />
      <meshBasicMaterial
        color={pickSecondary(ctx.palette)}
        transparent
        opacity={params.opacity}
        side={DoubleSide}
        blending={AdditiveBlending}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}
