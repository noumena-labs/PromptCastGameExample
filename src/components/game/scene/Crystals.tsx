"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group } from "three";
import { useGameStore } from "@/game/state/gameStore";

export function Crystals() {
  const crystals = useGameStore((state) => state.crystals);
  const group = useRef<Group>(null);
  const activeCrystals = crystals.filter((crystal) => crystal.active);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.28;
  });

  return (
    <group ref={group}>
      {activeCrystals.map((crystal, index) => (
        <Crystal key={crystal.id} position={crystal.position} phase={index} />
      ))}
    </group>
  );
}

function Crystal({ position, phase }: { position: [number, number, number]; phase: number }) {
  const mesh = useRef<Group>(null);

  useFrame((state) => {
    if (!mesh.current) return;
    mesh.current.position.y = 0.35 + Math.sin(state.clock.elapsedTime * 2 + phase) * 0.09;
    mesh.current.rotation.y += 0.03;
  });

  return (
    <group position={position} rotation-y={phase * 0.7}>
      <group ref={mesh}>
        <mesh castShadow>
          <octahedronGeometry args={[0.62, 0]} />
          <meshStandardMaterial color="#68f7d2" emissive="#44ffcc" emissiveIntensity={1.8} roughness={0.2} />
        </mesh>
      </group>
      <mesh position={[0, 0.35, 0]}>
        <sphereGeometry args={[1.1, 12, 8]} />
        <meshStandardMaterial color="#58ffcd" emissive="#22ffc2" emissiveIntensity={0.7} transparent opacity={0.16} />
      </mesh>
    </group>
  );
}
