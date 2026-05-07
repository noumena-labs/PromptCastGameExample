"use client";

import { useMemo } from "react";
import {
  CatmullRomCurve3,
  Vector3,
} from "three";
import { pickAccent, type EffectContext } from "./effectTypes";

/**
 * Vines primitive: N curving tubes erupting from the ground around the
 * origin. Each vine is a `CatmullRomCurve3` through `segments+1` random
 * points, extruded as a `tubeGeometry`. Static once spawned — animation
 * (rise / sway) lives on the parent group via the `rise` motion mode.
 */
export type VinesParams = {
  count: number;
  length: number;
  segments: number;
};

export function VinesEffect({ params, ctx }: { params: VinesParams; ctx: EffectContext }) {
  const count = Math.max(1, Math.round(params.count));
  const segments = Math.max(3, Math.round(params.segments));

  // Pre-build all the curve point sets so the geometry is stable across
  // frames. Vines should look gnarly but consistent.
  const vines = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const azimuth = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const points: Vector3[] = [];
      const radialBase = 0.2 + Math.random() * 0.4;
      for (let s = 0; s <= segments; s += 1) {
        const t = s / segments;
        // Rises along Y while drifting outward and curling laterally for a
        // creeping look. Random jitter on each segment keeps vines distinct.
        const radial = radialBase + t * 0.6 + (Math.random() - 0.5) * 0.15;
        const y = t * params.length;
        const sway = Math.sin(t * Math.PI * 1.3) * 0.25;
        const x = Math.cos(azimuth + sway) * radial;
        const z = Math.sin(azimuth + sway) * radial;
        points.push(new Vector3(x, y, z));
      }
      return new CatmullRomCurve3(points);
    });
  }, [count, segments, params.length]);

  const color = ctx.palette.primary;
  const emissive = pickAccent(ctx.palette);

  return (
    <group>
      {vines.map((curve, i) => (
        <mesh key={i}>
          <tubeGeometry args={[curve, segments * 2, 0.04, 6, false]} />
          <meshStandardMaterial
            color={color}
            emissive={emissive}
            emissiveIntensity={ctx.palette.emissive * 0.5}
            roughness={0.6}
            metalness={0}
          />
        </mesh>
      ))}
      {/* Small thorny spikes at the base */}
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.18, 12, 8]} />
        <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}
