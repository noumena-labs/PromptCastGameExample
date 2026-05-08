// JS port of the value-noise + fbm used in spellShaderPrograms.ts (fragmentCommon).
// Kept deterministic and dependency-free so the dev tool can run in the browser
// without pulling in three.js shader plumbing.

export function hash12(x: number, y: number): number {
  // Match the GLSL hash12 closely. fract() = x - floor(x).
  const fract = (v: number) => v - Math.floor(v);

  let p3x = fract(x * 0.1031);
  let p3y = fract(y * 0.1031);
  let p3z = fract(x * 0.1031);

  const dotVal = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += dotVal;
  p3y += dotVal;
  p3z += dotVal;

  return fract((p3x + p3y) * p3z);
}

function smoothstepQuintic(f: number): number {
  return f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
}

export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const a = hash12(ix, iy);
  const b = hash12(ix + 1, iy);
  const c = hash12(ix, iy + 1);
  const d = hash12(ix + 1, iy + 1);

  const ux = smoothstepQuintic(fx);
  const uy = smoothstepQuintic(fy);

  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uy;
}

export function fbm(x: number, y: number, octaves = 5): number {
  let v = 0.0;
  let amp = 0.5;
  let px = x;
  let py = y;

  for (let i = 0; i < octaves; i++) {
    v += valueNoise(px, py) * amp;
    // Same rotation/scale matrix used in GLSL fbm.
    const nx = 1.62 * px + 1.17 * py + 13.71;
    const ny = -1.17 * px + 1.62 * py + 7.23;
    px = nx;
    py = ny;
    amp *= 0.52;
  }

  return v;
}

// Tileable fbm via 4-corner blending in noise space.
export function tileableFbm(
  u: number,
  v: number,
  scale: number,
  octaves = 5
): number {
  const x = u * scale;
  const y = v * scale;
  const x1 = x - scale;
  const y1 = y - scale;

  const a = fbm(x, y, octaves);
  const b = fbm(x1, y, octaves);
  const c = fbm(x, y1, octaves);
  const d = fbm(x1, y1, octaves);

  const wx = u;
  const wy = v;
  const ab = a * (1 - wx) + b * wx;
  const cd = c * (1 - wx) + d * wx;
  return ab * (1 - wy) + cd * wy;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
