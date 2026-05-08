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
export function loadVfxTexture(filename: string): THREE.Texture {
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
  tex.colorSpace = THREE.SRGBColorSpace;
  _textureCache.set(filename, tex);

  // Asynchronously load the real PNG and copy its image onto our texture.
  _loader.load(
    `${VFX_TEX_BASE}${filename}`,
    (loaded) => {
      tex.image = loaded.image;
      tex.minFilter = loaded.minFilter;
      tex.magFilter = loaded.magFilter;
      tex.wrapS = loaded.wrapS;
      tex.wrapT = loaded.wrapT;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      // The temp `loaded` texture isn't bound anywhere; let it GC.
      loaded.dispose();
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
  | "lightning_arcs";

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
};

export type QuarksPresetFactory = (config?: QuarksPresetConfig) => ParticleSystem;

export type QuarksPresetTextureUsage = {
  filename: string;
  role: string;
};

export const QUARKS_PRESET_TEXTURES: Record<
  QuarksPresetId,
  readonly QuarksPresetTextureUsage[]
> = {
  smoke_plume_dark: [
    { filename: "smoke_puff_soft.png", role: "soft smoke billboard" },
  ],
  smoke_plume_dust: [
    { filename: "dust_puff.png", role: "dust/smoke billboard" },
  ],
  embers_rising: [
    { filename: "ember_dot.png", role: "additive ember sprite" },
  ],
  sparks_burst: [
    { filename: "spark_streak.png", role: "stretched spark sprite" },
  ],
  fire_core: [
    { filename: "fire_flipbook_4x4.png", role: "4x4 animated flame atlas" },
  ],
  debris_chunks: [],
  dust_puff: [
    { filename: "dust_puff.png", role: "impact dust billboard" },
  ],
  lava_droplets: [
    { filename: "ember_dot.png", role: "additive molten droplet sprite" },
  ],
  lightning_arcs: [
    { filename: "spark_streak.png", role: "stretched lightning sprite" },
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

// -- smoke_plume_dark: thick dark column rising from impact --
function buildSmokePlumeDark(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const colA = color4(cfg.colorA ?? "#1a1a1a", 0.85);
  const colB = color4(cfg.colorB ?? "#3a2a1e", 0.0);

  return new ParticleSystem({
    duration: 4,
    looping: cfg.looping ?? true,
    startLife: lifeOf(cfg, [2.0, 3.5]),
    startSpeed: new IntervalValue(1.2, 2.4),
    startSize: new IntervalValue(1.2 * scale, 2.4 * scale),
    startColor: new ConstantColor(colA),
    startRotation: new IntervalValue(0, Math.PI * 2),
    emissionOverTime: new ConstantValue(28 * intensity),
    shape: new ConeEmitter({ angle: 0.45, radius: 0.4 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("smoke_puff_soft.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new SizeOverLife(bezierCurve([[0.6, 1.4, 1.8, 2.2]])),
      new ColorOverLife(gradient([
        [0, colA],
        [0.4, color4(cfg.colorA ?? "#2a2a2a", 0.7)],
        [1, colB],
      ])),
      // Light horizontal wind drift so plumes don't rise dead-vertical.
      new ApplyForce(new QVector3(0.6, 0, 0.3), new ConstantValue(0.5)),
    ],
  });
}

// -- smoke_plume_dust: lighter, browner, faster fade for earth/ground --
function buildSmokePlumeDust(cfg: QuarksPresetConfig): ParticleSystem {
  const intensity = cfg.intensity ?? 1;
  const scale = cfg.scale ?? 1;
  const colA = color4(cfg.colorA ?? "#a08868", 0.7);
  const colB = color4(cfg.colorB ?? "#6b5a44", 0.0);

  return new ParticleSystem({
    duration: 3,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [1.4, 2.4]),
    startSpeed: new IntervalValue(2.0, 4.0),
    startSize: new IntervalValue(0.8 * scale, 1.8 * scale),
    startColor: new ConstantColor(colA),
    startRotation: new IntervalValue(0, Math.PI * 2),
    emissionOverTime: new ConstantValue(60 * intensity),
    shape: new ConeEmitter({ angle: 0.85, radius: 0.6 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("dust_puff.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new SizeOverLife(bezierCurve([[0.5, 1.2, 1.6, 1.8]])),
      new ColorOverLife(gradient([
        [0, colA],
        [1, colB],
      ])),
      // Mild wind drift on dust plumes (matches dark plume direction).
      new ApplyForce(new QVector3(0.6, 0, 0.3), new ConstantValue(0.7)),
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
    duration: 4,
    looping: cfg.looping ?? true,
    startLife: lifeOf(cfg, [1.5, 3.0]),
    startSpeed: new IntervalValue(1.0, 2.6),
    startSize: new IntervalValue(0.05 * scale, 0.18 * scale),
    startColor: new ConstantColor(hot),
    emissionOverTime: new ConstantValue(70 * intensity),
    shape: new ConeEmitter({ angle: 0.6, radius: 0.3 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("ember_dot.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
    duration: 0.4,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.3, 0.7]),
    startSpeed: new IntervalValue(8, 18),
    startSize: new IntervalValue(0.15 * scale, 0.4 * scale),
    startColor: new ConstantColor(hot),
    startLength: new IntervalValue(0.3 * scale, 0.8 * scale),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(80 * intensity)),
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
    duration: 3,
    looping: cfg.looping ?? true,
    startLife: lifeOf(cfg, [0.6, 1.1]),
    startSpeed: new IntervalValue(0.8, 1.6),
    startSize: new IntervalValue(0.8 * scale, 1.6 * scale),
    startColor: new ConstantColor(colA),
    startRotation: new IntervalValue(0, Math.PI * 2),
    emissionOverTime: new ConstantValue(40 * intensity),
    shape: new ConeEmitter({ angle: 0.25, radius: 0.4 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("fire_flipbook_4x4.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
  const colA = color4(cfg.colorA ?? "#7a6a55", 1);
  const colB = color4(cfg.colorB ?? "#3a2a1e", 1);

  const chunkGeom = new THREE.IcosahedronGeometry(0.18 * scale, 0);
  const chunkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cfg.colorA ?? "#7a6a55"),
    roughness: 0.85,
    metalness: 0.05,
  });

  return new ParticleSystem({
    duration: 0.6,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.8, 1.6]),
    startSpeed: new IntervalValue(4, 9),
    startSize: new IntervalValue(0.6 * scale, 1.4 * scale),
    startColor: new RandomColor(colA, colB),
    startRotation: new IntervalValue(0, Math.PI * 2),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(28 * intensity)),
        cycle: 1,
        interval: 0,
        probability: 1,
      },
    ],
    emissionOverTime: new ConstantValue(0),
    shape: new ConeEmitter({ angle: 0.7, radius: 0.4 }) as EmitterShape,
    material: chunkMat,
    renderMode: RenderMode.Mesh,
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
  const colA = color4(cfg.colorA ?? "#c8b896", 0.6);
  const colB = color4(cfg.colorB ?? "#7a6a55", 0);

  return new ParticleSystem({
    duration: 0.6,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.6, 1.2]),
    startSpeed: new IntervalValue(2, 5),
    startSize: new IntervalValue(0.6 * scale, 1.4 * scale),
    startColor: new ConstantColor(colA),
    startRotation: new IntervalValue(0, Math.PI * 2),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(40 * intensity)),
        cycle: 1,
        interval: 0,
        probability: 1,
      },
    ],
    emissionOverTime: new ConstantValue(0),
    // Flat ring expansion: sphere with thin radius, mostly horizontal speed.
    shape: new SphereEmitter({ radius: 0.3 }) as EmitterShape,
    material: new THREE.MeshBasicMaterial({
      map: loadVfxTexture("dust_puff.png"),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
    renderMode: RenderMode.BillBoard,
    behaviors: [
      new SizeOverLife(bezierCurve([[0.6, 1.4, 1.8, 1.2]])),
      new ColorOverLife(gradient([
        [0, colA],
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
    duration: 0.5,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.8, 1.6]),
    startSpeed: new IntervalValue(5, 12),
    startSize: new IntervalValue(0.12 * scale, 0.3 * scale),
    startColor: new ConstantColor(hot),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(50 * intensity)),
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
    duration: 0.3,
    looping: cfg.looping ?? false,
    startLife: lifeOf(cfg, [0.1, 0.25]),
    startSpeed: new IntervalValue(15, 30),
    startSize: new IntervalValue(0.2 * scale, 0.5 * scale),
    startLength: new IntervalValue(0.6 * scale, 1.4 * scale),
    startColor: new ConstantColor(hot),
    emissionBursts: [
      {
        time: 0,
        count: new ConstantValue(Math.round(40 * intensity)),
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
