"use client";

import { useMemo } from "react";
import { Color, InstancedMesh, Matrix4, Object3D } from "three";
import { CylinderCollider, RigidBody } from "@react-three/rapier";
import { ARENA_RADIUS, PLAYABLE_RADIUS } from "@/game/config/gameConfig";
import { scatterPositions } from "@/game/arena/terrain";
import { ENVIRONMENT_GROUPS } from "@/game/physics/collisionGroups";

const trunkColor = new Color("#3b2a1c");
const oakLeaf = new Color("#3f6b3a");
const oakLeafShade = new Color("#2c5230");
const birchTrunk = new Color("#d8d2c2");
const birchLeaf = new Color("#7ea35a");

const COLLIDER_CULL_RADIUS = PLAYABLE_RADIUS + 4;

type Tree = { x: number; z: number; y: number; rot: number; scale: number; kind: "oak" | "birch" };

export function Trees() {
  const trees = useMemo<Tree[]>(() => {
    // Sparse inside playable area, dense ring on hills.
    const inner = scatterPositions(130, 24, PLAYABLE_RADIUS - 4, 11);
    const ring = scatterPositions(360, PLAYABLE_RADIUS - 2, ARENA_RADIUS + 8, 23);
    return [...inner, ...ring].map((tree, idx) => ({
      ...tree,
      kind: idx % 3 === 0 ? "birch" : "oak",
    }));
  }, []);

  // Only colliders for trees the player can reach — keeps physics cost flat.
  const collidableTrees = useMemo(
    () => trees.filter((tree) => Math.hypot(tree.x, tree.z) <= COLLIDER_CULL_RADIUS),
    [trees],
  );

  return (
    <group>
      <OakInstanced trees={trees.filter((t) => t.kind === "oak")} />
      <BirchInstanced trees={trees.filter((t) => t.kind === "birch")} />
      <TreeColliders trees={collidableTrees} />
    </group>
  );
}

function TreeColliders({ trees }: { trees: Tree[] }) {
  // One positioned RigidBody per tree. Collider sits at local origin so the
  // RigidBody's world transform is the single source of truth.
  return (
    <group>
      {trees.map((tree, i) => {
        const isBirch = tree.kind === "birch";
        const radius = (isBirch ? 0.28 : 0.42) * tree.scale;
        const halfHeight = (isBirch ? 2.25 : 1.7) * tree.scale;
        return (
          <RigidBody
            key={`tree-col-${i}`}
            type="fixed"
            colliders={false}
            position={[tree.x, tree.y + halfHeight, tree.z]}
          >
            <CylinderCollider args={[halfHeight, radius]} collisionGroups={ENVIRONMENT_GROUPS} />
          </RigidBody>
        );
      })}
    </group>
  );
}

function OakInstanced({ trees }: { trees: Tree[] }) {
  const trunkMatrices = useMemo(() => buildMatrices(trees, "trunk"), [trees]);
  const canopyMatrices = useMemo(() => buildMatrices(trees, "canopy"), [trees]);
  const canopyTopMatrices = useMemo(() => buildMatrices(trees, "canopyTop"), [trees]);

  return (
    <group>
      <instancedMesh
        ref={applyMatrices(trunkMatrices)}
        args={[undefined, undefined, trees.length]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.32, 0.42, 3.4, 7]} />
        <meshStandardMaterial color={trunkColor} roughness={0.95} />
      </instancedMesh>
      <instancedMesh
        ref={applyMatrices(canopyMatrices)}
        args={[undefined, undefined, trees.length]}
        castShadow
      >
        <icosahedronGeometry args={[1.85, 1]} />
        <meshStandardMaterial color={oakLeaf} roughness={0.85} flatShading />
      </instancedMesh>
      <instancedMesh
        ref={applyMatrices(canopyTopMatrices)}
        args={[undefined, undefined, trees.length]}
        castShadow
      >
        <icosahedronGeometry args={[1.25, 1]} />
        <meshStandardMaterial color={oakLeafShade} roughness={0.85} flatShading />
      </instancedMesh>
    </group>
  );
}

function BirchInstanced({ trees }: { trees: Tree[] }) {
  const trunkMatrices = useMemo(() => buildMatrices(trees, "birchTrunk"), [trees]);
  const canopyMatrices = useMemo(() => buildMatrices(trees, "birchCanopy"), [trees]);

  return (
    <group>
      <instancedMesh
        ref={applyMatrices(trunkMatrices)}
        args={[undefined, undefined, trees.length]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.18, 0.22, 4.5, 6]} />
        <meshStandardMaterial color={birchTrunk} roughness={0.7} />
      </instancedMesh>
      <instancedMesh
        ref={applyMatrices(canopyMatrices)}
        args={[undefined, undefined, trees.length]}
        castShadow
      >
        <icosahedronGeometry args={[1.4, 1]} />
        <meshStandardMaterial color={birchLeaf} roughness={0.85} flatShading />
      </instancedMesh>
    </group>
  );
}

type Kind = "trunk" | "canopy" | "canopyTop" | "birchTrunk" | "birchCanopy";

function buildMatrices(trees: Tree[], kind: Kind): Matrix4[] {
  const dummy = new Object3D();
  return trees.map((tree) => {
    dummy.position.set(tree.x, tree.y, tree.z);
    dummy.rotation.set(0, tree.rot, 0);
    const scale = tree.scale;
    if (kind === "trunk") {
      dummy.position.y = tree.y + 1.7 * scale;
      dummy.scale.set(scale, scale, scale);
    } else if (kind === "canopy") {
      dummy.position.y = tree.y + 3.6 * scale;
      dummy.scale.set(scale, scale * 0.9, scale);
    } else if (kind === "canopyTop") {
      dummy.position.y = tree.y + 4.7 * scale;
      dummy.scale.set(scale, scale, scale);
    } else if (kind === "birchTrunk") {
      dummy.position.y = tree.y + 2.25 * scale;
      dummy.scale.set(scale, scale, scale);
    } else {
      dummy.position.y = tree.y + 4.6 * scale;
      dummy.scale.set(scale, scale * 1.1, scale);
    }
    dummy.updateMatrix();
    return dummy.matrix.clone();
  });
}

function applyMatrices(matrices: Matrix4[]) {
  return (mesh: InstancedMesh | null) => {
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = matrices.length;
  };
}
