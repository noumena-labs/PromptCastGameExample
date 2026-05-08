// Rock materials
// -----------------------------------------------------------------------------
// MeshStandardMaterial variants with onBeforeCompile injection for animated
// emissive cracks. Tinted by alignment (colorA = body, colorB = crack glow).
//
// Each factory returns a NEW material instance. Callers OWN it and must
// dispose() on unmount. (Unlike geometries, materials are cheap to recreate
// and cannot be safely shared across nodes that need different colorB tints.)
//
// Animation: `uTime` is updated externally (e.g. via useFrame in the render
// node) by writing to material.userData.uTime, which the shader reads.
// We expose `tickRockMaterial(material, time)` for convenience.

import * as THREE from "three";

type RockMaterialOptions = {
  colorA?: THREE.ColorRepresentation; // body color
  colorB?: THREE.ColorRepresentation; // crack/emissive color
  roughness?: number;
  metalness?: number;
  /** Crack glow strength (0..3 typical). */
  emissiveIntensity?: number;
  /** Crack pattern frequency. Higher = denser cracks. */
  crackScale?: number;
  /** How much the cracks pulse (0 = static, 1 = full breathe). */
  pulseAmount?: number;
};

const sharedFragmentSnippet = `
// === injected: animated emissive cracks ===
uniform float uTime;
uniform float uCrackScale;
uniform float uPulseAmount;
uniform vec3 uCrackColor;
uniform float uCrackIntensity;

// Re-use the same hash/fbm family as spellShaderPrograms for consistency.
float _crackHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float _crackNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = _crackHash(i);
  float b = _crackHash(i + vec2(1.0, 0.0));
  float c = _crackHash(i + vec2(0.0, 1.0));
  float d = _crackHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float _crackFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += _crackNoise(p) * a;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return v;
}
`;

const sharedFragmentMain = `
  // Build a crack mask from world-space tri-planar fbm so the pattern doesn't
  // swim with model rotation.
  vec3 wp = vWorldPosition * uCrackScale;
  float n = _crackFbm(wp.xy + vec2(uTime * 0.05, 0.0)) * 0.5
          + _crackFbm(wp.yz + vec2(0.0, uTime * 0.07)) * 0.3
          + _crackFbm(wp.xz + vec2(uTime * 0.06, uTime * 0.04)) * 0.2;
  // Ridge: bright at thresholds.
  float ridge = 1.0 - abs(2.0 * n - 1.0);
  ridge = smoothstep(0.78, 0.96, ridge);
  // Pulse modulation
  float pulse = mix(1.0, 0.55 + 0.45 * sin(uTime * 1.7), uPulseAmount);
  vec3 glow = uCrackColor * ridge * pulse * uCrackIntensity;
  totalEmissiveRadiance += glow;
`;

function injectCracks(
  material: THREE.MeshStandardMaterial,
  opts: Required<
    Pick<
      RockMaterialOptions,
      "emissiveIntensity" | "crackScale" | "pulseAmount"
    >
  > & { crackColor: THREE.Color }
) {
  // Stash uniforms in userData so they can be ticked from outside.
  material.userData.uTime = { value: 0 };
  material.userData.uCrackScale = { value: opts.crackScale };
  material.userData.uPulseAmount = { value: opts.pulseAmount };
  material.userData.uCrackColor = { value: opts.crackColor };
  material.userData.uCrackIntensity = { value: opts.emissiveIntensity };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = material.userData.uTime;
    shader.uniforms.uCrackScale = material.userData.uCrackScale;
    shader.uniforms.uPulseAmount = material.userData.uPulseAmount;
    shader.uniforms.uCrackColor = material.userData.uCrackColor;
    shader.uniforms.uCrackIntensity = material.userData.uCrackIntensity;

    // Ensure world position is available (vWorldPosition) by using the
    // standard worldpos varying from three's chunks.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vWorldPosition;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vWorldPosition;
${sharedFragmentSnippet}`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
${sharedFragmentMain}`
    );
  };

  // onBeforeCompile users must set a unique customProgramCacheKey or share it
  // explicitly; here every instance has unique uniforms so we keep them
  // separate.
  material.customProgramCacheKey = () => "rockCracks-v1";
}

/**
 * Advance the shader uTime uniform. Call from useFrame for each rock material
 * that's currently visible. Cheap (writes one float).
 */
export function tickRockMaterial(
  material: THREE.MeshStandardMaterial,
  time: number
) {
  const u = material.userData?.uTime as { value: number } | undefined;
  if (u) u.value = time;
}

// ---------- factories ----------

export function meteorMaterial(
  opts: RockMaterialOptions = {}
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.colorA ?? "#3a2a1e"),
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.05,
    emissive: new THREE.Color("#000000"),
  });
  injectCracks(mat, {
    emissiveIntensity: opts.emissiveIntensity ?? 1.6,
    crackScale: opts.crackScale ?? 1.4,
    pulseAmount: opts.pulseAmount ?? 0.6,
    crackColor: new THREE.Color(opts.colorB ?? "#ff6020"),
  });
  return mat;
}

export function monolithMaterial(
  opts: RockMaterialOptions = {}
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.colorA ?? "#5c5248"),
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.1,
    emissive: new THREE.Color("#000000"),
  });
  injectCracks(mat, {
    emissiveIntensity: opts.emissiveIntensity ?? 1.0,
    crackScale: opts.crackScale ?? 0.9,
    pulseAmount: opts.pulseAmount ?? 0.3,
    crackColor: new THREE.Color(opts.colorB ?? "#a8c8ff"),
  });
  return mat;
}

export function crystalMaterial(
  opts: RockMaterialOptions = {}
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.colorA ?? "#a0c8ff"),
    roughness: opts.roughness ?? 0.15,
    metalness: opts.metalness ?? 0.0,
    transparent: true,
    opacity: 0.85,
    emissive: new THREE.Color("#000000"),
  });
  injectCracks(mat, {
    emissiveIntensity: opts.emissiveIntensity ?? 1.4,
    crackScale: opts.crackScale ?? 2.2,
    pulseAmount: opts.pulseAmount ?? 0.8,
    crackColor: new THREE.Color(opts.colorB ?? "#ffffff"),
  });
  return mat;
}
