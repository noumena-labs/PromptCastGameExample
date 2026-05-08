import type { GeneratedSpell, Vec3 } from "@/game/types";

/**
 * Authoritative projectile motion lives outside zustand to avoid React
 * reconciliation every frame. The store only carries the ordered list of
 * projectile ids for rendering.
 */
export type ProjectileMotion = {
  id: string;
  ownerId: string;
  /**
   * Rapier collider handle of the wizard who cast this projectile, used to
   * exclude the caster from the per-step raycast so projectiles don't self-
   * collide at spawn. `null` when the caster has no registered collider yet
   * (e.g. remote wizard not mounted) — the raycast simply skips owner-filter.
   */
  ownerColliderHandle: number | null;
  spell: GeneratedSpell;
  mode: "linear" | "arc" | "skyfall" | "hitscan_visual";
  position: Vec3;
  direction: Vec3;
  velocity: Vec3;
  targetPoint: Vec3;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
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
