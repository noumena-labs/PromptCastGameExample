/**
 * Per-frame motion math for the SceneNode DSL.
 *
 * Each motion mode is a pure function of (elapsedSeconds, motionSpeed) →
 * a delta to apply to the node's local transform. Returned values are
 * relative to the node's *base* transform (position/rotation as authored
 * by the LLM); the renderer adds them on top each frame.
 *
 * All functions are stateless and allocation-free in the hot loop.
 */

export type MotionDelta = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

const ZERO: [number, number, number] = [0, 0, 0];

export function applyMotion(
  motion: string,
  motionSpeed: number,
  elapsed: number,
  out: MotionDelta,
): MotionDelta {
  const t = elapsed * motionSpeed;
  switch (motion) {
    case "spin":
      out.position = ZERO;
      out.rotation = [0, t, 0];
      out.scale = 1;
      return out;

    case "orbit": {
      // 1m orbit around local Y axis. Renderer combines with any per-node
      // base position so the orbit is relative to the parent group origin.
      const r = 1;
      out.position = [Math.cos(t) * r, 0, Math.sin(t) * r];
      out.rotation = ZERO;
      out.scale = 1;
      return out;
    }

    case "pulse": {
      // ±20% scale pulse.
      const s = 1 + Math.sin(t * 2) * 0.2;
      out.position = ZERO;
      out.rotation = ZERO;
      out.scale = s;
      return out;
    }

    case "drift": {
      // Slow lissajous wander, ±0.4m.
      out.position = [Math.sin(t * 0.7) * 0.4, Math.cos(t * 0.5) * 0.2, Math.sin(t * 0.3) * 0.4];
      out.rotation = ZERO;
      out.scale = 1;
      return out;
    }

    case "fall":
      // Accelerating descent, capped so we don't sink through the world.
      out.position = [0, -Math.min(elapsed * elapsed * 4 * motionSpeed, 30), 0];
      out.rotation = ZERO;
      out.scale = 1;
      return out;

    case "rise":
      out.position = [0, Math.min(elapsed * elapsed * 4 * motionSpeed, 30), 0];
      out.rotation = ZERO;
      out.scale = 1;
      return out;

    case "swirl":
      // Combined orbit + slow rise.
      out.position = [Math.cos(t) * 0.8, t * 0.15, Math.sin(t) * 0.8];
      out.rotation = [0, t, 0];
      out.scale = 1;
      return out;

    case "expand":
      // Monotonic outward growth, clamped at 4×.
      out.position = ZERO;
      out.rotation = ZERO;
      out.scale = Math.min(1 + elapsed * motionSpeed * 0.6, 4);
      return out;

    case "shake": {
      // High-frequency jitter, ±0.08m.
      const j = 0.08;
      out.position = [
        (Math.sin(t * 23) - 0.5) * j,
        (Math.cos(t * 31) - 0.5) * j,
        (Math.sin(t * 17) - 0.5) * j,
      ];
      out.rotation = ZERO;
      out.scale = 1;
      return out;
    }

    case "static":
    default:
      out.position = ZERO;
      out.rotation = ZERO;
      out.scale = 1;
      return out;
  }
}

/**
 * Computes per-instance offsets for an `arrange` mode. Returned positions
 * are relative to the node's authored position. Length always equals
 * `arrangeCount` (for "single" the array is `[[0,0,0]]`).
 *
 * Random arrange uses a seeded PRNG (mulberry32) keyed off the spell ID so
 * re-renders of the same spell keep the same scatter.
 */
export function arrangePositions(
  arrange: string,
  count: number,
  radius: number,
  seed: number,
): [number, number, number][] {
  const n = Math.max(1, Math.min(12, Math.round(count)));
  switch (arrange) {
    case "ring": {
      const out: [number, number, number][] = [];
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2;
        out.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]);
      }
      return out;
    }
    case "line": {
      const out: [number, number, number][] = [];
      const half = (n - 1) / 2;
      for (let i = 0; i < n; i += 1) {
        out.push([(i - half) * radius, 0, 0]);
      }
      return out;
    }
    case "stack": {
      const out: [number, number, number][] = [];
      for (let i = 0; i < n; i += 1) {
        out.push([0, i * radius, 0]);
      }
      return out;
    }
    case "random": {
      const rng = mulberry32(seed);
      const out: [number, number, number][] = [];
      for (let i = 0; i < n; i += 1) {
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * radius;
        const y = (rng() - 0.5) * radius * 0.5;
        out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
      }
      return out;
    }
    case "single":
    default:
      return [[0, 0, 0]];
  }
}

/** Hash a string ID to a 32-bit unsigned int seed. */
export function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
