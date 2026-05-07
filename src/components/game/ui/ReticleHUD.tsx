"use client";

import { useEffect, useRef } from "react";
import { reticleScreen } from "@/game/state/reticleScreen";

/**
 * DOM-side reticle. Mounted as a sibling of the R3F `<Canvas>` so it lives
 * in screen space (immune to camera FOV stretching, post-processing, or 3D
 * depth/billboard issues). Reads the per-frame `reticleScreen` singleton
 * (written by the in-canvas `Reticle` projector) on each animation frame and
 * mutates the DOM directly — no React re-render per frame.
 */
export function ReticleHUD() {
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const ring = ringRef.current;
      const dot = dotRef.current;
      if (!ring || !dot) return;

      if (!reticleScreen.visible) {
        if (ring.style.opacity !== "0") ring.style.opacity = "0";
        if (dot.style.opacity !== "0") dot.style.opacity = "0";
        return;
      }

      // GPU-friendly transform; avoid layout-thrashing top/left.
      const transform = `translate3d(${reticleScreen.x}px, ${reticleScreen.y}px, 0) translate(-50%, -50%)`;
      ring.style.transform = transform;
      dot.style.transform = transform;
      ring.style.opacity = "1";
      dot.style.opacity = "1";
      ring.style.borderColor = reticleScreen.color;
      dot.style.background = reticleScreen.color;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="reticleHud" aria-hidden>
      <div ref={ringRef} className="reticleHudRing" />
      <div ref={dotRef} className="reticleHudDot" />
    </div>
  );
}
