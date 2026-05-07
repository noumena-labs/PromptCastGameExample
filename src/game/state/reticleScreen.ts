/**
 * Screen-space reticle output. Written each frame by the in-canvas
 * `ReticleProjector` (projects `reticleTarget.hitPoint` to NDC), read each
 * animation frame by the DOM-side `ReticleHUD`. Module singleton so neither
 * side triggers React reconciliation per frame.
 */
export const reticleScreen = {
  /** Pixel position relative to the viewport (canvas fills the viewport). */
  x: 0,
  y: 0,
  /** False when the hit point is behind the camera or HUD is suppressed. */
  visible: false,
  /** Color of the currently selected slot's spell — drives the HUD ring tint. */
  color: "#f3e6c4",
};
