"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group } from "three";
import type { SceneLeaf, SpellScene } from "@/game/spells/sceneNode";
import {
  applyMotion,
  arrangePositions,
  seedFromId,
  type MotionDelta,
} from "@/components/game/scene/sceneMotion";
import { ParticleEmitterNode } from "@/components/game/scene/ParticleEmitterNode";
import { SpellShaderMaterial } from "@/components/game/scene/SpellShaderMaterial";

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

const LIGHT_CAP = 2;
const IMPACT_LIGHT_CAP = 4;
const LIGHT_THRESHOLD = 0.5;

export function SceneNodeRenderer({
  scene,
  spellId,
  spawnedAt,
  lifetimeSeconds,
  variant = "cast",
}: {
  scene: SpellScene;
  spellId: string;
  spawnedAt?: number;
  lifetimeSeconds?: number;
  variant?: "cast" | "travel" | "impact";
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
      />
      {scene.children.map((child, i) => (
        <NodeInstance
          key={i}
          node={child}
          seed={seed ^ ((i + 1) * 0x9e3779b9)}
          hostsLight={lightNodeIds.has(i)}
          variant={variant}
          opacityMultiplier={opacityMultiplier}
        />
      ))}
    </group>
  );
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
}: {
  node: SceneLeaf;
  seed: number;
  hostsLight: boolean;
  variant: "cast" | "travel" | "impact";
  opacityMultiplier: number;
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
          intensity={Math.min(node.emissiveIntensity, 4) * (variant === "impact" ? 3.0 : 1.6)}
          distance={Math.max(2, node.size * (variant === "impact" ? 10 : 6))}
          decay={2}
        />
      )}
      {offsets.map((offset, i) => (
        <group key={i} position={offset}>
          <ShapePrimitive node={node} variant={variant} opacityMultiplier={opacityMultiplier} />
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
}: {
  node: SceneLeaf;
  variant: "cast" | "travel" | "impact";
  opacityMultiplier: number;
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
    default:
      return null;
  }
}
