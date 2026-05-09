"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, type Mesh, type PointLight, ShaderMaterial } from "three";
import { getAlignment } from "@/game/spells/modules/alignments";
import { getSpellShaderProgram } from "@/components/game/scene/spellShaderPrograms";
import type { SpellAlignmentId, Vec3 } from "@/game/types";

/**
 * CastFlash: a deliberately minimal, performance-forward replacement for the
 * old per-spell `cast` SpellScene.
 *
 * Every spell, regardless of alignment or delivery vehicle, plays the same
 * effect on cast: a brief alignment-tinted flash at the caster's shoulder.
 * Spell identity is communicated through `travel` and `impact` instead.
 *
 * Implementation:
 *   - One additive sphere using the existing `flash` shader program.
 *   - One short-lived point light, sharing the alignment palette colors.
 *   - Lifetime is fixed at ~140ms; the renderer animates a fast attack /
 *     exponential decay envelope and removes itself implicitly when the
 *     parent CastVfx is filtered out of the store.
 *
 * Bypasses SceneNodeRenderer entirely so it has zero per-spell branching
 * cost and no scene-graph allocation.
 */

const DEFAULT_DURATION_MS = 140;
const FLASH_RADIUS = 0.42;
const LIGHT_INTENSITY_PEAK = 6.5;
const LIGHT_DISTANCE = 4.5;

type CastFlashProps = {
  position: Vec3;
  alignmentId: SpellAlignmentId;
  createdAt: number;
  duration?: number;
};

export function CastFlash({ position, alignmentId, createdAt, duration = DEFAULT_DURATION_MS }: CastFlashProps) {
  const meshRef = useRef<Mesh>(null);
  const lightRef = useRef<PointLight>(null);
  const materialRef = useRef<ShaderMaterial>(null);

  const palette = getAlignment(alignmentId).palette;
  const program = useMemo(() => getSpellShaderProgram("blast_flash"), []);

  const colorA = useMemo(() => new Color(palette.primary), [palette.primary]);
  const colorB = useMemo(() => new Color(palette.accent), [palette.accent]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
      uIntensity: { value: 1.6 },
      uDistortion: { value: 0.4 },
      uSpeed: { value: 2.4 },
      uOpacity: { value: 1 },
    }),
    [colorA, colorB],
  );

  useFrame(() => {
    const elapsed = performance.now() - createdAt;
    const t = Math.max(0, Math.min(1, elapsed / duration));
    // Fast attack (first ~25% of lifetime), exponential decay afterwards.
    const envelope = t < 0.25 ? t / 0.25 : Math.exp(-(t - 0.25) * 6.5);

    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = elapsed / 1000;
      materialRef.current.uniforms.uOpacity.value = envelope;
    }
    if (meshRef.current) {
      const scale = 0.55 + envelope * 0.85;
      meshRef.current.scale.setScalar(scale);
    }
    if (lightRef.current) {
      lightRef.current.intensity = LIGHT_INTENSITY_PEAK * envelope;
    }
  });

  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[FLASH_RADIUS, 16, 12]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={program.vertexShader}
          fragmentShader={program.fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        ref={lightRef}
        color={palette.accent}
        intensity={0}
        distance={LIGHT_DISTANCE}
        decay={2}
      />
    </group>
  );
}
