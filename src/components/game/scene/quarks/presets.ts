// Quarks preset catalog
// -----------------------------------------------------------------------------
// Each preset is a pure factory that returns a configured ParticleSystem
// (NOT yet added to a renderer or scene). The QuarksEmitterNode component is
// responsible for:
//   - calling the factory
//   - registering with the BatchedRenderer
//   - mounting `system.emitter` into the R3F graph
//   - cleanup on unmount
//
// Presets are intentionally code-defined (not JSON) so we can:
//   - share alignment palettes from src/game/spells/modules/alignments.ts
//   - tune values inline next to the spell composer
//   - get full TypeScript autocomplete on three.quarks types
//
// LOD: each preset declares a `budgetWeight` (1.0 = baseline). The total
// budget is gated externally (Phase 2: QUARKS_BUDGET=800). Presets that exceed
// the remaining budget are downgraded by scaling `maxParticle` and
// `emissionOverTime`.

import * as THREE from "three";
import {
  ApplyForce,
  Bezier,
  ColorOverLife,
  ConeEmitter,
  ConstantColor,
  ConstantValue,
  type EmitterShape,
  FrameOverLife,
  Gradient,
  IntervalValue,
  ParticleSystem,
  PiecewiseBezier,
  RandomColor,
  RenderMode,
  SizeOverLife,
  SphereEmitter,
  Vector3 as QVector3,
  Vector4 as QVector4,
} from "three.quarks";

// ---------- shared helpers ----------

const VFX_TEX_BASE = "/textures/vfx/";

/**
 * Builds a 1x1 white canvas used as a synchronous fallback image. A canvas
 * (rather than DataTexture) lets us assign HTMLImageElement back into the
 * same `Texture.image` slot once the real PNG loads.
 */
function makeFallbackCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
  }
  return c;
}

const _textureCache = new Map<string, THREE.Texture>();
const _loader = new THREE.TextureLoader();

/**
 * Load a VFX PNG from /public/textures/vfx/.
 *
 * IMPORTANT: We return a Texture that is ALWAYS uploadable from frame 0.
 * three.quarks' BatchedRenderer triggers texSubImage2D as soon as the
 * material is bound; if `texture.image` is undefined (i.e. the network
 * fetch hasn't resolved yet, or the file is missing), WebGL2 overload
 * resolution fails with `Failed to execute 'texSubImage2D'`.
 *
 * To avoid that, we initialize the texture with a 1x1 white canvas
 * synchronously, then asynchronously load the PNG and swap `.image` +
 * mark `needsUpdate` once it's ready. If the load fails the white pixel
 * remains, which is visually a benign no-op.
 */
export function loadVfxTexture(
  filename: string,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace,
): THREE.Texture {
  const cached = _textureCache.get(filename);
  if (cached) return cached;

  // SSR / non-DOM safety: if document is unavailable, return a barebones
  // texture and rely on the loader. (This module is "use client", so this
  // path only matters during the very first hydration tick.)
  const tex = new THREE.Texture();
  if (typeof document !== "undefined") {
    tex.image = makeFallbackCanvas();
    tex.needsUpdate = true;
  }
  tex.colorSpace = colorSpace;
  tex.premultiplyAlpha = false;
  tex.anisotropy = 1;
  _textureCache.set(filename, tex);

  // Asynchronously load the real PNG and adopt its Source onto our texture.
  // IMPORTANT: we replace `tex.source` (not `tex.image` aka `tex.source.data`)
  // so three.js's WebGLTextures sees a brand new `source.id` and uploads a
  // fresh GPU texture at the correct dimensions/format. Replacing only
  // `source.data` while keeping the same source.id can leave a stale GPU
  // upload (1x1 white) in three.quarks' BatchedRenderer.
  _loader.load(
    `${VFX_TEX_BASE}${filename}`,
    (loaded) => {
      // Drop the old GPU-side state for the placeholder texture.
      tex.dispose();
      tex.source = loaded.source;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = true;
      tex.colorSpace = colorSpace;
      tex.premultiplyAlpha = false;
      tex.anisotropy = 1;
      tex.needsUpdate = true;
      // The temp `loaded` Texture wrapper isn't bound; only its source matters.
      // Don't call loaded.dispose() — it would invalidate the source we adopted.
    },
    undefined,
    () => {
      // Missing file: keep the 1x1 white fallback. No-op.
    },
  );

  return tex;
}

function gradient(stops: Array<[number, QVector4]>): Gradient {
  // Quarks Gradient takes RGB (Vector3) stops + a separate alpha curve.
  // Each entry is [value, time-in-life].
  const colors = stops.map(
    ([t, v]) => [new QVector3(v.x, v.y, v.z), t] as [QVector3, number]
  );
  const alphas = stops.map(([t, v]) => [v.w, t] as [number, number]);
  return new Gradient(colors, alphas);
}

function bezierCurve(
  points: Array<[number, number, number, number]>
): PiecewiseBezier {
  // points: [v0, v1, v2, v3] for a cubic Bezier. We expose a single segment.
  const [p] = points;
  return new PiecewiseBezier([[new Bezier(p[0], p[1], p[2], p[3]), 0]]);
}

function linearFrameCurve(first: number, last: number): PiecewiseBezier {
  const span = last - first;
  return new PiecewiseBezier([
    [new Bezier(first, first + span / 3, first + (span * 2) / 3, last), 0],
  ]);
}

// ---------- debug texture (synchronous, in-memory) ----------

/**
 * Synchronously builds an in-memory test texture for diagnosing whether the
 * three.quarks pipeline correctly samples textures and respects alpha.
 *
 * 64x64 RGBA pattern:
 *   - Inner disc  (d <= 0.30): (255, 0,   0,   255)  opaque red
 *   - Mid ring    (0.30 < d <= 0.45): (0,   255, 0,   128)  50% green
 *   - Outer       (d > 0.45):       (0,   0,   0,   0)    transparent
 *
 * Where d = distance from texture center, normalized so corners ~ 0.71.
 *
 * Expected on screen for a single particle:
 *   - Solid red dot, surrounded by translucent green halo, transparent corners.
 *
 * Failure modes:
 *   - Solid red square    -> alpha not respected (blending/material broken)
 *   - Solid white square  -> texture sample not reaching shader
 *   - Nothing             -> particle not rendering
 */
let _debugAlphaTexture: THREE.DataTexture | null = null;
function getDebugAlphaTexture(): THREE.DataTexture {
  if (_debugAlphaTexture) return _debugAlphaTexture;
  const W = 64;
  const H = 64;
  const data = new Uint8Array(W * H * 4);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const maxR = Math.min(cx, cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const d = Math.sqrt(dx * dx + dy * dy) * 0.5; // 0..~0.71 at corners
      const i = (y * W + x) * 4;
      if (d <= 0.30) {
        data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      } else if (d <= 0.45) {
        data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; data[i + 3] = 128;
      } else {
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
      }
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  _debugAlphaTexture = tex;
  return tex;
}

// ---------- preset registry ----------

export type QuarksPresetId =
  | "smoke_plume_dark"
  | "smoke_plume_dust"
  | "embers_rising"
  | "sparks_burst"
  | "fire_core"
  | "debris_chunks"
  | "dust_puff"
  | "lava_droplets"
  | "lightning_arcs"
  | "debug_alpha_test";

export type QuarksPresetConfig = {
  /** Optional override for tinting (alignment colorA/colorB). */
  colorA?: THREE.Color | THREE.ColorRepresentation;
  colorB?: THREE.Color | THREE.ColorRepresentation;
  /** Multiplier on emission rate and maxParticle (LOD). 0..1 */
  intensity?: number;
  /** Multiplier on particle size. */
  scale?: number;
  /** One-shot vs looping. Defaults per-preset. */
  looping?: boolean;
  /** Lifetime override in seconds (interval [min,max] or single value). */
  lifetime?: [number, number] | number;
  /**
   * Override world-space simulation for this emitter.
   *
   * - `true`  → particles are baked into world coordinates at birth; they
   *             persist where spawned even if the host group keeps moving.
   *             This produces real trails (smoke left in the sky as a
   *             meteor falls).
   * - `false` → particles follow the parent transform every frame, so they
   *             stay attached to a moving host (good for auras, attached
   *             flames).
   *
   * When omitted, the preset chooses a sensible default — see preset
   * factories. Most production presets default to `true` so trails work
   * out of the box; `debug_alpha_test` keeps `false` so the debug pattern
   * is anchored to the camera-relative test scene.
   */
  worldSpace?: boolean;
};

export type QuarksPresetFactory = (config?: QuarksPresetConfig) => ParticleSystem;

export const QUARKS_PRESET_BASELINE: Record<QuarksPresetId, number> = {
  smoke_plume_dark: 78,
  smoke_plume_dust: 96,
  embers_rising: 112,
  sparks_burst: 72,
  fire_core: 56,
  debris_chunks: 20,
  dust_puff: 46,
  lava_droplets: 44,
  lightning_arcs: 42,
  debug_alpha_test: 12,
};

export function estimateQuarksPresetCost(
  id: QuarksPresetId,
  config?: QuarksPresetConfig,
): number {
  const intensity = Math.max(0, config?.intensity ?? 1);
  return (QUARKS_PRESET_BASELINE[id] ?? 48) * intensity;
}

export function shouldLoopQuarksPreset(id: QuarksPresetId): boolean {
  return (
    id === "smoke_plume_dark" ||
    id === "smoke_plume_dust" ||
    id === "embers_rising" ||
    id === "fire_core" ||
    id === "debug_alpha_test"
  );
}

export type QuarksPresetTextureUsage = {
  kind: "png" | "procedural" | "debug";
  filename: string;
  role: string;
};

export const QUARKS_PRESET_TEXTURES: Record<
  QuarksPresetId,
  readonly QuarksPresetTextureUsage[]
> = {
  smoke_plume_dark: [
    { kind: "png", filename: "smoke_puff_soft.png", role: "soft smoke billboard" },
  ],
  smoke_plume_dust: [
    { kind: "png", filename: "dust_puff.png", role: "dust/smoke billboard" },
  ],
  embers_rising: [
    { kind: "png", filename: "ember_dot.png", role: "additive ember sprite" },
  ],
  sparks_burst: [
    { kind: "png", filename: "spark_streak.png", role: "stretched spark sprite" },
  ],
  fire_core: [
    { kind: "png", filename: "fire_flipbook_4x4.png", role: "4x4 animated flame atlas" },
  ],
  debris_chunks: [
    { kind: "png", filename: "debris_chunk_albedo.png", role: "rock chunk mesh albedo" },
  ],
  dust_puff: [
    { kind: "png", filename: "dust_puff.png", role: "impact dust billboard" },
  ],
  lava_droplets: [
    { kind: "png", filename: "ember_dot.png", role: "additive molten droplet sprite" },
  ],
  lightning_arcs: [
    { kind: "png", filename: "spark_streak.png", role: "stretched lightning sprite" },
  ],
  debug_alpha_test: [
    { kind: "debug", filename: "in-memory", role: "diagnostic alpha DataTexture" },
  ],
};

export function getQuarksPresetTextures(
  id: QuarksPresetId,
): readonly QuarksPresetTextureUsage[] {
  return QUARKS_PRESET_TEXTURES[id] ?? [];
}

// ---------- internal builders ----------

type PresetSpec = {
  id: QuarksPresetId;
  build: (cfg: Required<Pick<QuarksPresetConfig, "intensity" | "scale">> &
    QuarksPresetConfig) => ParticleSystem;
  /** Relative cost vs. baseline; used by LOD gating (Phase 5). */
  budgetWeight: number;
};

function lifeOf(cfg: QuarksPresetConfig, fallback: [number, number]) {
  if (typeof cfg.lifetime === "number") return new ConstantValue(cfg.lifetime);
  if (Array.isArray(cfg.lifetime))
    return new IntervalValue(cfg.lifetime[0], cfg.lifetime[1]);
  return new IntervalValue(fallback[0], fallback[1]);
}

function color4(c: THREE.ColorRepresentation, alpha = 1): QVector4 {
  const col = new THREE.Color(c);
  return new QVector4(col.r, col.g, col.b, alpha);
}

function liftedColor4(
  c: THREE.ColorRepresentation,
  alpha = 1,
  minLuminance = 0.35,
): QVector4 {
  const col = new THREE.Color(c);
  const lum = col.r * 0.2126 + col.g * 0.7152 + col.b * 0.0722;
  if (lum < minLuminance) {
    const lift = minLuminance - lum;
    col.r = Math.min(1, col.r + lift);
    col.g = Math.min(1, col.g + lift);
    col.b = Math.min(1, col.b + lift);
  }
  return new QVector4(col.r, col.g, col.b, alpha);
}

// -- smoke_plume_dark: billowing dark gray plume rising from impact --
function buildSmokePlumeDark(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  // The quarks fragment shader does `diffuseColor = vColor; diffuseColor *= texelColor;`
  // so vColor.rgb directly tints the texture. If we use a dark color here, the
  // texture's grayscale luminance variation (0.78..1.0 white) gets crushed
  // into an invisible delta and the smoke reads as a flat black blob.
  //
  // Strategy: keep vColor.rgb LIGHT (medium-warm gray) so the texture's
  // detail is preserved, and use ALPHA to control "how much smoke" is
  // visible. Mid-life slightly darker tint hints at thick interior, late
  // life cools toward warm brown then fades.
  const colA = color4(cfg.colorA ?? "#9a9288", 0.72);
  const colB = color4(cfg.colorB ?? "#332821", 0.0);

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 4,
    looping: cfg.looping ?? true,
    startLife: lifeOf(cfg, [2.0, 3.2]),
    startSpeed: new IntervalValue(1.5, 2.9),
    // Larger sprites with more variance: softer falloff per overlap, more
    // visible texture detail per particle.
    startSize: new IntervalValue(2.0 * scale, 4.1 * scale),
    startColor: new ConstantColor(colA),
    startRotation: new IntervalValue(0, Math.PI * 2),
    // Keep the plume made of visible puffs, but raise density enough to read
    // against the bright meadow and flower colors.
    emissionOverTime: new ConstantValue(18 * intensity),
    shape: new ConeEmitter({ angle: 0.5, radius: 0.55 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      // Grayscale luminance map: load as linear so we don't gamma-decode
      // the white-ish midtones into a darker visual range.
      map: loadVfxTexture("smoke_puff_soft.png", THREE.LinearSRGBColorSpace),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      // Very small alphaTest: discard truly-zero edges only. A larger value
      // would harden the soft falloff that gives smoke its volumetric look.
      alphaTest: 0.005,
      toneMapped: false,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      // More dramatic expansion as puffs rise and dissipate.
      new SizeOverLife(bezierCurve([[0.9, 1.9, 3.0, 3.8]])),
      new ColorOverLife(gradient([
        [0, colA],
        // Mid-life: slightly darker/warmer to suggest thicker interior,
        // but still light enough that the texture's luminance reads.
        [0.45, color4("#6f5a48", 0.62)],
        [0.82, color4("#4a3b31", 0.26)],
        [1, colB],
      ])),
      // Light horizontal wind drift so plumes don't rise dead-vertical.
      new ApplyForce(new QVector3(0.75, 0, 0.38), new ConstantValue(0.55)),
    ],
  });
}

// -- smoke_plume_dust: lighter, browner, faster fade for earth/ground --
function buildSmokePlumeDust(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  // Same vColor-multiplies-texel principle as smoke_plume_dark: keep RGB
  // bright so the dust_puff texture's variation is visible. Light warm tan.
  const colA = color4(cfg.colorA ?? "#f0d2a0", 0.68);
  const colB = color4(cfg.colorB ?? "#8a7560", 0.0);

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 3,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [1.1, 2.0]),
    startSpeed: new IntervalValue(2.4, 4.8),
    startSize: new IntervalValue(1.3 * scale, 2.8 * scale),
    startColor: new ConstantColor(colA),
    startRotation: new IntervalValue(0, Math.PI * 2),
    // Denser than before so dust reads over sunlit grass instead of vanishing.
    emissionOverTime: new ConstantValue(30 * intensity),
    shape: new ConeEmitter({ angle: 0.9, radius: 0.7 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("dust_puff.png", THREE.LinearSRGBColorSpace),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      alphaTest: 0.005,
      toneMapped: false,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new SizeOverLife(bezierCurve([[0.75, 1.6, 2.5, 2.8]])),
      new ColorOverLife(gradient([
        [0, colA],
        [0.5, color4("#caa174", 0.52)],
        [1, colB],
      ])),
      // Mild wind drift on dust plumes (matches dark plume direction).
      new ApplyForce(new QVector3(0.75, 0, 0.38), new ConstantValue(0.8)),
    ],
  });
}

// -- embers_rising: tiny additive hot dots floating up --
function buildEmbersRising(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const hot = color4(cfg.colorA ?? "#ffb060", 1);
  const cool = color4(cfg.colorB ?? "#802010", 0);

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 4,
    looping: cfg.looping ?? true,
    startLife: lifeOf(cfg, [1.0, 2.0]),
    startSpeed: new IntervalValue(1.2, 3.0),
    startSize: new IntervalValue(0.08 * scale, 0.24 * scale),
    startColor: new ConstantColor(hot),
    emissionOverTime: new ConstantValue(58 * intensity),
    shape: new ConeEmitter({ angle: 0.6, radius: 0.3 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("ember_dot.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new SizeOverLife(bezierCurve([[1.0, 1.0, 0.6, 0.0]])),
      new ColorOverLife(gradient([
        [0, hot],
        [0.6, color4(cfg.colorA ?? "#ff6020", 0.8)],
        [1, cool],
      ])),
    ],
  });
}

// -- sparks_burst: short-lived velocity-aligned streaks --
function buildSparksBurst(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const hot = color4(cfg.colorA ?? "#fff0c0", 1);
  const dim = color4(cfg.colorB ?? "#a04020", 0);

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 0.4,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.28, 0.55]),
    startSpeed: new IntervalValue(10, 22),
    startSize: new IntervalValue(0.22 * scale, 0.55 * scale),
    startColor: new ConstantColor(hot),
    startLength: new IntervalValue(0.45 * scale, 1.15 * scale),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(64 * intensity)),
        cycle: 1,
        interval: 0,
        probability: 1,
      },
    ],
    emissionOverTime: new ConstantValue(0),
    shape: new SphereEmitter({ radius: 0.1 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("spark_streak.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    renderMode: RenderMode.StretchedBillBoard,
    speedFactor: 0.05,
    behaviors: [
      new ColorOverLife(gradient([
        [0, hot],
        [1, dim],
      ])),
    ],
  });
}

// -- fire_core: flipbook flame body --
function buildFireCore(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const colA = color4(cfg.colorA ?? "#ffb050", 1);
  const colB = color4(cfg.colorB ?? "#401000", 0);

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 3,
    looping: cfg.looping ?? true,
    startLife: lifeOf(cfg, [0.5, 0.9]),
    startSpeed: new IntervalValue(1.0, 1.9),
    startSize: new IntervalValue(1.0 * scale, 2.0 * scale),
    startColor: new ConstantColor(colA),
    startRotation: new IntervalValue(0, Math.PI * 2),
    emissionOverTime: new ConstantValue(36 * intensity),
    shape: new ConeEmitter({ angle: 0.25, radius: 0.4 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("fire_flipbook_4x4.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    renderMode: RenderMode.BillBoard,
    startTileIndex: new ConstantValue(0),
    uTileCount: 4,
    vTileCount: 4,
    blendTiles: true,
    behaviors: [
      new FrameOverLife(linearFrameCurve(0, 15)),
      new SizeOverLife(bezierCurve([[0.6, 1.0, 1.2, 0.4]])),
      new ColorOverLife(gradient([
        [0, colA],
        [0.7, color4(cfg.colorA ?? "#ff5020", 0.8)],
        [1, colB],
      ])),
    ],
  });
}

// -- debris_chunks: small mesh particles for ground eruption --
// We use small icosahedrons so the same pipeline applies to all alignments.
function buildDebrisChunks(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const colA = liftedColor4(cfg.colorA ?? "#8a7a64", 1, 0.45);
  const colB = liftedColor4(cfg.colorB ?? "#5a4938", 1, 0.35);

  const chunkGeom = new THREE.IcosahedronGeometry(0.18 * scale, 0);
  const chunkMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#b8a88c"),
    map: loadVfxTexture("debris_chunk_albedo.png"),
    toneMapped: false,
  });

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 0.6,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.55, 1.0]),
    startSpeed: new IntervalValue(4, 9),
    startSize: new IntervalValue(0.6 * scale, 1.4 * scale),
    startColor: new RandomColor(colA, colB),
    startRotation: new IntervalValue(0, Math.PI * 2),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(16 * intensity)),
        cycle: 1,
        interval: 0,
        probability: 1,
      },
    ],
    emissionOverTime: new ConstantValue(0),
    shape: new ConeEmitter({ angle: 0.7, radius: 0.4 }) as EmitterShape,
    material: chunkMat,
    renderMode: RenderMode.Mesh,
    instancingGeometry: chunkGeom,
    rendererEmitterSettings: {
      geometry: chunkGeom,
    },
    behaviors: [
      new SizeOverLife(bezierCurve([[1.0, 1.0, 0.9, 0.6]])),
    ],
  });
}

// -- dust_puff: one-shot soft dust ring on impact --
function buildDustPuff(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  // Bright tan; vColor tints the dust_puff texture luminance — keep RGB
  // light so the texture detail is visible.
  const colA = color4(cfg.colorA ?? "#f0d2a0", 0.82);
  const colB = color4(cfg.colorB ?? "#8a7560", 0);

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 0.6,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.6, 1.05]),
    startSpeed: new IntervalValue(2.6, 6.2),
    startSize: new IntervalValue(0.85 * scale, 2.0 * scale),
    startColor: new ConstantColor(colA),
    startRotation: new IntervalValue(0, Math.PI * 2),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(36 * intensity)),
        cycle: 1,
        interval: 0,
        probability: 1,
      },
    ],
    emissionOverTime: new ConstantValue(0),
    // Flat ring expansion: sphere with thin radius, mostly horizontal speed.
    shape: new SphereEmitter({ radius: 0.3 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("dust_puff.png", THREE.LinearSRGBColorSpace),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      alphaTest: 0.02,
      toneMapped: false,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new SizeOverLife(bezierCurve([[0.75, 1.6, 2.3, 1.5]])),
      new ColorOverLife(gradient([
        [0, colA],
        [0.48, color4("#caa174", 0.54)],
        [1, colB],
      ])),
    ],
  });
}

// -- lava_droplets: glowing orange dots arcing outward --
function buildLavaDroplets(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const hot = color4(cfg.colorA ?? "#ff7030", 1);
  const cool = color4(cfg.colorB ?? "#601000", 0);

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 0.5,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.55, 1.0]),
    startSpeed: new IntervalValue(5, 12),
    startSize: new IntervalValue(0.16 * scale, 0.38 * scale),
    startColor: new ConstantColor(hot),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(38 * intensity)),
        cycle: 1,
        interval: 0,
        probability: 1,
      },
    ],
    emissionOverTime: new ConstantValue(0),
    shape: new ConeEmitter({ angle: 0.55, radius: 0.2 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("ember_dot.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new SizeOverLife(bezierCurve([[1.0, 1.0, 0.8, 0.4]])),
      new ColorOverLife(gradient([
        [0, hot],
        [1, cool],
      ])),
    ],
  });
}

// -- lightning_arcs: short bright streaks (additive) --
function buildLightningArcs(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const hot = color4(cfg.colorA ?? "#d8e8ff", 1);
  const dim = color4(cfg.colorB ?? "#3050a0", 0);

  return new ParticleSystem({
    worldSpace: cfg.worldSpace ?? true,
    duration: 0.3,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.1, 0.22]),
    startSpeed: new IntervalValue(18, 34),
    startSize: new IntervalValue(0.28 * scale, 0.65 * scale),
    startLength: new IntervalValue(0.8 * scale, 1.8 * scale),
    startColor: new ConstantColor(hot),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(36 * intensity)),
        cycle: 1,
        interval: 0,
        probability: 1,
      },
    ],
    emissionOverTime: new ConstantValue(0),
    shape: new SphereEmitter({ radius: 0.2 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("spark_streak.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    renderMode: RenderMode.StretchedBillBoard,
    speedFactor: 0.08,
    behaviors: [
      new ColorOverLife(gradient([
        [0, hot],
        [1, dim],
      ])),
    ],
  });
}

// -- debug_alpha_test: in-memory tri-color texture for pipeline diagnosis --
function buildDebugAlphaTest(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const white = color4("#ffffff", 1);

  return new ParticleSystem({
    // Debug preset: keep local-space so the spinning fountain stays anchored
    // to the test scene origin and is easy to inspect.
    worldSpace: cfg.worldSpace ?? false,
    duration: 5,
    looping: cfg.looping ?? true,
    startLife: lifeOf(cfg, [5, 5]),
    startSpeed: new IntervalValue(0.4, 0.8),
    startSize: new IntervalValue(1.5 * scale, 2.5 * scale),
    startColor: new ConstantColor(white),
    startRotation: new ConstantValue(0),
    emissionOverTime: new ConstantValue(5 * intensity),
    shape: new ConeEmitter({ angle: 0.3, radius: 0.1 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: getDebugAlphaTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [],
  });
}

// ---------- preset map ----------

const PRESETS: Record<QuarksPresetId, PresetSpec> = {
  smoke_plume_dark: {
    id: "smoke_plume_dark",
    build: buildSmokePlumeDark,
    budgetWeight: 1.0,
  },
  smoke_plume_dust: {
    id: "smoke_plume_dust",
    build: buildSmokePlumeDust,
    budgetWeight: 1.2,
  },
  embers_rising: {
    id: "embers_rising",
    build: buildEmbersRising,
    budgetWeight: 0.8,
  },
  sparks_burst: {
    id: "sparks_burst",
    build: buildSparksBurst,
    budgetWeight: 0.5,
  },
  fire_core: {
    id: "fire_core",
    build: buildFireCore,
    budgetWeight: 0.7,
  },
  debris_chunks: {
    id: "debris_chunks",
    build: buildDebrisChunks,
    budgetWeight: 0.6,
  },
  dust_puff: {
    id: "dust_puff",
    build: buildDustPuff,
    budgetWeight: 0.5,
  },
  lava_droplets: {
    id: "lava_droplets",
    build: buildLavaDroplets,
    budgetWeight: 0.6,
  },
  lightning_arcs: {
    id: "lightning_arcs",
    build: buildLightningArcs,
    budgetWeight: 0.5,
  },
  debug_alpha_test: {
    id: "debug_alpha_test",
    build: buildDebugAlphaTest,
    budgetWeight: 0.3,
  },
};

export function buildQuarksPreset(
  id: QuarksPresetId,
  config?: QuarksPresetConfig
): ParticleSystem {
  const spec = PRESETS[id];
  if (!spec) throw new Error(`Unknown quarks preset: ${id}`);
  return spec.build({
    intensity: 1,
    scale: 1,
    ...config,
  });
}

export function getPresetBudgetWeight(id: QuarksPresetId): number {
  return PRESETS[id]?.budgetWeight ?? 1;
}

export const ALL_PRESET_IDS: QuarksPresetId[] = Object.keys(
  PRESETS
) as QuarksPresetId[];
