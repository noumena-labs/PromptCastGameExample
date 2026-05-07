/**
 * Maps Rapier collider handles to gameplay entities so projectile raycasts can
 * dispatch damage without a zustand-driven distance scan. Each entity (dummy,
 * wizard) registers its collider handle on mount and unregisters on unmount.
 *
 * Also keeps a reverse `id -> handle` index per kind, used by the projectile
 * raycast to exclude the caster's own collider via Rapier's filter predicate.
 */
export type ColliderEntityKind = "dummy" | "wizard" | "static";

export type ColliderEntity = {
  kind: ColliderEntityKind;
  id: string;
};

const registry = new Map<number, ColliderEntity>();
const wizardIdToHandle = new Map<string, number>();

export const colliderRegistry = {
  register(handle: number, entity: ColliderEntity) {
    registry.set(handle, entity);
    if (entity.kind === "wizard") wizardIdToHandle.set(entity.id, handle);
  },
  unregister(handle: number) {
    const entry = registry.get(handle);
    if (entry?.kind === "wizard" && wizardIdToHandle.get(entry.id) === handle) {
      wizardIdToHandle.delete(entry.id);
    }
    registry.delete(handle);
  },
  get(handle: number): ColliderEntity | undefined {
    return registry.get(handle);
  },
  /**
   * Resolve a wizard's Rapier collider handle from its player id. Returns
   * `null` if no wizard with that id is currently mounted.
   */
  findWizardHandle(playerId: string): number | null {
    return wizardIdToHandle.get(playerId) ?? null;
  },
  clear() {
    registry.clear();
    wizardIdToHandle.clear();
  },
};
