"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points } from "three";
import { pickAccent, type EffectContext } from "./effectTypes";

/**
 * Generic particle burst primitive.
 *
 * We use a single THREE.Points draw call for performance. Particle state
 * (position, velocity, age) is stored in a flat Float32Array; positions are
 * rewritten each frame and uploaded via `attribute.needsUpdate = true`.
 *
 * Particle count is hard-capped at 200 (MAX_PARTICLES). The recipe schema
 * already clamps to this; we re-clamp here as a safety net.
 */
export type ParticlesParams = {
  count: number;
  lifetime: number;
  spread: number;
  gravity: number;
  sizeStart: number;
  sizeEnd: number;
};

const MAX_PARTICLES = 200;

export function ParticlesEffect({ params, ctx }: { params: ParticlesParams; ctx: EffectContext }) {
  const pointsRef = useRef<Points>(null);
  const count = Math.min(MAX_PARTICLES, Math.max(1, Math.round(params.count)));

  // Particle scratch buffers. Each particle is reborn when its age exceeds
  // its (slightly randomized) lifetime — keeps the cloud alive for as long
  // as the parent effect stays mounted.
  const state = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const ages = new Float32Array(count);
    const lifetimes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      respawnParticle(i, positions, velocities, ages, lifetimes, params);
      // Spread initial ages so the cloud doesn't pop in lockstep.
      ages[i] = Math.random() * lifetimes[i]!;
    }
    return { positions, velocities, ages, lifetimes };
  }, [count, params.lifetime, params.spread]);

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
        respawnParticle(i, positions, velocities, ages, lifetimes, params);
        continue;
      }
      // Simple Euler integration; gravity acts along world -Y (or +Y if
      // gravity is negative; recipe already encodes direction in sign).
      velocities[i * 3 + 1]! += params.gravity * delta * 0.6;
      positions[i * 3 + 0]! += velocities[i * 3 + 0]! * delta;
      positions[i * 3 + 1]! += velocities[i * 3 + 1]! * delta;
      positions[i * 3 + 2]! += velocities[i * 3 + 2]! * delta;
    }
    const attr = geometry.attributes.position as Float32BufferAttribute;
    attr.needsUpdate = true;
  });

  // Average size used for the GL_POINT draw — particles all share one size,
  // which is cheaper than a per-particle attribute. We pick the midpoint
  // between sizeStart/End so it reads correctly throughout the lifetime.
  const drawSize = (params.sizeStart + params.sizeEnd) * 0.5;

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <points ref={pointsRef as any} geometry={geometry}>
      <pointsMaterial
        color={pickAccent(ctx.palette)}
        size={Math.max(0.02, drawSize) * 5}
        transparent
        opacity={0.9}
        sizeAttenuation
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

function respawnParticle(
  i: number,
  positions: Float32Array,
  velocities: Float32Array,
  ages: Float32Array,
  lifetimes: Float32Array,
  params: ParticlesParams,
): void {
  // Spawn at origin (parent group positions us); pick a random direction in
  // a uniform sphere, scale velocity by `spread`.
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const sinPhi = Math.sin(phi);
  const dx = sinPhi * Math.cos(theta);
  const dy = Math.cos(phi);
  const dz = sinPhi * Math.sin(theta);
  positions[i * 3 + 0] = 0;
  positions[i * 3 + 1] = 0;
  positions[i * 3 + 2] = 0;
  velocities[i * 3 + 0] = dx * params.spread;
  velocities[i * 3 + 1] = dy * params.spread;
  velocities[i * 3 + 2] = dz * params.spread;
  ages[i] = 0;
  // Jitter lifetime ±20% so the cloud never pops in unison.
  lifetimes[i] = params.lifetime * (0.8 + Math.random() * 0.4);
}
