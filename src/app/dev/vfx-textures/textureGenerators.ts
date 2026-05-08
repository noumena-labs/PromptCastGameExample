// Offline texture generators for three.quarks particles.
// All generators write into a Canvas2D ImageData and return it; the dev page
// handles preview + PNG download. No three.js imports here on purpose so the
// math stays portable.

import { clamp01, fbm, mix, smoothstep, tileableFbm } from "./noise";

export type TextureKind =
  | "smoke_puff_soft"
  | "smoke_noise_tile"
  | "ember_dot"
  | "spark_streak"
  | "fire_flipbook_4x4"
  | "dust_puff"
  | "debris_chunk_albedo"
  | "crack_glow";

export type TextureSpec = {
  id: TextureKind;
  filename: string;
  width: number;
  height: number;
  description: string;
  premultiplied: boolean;
};

export const TEXTURE_SPECS: Record<TextureKind, TextureSpec> = {
  smoke_puff_soft: {
    id: "smoke_puff_soft",
    filename: "smoke_puff_soft.png",
    width: 256,
    height: 256,
    description: "Soft round smoke puff, alpha falloff with fbm breakup.",
    premultiplied: false,
  },
  smoke_noise_tile: {
    id: "smoke_noise_tile",
    filename: "smoke_noise_tile.png",
    width: 256,
    height: 256,
    description: "Tileable fbm noise for distortion / detail UVs.",
    premultiplied: false,
  },
  ember_dot: {
    id: "ember_dot",
    filename: "ember_dot.png",
    width: 64,
    height: 64,
    description: "Tiny hot ember, additive-friendly radial.",
    premultiplied: false,
  },
  spark_streak: {
    id: "spark_streak",
    filename: "spark_streak.png",
    width: 128,
    height: 32,
    description: "Anisotropic spark streak for velocity-aligned particles.",
    premultiplied: false,
  },
  fire_flipbook_4x4: {
    id: "fire_flipbook_4x4",
    filename: "fire_flipbook_4x4.png",
    width: 1024,
    height: 1024,
    description: "16-frame flame flipbook (4x4) with rising fbm.",
    premultiplied: false,
  },
  dust_puff: {
    id: "dust_puff",
    filename: "dust_puff.png",
    width: 256,
    height: 256,
    description: "Lighter dust puff for ground impacts and earth alignment.",
    premultiplied: false,
  },
  debris_chunk_albedo: {
    id: "debris_chunk_albedo",
    filename: "debris_chunk_albedo.png",
    width: 256,
    height: 256,
    description: "Rocky albedo/noise tile for debris chunk mesh particles.",
    premultiplied: false,
  },
  crack_glow: {
    id: "crack_glow",
    filename: "crack_glow.png",
    width: 512,
    height: 512,
    description: "Branching crack glow decal for ground eruption hotspots.",
    premultiplied: false,
  },
};

// ---------- helpers ----------

type GenOptions = {
  seed?: number;
  // Optional overrides; defaults are chosen for the canonical spec.
  [k: string]: unknown;
};

function makeImageData(w: number, h: number): ImageData {
  // OffscreenCanvas works in workers but we just use a plain canvas here.
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), {
          width: w,
          height: h,
        });
  const ctx = (canvas as HTMLCanvasElement).getContext("2d", {
    willReadFrequently: true,
  })!;
  return ctx.createImageData(w, h);
}

function setPixel(
  img: ImageData,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number
) {
  const i = (y * img.width + x) * 4;
  img.data[i] = clamp01(r) * 255;
  img.data[i + 1] = clamp01(g) * 255;
  img.data[i + 2] = clamp01(b) * 255;
  img.data[i + 3] = clamp01(a) * 255;
}

// ---------- generators ----------

export function generateSmokePuff(opts: GenOptions = {}): ImageData {
  const { width: W, height: H } = TEXTURE_SPECS.smoke_puff_soft;
  const img = makeImageData(W, H);
  const seed = (opts.seed as number) ?? 11;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2.0; // 0..~1.41

      // Soft radial falloff
      const radial = 1.0 - smoothstep(0.05, 0.95, d);

      // Break up edges with fbm
      const n = fbm(u * 4.0 + seed, v * 4.0 - seed, 5);
      const breakup = mix(0.65, 1.0, n);

      const alpha = clamp01(radial * breakup);
      // Slight luminance variation for shading
      const lum = mix(0.78, 1.0, n);
      setPixel(img, x, y, lum, lum, lum, alpha);
    }
  }
  return img;
}

export function generateSmokeNoise(opts: GenOptions = {}): ImageData {
  const { width: W, height: H } = TEXTURE_SPECS.smoke_noise_tile;
  const img = makeImageData(W, H);
  const scale = (opts.scale as number) ?? 4;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const n = tileableFbm(u, v, scale, 5);
      const c = clamp01(n);
      setPixel(img, x, y, c, c, c, 1.0);
    }
  }
  return img;
}

export function generateEmberDot(): ImageData {
  const { width: W, height: H } = TEXTURE_SPECS.ember_dot;
  const img = makeImageData(W, H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2.0;

      const core = 1.0 - smoothstep(0.0, 0.25, d);
      const halo = (1.0 - smoothstep(0.2, 1.0, d)) * 0.45;
      const a = clamp01(core + halo);

      // Hot center -> warm edge
      const r = mix(1.0, 1.0, core);
      const g = mix(0.45, 0.95, core);
      const b = mix(0.1, 0.55, core);
      setPixel(img, x, y, r, g, b, a);
    }
  }
  return img;
}

export function generateSparkStreak(): ImageData {
  const { width: W, height: H } = TEXTURE_SPECS.spark_streak;
  const img = makeImageData(W, H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);

      // Horizontal streak: long in U, thin in V.
      const headBias = smoothstep(0.0, 1.0, u); // brighter toward right (head)
      const lateral = 1.0 - smoothstep(0.15, 0.5, Math.abs(v - 0.5));
      const longitudinal = mix(0.2, 1.0, headBias);

      const a = clamp01(lateral * longitudinal);
      const r = 1.0;
      const g = mix(0.6, 1.0, headBias);
      const b = mix(0.25, 0.8, headBias);
      setPixel(img, x, y, r, g, b, a);
    }
  }
  return img;
}

export function generateFireFlipbook(): ImageData {
  const { width: W, height: H } = TEXTURE_SPECS.fire_flipbook_4x4;
  const img = makeImageData(W, H);
  const cols = 4;
  const rows = 4;
  const cellW = W / cols;
  const cellH = H / rows;

  for (let frame = 0; frame < cols * rows; frame++) {
    const fx = frame % cols;
    const fy = Math.floor(frame / cols);
    const t = frame / (cols * rows - 1); // 0..1 across animation
    const offsetX = fx * cellW;
    const offsetY = fy * cellH;

    for (let py = 0; py < cellH; py++) {
      for (let px = 0; px < cellW; px++) {
        const u = px / (cellW - 1);
        const v = py / (cellH - 1);

        // v=0 is top of cell. Flame rises -> warp upward over time.
        const rise = t * 1.2;
        const distort =
          fbm(u * 3.0 + frame * 0.7, v * 3.0 - rise * 2.5, 5) - 0.5;
        const warpedV = clamp01(v + distort * 0.25);

        // Vertical flame profile: hot wide base, narrow peak.
        const verticalShape = smoothstep(0.0, 0.25, warpedV) *
          (1.0 - smoothstep(0.55, 1.0, warpedV));
        const widthAtV = mix(0.45, 0.12, warpedV);
        const lateral =
          1.0 -
          smoothstep(widthAtV * 0.6, widthAtV, Math.abs(u - 0.5));

        const core = clamp01(verticalShape * lateral);
        // Detail breakup
        const detail = fbm(u * 6.0 + 11.0, v * 6.0 - rise * 3.0, 5);
        const a = clamp01(core * mix(0.55, 1.0, detail));

        // Color ramp: white-hot core -> orange -> red -> dark
        const heat = clamp01(core * mix(0.7, 1.0, detail));
        const r = mix(0.6, 1.0, heat);
        const g = mix(0.1, 0.85, heat * heat);
        const b = mix(0.0, 0.35, heat * heat * heat);

        setPixel(img, offsetX + px, offsetY + py, r, g, b, a);
      }
    }
  }
  return img;
}

export function generateDustPuff(opts: GenOptions = {}): ImageData {
  const { width: W, height: H } = TEXTURE_SPECS.dust_puff;
  const img = makeImageData(W, H);
  const seed = (opts.seed as number) ?? 27;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2.0;

      const radial = 1.0 - smoothstep(0.1, 1.0, d);
      const n = fbm(u * 5.5 + seed, v * 5.5 - seed, 5);
      // Lighter, dustier alpha
      const alpha = clamp01(radial * mix(0.45, 0.9, n)) * 0.85;
      const lum = mix(0.85, 1.0, n);
      setPixel(img, x, y, lum, lum * 0.97, lum * 0.92, alpha);
    }
  }
  return img;
}

export function generateDebrisChunkAlbedo(opts: GenOptions = {}): ImageData {
  const { width: W, height: H } = TEXTURE_SPECS.debris_chunk_albedo;
  const img = makeImageData(W, H);
  const seed = (opts.seed as number) ?? 73;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const broad = fbm(u * 3.0 + seed, v * 3.0 - seed, 5);
      const grain = fbm(u * 18.0 - seed * 0.7, v * 18.0 + seed * 0.4, 4);
      const chips = fbm(u * 42.0 + seed * 1.7, v * 42.0 - seed * 1.1, 3);
      const shade = clamp01(broad * 0.58 + grain * 0.3 + chips * 0.12);
      const warm = fbm(u * 5.0 - seed * 0.3, v * 5.0 + seed * 0.2, 3);

      const r = mix(0.34, 0.68, shade) * mix(0.9, 1.12, warm);
      const g = mix(0.28, 0.55, shade) * mix(0.94, 1.04, warm);
      const b = mix(0.22, 0.42, shade) * mix(1.0, 0.86, warm);
      setPixel(img, x, y, r, g, b, 1.0);
    }
  }
  return img;
}

export function generateCrackGlow(opts: GenOptions = {}): ImageData {
  const { width: W, height: H } = TEXTURE_SPECS.crack_glow;
  const img = makeImageData(W, H);
  const seed = (opts.seed as number) ?? 42;

  // Build a "crack" field by thresholding warped fbm ridges.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const v = y / (H - 1);
      const dx = u - 0.5;
      const dy = v - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2.0;

      // Ridge noise = 1 - |2n - 1|; multi-octave for branching feel.
      const n1 = fbm(u * 4.0 + seed, v * 4.0 - seed, 5);
      const n2 = fbm(u * 9.0 - seed, v * 9.0 + seed, 5);
      const ridge1 = 1.0 - Math.abs(2.0 * n1 - 1.0);
      const ridge2 = 1.0 - Math.abs(2.0 * n2 - 1.0);
      const ridge = clamp01(ridge1 * 0.7 + ridge2 * 0.4);

      // Sharpen into thin cracks
      const cracks = smoothstep(0.78, 0.95, ridge);

      // Radial falloff so the decal fades at the edges
      const falloff = 1.0 - smoothstep(0.6, 1.0, d);

      const a = clamp01(cracks * falloff);
      // Hot orange glow
      const r = 1.0;
      const g = mix(0.35, 0.75, a);
      const b = mix(0.05, 0.25, a);
      setPixel(img, x, y, r, g, b, a);
    }
  }
  return img;
}

export type GeneratorFn = (opts?: GenOptions) => ImageData;

export const GENERATORS: Record<TextureKind, GeneratorFn> = {
  smoke_puff_soft: generateSmokePuff,
  smoke_noise_tile: generateSmokeNoise,
  ember_dot: generateEmberDot,
  spark_streak: generateSparkStreak,
  fire_flipbook_4x4: generateFireFlipbook,
  dust_puff: generateDustPuff,
  debris_chunk_albedo: generateDebrisChunkAlbedo,
  crack_glow: generateCrackGlow,
};
