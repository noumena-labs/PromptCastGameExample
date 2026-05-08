"use client";

import { KeyboardControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Suspense } from "react";
import { ArenaScene } from "@/components/game/scene/ArenaScene";
import { QuarksProviderRoot } from "@/components/game/scene/quarks/QuarksProviderRoot";
import { GameHud } from "@/components/game/ui/GameHud";
import { ModelLoader } from "@/components/game/ui/ModelLoader";
import { PromptOverlay } from "@/components/game/ui/PromptOverlay";
import { ReticleHUD } from "@/components/game/ui/ReticleHUD";
import { NetworkBridge } from "@/components/game/networking/NetworkBridge";
import { MultiplayerDebugPanel } from "@/components/game/networking/MultiplayerDebugPanel";
import { useGameStore } from "@/game/state/gameStore";
import { useAudioUnlock, useLoopingAudio, useUiClickAudio } from "@/game/audio/useGameAudio";

const controls = [
  { name: "forward", keys: ["KeyW", "ArrowUp"] },
  { name: "backward", keys: ["KeyS", "ArrowDown"] },
  { name: "left", keys: ["KeyA", "ArrowLeft"] },
  { name: "right", keys: ["KeyD", "ArrowRight"] },
  { name: "jump", keys: ["Space"] },
];

export function PromptCastCanvas() {
  const mode = useGameStore((state) => state.mode);
  const connected = useGameStore((state) => state.lastHostSnapshot !== null);
  const promptOpen = useGameStore((state) => state.promptOpen);
  const waitingForHost = mode === "client" && !connected;
  useAudioUnlock();
  useUiClickAudio();
  useLoopingAudio(waitingForHost ? null : "music_arena_loop", "music:arena", promptOpen ? 0.16 : 1);
  useLoopingAudio(waitingForHost ? null : "ambience_meadow_loop", "ambience:meadow", 0.9);
  useLoopingAudio(promptOpen ? "music_sanctuary_loop" : null, "music:sanctuary", 0.92);

  return (
    <ModelLoader>
      <main className="gameShell">
        <NetworkBridge />
        {waitingForHost ? (
          <div className="loadingScreen">Synchronizing host state...</div>
        ) : (
          <>
            <KeyboardControls map={controls}>
              <Canvas shadows camera={{ position: [0, 9, 28], fov: 60 }} dpr={[1, 1.6]}>
                <Suspense fallback={null}>
                  {/* QuarksProviderRoot owns the single BatchedRenderer for the
                      whole scene; every <QuarksEmitterNode> registers with it. */}
                  <QuarksProviderRoot>
                    <Physics gravity={[0, -22, 0]} timeStep="vary" colliders={false}>
                      <ArenaScene />
                    </Physics>
                  </QuarksProviderRoot>
                </Suspense>
              </Canvas>
            </KeyboardControls>
            <ReticleHUD />
            <GameHud />
            <PromptOverlay />
          </>
        )}
        <MultiplayerDebugPanel />
      </main>
    </ModelLoader>
  );
}
