import type { Vec3 } from "@/game/types";

/**
 * Shared per-frame aim state. Written by LocalWizard each frame from a
 * shoulder-anchored Rapier raycast; read by:
 *   - the screen-space ReticleHUD (projects `hitPoint` to NDC)
 *   - the cast logic (uses `origin`, `direction`, `hitPoint` directly)
 *
 * A module-level singleton keeps this off zustand so we don't re-render
 * components every frame for a value that mutates 60 Hz.
 */
export const reticleTarget = {
  /** Where the projectile will actually land (raycast hit, or fallback). */
  hitPoint: [0, 1, 0] as Vec3,
  /** Origin of the wizard's aim ray (shoulder anchor in world space). */
  origin: [0, 1, 0] as Vec3,
  /** Unit-length aim direction from `origin` toward `hitPoint`. */
  direction: [0, 0, -1] as Vec3,
  /** True iff the raycast actually hit something within MAX_DISTANCE. */
  hasHit: false,
  /** True once LocalWizard has produced a valid result this session. */
  ready: false,
};
