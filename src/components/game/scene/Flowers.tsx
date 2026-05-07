"use client";

import { useMemo } from "react";
import { InstancedMesh, Object3D } from "three";
import { PLAYABLE_RADIUS } from "@/game/config/gameConfig";
import { scatterPositions } from "@/game/arena/terrain";

export function Flowers({ color, count, seed, innerRadius = 6 }: { color: string; count: number; seed: number; innerRadius?: number }) {
  const clusters = useMemo(() => scatterPositions(count, innerRadius, PLAYABLE_RADIUS - 4, seed), [count, innerRadius, seed]);
  const matrices = useMemo(() => {
    const dummy = new Object3D();
    return clusters.map((c) => {
      dummy.position.set(c.x, c.y + 0.18, c.z);
      dummy.rotation.set(0, c.rot, 0);
      dummy.scale.setScalar(0.55 + c.scale * 0.45);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, [clusters]);

  return (
    <instancedMesh
      ref={(mesh: InstancedMesh | null) => {
        if (!mesh) return;
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.count = matrices.length;
      }}
      args={[undefined, undefined, clusters.length]}
      castShadow={false}
      receiveShadow={false}
    >
      <coneGeometry args={[0.13, 0.36, 5]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.12} roughness={0.85} />
    </instancedMesh>
  );
}

export function GrassClumps() {
  const clusters = useMemo(() => scatterPositions(420, 6, PLAYABLE_RADIUS, 113), []);
  const matrices = useMemo(() => {
    const dummy = new Object3D();
    return clusters.map((c) => {
      dummy.position.set(c.x, c.y + 0.12, c.z);
      dummy.rotation.set(0, c.rot, 0);
      dummy.scale.set(0.5 + c.scale * 0.5, 0.7 + c.scale * 0.5, 0.5 + c.scale * 0.5);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
  }, [clusters]);

  return (
    <instancedMesh
      ref={(mesh: InstancedMesh | null) => {
        if (!mesh) return;
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.count = matrices.length;
      }}
      args={[undefined, undefined, clusters.length]}
    >
      <coneGeometry args={[0.18, 0.42, 4]} />
      <meshStandardMaterial color="#4a7234" roughness={0.95} />
    </instancedMesh>
  );
}
