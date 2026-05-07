"use client";

import { Sky } from "@react-three/drei";
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
    </>
  );
}
