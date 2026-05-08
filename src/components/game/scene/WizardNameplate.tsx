"use client";

import { Billboard, Text } from "@react-three/drei";
import { PLAYER_MAX_HEALTH } from "@/game/config/gameConfig";

type WizardNameplateProps = {
  name: string;
  health: number;
  color?: string;
};

export function WizardNameplate({ name, health, color = "#74f7d0" }: WizardNameplateProps) {
  const healthRatio = Math.max(0, Math.min(1, health / PLAYER_MAX_HEALTH));
  return (
    <Billboard position={[0, 2.9, 0]}>
      <Text fontSize={0.28} color="#f4f7e8" anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="#1b1108">
        {name}
      </Text>
      <mesh position={[0, -0.28, 0]}>
        <planeGeometry args={[1.2, 0.12]} />
        <meshBasicMaterial color="#21120c" transparent opacity={0.78} />
      </mesh>
      <mesh position={[-0.6 + (1.2 * healthRatio) / 2, -0.28, 0.01]}>
        <planeGeometry args={[1.2 * healthRatio, 0.12]} />
        <meshBasicMaterial color={healthRatio > 0.35 ? color : "#ff746c"} />
      </mesh>
    </Billboard>
  );
}
