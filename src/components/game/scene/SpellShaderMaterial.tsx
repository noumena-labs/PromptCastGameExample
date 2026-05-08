"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, MultiplyBlending, NormalBlending, ShaderMaterial } from "three";
import { getShaderPreset } from "@/game/spells/modules/shaderPresets";
import { getSpellShaderProgram } from "@/components/game/scene/spellShaderPrograms";
import type { SpellShaderId } from "@/game/spells/modules/spellIds";

export function SpellShaderMaterial({
  shaderId,
  opacityMultiplier = 1,
  animated = true,
}: {
  shaderId: SpellShaderId;
  opacityMultiplier?: number;
  animated?: boolean;
}) {
  const ref = useRef<ShaderMaterial>(null);
  const preset = getShaderPreset(shaderId);
  const program = getSpellShaderProgram(shaderId);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColorA: { value: new Color(preset.colorA) },
      uColorB: { value: new Color(preset.colorB) },
      uIntensity: { value: preset.intensity },
      uDistortion: { value: preset.distortion },
      uSpeed: { value: preset.speed },
      uOpacity: { value: preset.opacity * opacityMultiplier },
    }),
    [preset.colorA, preset.colorB, preset.distortion, preset.intensity, preset.opacity, preset.speed, opacityMultiplier],
  );

  useFrame((_, delta) => {
    if (!animated) return;
    if (!ref.current) return;
    ref.current.uniforms.uTime.value += delta;
    ref.current.uniforms.uOpacity.value = preset.opacity * opacityMultiplier;
  });

  return (
    <shaderMaterial
      ref={ref}
      vertexShader={program.vertexShader}
      fragmentShader={program.fragmentShader}
      uniforms={uniforms}
      transparent={preset.opacity < 0.98 || opacityMultiplier < 0.98}
      depthWrite={preset.depthWrite}
      blending={blendMode(preset.blendMode)}
      toneMapped={false}
    />
  );
}

function blendMode(mode: string) {
  if (mode === "additive") return AdditiveBlending;
  if (mode === "multiply") return MultiplyBlending;
  return NormalBlending;
}
