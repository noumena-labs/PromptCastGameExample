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
import { SceneNodeRenderer } from "@/components/game/scene/SceneNodeRenderer";
import { MorphingTerrainMesh } from "@/components/game/scene/Meadow";
import {
  QuarksProviderRoot,
} from "@/components/game/scene/quarks/QuarksProviderRoot";
import { QuarksEmitterNode } from "@/components/game/scene/quarks/QuarksEmitterNode";
import {
  ALL_PRESET_IDS,
  getQuarksPresetTextures,
  type QuarksPresetTextureUsage,
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
import { alignmentCatalog } from "@/game/spells/modules/alignments";
import {
  deliveryVehicleIds,
  spellAlignmentIds,
  type DeliveryVehicleId,
  type SpellAlignmentId,
  type SpellBuildSpec,
} from "@/game/spells/modules/spellIds";
import { clampScene, type SceneLeaf, type SpellScene } from "@/game/spells/sceneNode";
import { compileVfxPayload } from "@/game/spells/vfx/compileVfxPayload";
import {
  shouldTerrainMorph,
  terrainMorphSeed,
  terrainMorphWorldRadius,
  type TerrainMorphSource,
} from "@/game/arena/terrainMorph";

// (preview imports above)

type PreviewMode = "preset" | "generated";
type ScenePhase = "cast" | "travel" | "impact";

const PHASES: ScenePhase[] = ["cast", "travel", "impact"];

function generatedSpec(
  alignment: SpellAlignmentId,
  deliveryVehicle: DeliveryVehicleId,
): SpellBuildSpec {
  const defaults = alignmentCatalog[alignment];
  return {
    name: `${defaults.label} ${deliveryVehicle}`,
    alignment,
    deliveryVehicle,
    vfx: {
      coreMesh: defaults.defaultCoreMesh,
      travel: defaults.defaultTravel,
      impact: defaults.defaultImpact,
      shaders: defaults.defaultShaders,
    },
    modifiers: {
      scale: 1.2,
      speed: 1,
      duration: 1,
      intensity: 1.2,
    },
    count: 1,
    intentSummary: "Dev preview spell",
    castImagery: "Preview cast effect",
    impactImagery: "Preview impact effect",
  };
}

function compilePreviewScene(
  alignment: SpellAlignmentId,
  deliveryVehicle: DeliveryVehicleId,
  phase: ScenePhase,
): SpellScene {
  const scenes = compileVfxPayload(generatedSpec(alignment, deliveryVehicle));
  return clampScene(scenes[phase]);
}

function previewTerrainMorphSource(spec: SpellBuildSpec, phase: ScenePhase): TerrainMorphSource[] {
  if (phase !== "impact" || !shouldTerrainMorph(spec)) return [];
  const now = Date.now();
  return [
    {
      position: [0, 0, 0],
      alignment: spec.alignment,
      radius: terrainMorphWorldRadius(spec.alignment, 3.6),
      powerTier: 3,
      intensity: spec.modifiers.intensity,
      createdAt: now - 15_000,
      expiresAt: now + 60_000,
      seed: terrainMorphSeed(spec),
    },
  ];
}

function allSceneNodes(scene: SpellScene): SceneLeaf[] {
  return [scene, ...scene.children];
}

function sceneDiagnostics(scene: SpellScene) {
  const nodes = allSceneNodes(scene);
  const quarks = nodes
    .filter((node) => node.shape === "quarks_emitter")
    .map((node) => ({
      preset: node.quarksPreset ?? "smoke_plume_dark",
      textures: getQuarksPresetTextures(
        (node.quarksPreset ?? "smoke_plume_dark") as QuarksPresetId,
      ),
      intensity: node.intensity ?? 1,
    }));
  const legacyCount = nodes.filter((node) => node.shape === "particle_cloud").length;
  return { quarks, legacyCount };
}

function textureLine(texture: QuarksPresetTextureUsage): string {
  if (texture.kind === "png") return `${texture.filename} - ${texture.role}`;
  if (texture.kind === "debug") return `debug texture: ${texture.role}`;
  return `procedural: ${texture.role}`;
}

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

function GeneratedShowcase({
  alignment,
  deliveryVehicle,
  phase,
}: {
  alignment: SpellAlignmentId;
  deliveryVehicle: DeliveryVehicleId;
  phase: ScenePhase;
}) {
  const spec = useMemo(
    () => generatedSpec(alignment, deliveryVehicle),
    [alignment, deliveryVehicle],
  );
  const scene = useMemo(
    () => compilePreviewScene(alignment, deliveryVehicle, phase),
    [alignment, deliveryVehicle, phase],
  );
  const morphSources = useMemo(
    () => previewTerrainMorphSource(spec, phase),
    [phase, spec],
  );

  return (
    <>
      <MorphingTerrainMesh size={40} segments={96} sources={morphSources} />
      <SceneNodeRenderer
        key={`${alignment}:${deliveryVehicle}:${phase}`}
        scene={scene}
        spellId={`preview:${alignment}:${deliveryVehicle}:${phase}`}
        lifetimeSeconds={phase === "impact" ? 2.4 : 4}
        variant={phase === "impact" ? "impact" : phase === "travel" ? "travel" : "cast"}
      />
    </>
  );
}

export default function VfxPreviewPage() {
  const [preset, setPreset] = useState<QuarksPresetId>("smoke_plume_dark");
  const [mode, setMode] = useState<PreviewMode>("preset");
  const [alignment, setAlignment] = useState<SpellAlignmentId>("fire");
  const [deliveryVehicle, setDeliveryVehicle] = useState<DeliveryVehicleId>("projectile_linear");
  const [phase, setPhase] = useState<ScenePhase>("travel");
  const generatedScene = useMemo(
    () => compilePreviewScene(alignment, deliveryVehicle, phase),
    [alignment, deliveryVehicle, phase],
  );
  const diagnostics = useMemo(
    () => sceneDiagnostics(generatedScene),
    [generatedScene],
  );
  const presetTextures = getQuarksPresetTextures(preset);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#1a1610", color: "#e8d8b8", fontFamily: "Georgia, serif" }}>
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10, width: 330, background: "rgba(0,0,0,0.68)", padding: 12, border: "1px solid #b8862b" }}>
        <div style={{ marginBottom: 8, fontSize: 13, letterSpacing: 1, textTransform: "uppercase" }}>VFX Preview</div>
        <label style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
          Mode
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PreviewMode)}
            style={{ display: "block", width: "100%", marginTop: 4, background: "#2a1f10", color: "#f3ead0", border: "1px solid #b8862b", padding: 4, fontFamily: "inherit" }}
          >
            <option value="preset">Quarks preset</option>
            <option value="generated">Generated spell scene</option>
          </select>
        </label>
        {mode === "preset" ? (
          <>
            <label style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
              Preset
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as QuarksPresetId)}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#2a1f10", color: "#f3ead0", border: "1px solid #b8862b", padding: 4, fontFamily: "inherit" }}
              >
                {ALL_PRESET_IDS.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
            <DiagnosticsBlock
              lines={presetTextures.length > 0
                ? presetTextures.map(textureLine)
                : ["No material metadata for preset"]}
            />
          </>
        ) : (
          <>
            <label style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
              Alignment
              <select
                value={alignment}
                onChange={(e) => setAlignment(e.target.value as SpellAlignmentId)}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#2a1f10", color: "#f3ead0", border: "1px solid #b8862b", padding: 4, fontFamily: "inherit" }}
              >
                {spellAlignmentIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
              Delivery
              <select
                value={deliveryVehicle}
                onChange={(e) => setDeliveryVehicle(e.target.value as DeliveryVehicleId)}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#2a1f10", color: "#f3ead0", border: "1px solid #b8862b", padding: 4, fontFamily: "inherit" }}
              >
                {deliveryVehicleIds.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
              Phase
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value as ScenePhase)}
                style={{ display: "block", width: "100%", marginTop: 4, background: "#2a1f10", color: "#f3ead0", border: "1px solid #b8862b", padding: 4, fontFamily: "inherit" }}
              >
                {PHASES.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
            <DiagnosticsBlock
              lines={[
                `${diagnostics.quarks.length} quarks emitter(s)`,
                `${diagnostics.legacyCount} legacy particle_cloud node(s)`,
                ...diagnostics.quarks.flatMap((item) => {
                  const textureText = item.textures.length > 0
                    ? item.textures.map((texture) => textureLine(texture)).join(", ")
                    : "no material metadata";
                  return [`${item.preset} x${item.intensity.toFixed(2)} -> ${textureText}`];
                }),
              ]}
            />
          </>
        )}
        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
          Drag to orbit. Preset mode includes standalone rock shader props; generated mode shows only the compiled spell scene.
        </div>
      </div>
      <Canvas shadows camera={{ position: [0, 6, 14], fov: 55 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.35} />
          <directionalLight position={[8, 12, 6]} intensity={1.2} castShadow />
          <hemisphereLight args={["#ffe0b0", "#101018", 0.4]} />
          {/* Ground */}
          {mode === "preset" && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[40, 40]} />
              <meshStandardMaterial color="#2a2218" roughness={0.95} />
            </mesh>
          )}
          <QuarksProviderRoot>
            {mode === "preset" && <RockShowcase />}
            {mode === "preset" ? (
              <PresetShowcase key={preset} preset={preset} />
            ) : (
              <GeneratedShowcase
                alignment={alignment}
                deliveryVehicle={deliveryVehicle}
                phase={phase}
              />
            )}
          </QuarksProviderRoot>
          <OrbitControls target={[0, 1, 0]} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function DiagnosticsBlock({ lines }: { lines: string[] }) {
  return (
    <div style={{ marginTop: 10, padding: 8, background: "rgba(255,255,255,0.06)", fontSize: 11, lineHeight: 1.45 }}>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
