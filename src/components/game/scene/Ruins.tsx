"use client";

import { useMemo } from "react";
import { CuboidCollider, CylinderCollider, RigidBody } from "@react-three/rapier";
import { getGroundHeight } from "@/game/arena/terrain";
import { ENVIRONMENT_GROUPS } from "@/game/physics/collisionGroups";

type Vec3Tuple = [number, number, number];
type RotationTuple = [number, number, number];

type WallPiece = {
  key: string;
  position: Vec3Tuple;
  rotation: RotationTuple;
  size: Vec3Tuple;
  color: string;
};

type PillarPiece = {
  key: string;
  position: Vec3Tuple;
  rotation: RotationTuple;
  radius: number;
  height: number;
  color: string;
};

type RubblePiece = {
  key: string;
  position: Vec3Tuple;
  rotationY: number;
  size: number;
  color: string;
};

const stone = "#81796e";
const darkStone = "#5b554d";
const moss = "#465f36";

const clusters = [
  { x: -39, z: -34, rot: 0.35, kind: "arch" },
  { x: 42, z: -31, rot: -0.55, kind: "wall" },
  { x: -63, z: 8, rot: 1.4, kind: "fallen" },
  { x: 66, z: 16, rot: -1.15, kind: "arch" },
  { x: -28, z: 58, rot: -0.25, kind: "wall" },
  { x: 31, z: 62, rot: 0.85, kind: "fallen" },
  { x: -80, z: -48, rot: 0.9, kind: "wall" },
  { x: 83, z: -47, rot: -0.25, kind: "fallen" },
  { x: -86, z: 42, rot: -0.8, kind: "arch" },
  { x: 87, z: 50, rot: 0.45, kind: "wall" },
  { x: -12, z: -82, rot: 0.15, kind: "fallen" },
  { x: 18, z: 87, rot: -0.35, kind: "arch" },
] as const;

export function Ruins() {
  const pieces = useMemo(() => buildRuins(), []);

  return (
    <group>
      {pieces.walls.map((piece) => (
        <Wall key={piece.key} piece={piece} />
      ))}
      {pieces.pillars.map((piece) => (
        <Pillar key={piece.key} piece={piece} />
      ))}
      {pieces.rubble.map((piece) => (
        <Rubble key={piece.key} piece={piece} />
      ))}
    </group>
  );
}

function Wall({ piece }: { piece: WallPiece }) {
  return (
    <RigidBody type="fixed" colliders={false} position={piece.position} rotation={piece.rotation}>
      <mesh receiveShadow castShadow>
        <boxGeometry args={piece.size} />
        <meshStandardMaterial color={piece.color} roughness={0.96} />
      </mesh>
      <CuboidCollider args={[piece.size[0] / 2, piece.size[1] / 2, piece.size[2] / 2]} collisionGroups={ENVIRONMENT_GROUPS} />
    </RigidBody>
  );
}

function Pillar({ piece }: { piece: PillarPiece }) {
  return (
    <RigidBody type="fixed" colliders={false} position={piece.position} rotation={piece.rotation}>
      <mesh receiveShadow castShadow>
        <cylinderGeometry args={[piece.radius * 0.82, piece.radius, piece.height, 7]} />
        <meshStandardMaterial color={piece.color} roughness={0.95} flatShading />
      </mesh>
      <CylinderCollider args={[piece.height / 2, piece.radius]} collisionGroups={ENVIRONMENT_GROUPS} />
    </RigidBody>
  );
}

function Rubble({ piece }: { piece: RubblePiece }) {
  return (
    <mesh receiveShadow castShadow position={piece.position} rotation-y={piece.rotationY}>
      <dodecahedronGeometry args={[piece.size, 0]} />
      <meshStandardMaterial color={piece.color} roughness={0.98} />
    </mesh>
  );
}

function buildRuins() {
  const walls: WallPiece[] = [];
  const pillars: PillarPiece[] = [];
  const rubble: RubblePiece[] = [];

  clusters.forEach((cluster, index) => {
    const baseY = getGroundHeight(cluster.x, cluster.z);
    if (cluster.kind === "arch") {
      addArch(walls, pillars, cluster.x, baseY, cluster.z, cluster.rot, index);
    } else if (cluster.kind === "wall") {
      addBrokenWall(walls, cluster.x, baseY, cluster.z, cluster.rot, index);
    } else {
      addFallenPillars(walls, pillars, cluster.x, baseY, cluster.z, cluster.rot, index);
    }
    addRubble(rubble, cluster.x, cluster.z, cluster.rot, index);
  });

  return { walls, pillars, rubble };
}

function addArch(walls: WallPiece[], pillars: PillarPiece[], x: number, y: number, z: number, rot: number, index: number) {
  const right = rightVector(rot);
  const forward = forwardVector(rot);
  const p1 = offset([x, y + 2.15, z], right, -1.65, forward, 0);
  const p2 = offset([x, y + 1.88, z], right, 1.65, forward, 0.15);
  pillars.push(
    {
      key: `arch-${index}-pillar-a`,
      position: p1,
      rotation: [0.08, rot, -0.07],
      radius: 0.48,
      height: 4.25,
      color: darkStone,
    },
    {
      key: `arch-${index}-pillar-b`,
      position: p2,
      rotation: [-0.04, rot, 0.1],
      radius: 0.52,
      height: 3.75,
      color: stone,
    },
  );
  walls.push({
    key: `arch-${index}-lintel`,
    position: offset([x, y + 4.25, z], right, 0.08, forward, 0.08),
    rotation: [0.02, rot, 0.16],
    size: [4.2, 0.58, 0.9],
    color: stone,
  });
}

function addBrokenWall(walls: WallPiece[], x: number, y: number, z: number, rot: number, index: number) {
  const right = rightVector(rot);
  const forward = forwardVector(rot);
  const chunks = [
    { side: -3.2, depth: 0, width: 3.1, height: 2.2, tilt: -0.04 },
    { side: 0.1, depth: 0.18, width: 2.6, height: 3.25, tilt: 0.05 },
    { side: 3.05, depth: -0.12, width: 2.4, height: 1.75, tilt: -0.09 },
  ];
  chunks.forEach((chunk, chunkIndex) => {
    walls.push({
      key: `wall-${index}-${chunkIndex}`,
      position: offset([x, y + chunk.height / 2, z], right, chunk.side, forward, chunk.depth),
      rotation: [0, rot + chunk.tilt, chunk.tilt],
      size: [chunk.width, chunk.height, 0.72],
      color: chunkIndex % 2 === 0 ? stone : darkStone,
    });
  });
  walls.push({
    key: `wall-${index}-capstone`,
    position: offset([x, y + 0.38, z], right, 5.4, forward, 1.05),
    rotation: [0.18, rot + 0.45, -0.11],
    size: [2.2, 0.6, 0.9],
    color: darkStone,
  });
}

function addFallenPillars(walls: WallPiece[], pillars: PillarPiece[], x: number, y: number, z: number, rot: number, index: number) {
  const right = rightVector(rot);
  const forward = forwardVector(rot);
  walls.push({
    key: `fallen-${index}-slab-a`,
    position: offset([x, y + 0.46, z], right, -1.2, forward, -0.65),
    rotation: [0.22, rot + 0.35, -0.1],
    size: [4.9, 0.62, 1.05],
    color: darkStone,
  });
  walls.push({
    key: `fallen-${index}-slab-b`,
    position: offset([x, y + 0.66, z], right, 2.6, forward, 1.2),
    rotation: [-0.12, rot - 0.42, 0.18],
    size: [3.3, 0.7, 1.0],
    color: stone,
  });
  pillars.push({
    key: `fallen-${index}-standing-pillar`,
    position: offset([x, y + 1.35, z], right, -4.3, forward, 1.25),
    rotation: [0.08, rot - 0.35, 0.2],
    radius: 0.48,
    height: 2.7,
    color: stone,
  });
}

function addRubble(rubble: RubblePiece[], x: number, z: number, rot: number, index: number) {
  for (let i = 0; i < 9; i += 1) {
    const angle = rot + i * 1.71;
    const radius = 2.2 + ((i * 37 + index * 11) % 9) * 0.42;
    const px = x + Math.cos(angle) * radius;
    const pz = z + Math.sin(angle) * radius;
    const py = getGroundHeight(px, pz);
    rubble.push({
      key: `rubble-${index}-${i}`,
      position: [px, py + 0.14 + (i % 3) * 0.04, pz],
      rotationY: rot + i * 0.38,
      size: 0.32 + (i % 4) * 0.11,
      color: i % 5 === 0 ? moss : i % 2 === 0 ? stone : darkStone,
    });
  }
}

function rightVector(rot: number) {
  return [Math.cos(rot), Math.sin(rot)] as const;
}

function forwardVector(rot: number) {
  return [-Math.sin(rot), Math.cos(rot)] as const;
}

function offset(
  origin: Vec3Tuple,
  right: readonly [number, number],
  side: number,
  forward: readonly [number, number],
  depth: number,
): Vec3Tuple {
  return [
    origin[0] + right[0] * side + forward[0] * depth,
    origin[1],
    origin[2] + right[1] * side + forward[1] * depth,
  ];
}
