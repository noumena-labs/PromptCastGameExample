"use client";

import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { BlendFunction, KernelSize } from "postprocessing";

/**
 * Post-processing chain for PromptCast.
 *
 * Tuned to make existing emissive content glow without blowing out the
 * golden-hour sky or subtle stone/robe emissives.
 *
 * Bloom band reference (current authored emissive intensities):
 *   Subtle (kept BELOW threshold): robe 0.08, flowers 0.12, stone 0.05
 *   Mid    (light bloom):           dummies 0.35, aura shell 0.75, base shapes 1.2
 *   Strong (full bloom):            wizard gem 1.6+, tower runes 1.6-2.2,
 *                                   crystals 3.0-3.2, baked spell VFX up to 3.4
 */

// --- Tuning constants (tweak here) -----------------------------------------
const BLOOM_THRESHOLD = 0.25;
const BLOOM_SMOOTHING = 0.1;
const BLOOM_INTENSITY = 0.9;
const BLOOM_RADIUS = 0.7;

const VIGNETTE_OFFSET = 0.35;
const VIGNETTE_DARKNESS = 0.45;
// ---------------------------------------------------------------------------

export function PostFX() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom
        mipmapBlur
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={BLOOM_SMOOTHING}
        intensity={BLOOM_INTENSITY}
        radius={BLOOM_RADIUS}
        kernelSize={KernelSize.LARGE}
      />
      <Vignette
        offset={VIGNETTE_OFFSET}
        darkness={VIGNETTE_DARKNESS}
        blendFunction={BlendFunction.NORMAL}
      />
      <SMAA />
    </EffectComposer>
  );
}
