"use client";

// Scratch preview route for Phase 1.
// Lets us validate quarks presets and procedural rock geometry/materials
// in isolation without the full game scene.
//
// Open: http://localhost:3000/dev/vfx-preview

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  QuarksProviderRoot,
} from "@/components/game/scene/quarks/QuarksProviderRoot";
import { QuarksEmitterNode } from "@/components/game/scene/quarks/QuarksEmitterNode";
import {
  ALL_PRESET_IDS,
  type QuarksPresetId,
} from "@/components/game/scene/quarks/presets";
import {
  makeMeteorGeometry,
  makeMonolithGeometry,
  makeCrystalShard,
} from "@/components/game/scene/geometry/proceduralRock";
import {
  meteorMaterial,
  monolithMaterial,
  crystalMaterial,
  tickRockMaterial,
} from "@/components/game/scene/materials/rockMaterials";

// (preview imports above)

function RockShowcase() {
  const meteorGeom = useMemo(
    () => makeMeteorGeometry({ radius: 1.2, detail: 3, displacement: 0.35, seed: 42 }),
    []
  );
  const monolithGeom = useMemo(
    () => makeMonolithGeometry({ width: 1.2, height: 4.5, depth: 1.2, displacement: 0.18, seed: 7 }),
    []
  );
  const crystalGeom = useMemo(
    () => makeCrystalShard({ radius: 0.6, height: 2.2, jitter: 0.12, seed: 13 }),
    []
  );
  const meteorMat = useMemo(() => meteorMaterial({ colorA: "#3a2a1e", colorB: "#ff6020" }), []);
  const monolithMat = useMemo(() => monolithMaterial({ colorA: "#5c5248", colorB: "#a8c8ff" }), []);
  const crystalMat = useMemo(() => crystalMaterial({ colorA: "#a0c8ff", colorB: "#ffffff" }), []);

  const meteorRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    tickRockMaterial(meteorMat, t);
    tickRockMaterial(monolithMat, t);
    tickRockMaterial(crystalMat, t);
    if (meteorRef.current) meteorRef.current.rotation.y = t * 0.3;
  });

  return (
    <group>
      <mesh ref={meteorRef} geometry={meteorGeom} material={meteorMat} position={[-4, 1.2, 0]} castShadow />
      <mesh geometry={monolithGeom} material={monolithMat} position={[0, 2.25, 0]} castShadow />
      <mesh geometry={crystalGeom} material={crystalMat} position={[4, 1.1, 0]} castShadow />
    </group>
  );
}

function PresetShowcase({ preset }: { preset: QuarksPresetId }) {
  return (
    <QuarksEmitterNode
      preset={preset}
      position={[0, 0, 0]}
      config={{ intensity: 1, scale: 1 }}
    />
  );
}

export default function VfxPreviewPage() {
  const [preset, setPreset] = useState<QuarksPresetId>("smoke_plume_dark");

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#1a1610", color: "#e8d8b8", fontFamily: "Georgia, serif" }}>
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10, background: "rgba(0,0,0,0.6)", padding: 12, border: "1px solid #b8862b" }}>
        <div style={{ marginBottom: 8, fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }}>VFX Preview</div>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as QuarksPresetId)}
          style={{ background: "#2a1f10", color: "#f3ead0", border: "1px solid #b8862b", padding: 4, fontFamily: "inherit" }}
        >
          {ALL_PRESET_IDS.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
          Drag to orbit. Rocks: meteor / monolith / crystal.
        </div>
      </div>
      <Canvas shadows camera={{ position: [0, 6, 14], fov: 55 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.35} />
          <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow />
          <hemisphereLight args={["#ffe0b0", "#101018", 0.4]} />
          {/* Ground */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[40, 40]} />
            <meshStandardMaterial color="#2a2218" roughness={0.95} />
          </mesh>
          <QuarksProviderRoot>
            <RockShowcase />
            <PresetShowcase preset={preset} />
          </QuarksProviderRoot>
          <OrbitControls target={[0, 1, 0]} />
        </Suspense>
      </Canvas>
    </div>
  );
}
