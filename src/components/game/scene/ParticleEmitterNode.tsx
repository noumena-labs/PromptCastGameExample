"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points } from "three";
import type { SceneLeaf } from "@/game/spells/sceneNode";

/**
 * Particle emitter for `shape: "particle_cloud"` nodes.
 *
 * One THREE.Points draw call. Particle state lives in flat Float32Arrays;
 * positions are rewritten each frame and re-uploaded via needsUpdate.
 *
 * Per-spell global cap (200) is enforced upstream by `clampScene`. We still
 * defensively clamp here in case this component is ever used outside the
 * pipeline (e.g. tests).
 */

const HARD_CAP = 200;

export function ParticleEmitterNode({ node }: { node: SceneLeaf }) {
  const pointsRef = useRef<Points>(null);
  const count = Math.max(1, Math.min(HARD_CAP, Math.round(node.particleCount)));

  // Spread (initial outward velocity scale) and lifetime are derived from
  // motion + size so the LLM doesn't have to pick them.
  const spread = node.size * 1.2 + node.motionSpeed * 0.4;
  const lifetime = 0.6 + node.size * 0.4 + (node.motion === "static" ? 1 : 0);
  const gravity = node.motion === "fall" ? -2 : node.motion === "rise" ? 2 : 0;

  const state = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const ages = new Float32Array(count);
    const lifetimes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      respawn(i, positions, velocities, ages, lifetimes, spread, lifetime);
      ages[i] = Math.random() * lifetimes[i]!;
    }
    return { positions, velocities, ages, lifetimes };
  }, [count, spread, lifetime]);

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
        respawn(i, positions, velocities, ages, lifetimes, spread, lifetime);
        continue;
      }
      velocities[i * 3 + 1]! += gravity * delta;
      positions[i * 3 + 0]! += velocities[i * 3 + 0]! * delta;
      positions[i * 3 + 1]! += velocities[i * 3 + 1]! * delta;
      positions[i * 3 + 2]! += velocities[i * 3 + 2]! * delta;
    }
    const attr = geometry.attributes.position as Float32BufferAttribute;
    attr.needsUpdate = true;
  });

  const drawSize = Math.max(0.04, node.size * 0.5);

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <points ref={pointsRef as any} geometry={geometry}>
      <pointsMaterial
        color={node.color}
        size={drawSize * 5}
        transparent
        opacity={node.opacity}
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
  spread: number,
  lifetime: number,
): void {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const sinPhi = Math.sin(phi);
  const dx = sinPhi * Math.cos(theta);
  const dy = Math.cos(phi);
  const dz = sinPhi * Math.sin(theta);
  positions[i * 3 + 0] = 0;
  positions[i * 3 + 1] = 0;
  positions[i * 3 + 2] = 0;
  velocities[i * 3 + 0] = dx * spread;
  velocities[i * 3 + 1] = dy * spread;
  velocities[i * 3 + 2] = dz * spread;
  ages[i] = 0;
  lifetimes[i] = lifetime * (0.8 + Math.random() * 0.4);
}
