/**
 * Collision group memberships and filter masks for Rapier interaction groups.
 *
 * Rapier packs an `InteractionGroups` as a u32: the high 16 bits are the
 * collider's *membership* (which groups it belongs to), the low 16 bits are
 * its *filter* (which groups it interacts with). A pair of colliders interacts
 * iff `(A.membership & B.filter) != 0 && (B.membership & A.filter) != 0`.
 *
 * The same packed value is also used for ray-cast `filterGroups`, where the
 * cast itself behaves like a "virtual collider" with the given membership +
 * filter mask. Practically we only set the filter half for raycasts.
 */

export const GROUP = {
  ENVIRONMENT: 1 << 0, // ground (n/a, no collider), shrine, trees
  WIZARD: 1 << 1, // local + remote wizard capsules
  DUMMY: 1 << 2, // training dummies
  PROJECTILE: 1 << 3, // reserved for when projectiles become real bodies
} as const;

export type GroupBit = (typeof GROUP)[keyof typeof GROUP];

/**
 * Pack a (membership, filter) pair into Rapier's u32 interactionGroups format.
 * Use bitwise OR over GROUP.* values for both arguments.
 */
export function groups(membership: number, filter: number): number {
  // Force unsigned 32-bit semantics. Rapier expects a number in u32 range.
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

// Convenience presets for the colliders in the scene.
export const ENVIRONMENT_GROUPS = groups(
  GROUP.ENVIRONMENT,
  GROUP.WIZARD | GROUP.DUMMY | GROUP.PROJECTILE,
);

export const WIZARD_GROUPS = groups(
  GROUP.WIZARD,
  GROUP.ENVIRONMENT | GROUP.WIZARD | GROUP.DUMMY | GROUP.PROJECTILE,
);

export const DUMMY_GROUPS = groups(
  GROUP.DUMMY,
  GROUP.ENVIRONMENT | GROUP.WIZARD | GROUP.PROJECTILE,
);

/**
 * Filter mask for spell aim rays: hit anything that can take a hit or block
 * line of fire. Membership is set to PROJECTILE so future real-body
 * projectiles trade collisions consistently.
 */
export const AIM_RAY_GROUPS = groups(
  GROUP.PROJECTILE,
  GROUP.ENVIRONMENT | GROUP.WIZARD | GROUP.DUMMY,
);
