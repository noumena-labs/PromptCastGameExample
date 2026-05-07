import type { GeneratedSpell, Vec3 } from "@/game/types";

/**
 * Authoritative projectile motion lives outside zustand to avoid React
 * reconciliation every frame. The store only carries the ordered list of
 * projectile ids for rendering.
 */
export type ProjectileMotion = {
  id: string;
  ownerId: string;
  spell: GeneratedSpell;
  position: Vec3;
  direction: Vec3;
  createdAt: number;
  expiresAt: number;
};

const projectiles = new Map<string, ProjectileMotion>();

export const projectileMotion = {
  register(motion: ProjectileMotion) {
    projectiles.set(motion.id, motion);
  },
  unregister(id: string) {
    projectiles.delete(id);
  },
  get(id: string): ProjectileMotion | undefined {
    return projectiles.get(id);
  },
  values(): IterableIterator<ProjectileMotion> {
    return projectiles.values();
  },
  size(): number {
    return projectiles.size;
  },
  clear() {
    projectiles.clear();
  },
};
