"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DoubleSide, type Mesh } from "three";
import { pickAccent, type EffectContext } from "./effectTypes";

/**
 * RingPulse primitive: N concentric expanding rings on the ground plane,
 * each completing a `period`-second expansion before resetting. Used for
 * shields, traps, ground sigils.
 */
export type RingPulseParams = {
  count: number;
  period: number;
  width: number;
};

export function RingPulseEffect({
  params,
  ctx,
}: {
  params: RingPulseParams;
  ctx: EffectContext;
}) {
  const ringRefs = useRef<(Mesh | null)[]>([]);
  const count = Math.max(1, Math.round(params.count));
  // Even out the start phases so rings don't all peak at once.
  const phases = useMemo(
    () => Array.from({ length: count }, (_, i) => (i / count) * params.period),
    [count, params.period],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i += 1) {
      const ring = ringRefs.current[i];
      if (!ring) continue;
      const local = ((t + phases[i]!) % params.period) / params.period; // 0..1
      const radius = 0.2 + local * 2.4;
      ring.scale.set(radius, radius, 1);
      const mat = ring.material as { opacity: number; transparent: boolean };
      mat.opacity = 0.85 * (1 - local);
    }
  });

  const color = pickAccent(ctx.palette);

  return (
    <group rotation-x={-Math.PI / 2}>
      {phases.map((_, i) => (
        <mesh
          key={i}
          ref={(node) => {
            ringRefs.current[i] = node;
          }}
        >
          <ringGeometry args={[1 - params.width, 1 + params.width, 48, 1]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.6}
            side={DoubleSide}
            blending={AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
