"use client";

import { Billboard, Text } from "@react-three/drei";
import { DoubleSide } from "three";
import { useGameStore } from "@/game/state/gameStore";

export function SpellEntities() {
  const projectiles = useGameStore((state) => state.projectiles);
  const areas = useGameStore((state) => state.areas);

  return (
    <group>
      {projectiles.map((projectile) => (
        <group key={projectile.id} position={projectile.position}>
          <mesh castShadow>
            <sphereGeometry args={[Math.max(0.18, projectile.spell.radius * 0.45), 12, 8]} />
            <meshStandardMaterial color={projectile.spell.color} emissive={projectile.spell.color} emissiveIntensity={1.7} roughness={0.2} />
          </mesh>
          <mesh rotation-x={Math.PI / 2}>
            <torusGeometry args={[Math.max(0.24, projectile.spell.radius * 0.55), 0.025, 6, 18]} />
            <meshStandardMaterial color={projectile.spell.color} emissive={projectile.spell.color} emissiveIntensity={1.2} />
          </mesh>
        </group>
      ))}
      {areas.map((area) => (
        <AreaSpell key={area.id} areaId={area.id} />
      ))}
    </group>
  );
}

function AreaSpell({ areaId }: { areaId: string }) {
  const area = useGameStore((state) => state.areas.find((item) => item.id === areaId));
  if (!area) return null;

  const pulseScale = area.spell.shape === "vortex" ? 1.15 : 1;
  const rotation = deterministicRotation(area.id);
  return (
    <group position={area.position} rotation-y={rotation}>
      <mesh rotation-x={-Math.PI / 2} scale={[pulseScale, pulseScale, pulseScale]}>
        <circleGeometry args={[area.spell.radius, area.spell.shape === "wall" ? 4 : 32]} />
        <meshStandardMaterial color={area.spell.color} emissive={area.spell.color} emissiveIntensity={0.95} transparent opacity={0.24} side={DoubleSide} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[Math.max(0.2, area.spell.radius - 0.12), area.spell.radius + 0.12, area.spell.shape === "wall" ? 4 : 32]} />
        <meshStandardMaterial color={area.spell.color} emissive={area.spell.color} emissiveIntensity={1.7} transparent opacity={0.75} side={DoubleSide} />
      </mesh>
      {area.spell.shape === "vortex" ? (
        <mesh position={[0, 1.4, 0]} rotation-x={Math.PI}>
          <coneGeometry args={[area.spell.radius * 0.46, 2.8, 18, 1, true]} />
          <meshStandardMaterial color={area.spell.color} emissive={area.spell.color} emissiveIntensity={0.9} transparent opacity={0.28} side={DoubleSide} />
        </mesh>
      ) : null}
      <Billboard position={[0, 0.18, 0]}>
        <Text fontSize={0.32} color={area.spell.color} anchorX="center" anchorY="middle">
          {area.spell.name}
        </Text>
      </Billboard>
    </group>
  );
}

function deterministicRotation(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }
  return (hash / 997) * Math.PI;
}
