"use client";

// Scratch preview route for Phase 1.
// Lets us validate quarks presets and procedural rock geometry/materials
// in isolation without the full game scene.
//
// Open: http://localhost:3000/dev/vfx-preview

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SceneNodeRenderer } from "@/components/game/scene/SceneNodeRenderer";
import { MorphingTerrainMesh } from "@/components/game/scene/Meadow";
import { PostFX } from "@/components/game/scene/PostFX";
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
  TERRAIN_MORPH_REPRESENTATIVE_IMPACT_RADIUS,
  terrainMorphSeed,
  terrainMorphWorldRadius,
  type TerrainMorphSource,
} from "@/game/arena/terrainMorph";

// (preview imports above)

type PreviewMode = "preset" | "generated";
type ScenePhase = "travel" | "impact";

const PHASES: ScenePhase[] = ["travel", "impact"];
const MIN_AUTO_ADVANCE_SECONDS = 0.5;
const MIN_AUTO_ORBIT_SPEED = 0.1;

function nextItem<T extends string>(items: readonly T[], current: T): T {
  const index = items.indexOf(current);
  const nextIndex = index < 0 ? 0 : (index + 1) % items.length;
  return items[nextIndex];
}

function numericInputValue(value: string, min: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(min, next) : min;
}

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
      radius: terrainMorphWorldRadius(spec.alignment, TERRAIN_MORPH_REPRESENTATIVE_IMPACT_RADIUS),
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
        variant={phase}
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
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [autoOrbitSpeed, setAutoOrbitSpeed] = useState(0.7);
  const [autoAdvanceAlignment, setAutoAdvanceAlignment] = useState(false);
  const [autoAdvanceAlignmentSeconds, setAutoAdvanceAlignmentSeconds] = useState(5);
  const [autoAdvanceDelivery, setAutoAdvanceDelivery] = useState(false);
  const [autoAdvanceDeliverySeconds, setAutoAdvanceDeliverySeconds] = useState(6);
  const [autoAdvancePhase, setAutoAdvancePhase] = useState(false);
  const [autoAdvancePhaseSeconds, setAutoAdvancePhaseSeconds] = useState(4);
  const generatedScene = useMemo(
    () => compilePreviewScene(alignment, deliveryVehicle, phase),
    [alignment, deliveryVehicle, phase],
  );
  const diagnostics = useMemo(
    () => sceneDiagnostics(generatedScene),
    [generatedScene],
  );
  const presetTextures = getQuarksPresetTextures(preset);

  useEffect(() => {
    if (mode !== "generated" || !autoAdvanceAlignment) return;
    const timeoutId = window.setTimeout(() => {
      setAlignment((current) => nextItem(spellAlignmentIds, current));
    }, autoAdvanceAlignmentSeconds * 1000);
    return () => window.clearTimeout(timeoutId);
  }, [alignment, autoAdvanceAlignment, autoAdvanceAlignmentSeconds, mode]);

  useEffect(() => {
    if (mode !== "generated" || !autoAdvanceDelivery) return;
    const timeoutId = window.setTimeout(() => {
      setDeliveryVehicle((current) => nextItem(deliveryVehicleIds, current));
    }, autoAdvanceDeliverySeconds * 1000);
    return () => window.clearTimeout(timeoutId);
  }, [autoAdvanceDelivery, autoAdvanceDeliverySeconds, deliveryVehicle, mode]);

  useEffect(() => {
    if (mode !== "generated" || !autoAdvancePhase) return;
    const timeoutId = window.setTimeout(() => {
      setPhase((current) => nextItem(PHASES, current));
    }, autoAdvancePhaseSeconds * 1000);
    return () => window.clearTimeout(timeoutId);
  }, [autoAdvancePhase, autoAdvancePhaseSeconds, mode, phase]);

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#1a1610", color: "#e8d8b8", fontFamily: "Georgia, serif" }}>
      <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10, width: 360, maxHeight: "calc(100vh - 24px)", overflowY: "auto", background: "rgba(0,0,0,0.68)", padding: 12, border: "1px solid #b8862b" }}>
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
        <div style={{ marginBottom: 10, padding: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(184,134,43,0.45)" }}>
          <div style={{ marginBottom: 8, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", opacity: 0.85 }}>Recording Controls</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={autoOrbit}
                onChange={(e) => setAutoOrbit(e.target.checked)}
                style={{ accentColor: "#b8862b" }}
              />
              Auto orbit
            </label>
            <input
              type="number"
              min={MIN_AUTO_ORBIT_SPEED}
              step={0.1}
              value={autoOrbitSpeed}
              onChange={(e) => setAutoOrbitSpeed(numericInputValue(e.target.value, MIN_AUTO_ORBIT_SPEED))}
              aria-label="Auto orbit speed"
              style={{ width: "100%", background: "#2a1f10", color: "#f3ead0", border: "1px solid #b8862b", padding: 4, fontFamily: "inherit" }}
            />
          </div>
          {mode === "generated" ? (
            <>
              <div style={{ marginBottom: 6, fontSize: 11, opacity: 0.72 }}>Seconds before advancing each generated-scene selector.</div>
              <AutoAdvanceRow
                label="Alignment"
                enabled={autoAdvanceAlignment}
                seconds={autoAdvanceAlignmentSeconds}
                onEnabledChange={setAutoAdvanceAlignment}
                onSecondsChange={setAutoAdvanceAlignmentSeconds}
              />
              <AutoAdvanceRow
                label="Delivery"
                enabled={autoAdvanceDelivery}
                seconds={autoAdvanceDeliverySeconds}
                onEnabledChange={setAutoAdvanceDelivery}
                onSecondsChange={setAutoAdvanceDeliverySeconds}
              />
              <AutoAdvanceRow
                label="Phase"
                enabled={autoAdvancePhase}
                seconds={autoAdvancePhaseSeconds}
                onEnabledChange={setAutoAdvancePhase}
                onSecondsChange={setAutoAdvancePhaseSeconds}
              />
            </>
          ) : (
            <div style={{ fontSize: 11, opacity: 0.72 }}>Auto-advance is available in generated spell scene mode.</div>
          )}
        </div>
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
      <Canvas
        shadows
        camera={{ position: [0, 6, 14], fov: 55 }}
        gl={{
          antialias: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: "high-performance",
        }}
      >
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
          <OrbitControls
            target={[0, 1, 0]}
            autoRotate={autoOrbit}
            autoRotateSpeed={autoOrbitSpeed}
            enableDamping
            dampingFactor={0.08}
          />
          <PostFX />
        </Suspense>
      </Canvas>
    </div>
  );
}

function AutoAdvanceRow({
  label,
  enabled,
  seconds,
  onEnabledChange,
  onSecondsChange,
}: {
  label: string;
  enabled: boolean;
  seconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (seconds: number) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 12 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          style={{ accentColor: "#b8862b" }}
        />
        {label}
      </label>
      <input
        type="number"
        min={MIN_AUTO_ADVANCE_SECONDS}
        step={0.5}
        value={seconds}
        onChange={(e) => onSecondsChange(numericInputValue(e.target.value, MIN_AUTO_ADVANCE_SECONDS))}
        aria-label={`${label} auto-advance seconds`}
        style={{ width: "100%", background: "#2a1f10", color: "#f3ead0", border: "1px solid #b8862b", padding: 4, fontFamily: "inherit" }}
      />
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
