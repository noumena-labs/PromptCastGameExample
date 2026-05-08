"use client";

import { useEffect, useState } from "react";
import { Sky } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Crystals } from "@/components/game/scene/Crystals";
import { ManaMotes } from "@/components/game/scene/ManaMotes";
import { DummyTargets } from "@/components/game/scene/DummyTargets";
import { GameplaySystems } from "@/components/game/systems/GameplaySystems";
import { LocalWizard } from "@/components/game/scene/LocalWizard";
import { Meadow } from "@/components/game/scene/Meadow";
import { RemoteWizards } from "@/components/game/scene/RemoteWizards";
import { Shrine } from "@/components/game/scene/Shrine";
import { SpellEntities } from "@/components/game/scene/SpellEntities";
import { Trees } from "@/components/game/scene/Trees";
import { Flowers, GrassClumps } from "@/components/game/scene/Flowers";
import { shaderPresetCatalog } from "@/game/spells/modules/shaderPresets";
import { SpellShaderMaterial } from "@/components/game/scene/SpellShaderMaterial";
import type { SpellShaderId } from "@/game/spells/modules/spellIds";
import { QuarksEmitterNode } from "@/components/game/scene/quarks/QuarksEmitterNode";
import { useOptionalQuarksRenderer } from "@/components/game/scene/quarks/QuarksProviderRoot";
import { ALL_PRESET_IDS } from "@/components/game/scene/quarks/presets";

export function ArenaScene() {
  return (
    <>
      {/* Golden-hour sky */}
      <Sky distance={4500} sunPosition={[40, 18, 80]} inclination={0.49} azimuth={0.25} mieCoefficient={0.012} mieDirectionalG={0.9} rayleigh={2.4} turbidity={6} />

      {/* Lighting */}
      <hemisphereLight args={["#fde7c0", "#5d6e3a", 0.55]} />
      <ambientLight intensity={0.18} color="#fff2d6" />
      <directionalLight
        castShadow
        position={[60, 70, 40]}
        intensity={2.4}
        color="#ffd9a3"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.0005}
      />

      <fog attach="fog" args={["#dcc89a", 60, 220]} />

      <Meadow />
      <GrassClumps />
      <Flowers color="#f3d24a" count={140} seed={31} />
      <Flowers color="#f06b8c" count={90} seed={52} />
      <Flowers color="#c578f0" count={70} seed={71} innerRadius={10} />
      <Flowers color="#f5f0d4" count={110} seed={97} />

      <Shrine />
      <Trees />

      <Crystals />
      <ManaMotes />
      <DummyTargets />
      <SpellEntities />
      <RemoteWizards />
      <LocalWizard />
      <GameplaySystems />
      <ShaderPrewarm />
      <QuarksPrewarm />
    </>
  );
}

/**
 * Pre-compiles every shader permutation currently in the scene so we never pay
 * a multi-hundred-millisecond compile cost mid-gameplay. Without this, the
 * first time a unique material/light combination renders, Three.js blocks the
 * main thread to compile its program. Combined with stable point-light counts
 * (no entity-attached pointLights), this keeps frame times flat after load.
 */
function ShaderPrewarm() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const shaderIds = Object.keys(shaderPresetCatalog) as SpellShaderId[];

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      gl.compile(scene, camera);
    });
    return () => cancelAnimationFrame(handle);
  }, [gl, scene, camera]);

  return (
    <group position={[0, -5000, 0]} scale={0.01}>
      {shaderIds.map((id) => (
        <mesh key={id}>
          <planeGeometry args={[1, 1]} />
          <SpellShaderMaterial shaderId={id} animated={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Mounts every quarks preset once, far offscreen, just long enough for the
 * BatchedRenderer to build its sprite/trail batches and for gl.compile to
 * pick up the resulting programs. Then unmounts so live spells own the budget.
 *
 * Skips entirely if no QuarksProviderRoot is present (e.g. preview routes).
 */
function QuarksPrewarm() {
  const renderer = useOptionalQuarksRenderer();
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!renderer) return;
    // Two-frame strategy: frame 1 mounts emitters, frame 2 compiles + unmounts.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        gl.compile(scene, camera);
        setActive(false);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [renderer, gl, scene, camera]);

  if (!renderer || !active) return null;

  return (
    <group position={[0, -5000, 0]} scale={0.01}>
      {ALL_PRESET_IDS.map((id) => (
        <QuarksEmitterNode
          key={id}
          preset={id}
          config={{ intensity: 0.01, scale: 0.01, looping: false }}
        />
      ))}
    </group>
  );
}
