"use client";

import { useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, Mesh } from "three";
import { buildTerrainGeometry } from "@/game/arena/terrain";

export function Meadow() {
  const geometry = useMemo(() => {
    const data = buildTerrainGeometry(220, 160);
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(data.positions, 3));
    geom.setAttribute("normal", new BufferAttribute(data.normals, 3));
    geom.setAttribute("color", new BufferAttribute(data.colors, 3));
    geom.setIndex(new BufferAttribute(data.indices, 1));
    return geom;
  }, []);

  const meshRef = useRef<Mesh>(null);

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow castShadow={false}>
      <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
    </mesh>
  );
}
