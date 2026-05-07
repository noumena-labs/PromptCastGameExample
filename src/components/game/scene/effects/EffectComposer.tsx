"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group } from "three";
import type { EffectPrimitive, VisualRecipe } from "@/game/spells/visualRecipe";
import { BeamEffect, type BeamParams } from "./BeamEffect";
import { BlackholeEffect, type BlackholeParams } from "./BlackholeEffect";
import { DiscEffect, type DiscParams } from "./DiscEffect";
import { EmbersEffect, type EmbersParams } from "./EmbersEffect";
import { FrostShardsEffect, type FrostShardsParams } from "./FrostShardsEffect";
import { LightningEffect, type LightningParams } from "./LightningEffect";
import { MeteorEffect, type MeteorParams } from "./MeteorEffect";
import { ParticlesEffect, type ParticlesParams } from "./ParticlesEffect";
import { RingPulseEffect, type RingPulseParams } from "./RingPulseEffect";
import { ShockwaveEffect, type ShockwaveParams } from "./ShockwaveEffect";
import { VinesEffect, type VinesParams } from "./VinesEffect";
import { VortexConeEffect, type VortexConeParams } from "./VortexConeEffect";
import type { EffectContext } from "./effectTypes";

/**
 * EffectComposer renders a `VisualRecipe` as a stack of primitive R3F
 * components at the local origin. The parent (Projectile / AreaSpell) is
 * responsible for placing the composer in world space.
 *
 * Per-frame, the composer derives `ageSeconds` from the spawn time and
 * forwards it to every primitive via `EffectContext`. Primitives that need
 * lifecycle behaviour (shockwaves, ring pulses) read `ctx.ageSeconds`
 * rather than the global clock so multiple instances don't sync.
 */
export type EffectComposerProps = {
  recipe: VisualRecipe;
  /** When the parent spawned. Used to drive age-driven primitives. */
  spawnedAt: number;
  /** Lifetime in seconds. `+Infinity` means "lives until parent unmounts". */
  lifetimeSeconds?: number;
  /** Optional travel direction (world-space, normalized). Used by beam/lightning. */
  direction?: [number, number, number];
};

export function EffectComposer({
  recipe,
  spawnedAt,
  lifetimeSeconds = Number.POSITIVE_INFINITY,
  direction,
}: EffectComposerProps) {
  const groupRef = useRef<Group>(null);
  // Mutable context object updated in-place each frame so React doesn't
  // re-render every primitive on every tick. Primitives read live values.
  const ctx = useMemo<EffectContext>(
    () => ({
      palette: recipe.palette,
      motion: recipe.motion,
      ageSeconds: 0,
      lifetimeSeconds,
      direction,
    }),
    [recipe.palette, recipe.motion, lifetimeSeconds, direction],
  );

  useFrame(() => {
    ctx.ageSeconds = (performance.now() - spawnedAt) / 1000;
  });

  return (
    <group ref={groupRef}>
      {recipe.primitives.map((p, i) => (
        <PrimitiveSwitch key={i} primitive={p} ctx={ctx} />
      ))}
    </group>
  );
}

/**
 * Discriminated dispatch from `EffectPrimitive.kind` to the concrete
 * component. Centralised so adding a new primitive is a one-line edit here
 * plus the new component file.
 */
function PrimitiveSwitch({ primitive, ctx }: { primitive: EffectPrimitive; ctx: EffectContext }) {
  switch (primitive.kind) {
    case "meteor":
      return <MeteorEffect params={primitive.params as MeteorParams} ctx={ctx} />;
    case "lightning":
      return <LightningEffect params={primitive.params as LightningParams} ctx={ctx} />;
    case "blackhole":
      return <BlackholeEffect params={primitive.params as BlackholeParams} ctx={ctx} />;
    case "particles":
      return <ParticlesEffect params={primitive.params as ParticlesParams} ctx={ctx} />;
    case "vortexCone":
      return <VortexConeEffect params={primitive.params as VortexConeParams} ctx={ctx} />;
    case "ringPulse":
      return <RingPulseEffect params={primitive.params as RingPulseParams} ctx={ctx} />;
    case "beam":
      return <BeamEffect params={primitive.params as BeamParams} ctx={ctx} />;
    case "disc":
      return <DiscEffect params={primitive.params as DiscParams} ctx={ctx} />;
    case "shockwave":
      return <ShockwaveEffect params={primitive.params as ShockwaveParams} ctx={ctx} />;
    case "embers":
      return <EmbersEffect params={primitive.params as EmbersParams} ctx={ctx} />;
    case "frostShards":
      return <FrostShardsEffect params={primitive.params as FrostShardsParams} ctx={ctx} />;
    case "vines":
      return <VinesEffect params={primitive.params as VinesParams} ctx={ctx} />;
    default: {
      // Exhaustiveness guard — a new primitive added to the schema without
      // a switch case will fail to compile here.
      const _exhaustive: never = primitive;
      void _exhaustive;
      return null;
    }
  }
}
