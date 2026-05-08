import type { SpellShaderId } from "@/game/spells/modules/spellIds";

export type SpellShaderProgram = {
  vertexShader: string;
  fragmentShader: string;
};

const meshVertexShader = `
varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vPosition = position;
  vNormal = normalize(normalMatrix * normal);

  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentCommon = `
precision highp float;

uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uIntensity;
uniform float uDistortion;
uniform float uSpeed;
uniform float uOpacity;

varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec3 vWorldPosition;

float saturate(float v) {
  return clamp(v, 0.0, 1.0);
}

vec3 saturate3(vec3 v) {
  return clamp(v, vec3(0.0), vec3(1.0));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));

  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;

  for (int i = 0; i < 5; i++) {
    v += noise(p) * a;
    p = mat2(1.62, 1.17, -1.17, 1.62) * p + vec2(13.71, 7.23);
    a *= 0.52;
  }

  return v;
}

vec2 rotate2(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c) * p;
}

vec2 warp2(vec2 p, float t, float amount) {
  float x = fbm(p + vec2(t * 0.17, -t * 0.11));
  float y = fbm(p + vec2(9.2 - t * 0.13, 2.7 + t * 0.19));
  return p + (vec2(x, y) - 0.5) * amount;
}

float ringMask(vec2 uv, float radius, float width) {
  float d = abs(length(uv - 0.5) - radius);
  return 1.0 - smoothstep(width * 0.45, width, d);
}

float radialMask(vec2 uv) {
  return 1.0 - smoothstep(0.04, 0.72, length(uv - 0.5));
}

float softVignette(vec2 uv) {
  vec2 p = uv - 0.5;
  return 1.0 - smoothstep(0.34, 0.76, dot(p, p) * 1.65);
}

float fresnelMask(float power) {
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float facing = max(0.0, dot(normalize(vNormal), viewDir));
  return pow(1.0 - facing, power);
}

float angularRays(vec2 uv, float count, float power, float phase) {
  vec2 p = uv - 0.5;
  float a = atan(p.y, p.x);
  return pow(abs(sin(a * count + phase)), power);
}

float sparkleField(vec2 uv, float scale, float threshold, float t) {
  vec2 grid = floor(uv * scale);
  vec2 cell = fract(uv * scale) - 0.5;
  float seed = hash12(grid);
  float star = 1.0 - smoothstep(0.02, 0.32, length(cell));
  float twinkle = 0.55 + 0.45 * sin(t * (2.0 + seed * 5.0) + seed * 24.0);
  return star * step(threshold, seed) * twinkle;
}

vec3 gradeColor(vec3 color, float glow) {
  vec3 c = saturate3(color);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
  return c + c * glow * 0.16;
}

void emitColor(vec3 color, float alpha, float pulse) {
  vec3 graded = gradeColor(color, pulse);
  float shapedAlpha = clamp(alpha * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(graded * uIntensity * pulse, shapedAlpha);
}
`;

const fragment = (body: string) => `${fragmentCommon}\nvoid main() {\n${body}\n}\n`;

const flameFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = vUv;

  float n1 = fbm(vec2(uv.x * 3.0, uv.y * 6.8) + vec2(0.0, -t * 1.55));
  float n2 = fbm(vec2(uv.x * 7.5, uv.y * 12.0) + vec2(t * 0.28, -t * 2.05));

  float center = 1.0 - smoothstep(0.03, 0.48, abs(uv.x - 0.5) * (1.15 + uv.y * 1.5));
  float rise = smoothstep(0.02, 0.22, uv.y) * (1.0 - smoothstep(0.9, 1.08, uv.y));
  float tongues = smoothstep(0.06, 0.92, uv.y + n1 * uDistortion * 0.85 - abs(uv.x - 0.5) * 0.55);
  float lick = pow(saturate(tongues * center), 1.25) * rise;

  float core = pow(saturate(center * (1.0 - uv.y * 0.62) + n2 * 0.25), 2.2);
  float rim = fresnelMask(1.55);
  float sparks = sparkleField(uv + vec2(0.0, -t * 0.2), 36.0, 0.965, t * 2.4) * smoothstep(0.22, 0.95, uv.y);

  vec3 hot = mix(uColorA, vec3(1.0), core * 0.38);
  vec3 color = mix(hot, uColorB, saturate(lick * 0.72 + n2 * 0.25 + sparks * 0.65));

  float alpha = 0.08 + lick * 0.64 + core * 0.18 + rim * 0.3 + sparks * 0.35;
  emitColor(color, alpha, 0.92 + sin(t * 6.5 + n1 * 4.0) * 0.12 + sparks * 0.45);
`);

const heatHazeFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = warp2(vUv * vec2(4.0, 8.5), t, 0.55);

  float wavesA = fbm(uv + vec2(t * 0.18, -t * 0.86));
  float wavesB = fbm(uv * 1.8 + vec2(-t * 0.12, -t * 1.12));
  float shimmer = pow(abs(sin((vUv.y + wavesA * uDistortion * 0.8) * 28.0 + t * 4.2)), 3.0);
  float mirage = smoothstep(0.35, 0.95, wavesA + wavesB * 0.35);

  float rim = fresnelMask(2.2);
  vec3 color = mix(uColorA, uColorB, saturate(shimmer * 0.26 + rim * 0.75 + mirage * 0.2));
  float alpha = softVignette(vUv) * (0.045 + shimmer * 0.14 + mirage * 0.08) + rim * 0.28;

  emitColor(color, alpha, 0.72 + shimmer * 0.22 + rim * 0.08);
`);

const moltenFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = warp2(vUv * 5.8, t, 0.42);

  float lava = fbm(uv + vec2(t * 0.06, -t * 0.04));
  float lavaFine = fbm(uv * 2.1 - vec2(t * 0.1, t * 0.05));
  float veins = 1.0 - smoothstep(0.035, 0.16, abs(lava - 0.52));
  float hairline = 1.0 - smoothstep(0.02, 0.08, abs(lavaFine - 0.5));
  float pulseRing = ringMask(vUv, 0.27 + sin(t * 0.85) * 0.025, 0.05);
  float outerRing = ringMask(vUv, 0.43, 0.032);
  float rim = fresnelMask(2.15);

  float glow = saturate(veins + hairline * 0.45 + pulseRing * 0.55 + outerRing * 0.35);
  vec3 crust = mix(uColorB * 0.42, uColorB, lava * 0.55);
  vec3 color = mix(crust, uColorA, glow);

  float alpha = 0.24 + veins * 0.55 + hairline * 0.18 + pulseRing * 0.34 + outerRing * 0.22 + rim * 0.2;
  emitColor(color, alpha, 0.9 + glow * 0.42);
`);

const smokeFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 centered = vUv - 0.5;
  vec2 swirl = rotate2(centered, t * 0.16 + length(centered) * 1.4) + 0.5;
  vec2 uv = warp2(swirl * 4.2, t, 0.65);

  float large = fbm(uv + vec2(t * 0.07, -t * 0.2));
  float wisps = fbm(uv * 2.7 + vec2(-t * 0.15, -t * 0.32));
  float curl = pow(saturate(large * 0.85 + wisps * 0.35), 1.35);
  float soft = radialMask(vUv) * softVignette(vUv);
  float liftFade = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.95, 1.08, vUv.y));
  float rim = fresnelMask(1.9);

  vec3 color = mix(uColorA, uColorB, saturate(curl * 0.72 + rim * 0.18));
  float alpha = soft * liftFade * (0.08 + curl * 0.48) + rim * 0.13;

  emitColor(color, alpha, 0.68 + curl * 0.28);
`);

const flashFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 p = vUv - 0.5;
  float r = length(p);

  float pulse = 0.55 + 0.45 * sin(t * 11.5);
  float core = 1.0 - smoothstep(0.02, 0.36, r);
  float bloom = 1.0 - smoothstep(0.16, 0.74, r);
  float raysA = angularRays(vUv, 8.0, 12.0, t * 3.8);
  float raysB = angularRays(vUv, 13.0, 20.0, -t * 2.1);
  float rays = (raysA * 0.65 + raysB * 0.35) * smoothstep(0.08, 0.55, r);
  float rim = fresnelMask(1.18);

  vec3 color = mix(uColorA, uColorB, saturate(rays * 0.8 + pulse * 0.32 + rim * 0.45));
  float alpha = core * 0.74 + bloom * 0.22 + rays * 0.42 + rim * 0.34;

  emitColor(color, alpha, 1.18 + pulse * 0.56 + core * 0.26);
`);

const shockwaveFragment = fragment(`
  float t = uTime * uSpeed;
  float outward = fract(t * 0.42);

  float waveA = ringMask(vUv, mix(0.1, 0.56, outward), 0.06) * (1.0 - outward * 0.22);
  float waveB = ringMask(vUv, mix(0.16, 0.62, fract(outward + 0.43)), 0.035);
  float wake = ringMask(vUv, mix(0.08, 0.5, fract(outward + 0.18)), 0.09) * 0.34;
  float fineRipples = ringMask(vUv, 0.36 + sin(t * 1.3) * 0.012, 0.022);
  float rippleNoise = fbm(vUv * 9.0 + vec2(t * 0.25, -t * 0.1));

  float ripple = (waveA + waveB + wake + fineRipples * 0.55) * (0.72 + rippleNoise * 0.35);
  float rim = fresnelMask(2.0);
  vec3 color = mix(uColorA, uColorB, saturate(radialMask(vUv) * 0.34 + ripple * 0.5 + rim * 0.4));
  float alpha = ripple * 0.68 + rim * 0.15;

  emitColor(color, alpha, 0.95 + ripple * 0.5);
`);

const holyFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 centered = vUv - 0.5;
  float r = length(centered);

  float beamsA = angularRays(vUv, 9.0, 5.5, t * 1.35);
  float beamsB = angularRays(vUv, 15.0, 10.0, -t * 0.75) * 0.45;
  float beams = (beamsA + beamsB) * (1.0 - smoothstep(0.08, 0.74, r));
  float halo = ringMask(vUv, 0.31 + sin(t * 0.45) * 0.012, 0.075);
  float innerGlow = radialMask(vUv) * 0.46;
  float motes = sparkleField(vUv + vec2(0.0, -t * 0.035), 38.0, 0.955, t * 1.6);
  float rim = fresnelMask(1.65);

  vec3 color = mix(uColorA, uColorB, saturate(beams * 0.58 + motes * 0.9 + halo * 0.28));
  float alpha = halo * 0.48 + innerGlow * 0.35 + beams * 0.25 + motes * 0.48 + rim * 0.32;

  emitColor(color, alpha, 0.96 + beams * 0.22 + motes * 0.36);
`);

const lightningFragment = fragment(`
  float t = uTime * uSpeed;
  float jagA = noise(vec2(vUv.x * 12.0, t * 2.1)) - 0.5;
  float jagB = noise(vec2(vUv.x * 27.0 + 6.0, t * 3.4)) - 0.5;
  float path = 0.5 + sin(vUv.x * 15.5 + t * 8.0) * 0.055 + jagA * 0.22 + jagB * 0.08;

  float boltCore = 1.0 - smoothstep(0.0, 0.026, abs(vUv.y - path));
  float boltGlow = 1.0 - smoothstep(0.0, 0.12, abs(vUv.y - path));

  float branchPathA = path + sin(vUv.x * 31.0 - t * 6.0) * 0.19;
  float branchPathB = path - sin(vUv.x * 26.0 + t * 5.0) * 0.15;
  float branchMaskA = step(0.58, noise(vec2(vUv.x * 8.0, floor(t * 7.0))));
  float branchMaskB = step(0.66, noise(vec2(vUv.x * 10.0 + 4.0, floor(t * 6.0))));
  float branchA = (1.0 - smoothstep(0.0, 0.034, abs(vUv.y - branchPathA))) * branchMaskA;
  float branchB = (1.0 - smoothstep(0.0, 0.03, abs(vUv.y - branchPathB))) * branchMaskB;

  float arcs = max(boltCore, max(branchA, branchB));
  float glow = max(boltGlow * 0.42, arcs);
  float rim = fresnelMask(1.35);

  vec3 color = mix(uColorB, uColorA, saturate(arcs + rim * 0.45));
  float alpha = arcs * 0.88 + glow * 0.34 + rim * 0.26;

  emitColor(color, alpha, 1.05 + arcs * 0.92 + sin(t * 18.0) * 0.08);
`);

const frostFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = vUv;

  vec2 grid = fract(uv * 7.5);
  vec2 distToEdge = min(grid, 1.0 - grid);
  float edge = 1.0 - smoothstep(0.0, 0.075, min(distToEdge.x, distToEdge.y));

  float facetNoise = noise(floor(uv * 7.5)) * 0.58;
  float crystal = fbm(uv * 12.0 + vec2(t * 0.035, -t * 0.025));
  float snowflake = angularRays(uv, 6.0, 14.0, crystal * 1.8) * ringMask(uv, 0.29, 0.18);
  float sparkle = sparkleField(uv + vec2(t * 0.01), 44.0, 0.965, t * 1.2);
  float rim = fresnelMask(1.18);

  float facets = saturate(edge * 0.5 + facetNoise + crystal * 0.24 + snowflake * 0.42);
  vec3 color = mix(uColorA, uColorB, saturate(facets + sparkle * 0.65 + rim * 0.35));
  float alpha = 0.22 + facets * 0.42 + snowflake * 0.2 + sparkle * 0.36 + rim * 0.46;

  emitColor(color, alpha, 0.88 + sparkle * 0.42 + crystal * 0.18);
`);

const waterFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = warp2(vUv * 3.8, t, 0.18);

  float rings = 0.0;
  rings += ringMask(vUv, fract(t * 0.19) * 0.52 + 0.06, 0.044);
  rings += ringMask(vUv, fract(t * 0.19 + 0.39) * 0.52 + 0.06, 0.034);
  rings += ringMask(vUv, 0.32 + sin(t * 0.8) * 0.018, 0.022) * 0.35;

  float waveX = sin((uv.x + fbm(uv * 1.9 + vec2(t * 0.15))) * 19.0 + t * 1.4);
  float waveY = sin((uv.y - t * 0.13 + fbm(uv * 2.3)) * 17.0);
  float caustics = pow(abs(waveX * waveY), 2.15);
  float foam = smoothstep(0.52, 0.92, caustics) * radialMask(vUv);
  float rim = fresnelMask(1.85);

  vec3 color = mix(uColorA, uColorB, saturate(rings * 0.62 + caustics * 0.28 + rim * 0.38));
  float alpha = rings * 0.5 + caustics * 0.18 + foam * 0.18 + rim * 0.34;

  emitColor(color, alpha, 0.86 + rings * 0.36 + foam * 0.18);
`);

const earthFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = vUv;

  float grain = fbm(uv * 14.0 + vec2(t * 0.035, t * 0.02));
  float fine = fbm(uv * 31.0 - vec2(t * 0.025, 0.0));
  float strata = smoothstep(0.38, 0.62, sin((uv.y + grain * 0.11) * 30.0 + fine * 1.2));
  float cracks = 1.0 - smoothstep(0.04, 0.13, abs(fbm(uv * 7.0) - 0.5));
  float dust = sparkleField(uv + vec2(t * 0.015, t * 0.02), 28.0, 0.93, t * 0.9);
  float rim = fresnelMask(2.15);

  vec3 base = mix(uColorA, uColorB, saturate(grain * 0.62 + strata * 0.26));
  vec3 color = mix(base, uColorB, cracks * 0.22 + dust * 0.18);
  float alpha = 0.28 + grain * 0.3 + strata * 0.18 + cracks * 0.16 + dust * 0.24 + rim * 0.13;

  emitColor(color, alpha, 0.74 + dust * 0.28 + cracks * 0.12);
`);

const darkFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 centered = vUv - 0.5;
  float r = length(centered);

  vec2 swirl = rotate2(centered, t * 0.72 + r * 6.4) + 0.5;
  vec2 warped = warp2(swirl * 5.6, t, 0.36);
  float voidNoise = fbm(warped - vec2(t * 0.12, t * 0.22));
  float tendrilA = angularRays(vUv + (voidNoise - 0.5) * 0.08, 5.0, 8.0, -t * 2.3 + voidNoise * 5.5);
  float tendrilB = angularRays(vUv, 9.0, 16.0, t * 1.1 + voidNoise * 2.0) * 0.45;
  float well = 1.0 - smoothstep(0.07, 0.72, r);
  float eclipse = smoothstep(0.12, 0.28, r) * (1.0 - smoothstep(0.58, 0.76, r));
  float rim = fresnelMask(1.5);

  float tendril = (tendrilA + tendrilB) * well;
  vec3 color = mix(uColorB * 0.62, uColorA, saturate(tendril * 0.82 + voidNoise * 0.38 + rim * 0.32));
  float alpha = well * 0.36 + eclipse * 0.1 + tendril * 0.32 + rim * 0.36;

  emitColor(color, alpha, 0.8 + tendril * 0.42);
`);

const cosmicFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 centered = vUv - 0.5;
  float r = length(centered);

  vec2 spiralUv = rotate2(centered, t * 0.16 + r * 4.8) * vec2(1.0, 0.58) + 0.5;
  float nebula = fbm(spiralUv * 6.8 + vec2(t * 0.025, -t * 0.018));
  float dust = fbm(spiralUv * 13.0 - vec2(t * 0.02, t * 0.012));
  float galaxy = smoothstep(0.28, 0.86, nebula + dust * 0.28) * (1.0 - smoothstep(0.06, 0.68, r));

  float starsNear = sparkleField(vUv + vec2(t * 0.006, -t * 0.004), 46.0, 0.966, t * 1.7);
  float starsFar = sparkleField(vUv - vec2(t * 0.003, t * 0.002), 74.0, 0.983, t * 1.1) * 0.6;
  float ring = ringMask(vUv, 0.33 + sin(t * 0.62) * 0.026, 0.046);
  float lens = 1.0 - smoothstep(0.04, 0.55, r);
  float rim = fresnelMask(1.36);

  vec3 color = mix(uColorB, uColorA, saturate(galaxy * 0.7 + starsNear + starsFar + ring * 0.52 + rim * 0.28));
  float alpha = lens * 0.26 + galaxy * 0.28 + starsNear * 0.88 + starsFar * 0.58 + ring * 0.48 + rim * 0.27;

  emitColor(color, alpha, 0.86 + starsNear * 0.75 + ring * 0.24);
`);

const toxicFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = vUv + vec2(
    sin(t * 0.9 + vUv.y * 9.0),
    cos(t * 0.64 + vUv.x * 8.0)
  ) * 0.027 * max(0.25, uDistortion);

  vec2 cell = floor(uv * 8.5);
  vec2 local = fract(uv * 8.5) - 0.5;
  float seed = hash12(cell);

  vec2 wobble = vec2(sin(seed * 6.0 + t * 1.2), cos(seed * 5.0 - t * 0.9)) * 0.14;
  float bubbleCore = 1.0 - smoothstep(0.08, 0.19, length(local + wobble));
  float bubbleRim = ringMask(fract(uv * 8.5), 0.23 + sin(seed * 12.0 + t) * 0.025, 0.052);
  float slime = fbm(warp2(uv * 4.8, t, 0.24) + vec2(0.0, -t * 0.22));
  float veins = 1.0 - smoothstep(0.06, 0.19, abs(slime - 0.55));
  float rim = fresnelMask(1.75);

  float toxicGlow = saturate(bubbleCore + bubbleRim * 0.42 + veins * 0.4 + slime * 0.24);
  vec3 color = mix(uColorB, uColorA, toxicGlow);
  float alpha = 0.2 + slime * 0.32 + bubbleCore * 0.44 + bubbleRim * 0.18 + veins * 0.16 + rim * 0.24;

  emitColor(color, alpha, 0.82 + bubbleCore * 0.38 + veins * 0.18);
`);

const runeFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 centered = vUv - 0.5;
  float r = length(centered);
  float a = atan(centered.y, centered.x);

  float ringA = ringMask(vUv, 0.23, 0.026);
  float ringB = ringMask(vUv, 0.42, 0.024);
  float ringC = ringMask(vUv, 0.32 + sin(t * 0.4) * 0.012, 0.014);
  float spokes = pow(abs(sin(a * 6.0 + t * 0.22)), 22.0) * smoothstep(0.14, 0.47, r) * (1.0 - smoothstep(0.47, 0.54, r));

  vec2 glyphGrid = floor(rotate2(centered, t * 0.08) * 10.0 + 0.5);
  float glyphSeed = hash12(glyphGrid);
  float glyphMask = step(0.72, glyphSeed) * smoothstep(0.16, 0.5, r) * (1.0 - smoothstep(0.49, 0.62, r));
  float glyphPulse = 0.55 + 0.45 * sin(t * 2.4 + glyphSeed * 18.0);
  float glyphs = glyphMask * glyphPulse;

  float sigil = ringA + ringB + ringC * 0.7 + spokes + glyphs * 0.5;
  float rim = fresnelMask(1.95);

  vec3 color = mix(uColorA, uColorB, saturate(glyphs * 0.54 + ringC * 0.24 + sin(t * 0.8) * 0.08 + 0.1));
  float alpha = sigil * 0.62 + radialMask(vUv) * 0.08 + rim * 0.18;

  emitColor(color, alpha, 0.86 + sigil * 0.28);
`);

const glowFragment = fragment(`
  float t = uTime * uSpeed;
  float pulse = 0.5 + 0.5 * sin(t * 2.7);
  float breath = 0.5 + 0.5 * sin(t * 1.17 + fbm(vUv * 3.0) * 2.0);
  float soft = radialMask(vUv);
  float inner = 1.0 - smoothstep(0.02, 0.34, length(vUv - 0.5));
  float halo = 1.0 - smoothstep(0.16, 0.78, length(vUv - 0.5));
  float rim = fresnelMask(1.42);

  vec3 color = mix(uColorA, uColorB, saturate(pulse * 0.32 + rim * 0.55 + inner * 0.15));
  float alpha = soft * 0.24 + halo * 0.18 + inner * 0.16 + rim * 0.46;

  emitColor(color, alpha, 0.76 + pulse * 0.22 + breath * 0.12);
`);

const dissolveFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = warp2(vUv * 7.6, t, 0.34);

  float field = fbm(uv + vec2(t * 0.09, -t * 0.07));
  float fine = fbm(uv * 2.4 - vec2(t * 0.12, t * 0.04));
  float threshold = 0.36 + 0.24 * sin(t * 0.82);
  float edge = 1.0 - smoothstep(0.0, 0.075, abs(field - threshold));
  float emberEdge = 1.0 - smoothstep(0.0, 0.045, abs(fine - threshold));
  float body = smoothstep(threshold - 0.2, threshold + 0.24, field);
  float ash = smoothstep(threshold + 0.08, threshold + 0.36, field) * softVignette(vUv);
  float rim = fresnelMask(1.68);

  float glow = saturate(edge + emberEdge * 0.32);
  vec3 color = mix(uColorB, uColorA, saturate(glow + body * 0.22));
  float alpha = body * 0.3 + ash * 0.1 + edge * 0.45 + emberEdge * 0.14 + rim * 0.2;

  emitColor(color, alpha, 0.72 + glow * 0.6);
`);

type ShaderFamily =
  | "flame"
  | "heat_haze"
  | "molten"
  | "smoke"
  | "flash"
  | "shockwave"
  | "holy"
  | "lightning"
  | "frost"
  | "water"
  | "earth"
  | "dark"
  | "cosmic"
  | "toxic"
  | "rune"
  | "glow"
  | "dissolve";

const families: Record<ShaderFamily, SpellShaderProgram> = {
  flame: { vertexShader: meshVertexShader, fragmentShader: flameFragment },
  heat_haze: { vertexShader: meshVertexShader, fragmentShader: heatHazeFragment },
  molten: { vertexShader: meshVertexShader, fragmentShader: moltenFragment },
  smoke: { vertexShader: meshVertexShader, fragmentShader: smokeFragment },
  flash: { vertexShader: meshVertexShader, fragmentShader: flashFragment },
  shockwave: { vertexShader: meshVertexShader, fragmentShader: shockwaveFragment },
  holy: { vertexShader: meshVertexShader, fragmentShader: holyFragment },
  lightning: { vertexShader: meshVertexShader, fragmentShader: lightningFragment },
  frost: { vertexShader: meshVertexShader, fragmentShader: frostFragment },
  water: { vertexShader: meshVertexShader, fragmentShader: waterFragment },
  earth: { vertexShader: meshVertexShader, fragmentShader: earthFragment },
  dark: { vertexShader: meshVertexShader, fragmentShader: darkFragment },
  cosmic: { vertexShader: meshVertexShader, fragmentShader: cosmicFragment },
  toxic: { vertexShader: meshVertexShader, fragmentShader: toxicFragment },
  rune: { vertexShader: meshVertexShader, fragmentShader: runeFragment },
  glow: { vertexShader: meshVertexShader, fragmentShader: glowFragment },
  dissolve: { vertexShader: meshVertexShader, fragmentShader: dissolveFragment },
};

export const shaderProgramFamilyById: Record<SpellShaderId, ShaderFamily> = {
  flame_core: "flame",
  ember_shell: "flame",
  heat_haze: "heat_haze",
  molten_crack: "molten",
  ember_trail: "flame",
  smoke_fire_trail: "smoke",
  comet_flame_trail: "flame",
  blast_flash: "flash",
  shockwave_ring: "shockwave",
  smoke_plume: "smoke",
  sparks_burst: "flash",
  holy_radiance: "holy",
  halo_ring: "holy",
  sunbeam_core: "holy",
  blinding_flash: "flash",
  arcane_shimmer: "cosmic",
  forcefield_ripple: "water",
  mana_glass: "frost",
  ward_barrier: "holy",
  plasma_arc: "lightning",
  storm_core: "lightning",
  chain_bolt: "lightning",
  electric_noise: "lightning",
  frost_crystal: "frost",
  ice_glass: "frost",
  water_ripple: "water",
  mist_shell: "smoke",
  dust_cloud: "earth",
  stone_rune: "earth",
  moss_glow: "toxic",
  sand_burst: "earth",
  void_swirl: "dark",
  shadow_smoke: "dark",
  necrotic_decay: "dark",
  life_leech_tendril: "dark",
  starfield_core: "cosmic",
  gravity_lens: "cosmic",
  meteor_ember: "flame",
  cosmic_impact_ring: "shockwave",
  toxic_bubble: "toxic",
  acid_sizzle: "toxic",
  spore_cloud: "toxic",
  thorn_glow: "toxic",
  soft_glow: "glow",
  additive_sprite: "glow",
  ground_rune: "rune",
  dissolve_fade: "dissolve",
};

export function getSpellShaderProgram(shaderId: SpellShaderId): SpellShaderProgram {
  return families[shaderProgramFamilyById[shaderId]];
}

export const particleVertexShader = `
precision highp float;

uniform float uTime;
uniform float uPointSize;
uniform float uSpeed;

attribute float aSeed;

varying float vSeed;
varying float vFlicker;
varying float vDepthFade;

void main() {
  vSeed = aSeed;

  float flutter = sin(uTime * uSpeed * (1.6 + aSeed * 3.8) + aSeed * 21.0);
  float slowPulse = sin(uTime * uSpeed * 0.65 + aSeed * 11.0);
  vFlicker = 0.72 + 0.2 * flutter + 0.08 * slowPulse;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float perspective = 90.0 / max(1.0, -mvPosition.z);
  vDepthFade = smoothstep(0.0, 1.0, perspective * 0.06);

  gl_PointSize = uPointSize * perspective * (0.86 + aSeed * 0.28);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const particleFragmentShader = `
precision highp float;

uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uIntensity;
uniform float uOpacity;
uniform float uTime;

varying float vSeed;
varying float vFlicker;
varying float vDepthFade;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);

  float core = 1.0 - smoothstep(0.02, 0.18, d);
  float halo = 1.0 - smoothstep(0.12, 0.5, d);

  float rayX = 1.0 - smoothstep(0.0, 0.045, abs(p.x));
  float rayY = 1.0 - smoothstep(0.0, 0.045, abs(p.y));
  float rayFalloff = 1.0 - smoothstep(0.08, 0.5, d);
  float starRay = max(rayX, rayY) * rayFalloff * 0.32;

  float sparkleSeed = hash12(gl_PointCoord * 18.0 + vec2(vSeed, floor(uTime * 6.0)));
  float sparkle = step(0.88, sparkleSeed) * (1.0 - smoothstep(0.08, 0.46, d));

  vec3 color = mix(uColorA, uColorB, clamp(core * 0.36 + sparkle * 0.7 + starRay * 0.35, 0.0, 1.0));
  float alpha = (core * 0.76 + halo * 0.32 + starRay * 0.26 + sparkle * 0.22) * vFlicker * vDepthFade;

  if (alpha * uOpacity <= 0.01) discard;

  gl_FragColor = vec4(color * uIntensity * (0.82 + core * 0.24 + sparkle * 0.58), alpha * uOpacity);
}
`;
