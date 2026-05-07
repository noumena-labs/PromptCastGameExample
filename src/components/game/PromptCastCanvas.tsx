"use client";

import { KeyboardControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { ArenaScene } from "@/components/game/scene/ArenaScene";
import { GameHud } from "@/components/game/ui/GameHud";
import { PromptOverlay } from "@/components/game/ui/PromptOverlay";
import { NetworkBridge } from "@/components/game/networking/NetworkBridge";

const controls = [
  { name: "forward", keys: ["KeyW", "ArrowUp"] },
  { name: "backward", keys: ["KeyS", "ArrowDown"] },
  { name: "left", keys: ["KeyA", "ArrowLeft"] },
  { name: "right", keys: ["KeyD", "ArrowRight"] },
  { name: "jump", keys: ["Space"] },
];

export function PromptCastCanvas() {
  return (
    <main className="gameShell">
      <KeyboardControls map={controls}>
        <Canvas shadows camera={{ position: [0, 9, 28], fov: 60 }} dpr={[1, 1.6]}>
          <Suspense fallback={null}>
            <ArenaScene />
          </Suspense>
        </Canvas>
      </KeyboardControls>
      <NetworkBridge />
      <GameHud />
      <PromptOverlay />
    </main>
  );
}
