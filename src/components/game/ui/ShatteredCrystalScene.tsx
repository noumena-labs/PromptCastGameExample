/**
 * Pure-CSS "shattered crystal" tableau used by Limited Mode surfaces:
 *   - The in-Sanctuary lore panel inside `PromptOverlay`.
 *   - The brief demotion interstitial inside `ModelLoader` when cogentlm
 *     fails at runtime.
 *
 * The crystal silhouette flashes, eight angular shards burst outward along
 * pre-computed vectors, and a few embers drift skyward. After the initial
 * burst (~0.9s) the shards transition into a slow ambient drift via the
 * second keyframe track defined in `globals.css`. All values are
 * deterministic so SSR and client renders match — no `Math.random()`.
 */
"use client";

import type { CSSProperties } from "react";

export function ShatteredCrystalScene() {
  // Eight shards spread roughly evenly around the circle, with slight
  // variance in distance and rotation so they feel hand-broken rather than
  // metronomically placed. Pre-computed from a sketch:
  //   angle (deg) → (dx, dy) at radii 58–82 px.
  // Negative dy = upward (screen Y is down).
  const shards: Array<{
    dx: number;
    dy: number;
    rot: number;
    tiny?: boolean;
  }> = [
    { dx: 0, dy: -78, rot: -12 },        //  N
    { dx: 56, dy: -56, rot: 38 },        //  NE
    { dx: 78, dy: -8, rot: 86 },         //  E
    { dx: 60, dy: 44, rot: 132 },        //  SE
    { dx: 4, dy: 70, rot: 178 },         //  S
    { dx: -58, dy: 48, rot: -132 },      //  SW
    { dx: -82, dy: -4, rot: -88 },       //  W
    { dx: -54, dy: -52, rot: -42 },      //  NW
    // A few smaller chips closer in for visual density.
    { dx: 30, dy: -34, rot: 22, tiny: true },
    { dx: -28, dy: 24, rot: -118, tiny: true },
    { dx: 42, dy: 12, rot: 70, tiny: true },
    { dx: -34, dy: -18, rot: -64, tiny: true },
  ];

  // Three rising embers with distinct end points & timing (delay set inline).
  const embers: Array<{ ex: number; ey: number; delay: number }> = [
    { ex: -8, ey: -64, delay: 0.4 },
    { ex: 14, ey: -78, delay: 1.6 },
    { ex: -2, ey: -56, delay: 2.8 },
  ];

  return (
    <div className="shatteredCrystalScene" aria-hidden>
      <span className="shatteredCrystalFlash" />
      <span className="shatteredCrystalGhost" />
      {shards.map((shard, i) => (
        <span
          key={`shard-${i}`}
          className={`shatteredCrystalShard${shard.tiny ? " tiny" : ""}`}
          style={
            {
              "--dx": `${shard.dx}px`,
              "--dy": `${shard.dy}px`,
              "--rot": `${shard.rot}deg`,
            } as CSSProperties
          }
        />
      ))}
      {embers.map((ember, i) => (
        <span
          key={`ember-${i}`}
          className="shatteredCrystalEmber"
          style={
            {
              "--ex": `${ember.ex}px`,
              "--ey": `${ember.ey}px`,
              animationDelay: `${ember.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
