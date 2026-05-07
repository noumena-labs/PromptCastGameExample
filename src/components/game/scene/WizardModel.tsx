"use client";

import type { Vec3 } from "@/game/types";

type WizardModelProps = {
  color: string;
  shielded?: boolean;
  position?: Vec3;
  rotationY?: number;
};

export function WizardModel({ color, shielded = false, position = [0, 0, 0], rotationY = 0 }: WizardModelProps) {
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh castShadow position={[0, 0.65, 0]}>
        <cylinderGeometry args={[0.38, 0.48, 1.25, 6]} />
        <meshStandardMaterial color={color} roughness={0.62} emissive={color} emissiveIntensity={0.08} />
      </mesh>
      <mesh castShadow position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.34, 10, 8]} />
        <meshStandardMaterial color="#f0d1aa" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 2.05, 0]} rotation-z={0.08}>
        <coneGeometry args={[0.58, 0.95, 7]} />
        <meshStandardMaterial color="#202038" roughness={0.58} emissive="#24114d" emissiveIntensity={0.14} />
      </mesh>
      <mesh castShadow position={[0.48, 1.2, -0.08]} rotation-z={-0.45}>
        <cylinderGeometry args={[0.07, 0.09, 1.2, 6]} />
        <meshStandardMaterial color="#4b2d19" roughness={0.8} />
      </mesh>
      <mesh position={[0.66, 1.72, -0.18]}>
        <sphereGeometry args={[0.13, 8, 8]} />
        <meshStandardMaterial color="#9d7cff" emissive="#9d7cff" emissiveIntensity={1.6} />
      </mesh>
      {shielded ? (
        <mesh position={[0, 1.08, 0]}>
          <sphereGeometry args={[1.15, 18, 12]} />
          <meshStandardMaterial color="#74f7d0" emissive="#55ffc9" emissiveIntensity={0.75} transparent opacity={0.22} roughness={0.2} />
        </mesh>
      ) : null}
    </group>
  );
}
