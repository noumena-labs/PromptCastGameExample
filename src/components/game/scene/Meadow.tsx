"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Mesh, type MeshStandardMaterial } from "three";
import { buildTerrainGeometry } from "@/game/arena/terrain";
import {
  terrainMorphSourceFromArea,
  type TerrainMorphSource,
} from "@/game/arena/terrainMorph";
import { useGameStore } from "@/game/state/gameStore";
import {
  makeTerrainMorphMaterial,
  setTerrainMorphSources,
  tickTerrainMorphMaterial,
} from "@/components/game/scene/materials/terrainMorphMaterial";

export function Meadow() {
  return <MorphingTerrainMesh size={220} segments={160} />;
}

export function MorphingTerrainMesh({
  size,
  segments,
  sources,
}: {
  size: number;
  segments: number;
  sources?: TerrainMorphSource[];
}) {
  const geometry = useMemo(() => {
    const data = buildTerrainGeometry(size, segments);
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(data.positions, 3));
    geom.setAttribute("normal", new BufferAttribute(data.normals.slice(), 3));
    geom.setAttribute("color", new BufferAttribute(data.colors, 3));
    geom.setIndex(new BufferAttribute(data.indices, 1));
    return geom;
  }, [segments, size]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const [material] = useState<MeshStandardMaterial>(() => makeTerrainMorphMaterial());
  useEffect(() => () => material.dispose(), [material]);

  const meshRef = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    const nowMs = Date.now();
    const activeSources = sources ?? useGameStore.getState().areas.flatMap((area) => {
      const source = terrainMorphSourceFromArea(area);
      return source && source.expiresAt > nowMs ? [source] : [];
    });

    tickTerrainMorphMaterial(material, clock.getElapsedTime());
    setTerrainMorphSources(material, activeSources, nowMs);
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} receiveShadow castShadow={false} />
  );
}
