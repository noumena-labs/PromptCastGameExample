"use client";

import { Billboard, Text } from "@react-three/drei";
import { useGameStore } from "@/game/state/gameStore";

export function DummyTargets() {
  const targets = useGameStore((state) => state.dummyTargets);

  return (
    <group>
      {targets.map((target) => {
        const active = !target.respawnAt;
        const healthRatio = target.health / target.maxHealth;
        return (
          <group key={target.id} position={target.position} visible={active}>
            <mesh castShadow>
              <dodecahedronGeometry args={[0.95, 0]} />
              <meshStandardMaterial color="#ff746c" emissive="#6c1618" emissiveIntensity={0.35} roughness={0.7} />
            </mesh>
            <mesh position={[0, -0.85, 0]}>
              <cylinderGeometry args={[0.65, 0.8, 0.25, 7]} />
              <meshStandardMaterial color="#2c1b1b" roughness={0.9} />
            </mesh>
            <Billboard position={[0, 1.45, 0]}>
              <mesh position={[0, 0, 0]}>
                <planeGeometry args={[1.3, 0.12]} />
                <meshBasicMaterial color="#381717" />
              </mesh>
              <mesh position={[-0.65 + healthRatio * 0.65, 0, 0.01]}>
                <planeGeometry args={[1.3 * healthRatio, 0.12]} />
                <meshBasicMaterial color="#ff746c" />
              </mesh>
              <Text position={[0, 0.28, 0]} fontSize={0.22} color="#f4f7e8" anchorX="center" anchorY="middle">
                target
              </Text>
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}
