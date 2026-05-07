"use client";

import { useMemo } from "react";
import { pickAccent, pickSecondary, type EffectContext } from "./effectTypes";

/**
 * FrostShards primitive: N elongated ice crystals jutting outward in a star
 * pattern around the origin. Used by `frost_nova` (radial burst) and
 * `ice_shard` (small forward cluster).
 *
 * The shards are static — frost reads as crystalline / frozen. If you want
 * motion, drive the parent group's transform.
 */
export type FrostShardsParams = {
  count: number;
  length: number;
};

export function FrostShardsEffect({
  params,
  ctx,
}: {
  params: FrostShardsParams;
  ctx: EffectContext;
}) {
  const count = Math.max(2, Math.round(params.count));
  // Distribute shards evenly around Y axis with a small random tilt so they
  // don't look perfectly mechanical. Memo so we don't reroll every frame.
  const shards = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const azimuth = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const tilt = (Math.random() - 0.5) * 0.6;
      return { azimuth, tilt, len: params.length * (0.85 + Math.random() * 0.3) };
    });
  }, [count, params.length]);

  const primary = pickAccent(ctx.palette);
  const accent = pickSecondary(ctx.palette);

  return (
    <group>
      {shards.map((s, i) => (
        <group key={i} rotation={[0, s.azimuth, s.tilt]}>
          {/* Long thin spike pointing along +X. Cone radius at base, tip at the far end. */}
          <mesh rotation={[0, 0, -Math.PI / 2]} position={[s.len * 0.5, 0, 0]}>
            <coneGeometry args={[s.len * 0.18, s.len, 6]} />
            <meshStandardMaterial
              color={primary}
              emissive={accent}
              emissiveIntensity={ctx.palette.emissive * 0.8}
              metalness={0.2}
              roughness={0.1}
              transparent
              opacity={0.9}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
