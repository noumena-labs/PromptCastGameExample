"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import { pickAccent, type EffectContext } from "./effectTypes";

/**
 * Lightning primitive: a jagged line from origin to (length * direction)
 * with optional branches. Regenerated each `1/flickerHz` seconds for the
 * crackle effect. We use a single `BufferGeometry` whose positions buffer
 * is rewritten in place — no per-frame allocation.
 */
export type LightningParams = {
  jaggedness: number;
  segments: number;
  branches: number;
  flickerHz: number;
  length: number;
};

export function LightningEffect({ params, ctx }: { params: LightningParams; ctx: EffectContext }) {
  const lastFlickerRef = useRef(0);

  // Direction defaults to +Z if none provided. Lightning is usually tied to a
  // travel vector; sky lightning falls along -Y.
  const dir = ctx.direction ?? [0, 0, 1];
  const segCount = Math.max(2, Math.round(params.segments));

  // One flat geometry shared between renders; we just rewrite the position
  // attribute on each flicker tick.
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array((segCount + 1) * 3), 3));
    return g;
  }, [segCount]);

  const branchGeoms = useMemo(() => {
    const branchSegs = Math.max(2, Math.round(segCount * 0.4));
    return Array.from({ length: Math.max(0, Math.round(params.branches)) }, () => {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(new Float32Array((branchSegs + 1) * 3), 3));
      return g;
    });
  }, [segCount, params.branches]);

  useFrame((state) => {
    const flickerPeriod = 1 / Math.max(2, params.flickerHz);
    if (state.clock.elapsedTime - lastFlickerRef.current < flickerPeriod) return;
    lastFlickerRef.current = state.clock.elapsedTime;

    rebuildLightning(geometry, dir, params.length, segCount, params.jaggedness);
    for (let i = 0; i < branchGeoms.length; i += 1) {
      const branchSegs = Math.max(2, Math.round(segCount * 0.4));
      const t = 0.2 + ((i * 0.31) % 0.6); // anchor offset along the main bolt
      rebuildBranch(branchGeoms[i]!, dir, params.length, branchSegs, params.jaggedness * 1.2, t);
    }
  });

  const color = pickAccent(ctx.palette);

  return (
    <group>
      <line geometry={geometry}>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.95}
          linewidth={2}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </line>
      {branchGeoms.map((g, i) => (
        <line key={i} geometry={g}>
          <lineBasicMaterial
            color={color}
            transparent
            opacity={0.55}
            linewidth={1}
            blending={AdditiveBlending}
            toneMapped={false}
          />
        </line>
      ))}
      {/* Glow halo at origin */}
      <mesh>
        <sphereGeometry args={[0.18, 12, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
      </mesh>
    </group>
  );
}

function rebuildLightning(
  geometry: BufferGeometry,
  dir: [number, number, number],
  length: number,
  segments: number,
  jaggedness: number,
): void {
  const attr = geometry.attributes.position as Float32BufferAttribute;
  const arr = attr.array as Float32Array;
  // Build an orthonormal basis around `dir` so we can perturb in the plane
  // perpendicular to travel.
  const [ux, uy, uz] = perpendicular(dir);
  const [vx, vy, vz] = cross(dir, [ux, uy, uz]);
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    // Triangular envelope so endpoints stay on-axis.
    const env = 1 - Math.abs(t * 2 - 1);
    const offset = env * jaggedness * (Math.random() - 0.5) * length * 0.5;
    const offset2 = env * jaggedness * (Math.random() - 0.5) * length * 0.5;
    arr[i * 3 + 0] = dir[0] * t * length + ux * offset + vx * offset2;
    arr[i * 3 + 1] = dir[1] * t * length + uy * offset + vy * offset2;
    arr[i * 3 + 2] = dir[2] * t * length + uz * offset + vz * offset2;
  }
  attr.needsUpdate = true;
}

function rebuildBranch(
  geometry: BufferGeometry,
  dir: [number, number, number],
  length: number,
  segments: number,
  jaggedness: number,
  anchorT: number,
): void {
  // Branch starts at anchorT along the main bolt and shoots off in a random
  // perpendicular direction for ~30% of the main length.
  const attr = geometry.attributes.position as Float32BufferAttribute;
  const arr = attr.array as Float32Array;
  const [ux, uy, uz] = perpendicular(dir);
  const [vx, vy, vz] = cross(dir, [ux, uy, uz]);
  const angle = Math.random() * Math.PI * 2;
  const dx = ux * Math.cos(angle) + vx * Math.sin(angle);
  const dy = uy * Math.cos(angle) + vy * Math.sin(angle);
  const dz = uz * Math.cos(angle) + vz * Math.sin(angle);
  const branchLen = length * 0.3;
  const ax = dir[0] * anchorT * length;
  const ay = dir[1] * anchorT * length;
  const az = dir[2] * anchorT * length;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const env = 1 - Math.abs(t * 2 - 1);
    const offset = env * jaggedness * (Math.random() - 0.5) * branchLen * 0.6;
    arr[i * 3 + 0] = ax + dx * t * branchLen + ux * offset;
    arr[i * 3 + 1] = ay + dy * t * branchLen + uy * offset;
    arr[i * 3 + 2] = az + dz * t * branchLen + uz * offset;
  }
  attr.needsUpdate = true;
}

function perpendicular(d: [number, number, number]): [number, number, number] {
  // Pick the world axis least aligned with d, cross to get a perpendicular.
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  const az = Math.abs(d[2]);
  const seed: [number, number, number] = ax < ay && ax < az ? [1, 0, 0] : ay < az ? [0, 1, 0] : [0, 0, 1];
  const c = cross(d, seed);
  const len = Math.hypot(c[0], c[1], c[2]) || 1;
  return [c[0] / len, c[1] / len, c[2] / len];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
