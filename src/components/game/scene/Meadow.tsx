"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Mesh, type MeshStandardMaterial } from "three";
import { buildTerrainGeometry } from "@/game/arena/terrain";
import {
  terrainMorphSampleAt,
  terrainMorphSourceFromArea,
  type TerrainMorphSource,
} from "@/game/arena/terrainMorph";
import { useGameStore } from "@/game/state/gameStore";
import {
  makeTerrainMorphMaterial,
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
    const vertexCount = data.positions.length / 3;
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(data.positions.slice(), 3));
    geom.setAttribute("normal", new BufferAttribute(data.normals.slice(), 3));
    geom.setAttribute("color", new BufferAttribute(data.colors, 3));
    geom.setAttribute("morphMask", new BufferAttribute(new Float32Array(vertexCount), 1));
    geom.setAttribute("morphSigned", new BufferAttribute(new Float32Array(vertexCount), 1));
    geom.setAttribute("morphStyle", new BufferAttribute(new Float32Array(vertexCount), 1));
    geom.setAttribute("morphColorA", new BufferAttribute(new Float32Array(vertexCount * 3), 3));
    geom.setAttribute("morphColorB", new BufferAttribute(new Float32Array(vertexCount * 3), 3));
    geom.setIndex(new BufferAttribute(data.indices, 1));
    return { geom, basePositions: data.positions };
  }, [segments, size]);
  useEffect(() => () => geometry.geom.dispose(), [geometry]);

  const [material] = useState<MeshStandardMaterial>(() => makeTerrainMorphMaterial());
  useEffect(() => () => material.dispose(), [material]);

  const meshRef = useRef<Mesh>(null);
  const wasMorphedRef = useRef(false);

  useFrame(({ clock }) => {
    const nowMs = Date.now();
    const activeSources = sources ?? useGameStore.getState().areas.flatMap((area) => {
      const source = terrainMorphSourceFromArea(area);
      return source && source.expiresAt > nowMs ? [source] : [];
    });

    tickTerrainMorphMaterial(material, clock.getElapsedTime());
    if (activeSources.length === 0 && !wasMorphedRef.current) return;
    deformTerrainGeometry(geometry.geom, geometry.basePositions, activeSources, nowMs);
    wasMorphedRef.current = activeSources.length > 0;
  });

  return (
    <mesh ref={meshRef} geometry={geometry.geom} material={material} receiveShadow castShadow={false} />
  );
}

function deformTerrainGeometry(
  geometry: BufferGeometry,
  basePositions: Float32Array,
  sources: TerrainMorphSource[],
  nowMs: number,
) {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const morphMask = geometry.getAttribute("morphMask") as BufferAttribute;
  const morphSigned = geometry.getAttribute("morphSigned") as BufferAttribute;
  const morphStyle = geometry.getAttribute("morphStyle") as BufferAttribute;
  const morphColorA = geometry.getAttribute("morphColorA") as BufferAttribute;
  const morphColorB = geometry.getAttribute("morphColorB") as BufferAttribute;
  const values = position.array as Float32Array;
  const maskValues = morphMask.array as Float32Array;
  const signedValues = morphSigned.array as Float32Array;
  const styleValues = morphStyle.array as Float32Array;
  const colorAValues = morphColorA.array as Float32Array;
  const colorBValues = morphColorB.array as Float32Array;
  for (let i = 0; i < values.length; i += 3) {
    const vertexIndex = i / 3;
    const x = basePositions[i];
    const baseY = basePositions[i + 1];
    const z = basePositions[i + 2];
    let displacement = 0;
    let mask = 0;
    let signed = 0;
    let style = 0;
    let strongestDisplacement = 0;
    let colorA: readonly [number, number, number] = [0, 0, 0];
    let colorB: readonly [number, number, number] = [0, 0, 0];
    for (const source of sources) {
      const sample = terrainMorphSampleAt(x, z, source, nowMs);
      displacement += sample.displacement;
      const absDisplacement = Math.abs(sample.displacement);
      if (absDisplacement > strongestDisplacement) {
        strongestDisplacement = absDisplacement;
        mask = sample.mask;
        signed = sample.signedStrength;
        style = sample.style;
        colorA = sample.colorA;
        colorB = sample.colorB;
      }
    }
    values[i] = x;
    values[i + 1] = baseY + Math.max(-3.2, Math.min(3.2, displacement));
    values[i + 2] = z;
    maskValues[vertexIndex] = mask;
    signedValues[vertexIndex] = signed;
    styleValues[vertexIndex] = style;
    colorAValues[i] = colorA[0];
    colorAValues[i + 1] = colorA[1];
    colorAValues[i + 2] = colorA[2];
    colorBValues[i] = colorB[0];
    colorBValues[i + 1] = colorB[1];
    colorBValues[i + 2] = colorB[2];
  }
  position.needsUpdate = true;
  morphMask.needsUpdate = true;
  morphSigned.needsUpdate = true;
  morphStyle.needsUpdate = true;
  morphColorA.needsUpdate = true;
  morphColorB.needsUpdate = true;
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal") as BufferAttribute | undefined;
  if (normal) normal.needsUpdate = true;
}
