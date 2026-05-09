import * as THREE from "three";
import type { TerrainMorphSource } from "@/game/arena/terrainMorph";

const MAX_TERRAIN_MORPHS = 4;

const PROFILE_MAX_DOWN = [0, 1.65, 0.85, 0.65, 0.95, 1.9, 0.55, 2.25] as const;
const PROFILE_MAX_UP = [0, 1.45, 1.5, 1.35, 2.0, 1.25, 1.45, 1.65] as const;

const STYLE_COLORS: Record<number, { colorA: [number, number, number]; colorB: [number, number, number] }> = {
  1: { colorA: [0.11, 0.035, 0.012], colorB: [1.0, 0.34, 0.08] },
  2: { colorA: [0.52, 0.92, 1.0], colorB: [0.92, 1.0, 1.0] },
  3: { colorA: [0.14, 0.11, 0.36], colorB: [1.0, 0.95, 0.25] },
  4: { colorA: [0.38, 0.27, 0.16], colorB: [0.82, 0.63, 0.36] },
  5: { colorA: [0.06, 0.02, 0.08], colorB: [0.64, 0.34, 0.8] },
  6: { colorA: [0.58, 0.44, 0.16], colorB: [1.0, 0.92, 0.48] },
  7: { colorA: [0.06, 0.025, 0.09], colorB: [0.96, 0.52, 0.22] },
};

const terrainMorphCommon = /* glsl */ `
#define TERRAIN_MORPH_MAX ${MAX_TERRAIN_MORPHS}

uniform float uTerrainMorphTime;
uniform int uTerrainMorphCount;
uniform vec4 uTerrainMorphPositionRadius[TERRAIN_MORPH_MAX];
uniform vec4 uTerrainMorphParams[TERRAIN_MORPH_MAX];
uniform vec3 uTerrainMorphColorA[TERRAIN_MORPH_MAX];
uniform vec3 uTerrainMorphColorB[TERRAIN_MORPH_MAX];

const float TERRAIN_MORPH_DETAIL_SCALE = 0.72;

varying vec3 vTerrainMorphWorldPosition;
varying float vTerrainMorphMask;
varying float vTerrainMorphSigned;
varying float vTerrainMorphStyle;
varying vec3 vTerrainMorphColorA;
varying vec3 vTerrainMorphColorB;

vec2 terrainMorphDetail(vec2 p, float frequency) {
  return p * frequency * TERRAIN_MORPH_DETAIL_SCALE;
}

float terrainMorphHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float terrainMorphNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = terrainMorphHash(i);
  float b = terrainMorphHash(i + vec2(1.0, 0.0));
  float c = terrainMorphHash(i + vec2(0.0, 1.0));
  float d = terrainMorphHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float terrainMorphFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += terrainMorphNoise(p) * a;
    p = mat2(1.62, 1.15, -1.15, 1.62) * p + vec2(8.7, 3.4);
    a *= 0.52;
  }
  return v;
}

float terrainMorphVeins(vec2 p, float threshold, float width) {
  float n = terrainMorphFbm(p);
  return 1.0 - smoothstep(width * 0.35, width, abs(n - threshold));
}

float terrainMorphRings(vec2 p, float speed) {
  float d = length(p);
  float wave = sin(d * 7.0 - uTerrainMorphTime * speed);
  return smoothstep(0.62, 0.96, wave);
}

float terrainMorphRing(float t, float center, float width) {
  float d = (t - center) / width;
  return exp(-d * d * 2.4);
}

float terrainMorphMaxDown(float style) {
  if (style < 1.5) return 1.65;
  if (style < 2.5) return 0.85;
  if (style < 3.5) return 0.65;
  if (style < 4.5) return 0.95;
  if (style < 5.5) return 1.9;
  if (style < 6.5) return 0.55;
  return 2.25;
}

float terrainMorphMaxUp(float style) {
  if (style < 1.5) return 1.45;
  if (style < 2.5) return 1.5;
  if (style < 3.5) return 1.35;
  if (style < 4.5) return 2.0;
  if (style < 5.5) return 1.25;
  if (style < 6.5) return 1.45;
  return 1.65;
}

float terrainMorphRidgeCount(float style) {
  if (style > 3.5 && style < 4.5) return 9.0;
  if (style > 2.5 && style < 3.5) return 13.0;
  if (style > 5.5 && style < 6.5) return 10.0;
  if (style > 6.5) return 11.0;
  return 7.0;
}

float terrainMorphShape(float style, float t, float angle, float ageSec, vec2 worldXZ, float seedPhase) {
  float edge = 1.0 - smoothstep(0.78, 1.0, t);
  float center = 1.0 - smoothstep(0.0, 0.58, t);
  float rim = terrainMorphRing(t, 0.58, 0.11);
  float outerRing = terrainMorphRing(t, 0.82, 0.08);
  float noise = terrainMorphNoise(terrainMorphDetail(worldXZ, 0.42) + vec2(seedPhase, seedPhase * 0.37)) - 0.5;
  float ridges = (pow(abs(sin(angle * terrainMorphRidgeCount(style) + seedPhase * 6.28318)), 5.5) * 1.35 - 0.18) * edge;
  float wave = sin(t * 25.1327 - ageSec * 5.2 + seedPhase * 6.28318) * edge;

  if (style < 1.5) return -0.95 * center + 0.95 * rim + 0.28 * ridges + 0.2 * wave + 0.26 * noise * edge;
  if (style < 2.5) return 0.52 * sin(t * 17.2788 - ageSec * 2.1) * edge + 0.7 * terrainMorphRing(t, 0.42, 0.12) + 0.24 * ridges - 0.2 * center;
  if (style < 3.5) return 0.78 * terrainMorphRing(t, 0.28 + sin(ageSec * 3.5) * 0.035, 0.055) + 0.66 * terrainMorphRing(t, 0.56, 0.07) + 0.36 * ridges - 0.18 * center;
  if (style < 4.5) return 0.5 * center + 0.95 * ridges + 0.7 * terrainMorphRing(t, 0.38, 0.13) - 0.28 * outerRing + 0.34 * noise * edge;
  if (style < 5.5) return -1.2 * center + 0.95 * rim - 0.34 * terrainMorphRing(t, 0.28, 0.12) + 0.18 * wave + 0.3 * noise * edge;
  if (style < 6.5) return 0.34 * center + 0.72 * terrainMorphRing(t, 0.34, 0.08) + 0.58 * terrainMorphRing(t, 0.64, 0.08) + 0.22 * ridges + 0.18 * wave;
  return -1.35 * center + 1.1 * rim + 0.42 * outerRing + 0.26 * ridges + 0.22 * noise * edge;
}

struct TerrainMorphResult {
  float displacement;
  float mask;
  float signedStrength;
  float style;
  vec3 colorA;
  vec3 colorB;
};

TerrainMorphResult terrainMorphSample(vec2 worldXZ) {
  TerrainMorphResult result;
  result.displacement = 0.0;
  result.mask = 0.0;
  result.signedStrength = 0.0;
  result.style = 0.0;
  result.colorA = vec3(0.0);
  result.colorB = vec3(0.0);
  float strongest = 0.0;

  for (int i = 0; i < TERRAIN_MORPH_MAX; i++) {
    if (i >= uTerrainMorphCount) break;
    vec4 pr = uTerrainMorphPositionRadius[i];
    vec4 params = uTerrainMorphParams[i];
    float radius = max(pr.z, 0.001);
    vec2 delta = worldXZ - pr.xy;
    float dist = length(delta);
    if (dist >= radius) continue;

    float style = params.x;
    float strength = params.y;
    float lifeAlpha = params.z;
    float ageSec = params.w;
    if (lifeAlpha <= 0.0 || strength <= 0.0) continue;

    float t = dist / radius;
    float angle = atan(delta.y, delta.x);
    float shape = terrainMorphShape(style, t, angle, ageSec, worldXZ, pr.w);
    float raw = shape * strength * lifeAlpha;
    float clamped = clamp(raw, -terrainMorphMaxDown(style), terrainMorphMaxUp(style));
    result.displacement += clamped;

    float absDisp = abs(clamped);
    if (absDisp > strongest) {
      strongest = absDisp;
      float edge = 1.0 - smoothstep(0.78, 1.0, t);
      float signedStrength = clamp(clamped, -1.0, 1.0);
      result.mask = clamp(abs(signedStrength) * 0.9 + edge * lifeAlpha * 0.22, 0.0, 1.0);
      result.signedStrength = signedStrength;
      result.style = style;
      result.colorA = uTerrainMorphColorA[i];
      result.colorB = uTerrainMorphColorB[i];
    }
  }
  return result;
}
`;

const terrainMorphVertex = /* glsl */ `
vec4 terrainMorphWorld = modelMatrix * vec4(transformed, 1.0);
TerrainMorphResult terrainMorph = terrainMorphSample(terrainMorphWorld.xz);
transformed.y += clamp(terrainMorph.displacement, -3.2, 3.2);
vTerrainMorphMask = terrainMorph.mask;
vTerrainMorphSigned = terrainMorph.signedStrength;
vTerrainMorphStyle = terrainMorph.style;
vTerrainMorphColorA = terrainMorph.colorA;
vTerrainMorphColorB = terrainMorph.colorB;
`;

const terrainMorphWorldPosition = /* glsl */ `
vTerrainMorphWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const terrainMorphDiffuse = /* glsl */ `
  float morphMask = clamp(vTerrainMorphMask, 0.0, 1.0);
  if (morphMask > 0.001) {
    vec2 morphP = vTerrainMorphWorldPosition.xz;
    float signedMeters = clamp(vTerrainMorphSigned, -1.0, 1.0);
    float up = smoothstep(0.18, 1.0, signedMeters);
    float down = smoothstep(0.18, 1.0, -signedMeters);
    float midUp = smoothstep(0.12, 0.58, signedMeters) * (1.0 - smoothstep(0.62, 0.96, signedMeters));
    float highTip = smoothstep(0.62, 1.0, signedMeters);
    float neutral = morphMask * (1.0 - max(up, down));
    float yBand = clamp(abs(signedMeters), 0.0, 1.0);
    float n = terrainMorphFbm(terrainMorphDetail(morphP, 0.42) + vec2(uTerrainMorphTime * 0.025, -uTerrainMorphTime * 0.018));
    float fine = terrainMorphFbm(terrainMorphDetail(morphP, 1.35) - vec2(uTerrainMorphTime * 0.045, uTerrainMorphTime * 0.03));
    float style = floor(vTerrainMorphStyle + 0.5);
    vec3 base = diffuseColor.rgb;
    vec3 neutralScar = mix(base, vTerrainMorphColorA, 0.32 + n * 0.18);
    vec3 raisedScar = mix(vTerrainMorphColorA, vTerrainMorphColorB, 0.52 + fine * 0.28);
    vec3 depressedScar = mix(base * 0.16, vTerrainMorphColorA * 0.46, 0.36 + n * 0.28);
    vec3 effect = mix(base, neutralScar, neutral * 0.7);
    effect = mix(effect, raisedScar, up * morphMask);
    effect = mix(effect, depressedScar, down * morphMask);
    vec3 glow = vec3(0.0);

    if (style == 1.0) {
      float cracks = terrainMorphVeins(terrainMorphDetail(morphP, 0.72) + vec2(uTerrainMorphTime * 0.035, 0.0), 0.54, 0.105);
      cracks *= smoothstep(0.08, 0.78, down * 1.3 + up * 0.65 + neutral * 0.35);
      vec3 crust = mix(vec3(0.045, 0.025, 0.012), vTerrainMorphColorA, n * 0.32);
      vec3 lavaBed = mix(vec3(1.0, 0.78, 0.12), vTerrainMorphColorB, 0.35 + cracks * 0.45);
      vec3 magmaMiddle = mix(vec3(0.72, 0.12, 0.025), vec3(1.0, 0.42, 0.06), 0.35 + cracks * 0.45 + fine * 0.18);
      vec3 obsidianTip = mix(vec3(0.01, 0.008, 0.006), vec3(0.10, 0.025, 0.01), n * 0.35);
      effect = mix(effect, crust, neutral * 0.65);
      effect = mix(effect, lavaBed, down * morphMask);
      effect = mix(effect, magmaMiddle, midUp * morphMask);
      effect = mix(effect, obsidianTip, highTip * morphMask);
      glow += vec3(1.0, 0.52, 0.08) * (cracks * (0.35 + midUp * 0.55) + down * 0.95) * (0.75 + 0.35 * sin(uTerrainMorphTime * 5.0 + fine * 4.0));
    } else if (style == 2.0) {
      float frost = smoothstep(0.12, 0.82, neutral + up * 0.75 + fine * 0.22);
      float glint = pow(max(0.0, fine), 5.0) * smoothstep(0.18, 0.9, up + morphMask * 0.45);
      vec3 frozenBasin = mix(vec3(0.02, 0.18, 0.34), vec3(0.10, 0.44, 0.72), 0.45 + fine * 0.25);
      vec3 iceMiddle = mix(vec3(0.48, 0.88, 1.0), vTerrainMorphColorB, 0.46 + glint * 0.28);
      vec3 darkBlueTip = mix(vec3(0.015, 0.055, 0.16), vec3(0.03, 0.13, 0.34), n * 0.45);
      effect = mix(effect, vTerrainMorphColorA, frost * neutral * 0.72);
      effect = mix(effect, frozenBasin, down * morphMask);
      effect = mix(effect, iceMiddle, midUp * morphMask);
      effect = mix(effect, darkBlueTip, highTip * morphMask);
      glow += vTerrainMorphColorB * glint * (0.12 + midUp * 0.22);
    } else if (style == 3.0) {
      float arcs = terrainMorphVeins(terrainMorphDetail(morphP, 1.15) + vec2(uTerrainMorphTime * 0.42, -uTerrainMorphTime * 0.18), 0.5, 0.075);
      float shock = terrainMorphRings(terrainMorphDetail(morphP, 0.42), 4.6) * morphMask;
      arcs *= smoothstep(0.12, 0.82, neutral * 0.4 + up * 1.1 + down * 0.35);
      vec3 singedLow = mix(vec3(0.018, 0.018, 0.04), vec3(0.08, 0.07, 0.18), n * 0.35);
      vec3 chargedMiddle = mix(vec3(0.32, 0.22, 0.9), vTerrainMorphColorB, arcs * 0.65 + 0.2);
      vec3 charredTip = mix(vec3(0.018, 0.014, 0.026), vec3(0.08, 0.06, 0.12), fine * 0.35);
      effect = mix(effect, singedLow, down * morphMask);
      effect = mix(effect, chargedMiddle, midUp * morphMask);
      effect = mix(effect, charredTip, highTip * morphMask);
      glow += vTerrainMorphColorB * (arcs * (0.35 + midUp * 0.75) + shock * 0.22);
    } else if (style == 4.0) {
      float grit = smoothstep(0.22, 0.78, n + fine * 0.25 + up * 0.18);
      vec3 compacted = mix(vec3(0.055, 0.032, 0.015), vec3(0.18, 0.10, 0.045), n * 0.35);
      vec3 exposed = mix(vec3(0.46, 0.31, 0.16), vTerrainMorphColorB, grit * 0.62);
      vec3 darkStoneTip = mix(vec3(0.075, 0.065, 0.055), vec3(0.18, 0.16, 0.13), fine * 0.35);
      effect = mix(effect, vTerrainMorphColorA, neutral * 0.55);
      effect = mix(effect, compacted, down * morphMask);
      effect = mix(effect, exposed, midUp * morphMask);
      effect = mix(effect, darkStoneTip, highTip * morphMask);
    } else if (style == 5.0) {
      float tar = smoothstep(0.18, 0.78, down + n * 0.35);
      float corruption = terrainMorphVeins(terrainMorphDetail(morphP, 0.78) - vec2(uTerrainMorphTime * 0.04, uTerrainMorphTime * 0.03), 0.48, 0.13);
      vec3 tarPit = mix(vec3(0.006, 0.002, 0.012), vec3(0.12, 0.025, 0.15), n * 0.34 + tar * 0.22);
      vec3 corruptedMiddle = mix(vec3(0.28, 0.08, 0.34), vTerrainMorphColorB, corruption * 0.5 + 0.22);
      vec3 deadTip = mix(vec3(0.018, 0.012, 0.02), vec3(0.06, 0.035, 0.07), fine * 0.35);
      effect = mix(effect, vTerrainMorphColorA, neutral * 0.55);
      effect = mix(effect, tarPit, down * morphMask * (0.75 + tar * 0.25));
      effect = mix(effect, corruptedMiddle, midUp * morphMask);
      effect = mix(effect, deadTip, highTip * morphMask);
      glow += vTerrainMorphColorB * corruption * (neutral * 0.12 + midUp * 0.28 + down * 0.2);
    } else if (style == 6.0) {
      float rays = terrainMorphVeins(terrainMorphDetail(morphP, 0.9) + vec2(uTerrainMorphTime * 0.035, 0.0), 0.56, 0.085);
      float halo = terrainMorphRings(terrainMorphDetail(morphP, 0.34), 1.6) * 0.35;
      vec3 shadowedGold = mix(vec3(0.10, 0.065, 0.012), vec3(0.34, 0.22, 0.06), n * 0.38);
      vec3 radiantMiddle = mix(vec3(0.82, 0.55, 0.10), vTerrainMorphColorB, rays * 0.42 + 0.2);
      vec3 burntGoldTip = mix(vec3(0.08, 0.055, 0.018), vec3(0.20, 0.14, 0.035), fine * 0.4);
      effect = mix(effect, shadowedGold, down * morphMask);
      effect = mix(effect, radiantMiddle, midUp * morphMask);
      effect = mix(effect, burntGoldTip, highTip * morphMask);
      glow += vTerrainMorphColorB * (rays * (0.16 + midUp * 0.32) + halo * 0.16) * morphMask;
    } else if (style == 7.0) {
      float scorch = smoothstep(0.1, 0.78, down + morphMask * 0.35 + n * 0.18);
      float stars = step(0.965, terrainMorphHash(floor(terrainMorphDetail(morphP, 3.2)))) * smoothstep(0.32, 0.9, morphMask);
      float ember = terrainMorphVeins(terrainMorphDetail(morphP, 0.62) + vec2(uTerrainMorphTime * 0.025, -uTerrainMorphTime * 0.02), 0.52, 0.12);
      vec3 voidCrater = mix(vec3(0.006, 0.004, 0.016), vec3(0.09, 0.045, 0.13), scorch * 0.45);
      vec3 cosmicMiddle = mix(vec3(0.28, 0.12, 0.38), vTerrainMorphColorB, ember * 0.32 + stars * 0.35 + 0.18);
      vec3 cooledMeteorTip = mix(vec3(0.018, 0.012, 0.024), vec3(0.10, 0.055, 0.08), fine * 0.36);
      effect = mix(effect, voidCrater, down * morphMask);
      effect = mix(effect, cosmicMiddle, midUp * morphMask);
      effect = mix(effect, cooledMeteorTip, highTip * morphMask);
      effect = mix(effect, vTerrainMorphColorA, neutral * scorch * 0.4);
      glow += vTerrainMorphColorB * (ember * (0.12 + midUp * 0.24) + stars * 0.42) * morphMask;
    }

    float contrast = 1.0 + yBand * 0.42;
    effect = clamp((effect - 0.5) * contrast + 0.5, 0.0, 1.8);
    diffuseColor.rgb = mix(base, effect, morphMask);
    totalEmissiveRadiance += glow * morphMask;
  }
`;

export function makeTerrainMorphMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    emissive: new THREE.Color("#000000"),
  });
  const positionRadius = Array.from({ length: MAX_TERRAIN_MORPHS }, () => new THREE.Vector4());
  const params = Array.from({ length: MAX_TERRAIN_MORPHS }, () => new THREE.Vector4());
  const colorA = Array.from({ length: MAX_TERRAIN_MORPHS }, () => new THREE.Color());
  const colorB = Array.from({ length: MAX_TERRAIN_MORPHS }, () => new THREE.Color());
  material.userData.uTerrainMorphTime = { value: 0 };
  material.userData.uTerrainMorphCount = { value: 0 };
  material.userData.uTerrainMorphPositionRadius = { value: positionRadius };
  material.userData.uTerrainMorphParams = { value: params };
  material.userData.uTerrainMorphColorA = { value: colorA };
  material.userData.uTerrainMorphColorB = { value: colorB };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainMorphTime = material.userData.uTerrainMorphTime;
    shader.uniforms.uTerrainMorphCount = material.userData.uTerrainMorphCount;
    shader.uniforms.uTerrainMorphPositionRadius = material.userData.uTerrainMorphPositionRadius;
    shader.uniforms.uTerrainMorphParams = material.userData.uTerrainMorphParams;
    shader.uniforms.uTerrainMorphColorA = material.userData.uTerrainMorphColorA;
    shader.uniforms.uTerrainMorphColorB = material.userData.uTerrainMorphColorB;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
${terrainMorphCommon}`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
${terrainMorphVertex}`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
${terrainMorphWorldPosition}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
${terrainMorphCommon}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
${terrainMorphDiffuse}`,
    );
  };
  material.customProgramCacheKey = () => "terrainMorphMaterial-v2-gpu";
  return material;
}

export function tickTerrainMorphMaterial(material: THREE.MeshStandardMaterial, time: number): void {
  const uniform = material.userData.uTerrainMorphTime as { value: number } | undefined;
  if (uniform) uniform.value = time;
}

export function setTerrainMorphSources(
  material: THREE.MeshStandardMaterial,
  sources: TerrainMorphSource[],
  nowMs: number,
): void {
  const countUniform = material.userData.uTerrainMorphCount as { value: number } | undefined;
  const positionUniform = material.userData.uTerrainMorphPositionRadius as { value: THREE.Vector4[] } | undefined;
  const paramsUniform = material.userData.uTerrainMorphParams as { value: THREE.Vector4[] } | undefined;
  const colorAUniform = material.userData.uTerrainMorphColorA as { value: THREE.Color[] } | undefined;
  const colorBUniform = material.userData.uTerrainMorphColorB as { value: THREE.Color[] } | undefined;
  if (!countUniform || !positionUniform || !paramsUniform || !colorAUniform || !colorBUniform) return;

  let count = 0;
  for (const source of sources) {
    if (count >= MAX_TERRAIN_MORPHS) break;
    if (source.expiresAt <= nowMs) continue;
    const duration = Math.max(1, source.expiresAt - source.createdAt);
    const life = clamp01((nowMs - source.createdAt) / duration);
    const lifeAlpha = smoothstep(0, 0.16, life) * (1 - smoothstep(0.78, 1, life));
    if (lifeAlpha <= 0) continue;
    const style = terrainMorphStyleId(source.alignment);
    const strength = terrainMorphStrength(source, style);
    const seedPhase = (source.seed & 0xffff) / 0xffff;
    const ageSeconds = Math.max(0, (nowMs - source.createdAt) / 1000);
    positionUniform.value[count].set(source.position[0], source.position[2], source.radius, seedPhase);
    paramsUniform.value[count].set(style, strength, lifeAlpha, ageSeconds);
    const colors = STYLE_COLORS[style] ?? STYLE_COLORS[1];
    colorAUniform.value[count].setRGB(colors.colorA[0], colors.colorA[1], colors.colorA[2]);
    colorBUniform.value[count].setRGB(colors.colorB[0], colors.colorB[1], colors.colorB[2]);
    count += 1;
  }

  for (let i = count; i < MAX_TERRAIN_MORPHS; i += 1) {
    positionUniform.value[i].set(0, 0, 0.001, 0);
    paramsUniform.value[i].set(0, 0, 0, 0);
    colorAUniform.value[i].setRGB(0, 0, 0);
    colorBUniform.value[i].setRGB(0, 0, 0);
  }
  countUniform.value = count;
}

function terrainMorphStyleId(alignment: TerrainMorphSource["alignment"]): number {
  switch (alignment) {
    case "fire":
      return 1;
    case "water_ice":
      return 2;
    case "lightning":
      return 3;
    case "earth":
      return 4;
    case "dark":
      return 5;
    case "light":
      return 6;
    case "meteor_cosmic":
      return 7;
  }
}

function terrainMorphStrength(source: TerrainMorphSource, style: number): number {
  const powerScale = 0.86 + source.powerTier * 0.08;
  const intensityScale = 0.85 + Math.max(0, source.intensity - 1) * 0.45;
  const maxUp = PROFILE_MAX_UP[style] ?? 1;
  const maxDown = PROFILE_MAX_DOWN[style] ?? 1;
  return Math.max(maxUp, maxDown) * powerScale * intensityScale;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
