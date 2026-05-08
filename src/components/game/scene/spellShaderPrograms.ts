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
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += noise(p) * a;
    p = p * 2.03 + vec2(19.17, 7.31);
    a *= 0.5;
  }
  return v;
}

vec2 rotate2(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c) * p;
}

float ringMask(vec2 uv, float radius, float width) {
  float d = abs(length(uv - 0.5) - radius);
  return 1.0 - smoothstep(width * 0.45, width, d);
}

float fresnelMask(float power) {
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  return pow(1.0 - max(0.0, dot(normalize(vNormal), viewDir)), power);
}

float radialMask(vec2 uv) {
  return 1.0 - smoothstep(0.05, 0.72, length(uv - 0.5));
}

void emitColor(vec3 color, float alpha, float pulse) {
  gl_FragColor = vec4(color * uIntensity * pulse, clamp(alpha * uOpacity, 0.0, 1.0));
}
`;

const fragment = (body: string) => `${fragmentCommon}\nvoid main() {\n${body}\n}\n`;

const flameFragment = fragment(`
  float t = uTime * uSpeed;
  float n = fbm(vUv * vec2(3.0, 7.0) + vec2(0.0, -t * 1.7));
  float tongues = smoothstep(0.15, 1.0, vUv.y + n * uDistortion);
  float emberGrid = hash12(floor(vUv * 30.0) + vec2(floor(t * 8.0)));
  float embers = step(0.94, emberGrid) * smoothstep(0.15, 0.85, vUv.y);
  float rim = fresnelMask(1.7);
  vec3 color = mix(uColorA, uColorB, clamp(tongues + embers * 0.6, 0.0, 1.0));
  float alpha = 0.24 + tongues * 0.5 + rim * 0.36 + embers * 0.35;
  emitColor(color, alpha, 0.9 + sin(t * 7.0 + n * 4.0) * 0.16);
`);

const heatHazeFragment = fragment(`
  float t = uTime * uSpeed;
  float waves = fbm(vUv * vec2(7.0, 11.0) + vec2(t * 0.2, -t * 0.9));
  float shimmer = abs(sin((vUv.y + waves * uDistortion) * 24.0 + t * 5.0));
  vec3 color = mix(uColorA, uColorB, clamp(shimmer * 0.35 + fresnelMask(2.4), 0.0, 1.0));
  float alpha = (0.08 + shimmer * 0.18 + fresnelMask(2.0) * 0.32) * (0.8 + waves * 0.6);
  emitColor(color, alpha, 0.75 + shimmer * 0.2);
`);

const moltenFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = vUv * 7.0;
  float cells = fbm(uv + vec2(t * 0.08, -t * 0.05));
  float cracks = 1.0 - smoothstep(0.06, 0.18, abs(cells - 0.52));
  float rings = ringMask(vUv, 0.26 + sin(t) * 0.025, 0.045) + ringMask(vUv, 0.42, 0.035);
  vec3 color = mix(uColorB, uColorA, clamp(cracks + rings * 0.5, 0.0, 1.0));
  float alpha = 0.28 + cracks * 0.58 + rings * 0.35 + fresnelMask(2.2) * 0.18;
  emitColor(color, alpha, 0.95 + cracks * 0.35);
`);

const smokeFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = rotate2(vUv - 0.5, t * 0.25) + vec2(0.5);
  float billow = fbm(uv * 5.5 + vec2(t * 0.12, -t * 0.22));
  float soft = radialMask(vUv);
  vec3 color = mix(uColorA, uColorB, billow);
  float alpha = soft * (0.18 + billow * 0.55) + fresnelMask(1.9) * 0.16;
  emitColor(color, alpha, 0.75 + billow * 0.3);
`);

const flashFragment = fragment(`
  float t = uTime * uSpeed;
  float pulse = 0.55 + 0.45 * sin(t * 12.0);
  float core = radialMask(vUv);
  float rays = pow(abs(sin(atan(vUv.y - 0.5, vUv.x - 0.5) * 8.0 + t * 4.0)), 12.0);
  float rim = fresnelMask(1.2);
  vec3 color = mix(uColorA, uColorB, clamp(rays + pulse * 0.35, 0.0, 1.0));
  float alpha = core * 0.58 + rays * 0.45 + rim * 0.42;
  emitColor(color, alpha, 1.25 + pulse * 0.55);
`);

const shockwaveFragment = fragment(`
  float t = uTime * uSpeed;
  float outward = fract(t * 0.45);
  float waveA = ringMask(vUv, mix(0.12, 0.52, outward), 0.055);
  float waveB = ringMask(vUv, mix(0.2, 0.58, fract(outward + 0.45)), 0.035);
  float ripple = waveA + waveB + ringMask(vUv, 0.36, 0.025);
  vec3 color = mix(uColorA, uColorB, radialMask(vUv));
  float alpha = ripple * 0.75 + fresnelMask(2.0) * 0.15;
  emitColor(color, alpha, 1.0 + ripple * 0.45);
`);

const holyFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 centered = vUv - 0.5;
  float angle = atan(centered.y, centered.x);
  float beams = pow(abs(sin(angle * 9.0 + t * 1.7)), 5.0);
  float halo = ringMask(vUv, 0.32, 0.07) + radialMask(vUv) * 0.4;
  float motes = step(0.965, hash12(floor(vUv * 34.0) + vec2(floor(t * 3.0))));
  vec3 color = mix(uColorA, uColorB, clamp(beams * 0.65 + motes, 0.0, 1.0));
  float alpha = halo * 0.56 + beams * 0.22 + motes * 0.45 + fresnelMask(1.8) * 0.32;
  emitColor(color, alpha, 1.0 + beams * 0.25);
`);

const lightningFragment = fragment(`
  float t = uTime * uSpeed;
  float path = 0.5 + sin(vUv.x * 16.0 + t * 8.0) * 0.08 + (noise(vec2(vUv.x * 12.0, t * 2.0)) - 0.5) * 0.25;
  float bolt = 1.0 - smoothstep(0.0, 0.055, abs(vUv.y - path));
  float branches = 1.0 - smoothstep(0.0, 0.035, abs(vUv.y - (path + sin(vUv.x * 32.0 - t * 7.0) * 0.22)));
  float arcs = max(bolt, branches * step(0.56, noise(vec2(vUv.x * 8.0, t))));
  vec3 color = mix(uColorB, uColorA, arcs);
  float alpha = arcs * 0.85 + fresnelMask(1.4) * 0.35;
  emitColor(color, alpha, 1.15 + arcs * 0.7);
`);

const frostFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 cells = fract(vUv * 7.0);
  float edgeX = 1.0 - smoothstep(0.0, 0.08, min(cells.x, 1.0 - cells.x));
  float edgeY = 1.0 - smoothstep(0.0, 0.08, min(cells.y, 1.0 - cells.y));
  float facets = noise(floor(vUv * 7.0)) * 0.65 + max(edgeX, edgeY) * 0.45;
  float frost = fbm(vUv * 11.0 + vec2(t * 0.08));
  vec3 color = mix(uColorA, uColorB, clamp(facets + frost * 0.3, 0.0, 1.0));
  float alpha = 0.32 + facets * 0.42 + fresnelMask(1.25) * 0.42;
  emitColor(color, alpha, 0.9 + frost * 0.25);
`);

const waterFragment = fragment(`
  float t = uTime * uSpeed;
  float rings = 0.0;
  rings += ringMask(vUv, fract(t * 0.22) * 0.5 + 0.08, 0.045);
  rings += ringMask(vUv, fract(t * 0.22 + 0.45) * 0.5 + 0.08, 0.035);
  float caustics = pow(abs(sin((vUv.x + fbm(vUv * 4.0 + vec2(t))) * 18.0) * sin((vUv.y - t * 0.15) * 16.0)), 2.0);
  vec3 color = mix(uColorA, uColorB, clamp(rings + caustics * 0.35, 0.0, 1.0));
  float alpha = rings * 0.55 + caustics * 0.22 + fresnelMask(1.9) * 0.32;
  emitColor(color, alpha, 0.9 + rings * 0.35);
`);

const earthFragment = fragment(`
  float t = uTime * uSpeed;
  float grain = fbm(vUv * 13.0 + vec2(0.0, t * 0.05));
  float strata = smoothstep(0.42, 0.58, sin((vUv.y + grain * 0.12) * 28.0));
  float dust = step(0.91, hash12(floor(vUv * 24.0) + vec2(floor(t * 2.0))));
  vec3 color = mix(uColorA, uColorB, clamp(grain * 0.65 + strata * 0.25, 0.0, 1.0));
  float alpha = 0.34 + grain * 0.34 + strata * 0.2 + dust * 0.24 + fresnelMask(2.2) * 0.12;
  emitColor(color, alpha, 0.78 + dust * 0.32);
`);

const darkFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 centered = vUv - 0.5;
  float r = length(centered);
  vec2 swirl = rotate2(centered, t * 0.8 + r * 5.5) + vec2(0.5);
  float voidNoise = fbm(swirl * 6.0 - vec2(t * 0.15, t * 0.25));
  float tendril = pow(abs(sin(atan(centered.y, centered.x) * 5.0 + voidNoise * 6.0 - t * 2.5)), 8.0);
  vec3 color = mix(uColorB, uColorA, clamp(tendril + voidNoise * 0.45, 0.0, 1.0));
  float alpha = (1.0 - smoothstep(0.08, 0.72, r)) * 0.42 + tendril * 0.34 + fresnelMask(1.6) * 0.38;
  emitColor(color, alpha, 0.85 + tendril * 0.35);
`);

const cosmicFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 centered = vUv - 0.5;
  float lens = 1.0 - smoothstep(0.04, 0.56, length(centered));
  float stars = step(0.975, hash12(floor((vUv + vec2(t * 0.01)) * 42.0)));
  float galaxy = fbm(rotate2(centered, t * 0.18 + length(centered) * 3.0) * 7.0 + vec2(0.5));
  float ring = ringMask(vUv, 0.33 + sin(t * 0.7) * 0.03, 0.045);
  vec3 color = mix(uColorB, uColorA, clamp(galaxy * 0.45 + stars + ring * 0.5, 0.0, 1.0));
  float alpha = lens * 0.34 + galaxy * 0.28 + stars * 0.9 + ring * 0.5 + fresnelMask(1.4) * 0.28;
  emitColor(color, alpha, 0.9 + stars * 0.8 + ring * 0.25);
`);

const toxicFragment = fragment(`
  float t = uTime * uSpeed;
  vec2 uv = vUv + vec2(sin(t + vUv.y * 9.0), cos(t * 0.7 + vUv.x * 8.0)) * 0.025;
  vec2 cell = floor(uv * 8.0);
  vec2 local = fract(uv * 8.0) - 0.5;
  float seed = hash12(cell);
  float bubbles = 1.0 - smoothstep(0.13, 0.22, length(local + vec2(sin(seed * 6.0 + t), cos(seed * 5.0 - t)) * 0.12));
  float slime = fbm(uv * 5.0 + vec2(0.0, -t * 0.25));
  vec3 color = mix(uColorB, uColorA, clamp(bubbles + slime * 0.45, 0.0, 1.0));
  float alpha = 0.24 + slime * 0.34 + bubbles * 0.48 + fresnelMask(1.8) * 0.24;
  emitColor(color, alpha, 0.85 + bubbles * 0.35);
`);

const runeFragment = fragment(`
  float t = uTime * uSpeed;
  float ringA = ringMask(vUv, 0.24, 0.03);
  float ringB = ringMask(vUv, 0.42, 0.025);
  float spokes = pow(abs(sin(atan(vUv.y - 0.5, vUv.x - 0.5) * 6.0)), 18.0) * smoothstep(0.15, 0.48, length(vUv - 0.5));
  float glyphs = step(0.82, fbm(floor(vUv * 9.0) + vec2(t * 0.05)));
  float mark = ringA + ringB + spokes + glyphs * 0.45;
  vec3 color = mix(uColorA, uColorB, clamp(glyphs * 0.5 + sin(t) * 0.15, 0.0, 1.0));
  float alpha = mark * 0.62 + fresnelMask(2.0) * 0.18;
  emitColor(color, alpha, 0.9 + mark * 0.25);
`);

const glowFragment = fragment(`
  float t = uTime * uSpeed;
  float pulse = 0.5 + 0.5 * sin(t * 3.0);
  float soft = radialMask(vUv);
  float rim = fresnelMask(1.45);
  vec3 color = mix(uColorA, uColorB, clamp(pulse * 0.4 + rim * 0.5, 0.0, 1.0));
  float alpha = soft * 0.36 + rim * 0.5;
  emitColor(color, alpha, 0.8 + pulse * 0.35);
`);

const dissolveFragment = fragment(`
  float t = uTime * uSpeed;
  float field = fbm(vUv * 8.0 + vec2(t * 0.12, -t * 0.08));
  float threshold = 0.35 + 0.25 * sin(t * 0.9);
  float edge = 1.0 - smoothstep(0.0, 0.08, abs(field - threshold));
  float body = smoothstep(threshold - 0.18, threshold + 0.28, field);
  vec3 color = mix(uColorB, uColorA, clamp(edge + body * 0.35, 0.0, 1.0));
  float alpha = body * 0.34 + edge * 0.48 + fresnelMask(1.7) * 0.2;
  emitColor(color, alpha, 0.75 + edge * 0.55);
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

void main() {
  vSeed = aSeed;
  vFlicker = 0.75 + 0.25 * sin(uTime * uSpeed * (2.0 + aSeed * 4.0) + aSeed * 19.0);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uPointSize * (80.0 / max(1.0, -mvPosition.z));
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

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float core = 1.0 - smoothstep(0.04, 0.22, d);
  float halo = 1.0 - smoothstep(0.18, 0.5, d);
  float sparkle = step(0.86, hash12(gl_PointCoord * 16.0 + vec2(vSeed, uTime * 0.2)));
  vec3 color = mix(uColorA, uColorB, clamp(sparkle * 0.55 + core * 0.25, 0.0, 1.0));
  float alpha = (core * 0.75 + halo * 0.35 + sparkle * 0.2) * vFlicker;
  gl_FragColor = vec4(color * uIntensity * (0.85 + sparkle * 0.6), alpha * uOpacity);
}
`;
