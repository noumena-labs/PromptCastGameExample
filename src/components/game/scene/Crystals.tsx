"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { useGameStore } from "@/game/state/gameStore";

export function Crystals() {
  const crystalIds = useGameStore(useShallow((state) => state.crystals.map((c) => c.id)));

  return (
    <group>
      {crystalIds.map((id, index) => (
        <Crystal key={id} id={id} phase={index} />
      ))}
    </group>
  );
}

function Crystal({ id, phase }: { id: string; phase: number }) {
  const crystal = useGameStore((state) => state.crystals.find((c) => c.id === id));
  const mesh = useRef<Group>(null);

  useFrame((state) => {
    if (!mesh.current) return;
    mesh.current.position.y = 0.35 + Math.sin(state.clock.elapsedTime * 2 + phase) * 0.09;
    mesh.current.rotation.y += 0.03;
  });

  if (!crystal?.active) return null;

  return (
    <group position={crystal.position} rotation-y={phase * 0.7}>
      <group ref={mesh}>
        {/* Core crystal — violet octahedron */}
        <mesh castShadow>
          <octahedronGeometry args={[1.05, 0]} />
          <meshStandardMaterial
            color="#b890ff"
            emissive="#7a3df7"
            emissiveIntensity={2.2}
            roughness={0.18}
            metalness={0.35}
          />
        </mesh>
        {/* Inner gold core peeking through */}
        <mesh>
          <octahedronGeometry args={[0.55, 0]} />
          <meshStandardMaterial
            color="#ffd76b"
            emissive="#f7b53a"
            emissiveIntensity={2.4}
            roughness={0.25}
            metalness={0.55}
          />
        </mesh>
      </group>
      {/* Soft violet halo */}
      <mesh position={[0, 0.55, 0]}>
        <sphereGeometry args={[1.85, 14, 10]} />
        <meshStandardMaterial color="#cda6ff" emissive="#8b4dff" emissiveIntensity={0.85} transparent opacity={0.18} />
      </mesh>
      {/* Anchor light to call attention */}
      <pointLight color="#c89bff" intensity={1.4} distance={6} decay={2} position={[0, 0.6, 0]} />
    </group>
  );
}
