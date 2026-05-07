"use client";

import { KeyboardControls, PointerLockControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
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
        <Canvas shadows camera={{ position: [0, 9, 14], fov: 55 }} dpr={[1, 1.6]}>
          <color attach="background" args={["#07110f"]} />
          <fog attach="fog" args={["#07110f", 28, 82]} />
          <Suspense fallback={null}>
            <Physics gravity={[0, -18, 0]}>
              <ArenaScene />
            </Physics>
          </Suspense>
          <PointerLockControls selector="#arena-lock-target" />
        </Canvas>
      </KeyboardControls>
      <button id="arena-lock-target" className="lockButton" type="button">
        Click to lock mouse and play
      </button>
      <NetworkBridge />
      <GameHud />
      <PromptOverlay />
    </main>
  );
}
