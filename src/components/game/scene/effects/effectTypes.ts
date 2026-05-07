import type { VisualRecipe } from "@/game/spells/visualRecipe";

/**
 * Shared context passed to every effect primitive.
 *
 * `palette`, `motion`, and `emissive` come from the visual recipe. Position
 * and orientation are owned by the parent (`EffectComposer`) — primitives
 * render in local space at the origin.
 */
export type EffectContext = {
  palette: VisualRecipe["palette"];
  motion?: VisualRecipe["motion"];
  /** Local age in seconds (since the parent effect spawned). */
  ageSeconds: number;
  /**
   * Authoritative lifetime in seconds (or +Inf for "live until parent unmounts").
   * Effects can use this to drive shockwaves / pulses / lifetime-relative shaders.
   */
  lifetimeSeconds: number;
  /**
   * Optional travel direction in world space (already normalized). Beams /
   * lightning use this to orient. `undefined` for self-cast / area spells.
   */
  direction?: [number, number, number];
};

/** Color helpers — recipes always carry a `primary`; secondary/accent fall back. */
export function pickAccent(palette: VisualRecipe["palette"]): string {
  return palette.accent ?? palette.secondary ?? palette.primary;
}

export function pickSecondary(palette: VisualRecipe["palette"]): string {
  return palette.secondary ?? palette.primary;
}

export const TWO_PI = Math.PI * 2;
