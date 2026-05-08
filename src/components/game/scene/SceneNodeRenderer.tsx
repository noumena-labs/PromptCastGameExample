"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, type MeshStandardMaterial } from "three";
import type { SceneLeaf, SpellScene } from "@/game/spells/sceneNode";
import {
  applyMotion,
  arrangePositions,
  seedFromId,
  type MotionDelta,
} from "@/components/game/scene/sceneMotion";
import { ParticleEmitterNode } from "@/components/game/scene/ParticleEmitterNode";
import { SpellShaderMaterial } from "@/components/game/scene/SpellShaderMaterial";
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
import { QuarksEmitterNode } from "@/components/game/scene/quarks/QuarksEmitterNode";
import { shouldLoopQuarksPreset, type QuarksPresetId } from "@/components/game/scene/quarks/presets";

/**
 * Recursive renderer for the SceneNode DSL.
 *
 * The tree is depth-1: a root node + up to 6 leaf children. We render the
 * root with its arrange / motion, and each child the same way nested under
 * the root's local frame.
 *
 * Light cap: Three.js point lights are expensive on a forward renderer. We
 * count emissive nodes (emissiveIntensity > 0.5) across the whole scene and
 * keep at most 2. This is enforced HERE rather than in clampScene so the
 * VFX templates can author scenes with broad emissive intent and the renderer
 * just picks the strongest two.
 */

const LIGHT_CAP = 1;
const IMPACT_LIGHT_CAP = 2;
const LIGHT_THRESHOLD = 0.5;

export function SceneNodeRenderer({
  scene,
  spellId,
  spawnedAt,
  lifetimeSeconds,
  variant = "cast",
  effectScale = 1,
}: {
  scene: SpellScene;
  spellId: string;
  spawnedAt?: number;
  lifetimeSeconds?: number;
  variant?: "cast" | "travel" | "impact";
  effectScale?: number;
}) {
  const seed = useMemo(() => seedFromId(spellId), [spellId]);
  const groupRef = useRef<Group>(null);

  // Pick the top-N most-emissive nodes to host point lights. Everything else
  // still uses meshStandardMaterial.emissive but contributes no actual light.
  const lightNodeIds = useMemo(() => {
    const cap = variant === "impact" ? IMPACT_LIGHT_CAP : LIGHT_CAP;
    const all: { idx: number; v: number }[] = [];
    if (scene.emissiveIntensity > LIGHT_THRESHOLD) all.push({ idx: -1, v: scene.emissiveIntensity });
    scene.children.forEach((c, i) => {
      if (c.emissiveIntensity > LIGHT_THRESHOLD) all.push({ idx: i, v: c.emissiveIntensity });
    });
    all.sort((a, b) => b.v - a.v);
    return new Set(all.slice(0, cap).map((x) => x.idx));
  }, [scene, variant]);

  const opacityMultiplier = impactOpacityMultiplier(variant, spawnedAt, lifetimeSeconds);
  const particleScale = Math.max(0.45, Math.sqrt(effectScale));
  const quarksIntensityMultiplier = Math.max(
    0.25,
    particleScale * impactParticleMultiplier(variant, spawnedAt, lifetimeSeconds),
  );
  const quarksEmissionScale = impactParticleMultiplier(variant, spawnedAt, lifetimeSeconds);

  useFrame(() => {
    if (!groupRef.current || variant !== "impact" || spawnedAt === undefined) return;
    const age = (Date.now() - spawnedAt) / 1000;
    const pop = 1 + Math.min(1, age / 0.22) * 0.22;
    groupRef.current.scale.setScalar(pop);
  });

  return (
    <group ref={groupRef}>
      <NodeInstance
        node={scene}
        seed={seed}
        hostsLight={lightNodeIds.has(-1)}
        variant={variant}
        opacityMultiplier={opacityMultiplier}
        effectScale={effectScale}
        quarksIntensityMultiplier={quarksIntensityMultiplier}
        quarksEmissionScale={quarksEmissionScale}
      />
      {scene.children.map((child, i) => (
        <NodeInstance
          key={i}
          node={child}
          seed={seed ^ ((i + 1) * 0x9e3779b9)}
          hostsLight={lightNodeIds.has(i)}
          variant={variant}
          opacityMultiplier={opacityMultiplier}
          effectScale={effectScale}
          quarksIntensityMultiplier={quarksIntensityMultiplier}
          quarksEmissionScale={quarksEmissionScale}
        />
      ))}
    </group>
  );
}

function impactParticleMultiplier(
  variant: "cast" | "travel" | "impact",
  spawnedAt?: number,
  lifetimeSeconds?: number,
): number {
  if (variant !== "impact" || spawnedAt === undefined || !lifetimeSeconds) return 1;
  const age = (Date.now() - spawnedAt) / 1000;
  const fadeStart = lifetimeSeconds * 0.58;
  if (age <= fadeStart) return 1;
  return Math.max(0, 1 - (age - fadeStart) / Math.max(0.15, lifetimeSeconds - fadeStart));
}

function impactOpacityMultiplier(
  variant: "cast" | "travel" | "impact",
  spawnedAt?: number,
  lifetimeSeconds?: number,
): number {
  if (variant !== "impact" || spawnedAt === undefined || !lifetimeSeconds) return 1;
  const age = (Date.now() - spawnedAt) / 1000;
  const fadeStart = lifetimeSeconds * 0.68;
  if (age <= fadeStart) return 1;
  return Math.max(0, 1 - (age - fadeStart) / Math.max(0.1, lifetimeSeconds - fadeStart));
}

/**
 * Renders one node, handling `arrange` (multiple instances) and `motion`
 * (per-frame transform). Each instance shares the same shape + material;
 * motion is applied to the shared parent group, so a `ring` of orbiting
 * shards spins as a unit (which is what "arrange + motion" should mean).
 */
function NodeInstance({
  node,
  seed,
  hostsLight,
  variant,
  opacityMultiplier,
  effectScale,
  quarksIntensityMultiplier,
  quarksEmissionScale,
}: {
  node: SceneLeaf;
  seed: number;
  hostsLight: boolean;
  variant: "cast" | "travel" | "impact";
  opacityMultiplier: number;
  effectScale: number;
  quarksIntensityMultiplier: number;
  quarksEmissionScale: number;
}) {
  const groupRef = useRef<Group>(null);
  const elapsedRef = useRef(0);
  const deltaRef = useRef<MotionDelta>({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 });

  const offsets = useMemo(
    () => arrangePositions(node.arrange, node.arrangeCount, node.arrangeRadius, seed),
    [node.arrange, node.arrangeCount, node.arrangeRadius, seed],
  );

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    elapsedRef.current += delta;
    const d = applyMotion(node.motion, node.motionSpeed, elapsedRef.current, deltaRef.current);
    groupRef.current.position.set(
      node.position[0] + d.position[0],
      node.position[1] + d.position[1],
      node.position[2] + d.position[2],
    );
    groupRef.current.rotation.set(
      node.rotation[0] + d.rotation[0],
      node.rotation[1] + d.rotation[1],
      node.rotation[2] + d.rotation[2],
    );
    groupRef.current.scale.setScalar(d.scale);
  });

  return (
    <group ref={groupRef}>
      {hostsLight && (
        <pointLight
          color={node.color}
          intensity={Math.min(node.emissiveIntensity, 4) * (variant === "impact" ? 2.2 : 1.2) * Math.min(1, effectScale)}
          distance={Math.max(2, node.size * (variant === "impact" ? 10 : 6))}
          decay={2}
        />
      )}
      {offsets.map((offset, i) => (
        <group key={i} position={offset}>
          <ShapePrimitive
            node={node}
            variant={variant}
            opacityMultiplier={opacityMultiplier}
            quarksIntensityMultiplier={quarksIntensityMultiplier}
            quarksEmissionScale={quarksEmissionScale}
          />
        </group>
      ))}
    </group>
  );
}

/**
 * Instantiates the actual Three.js mesh for the node's `shape`. Materials
 * are shared per node (every arrange instance reuses the same material via
 * R3F's automatic dedup of inline JSX), but geometries are too small to
 * bother caching.
 */
function ShapePrimitive({
  node,
  variant,
  opacityMultiplier,
  quarksIntensityMultiplier,
  quarksEmissionScale,
}: {
  node: SceneLeaf;
  variant: "cast" | "travel" | "impact";
  opacityMultiplier: number;
  quarksIntensityMultiplier: number;
  quarksEmissionScale: number;
}) {
  if (node.shape === "particle_cloud") {
    return <ParticleEmitterNode node={node} opacityMultiplier={opacityMultiplier} burst={variant === "impact"} />;
  }

  const opacity = Math.max(0, Math.min(1, node.opacity * opacityMultiplier));

  const material = (
    <SpellShaderMaterial shaderId={node.shaderId} opacityMultiplier={opacity} />
  );

  const s = node.size;
  switch (node.shape) {
    case "sphere":
      return (
        <mesh>
          <sphereGeometry args={[s, 16, 16]} />
          {material}
        </mesh>
      );
    case "box":
      return (
        <mesh>
          <boxGeometry args={[s, s, s]} />
          {material}
        </mesh>
      );
    case "cylinder":
      return (
        <mesh>
          <cylinderGeometry args={[s * 0.5, s * 0.5, s * 1.6, 16]} />
          {material}
        </mesh>
      );
    case "cone":
      return (
        <mesh>
          <coneGeometry args={[s * 0.6, s * 1.6, 16]} />
          {material}
        </mesh>
      );
    case "torus":
      return (
        <mesh>
          <torusGeometry args={[s, s * 0.25, 12, 24]} />
          {material}
        </mesh>
      );
    case "ring":
      return (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[s * 0.85, s, 32]} />
          {material}
        </mesh>
      );
    case "plane":
      return (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[s, s]} />
          {material}
        </mesh>
      );
    case "tetra":
      return (
        <mesh>
          <tetrahedronGeometry args={[s, 0]} />
          {material}
        </mesh>
      );
    case "octa":
      return (
        <mesh>
          <octahedronGeometry args={[s, 0]} />
          {material}
        </mesh>
      );
    case "bar":
      // Tall thin pillar — useful for lightning columns, vine spikes.
      return (
        <mesh>
          <boxGeometry args={[s * 0.35, s * 2.4, s * 0.35]} />
          {material}
        </mesh>
      );
    case "disc":
      return (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[s, 32]} />
          {material}
        </mesh>
      );
    case "displaced_meteor":
      return <DisplacedMeteor node={node} />;
    case "monolith":
      return <Monolith node={node} />;
    case "crystal_cluster":
      return <CrystalCluster node={node} />;
    case "rock_chunks":
      return <RockChunks node={node} />;
    case "quarks_emitter": {
      const preset = (node.quarksPreset ?? "smoke_plume_dark") as QuarksPresetId;
      return (
        <QuarksEmitterNode
          preset={preset}
          config={{
            colorA: node.color,
            colorB: node.colorB ?? node.color,
            intensity: Math.max(0.01, (node.intensity ?? 1) * quarksIntensityMultiplier),
            scale: Math.max(0.1, s),
            lifetime: variant === "impact" ? impactParticleLifetime(preset) : undefined,
            looping: variant === "travel" && shouldLoopQuarksPreset(preset) ? true : undefined,
            // Forward optional world-space override; when undefined, the
            // preset chooses its own default (production presets default to
            // worldSpace=true so trails persist where spawned).
            worldSpace: node.quarksWorldSpace,
          }}
          emissionScale={quarksEmissionScale}
        />
      );
    }
    default:
      return null;
  }
}

function impactParticleLifetime(preset: QuarksPresetId): [number, number] | undefined {
  if (preset === "smoke_plume_dark" || preset === "smoke_plume_dust") return [0.7, 1.25];
  if (preset === "embers_rising" || preset === "fire_core") return [0.45, 0.9];
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedural rock primitives
//
// Each component:
//   - builds geometry via the proceduralRock LRU (cached, do NOT dispose)
//   - builds a fresh material per mount and disposes on unmount
//   - ticks the material's uTime uniform via useFrame for animated cracks
// ─────────────────────────────────────────────────────────────────────────────

function useRockMaterial<M extends MeshStandardMaterial>(factory: () => M): M {
  // Lazy-init via useState so the material is created exactly once and we
  // never read a ref's `.current` during render (lint: react-hooks/refs).
  const [material] = useState<M>(() => factory());
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);
  useFrame(({ clock }) => {
    tickRockMaterial(material, clock.getElapsedTime());
  });
  return material;
}

function DisplacedMeteor({ node }: { node: SceneLeaf }) {
  const geom = useMemo(
    () =>
      makeMeteorGeometry({
        radius: node.size,
        detail: 2,
        displacement: 0.28,
        seed: node.seed ?? 0,
      }),
    [node.size, node.seed],
  );
  const mat = useRockMaterial(() =>
    meteorMaterial({
      colorA: node.color,
      colorB: node.colorB ?? "#ff6020",
      emissiveIntensity: 1.2 + node.emissiveIntensity * 0.6,
    }),
  );
  return <mesh geometry={geom} material={mat} castShadow />;
}

function Monolith({ node }: { node: SceneLeaf }) {
  const geom = useMemo(
    () =>
      makeMonolithGeometry({
        width: node.size * 0.8,
        height: node.size * 2.6,
        depth: node.size * 0.8,
        segments: 4,
        displacement: 0.16,
        seed: node.seed ?? 0,
      }),
    [node.size, node.seed],
  );
  const mat = useRockMaterial(() =>
    monolithMaterial({
      colorA: node.color,
      colorB: node.colorB ?? "#a8c8ff",
      emissiveIntensity: 0.8 + node.emissiveIntensity * 0.5,
    }),
  );
  return <mesh geometry={geom} material={mat} castShadow />;
}

function CrystalCluster({ node }: { node: SceneLeaf }) {
  // A small cluster of 3-5 shards arranged radially. Count derives from
  // arrangeCount when present (capped); otherwise 4.
  const count = Math.min(5, Math.max(3, node.arrangeCount));
  const seedBase = node.seed ?? 0;
  const shards = useMemo(() => {
    const out: { geom: ReturnType<typeof makeCrystalShard>; pos: [number, number, number]; rot: [number, number, number]; scale: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = node.size * 0.45;
      const s = 0.6 + ((i * 37) % 100) / 250; // 0.6..1.0 deterministic
      out.push({
        geom: makeCrystalShard({
          radius: node.size * 0.22,
          height: node.size * 1.2 * s,
          jitter: 0.08,
          seed: seedBase + i * 17,
        }),
        pos: [Math.cos(a) * r, 0, Math.sin(a) * r],
        rot: [((i * 13) % 100) / 200, a, ((i * 29) % 100) / 200],
        scale: s,
      });
    }
    return out;
  }, [count, node.size, seedBase]);
  const mat = useRockMaterial(() =>
    crystalMaterial({
      colorA: node.color,
      colorB: node.colorB ?? "#ffffff",
      emissiveIntensity: 1.2 + node.emissiveIntensity * 0.7,
    }),
  );
  return (
    <group>
      {shards.map((s, i) => (
        <mesh key={i} geometry={s.geom} material={mat} position={s.pos} rotation={s.rot} scale={s.scale} castShadow />
      ))}
    </group>
  );
}

function RockChunks({ node }: { node: SceneLeaf }) {
  // A scattered pile of small displaced icosahedrons. Static; intended to
  // pair with a quarks_emitter (debris_chunks) for the kinetic part.
  const count = Math.min(8, Math.max(3, node.arrangeCount));
  const seedBase = node.seed ?? 0;
  const chunks = useMemo(() => {
    const out: { geom: ReturnType<typeof makeMeteorGeometry>; pos: [number, number, number]; rot: [number, number, number]; scale: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ((i * 31) % 100) / 200;
      const r = node.size * (0.3 + ((i * 23) % 100) / 200);
      const sc = 0.4 + ((i * 47) % 100) / 200;
      out.push({
        geom: makeMeteorGeometry({
          radius: node.size * 0.25 * sc,
          detail: 1,
          displacement: 0.4,
          seed: seedBase + i * 11,
        }),
        pos: [Math.cos(a) * r, sc * node.size * 0.15, Math.sin(a) * r],
        rot: [((i * 7) % 100) / 50, a, ((i * 19) % 100) / 50],
        scale: sc,
      });
    }
    return out;
  }, [count, node.size, seedBase]);
  const mat = useRockMaterial(() =>
    meteorMaterial({
      colorA: node.color,
      colorB: node.colorB ?? "#ff6020",
      emissiveIntensity: 0.4 + node.emissiveIntensity * 0.4,
    }),
  );
  return (
    <group>
      {chunks.map((c, i) => (
        <mesh key={i} geometry={c.geom} material={mat} position={c.pos} rotation={c.rot} scale={c.scale} castShadow />
      ))}
    </group>
  );
}
