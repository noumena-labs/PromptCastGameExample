import * as THREE from "three";

const terrainMorphCommon = /* glsl */ `
uniform float uTerrainMorphTime;
varying vec3 vTerrainMorphWorldPosition;
varying float vTerrainMorphMask;
varying float vTerrainMorphSigned;
varying float vTerrainMorphStyle;
varying vec3 vTerrainMorphColorA;
varying vec3 vTerrainMorphColorB;

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
    float n = terrainMorphFbm(morphP * 0.42 + vec2(uTerrainMorphTime * 0.025, -uTerrainMorphTime * 0.018));
    float fine = terrainMorphFbm(morphP * 1.35 - vec2(uTerrainMorphTime * 0.045, uTerrainMorphTime * 0.03));
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
      float cracks = terrainMorphVeins(morphP * 0.72 + vec2(uTerrainMorphTime * 0.035, 0.0), 0.54, 0.105);
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
      float arcs = terrainMorphVeins(morphP * 1.15 + vec2(uTerrainMorphTime * 0.42, -uTerrainMorphTime * 0.18), 0.5, 0.075);
      float shock = terrainMorphRings(morphP * 0.42, 4.6) * morphMask;
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
      float corruption = terrainMorphVeins(morphP * 0.78 - vec2(uTerrainMorphTime * 0.04, uTerrainMorphTime * 0.03), 0.48, 0.13);
      vec3 tarPit = mix(vec3(0.006, 0.002, 0.012), vec3(0.12, 0.025, 0.15), n * 0.34 + tar * 0.22);
      vec3 corruptedMiddle = mix(vec3(0.28, 0.08, 0.34), vTerrainMorphColorB, corruption * 0.5 + 0.22);
      vec3 deadTip = mix(vec3(0.018, 0.012, 0.02), vec3(0.06, 0.035, 0.07), fine * 0.35);
      effect = mix(effect, vTerrainMorphColorA, neutral * 0.55);
      effect = mix(effect, tarPit, down * morphMask * (0.75 + tar * 0.25));
      effect = mix(effect, corruptedMiddle, midUp * morphMask);
      effect = mix(effect, deadTip, highTip * morphMask);
      glow += vTerrainMorphColorB * corruption * (neutral * 0.12 + midUp * 0.28 + down * 0.2);
    } else if (style == 6.0) {
      float rays = terrainMorphVeins(morphP * 0.9 + vec2(uTerrainMorphTime * 0.035, 0.0), 0.56, 0.085);
      float halo = terrainMorphRings(morphP * 0.34, 1.6) * 0.35;
      vec3 shadowedGold = mix(vec3(0.10, 0.065, 0.012), vec3(0.34, 0.22, 0.06), n * 0.38);
      vec3 radiantMiddle = mix(vec3(0.82, 0.55, 0.10), vTerrainMorphColorB, rays * 0.42 + 0.2);
      vec3 burntGoldTip = mix(vec3(0.08, 0.055, 0.018), vec3(0.20, 0.14, 0.035), fine * 0.4);
      effect = mix(effect, shadowedGold, down * morphMask);
      effect = mix(effect, radiantMiddle, midUp * morphMask);
      effect = mix(effect, burntGoldTip, highTip * morphMask);
      glow += vTerrainMorphColorB * (rays * (0.16 + midUp * 0.32) + halo * 0.16) * morphMask;
    } else if (style == 7.0) {
      float scorch = smoothstep(0.1, 0.78, down + morphMask * 0.35 + n * 0.18);
      float stars = step(0.965, terrainMorphHash(floor(morphP * 3.2))) * smoothstep(0.32, 0.9, morphMask);
      float ember = terrainMorphVeins(morphP * 0.62 + vec2(uTerrainMorphTime * 0.025, -uTerrainMorphTime * 0.02), 0.52, 0.12);
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
  material.userData.uTerrainMorphTime = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainMorphTime = material.userData.uTerrainMorphTime;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
attribute float morphMask;
attribute float morphSigned;
attribute float morphStyle;
attribute vec3 morphColorA;
attribute vec3 morphColorB;
varying vec3 vTerrainMorphWorldPosition;
varying float vTerrainMorphMask;
varying float vTerrainMorphSigned;
varying float vTerrainMorphStyle;
varying vec3 vTerrainMorphColorA;
varying vec3 vTerrainMorphColorB;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
vTerrainMorphWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainMorphMask = morphMask;
vTerrainMorphSigned = morphSigned;
vTerrainMorphStyle = morphStyle;
vTerrainMorphColorA = morphColorA;
vTerrainMorphColorB = morphColorB;`,
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
  material.customProgramCacheKey = () => "terrainMorphMaterial-v1";
  return material;
}

export function tickTerrainMorphMaterial(material: THREE.MeshStandardMaterial, time: number): void {
  const uniform = material.userData.uTerrainMorphTime as { value: number } | undefined;
  if (uniform) uniform.value = time;
}
