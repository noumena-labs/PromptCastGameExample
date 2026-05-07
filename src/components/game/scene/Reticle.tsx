"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3 } from "three";
import { useGameStore } from "@/game/state/gameStore";
import { reticleTarget } from "@/game/state/reticleTarget";
import { reticleScreen } from "@/game/state/reticleScreen";

/**
 * In-canvas reticle projector. Reads the per-frame `reticleTarget.hitPoint`
 * (written by `LocalWizard` from a shoulder-anchored Rapier raycast) and
 * projects it to viewport pixels, publishing the result to `reticleScreen`
 * for the DOM-side `ReticleHUD` to render.
 *
 * No mesh: the reticle is a screen-space `<div>` sibling of the `<Canvas>`,
 * so it renders crisp at any resolution and is unaffected by post-processing,
 * fog, depth, or stereoscopic projection issues.
 */
export function Reticle() {
  const { camera, size } = useThree();
  const promptOpen = useGameStore((state) => state.promptOpen);
  const slotColor = useGameStore((state) => {
    const player = state.players[state.localPlayerId];
    return player?.spellSlots[state.selectedSlot]?.color ?? "#f3e6c4";
  });

  const tmp = useRef(new Vector3());

  useFrame(() => {
    if (promptOpen || !reticleTarget.ready) {
      reticleScreen.visible = false;
      return;
    }

    tmp.current.set(
      reticleTarget.hitPoint[0],
      reticleTarget.hitPoint[1],
      reticleTarget.hitPoint[2],
    );
    tmp.current.project(camera);

    // After project(), z > 1 means the point is behind the camera (or beyond
    // the far plane). x/y are in NDC ([-1, 1] inside the frustum).
    if (tmp.current.z > 1) {
      reticleScreen.visible = false;
      return;
    }

    reticleScreen.x = (tmp.current.x * 0.5 + 0.5) * size.width;
    reticleScreen.y = (-tmp.current.y * 0.5 + 0.5) * size.height;
    reticleScreen.visible = true;
    reticleScreen.color = slotColor;
  });

  return null;
}
