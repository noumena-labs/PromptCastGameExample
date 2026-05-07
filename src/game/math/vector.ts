import type { Vec3 } from "@/game/types";

export const vec3DistanceSq = (a: Vec3, b: Vec3) => {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
};

export const vec3Distance = (a: Vec3, b: Vec3) => Math.sqrt(vec3DistanceSq(a, b));

export const toVec3 = (x: number, y: number, z: number): Vec3 => [Number(x.toFixed(3)), Number(y.toFixed(3)), Number(z.toFixed(3))];

export function normalizeVec3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

export function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function rotateAroundY(v: Vec3, radians: number): Vec3 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
