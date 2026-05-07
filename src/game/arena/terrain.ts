import type { Vec3 } from "@/game/types";

export type Platform = {
  id: string;
  position: Vec3;
  size: Vec3;
  color: string;
};

export const PLATFORMS: Platform[] = [
  { id: "west-ruin-platform", position: [-14, 1.5, 2], size: [10, 3, 8], color: "#313841" },
  { id: "east-ruin-platform", position: [14, 1.5, -2], size: [10, 3, 8], color: "#34313f" },
  { id: "north-bridge", position: [0, 2.5, -15], size: [14, 2, 5], color: "#3b3841" },
];

export function getGroundHeight(x: number, z: number): number {
  for (const platform of PLATFORMS) {
    const halfX = platform.size[0] / 2;
    const halfZ = platform.size[2] / 2;
    if (x >= platform.position[0] - halfX && x <= platform.position[0] + halfX && z >= platform.position[2] - halfZ && z <= platform.position[2] + halfZ) {
      return platform.position[1] + platform.size[1] / 2;
    }
  }
  return 0;
}
