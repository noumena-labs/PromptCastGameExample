"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points } from "three";
import { pickAccent, type EffectContext } from "./effectTypes";

/**
 * Embers primitive: small upward-drifting glow points used for fire trails
 * and meteor afterglow. Cheaper than `ParticlesEffect` because we never
 * shrink the GL_POINT size — embers fade via opacity only.
 */
export type EmbersParams = {
  count: number;
  gravity: number;
  lifetime: number;
};

const MAX = 120;

export function EmbersEffect({ params, ctx }: { params: EmbersParams; ctx: EffectContext }) {
  const ref = useRef<Points>(null);
  const count = Math.min(MAX, Math.max(1, Math.round(params.count)));

  const state = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const ages = new Float32Array(count);
    const lifetimes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      respawn(i, positions, velocities, ages, lifetimes, params);
      ages[i] = Math.random() * lifetimes[i]!;
    }
    return { positions, velocities, ages, lifetimes };
  }, [count, params.lifetime]);

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(state.positions, 3));
    return g;
  }, [state.positions]);

  useFrame((_, delta) => {
    const { positions, velocities, ages, lifetimes } = state;
    for (let i = 0; i < count; i += 1) {
      ages[i]! += delta;
      if (ages[i]! >= lifetimes[i]!) {
        respawn(i, positions, velocities, ages, lifetimes, params);
        continue;
      }
      // Embers RISE by default (positive gravity pushes Y up). The recipe
      // can flip the sign for falling sparks.
      velocities[i * 3 + 1]! += params.gravity * delta * 0.4;
      positions[i * 3 + 0]! += velocities[i * 3 + 0]! * delta;
      positions[i * 3 + 1]! += velocities[i * 3 + 1]! * delta;
      positions[i * 3 + 2]! += velocities[i * 3 + 2]! * delta;
    }
    (geometry.attributes.position as Float32BufferAttribute).needsUpdate = true;
  });

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <points ref={ref as any} geometry={geometry}>
      <pointsMaterial
        color={pickAccent(ctx.palette)}
        size={0.08}
        transparent
        opacity={0.85}
        sizeAttenuation
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

function respawn(
  i: number,
  positions: Float32Array,
  velocities: Float32Array,
  ages: Float32Array,
  lifetimes: Float32Array,
  params: EmbersParams,
): void {
  // Embers spawn at the origin with a small upward velocity component.
  positions[i * 3 + 0] = (Math.random() - 0.5) * 0.2;
  positions[i * 3 + 1] = 0;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
  velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.6;
  velocities[i * 3 + 1] = 0.4 + Math.random() * 0.6;
  velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
  ages[i] = 0;
  lifetimes[i] = params.lifetime * (0.7 + Math.random() * 0.6);
}
