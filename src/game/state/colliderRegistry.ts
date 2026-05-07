/**
 * Maps Rapier collider handles to gameplay entities so projectile raycasts can
 * dispatch damage without a zustand-driven distance scan. Each entity (dummy,
 * wizard) registers its collider handle on mount and unregisters on unmount.
 */
export type ColliderEntityKind = "dummy" | "wizard" | "static";

export type ColliderEntity = {
  kind: ColliderEntityKind;
  id: string;
};

const registry = new Map<number, ColliderEntity>();

export const colliderRegistry = {
  register(handle: number, entity: ColliderEntity) {
    registry.set(handle, entity);
  },
  unregister(handle: number) {
    registry.delete(handle);
  },
  get(handle: number): ColliderEntity | undefined {
    return registry.get(handle);
  },
  clear() {
    registry.clear();
  },
};
