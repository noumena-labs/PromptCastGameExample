"use client";

/**
 * Static centered crosshair. The orbit camera's lookAt is tuned so that
 * screen-center coincides with where the projectile lands, so the reticle
 * is a fixed DOM overlay — no per-frame projection, no state, no rAF.
 */
export function ReticleHUD() {
  return (
    <div className="reticleHud" aria-hidden>
      <div className="reticleHudRing" />
      <div className="reticleHudDot" />
    </div>
  );
}
