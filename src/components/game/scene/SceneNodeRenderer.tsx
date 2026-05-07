"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Group } from "three";
import type { SceneLeaf, SpellScene } from "@/game/spells/sceneNode";
import {
  applyMotion,
  arrangePositions,
  seedFromId,
  type MotionDelta,
} from "@/components/game/scene/sceneMotion";
import { ParticleEmitterNode } from "@/components/game/scene/ParticleEmitterNode";

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
 * LLM can author scenes with broad emissive intent and the renderer just
 * picks the strongest two.
 */

const LIGHT_CAP = 2;
const LIGHT_THRESHOLD = 0.5;

export function SceneNodeRenderer({
  scene,
  spellId,
  spawnedAt: _spawnedAt,
  lifetimeSeconds: _lifetimeSeconds,
}: {
  scene: SpellScene;
  spellId: string;
  /** Reserved for future fade-on-expiry; unused for now. */
  spawnedAt?: number;
  /** Reserved for future fade-on-expiry; unused for now. */
  lifetimeSeconds?: number;
}) {
  const seed = useMemo(() => seedFromId(spellId), [spellId]);

  // Pick the top-N most-emissive nodes to host point lights. Everything else
  // still uses meshStandardMaterial.emissive but contributes no actual light.
  const lightNodeIds = useMemo(() => {
    const all: { idx: number; v: number }[] = [];
    if (scene.emissiveIntensity > LIGHT_THRESHOLD) all.push({ idx: -1, v: scene.emissiveIntensity });
    scene.children.forEach((c, i) => {
      if (c.emissiveIntensity > LIGHT_THRESHOLD) all.push({ idx: i, v: c.emissiveIntensity });
    });
    all.sort((a, b) => b.v - a.v);
    return new Set(all.slice(0, LIGHT_CAP).map((x) => x.idx));
  }, [scene]);

  return (
    <group>
      <NodeInstance node={scene} seed={seed} hostsLight={lightNodeIds.has(-1)} />
      {scene.children.map((child, i) => (
        <NodeInstance
          key={i}
          node={child}
          seed={seed ^ ((i + 1) * 0x9e3779b9)}
          hostsLight={lightNodeIds.has(i)}
        />
      ))}
    </group>
  );
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
}: {
  node: SceneLeaf;
  seed: number;
  hostsLight: boolean;
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
          intensity={Math.min(node.emissiveIntensity, 4) * 1.6}
          distance={Math.max(2, node.size * 6)}
          decay={2}
        />
      )}
      {offsets.map((offset, i) => (
        <group key={i} position={offset}>
          <ShapePrimitive node={node} />
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
function ShapePrimitive({ node }: { node: SceneLeaf }) {
  if (node.shape === "particle_cloud") {
    return <ParticleEmitterNode node={node} />;
  }

  const material = (
    <meshStandardMaterial
      color={node.color}
      emissive={node.color}
      emissiveIntensity={node.emissiveIntensity}
      transparent={node.opacity < 1}
      opacity={node.opacity}
      toneMapped={false}
      blending={node.emissiveIntensity > 1.5 ? AdditiveBlending : undefined}
      depthWrite={node.opacity >= 0.95}
    />
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
