"use client";

import { useMemo } from "react";
import { Euler, Object3D } from "three";
import { getGroundHeight } from "@/game/arena/terrain";

const stoneColor = "#8a8273";
const stoneShadow = "#5e574b";
const mossColor = "#4a6a3c";

/**
 * Small ruined shrine near the arena center: a broken stone dais,
 * four standing stones, two leaning arches, scattered rubble.
 */
export function Shrine() {
  const groundY = useMemo(() => getGroundHeight(0, 0), []);

  const standingStones = useMemo(() => {
    const dummy = new Object3D();
    return Array.from({ length: 6 }, (_, index) => {
      const angle = (index / 6) * Math.PI * 2 + Math.PI / 12;
      const radius = 5.4;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = getGroundHeight(x, z);
      const tilt = (index % 3) * 0.06 - 0.05;
      dummy.position.set(x, y + 1.65, z);
      dummy.rotation.set(tilt, angle, tilt * 0.6);
      return { pos: [x, y + 1.65, z] as [number, number, number], rot: new Euler(tilt, angle, tilt * 0.6) };
    });
  }, []);

  const rubble = useMemo(() => {
    const items = [];
    for (let i = 0; i < 14; i += 1) {
      const angle = (i * 137.5) % 360 * (Math.PI / 180);
      const radius = 3 + (i % 5) * 0.7;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = getGroundHeight(x, z);
      items.push({
        pos: [x, y + 0.18, z] as [number, number, number],
        rot: (i * 0.41) % (Math.PI * 2),
        size: 0.4 + (i % 4) * 0.18,
      });
    }
    return items;
  }, []);

  return (
    <group>
      {/* Dais: low stepped platform */}
      <mesh receiveShadow castShadow position={[0, groundY + 0.12, 0]}>
        <cylinderGeometry args={[4.6, 4.8, 0.32, 16]} />
        <meshStandardMaterial color={stoneColor} roughness={0.95} />
      </mesh>
      <mesh receiveShadow castShadow position={[0, groundY + 0.42, 0]}>
        <cylinderGeometry args={[3.6, 3.8, 0.34, 16]} />
        <meshStandardMaterial color={stoneShadow} roughness={0.95} />
      </mesh>
      <mesh receiveShadow castShadow position={[0, groundY + 0.74, 0]}>
        <cylinderGeometry args={[2.4, 2.6, 0.26, 16]} />
        <meshStandardMaterial color={stoneColor} roughness={0.95} />
      </mesh>
      {/* Moss patch on top */}
      <mesh receiveShadow position={[0, groundY + 0.88, 0]}>
        <cylinderGeometry args={[2.2, 2.2, 0.02, 16]} />
        <meshStandardMaterial color={mossColor} roughness={1} />
      </mesh>

      {/* Standing stones */}
      {standingStones.map((stone, i) => (
        <mesh key={`stone-${i}`} castShadow receiveShadow position={stone.pos} rotation={stone.rot}>
          <boxGeometry args={[0.9, 3.2 + (i % 2) * 0.6, 0.6]} />
          <meshStandardMaterial color={stoneColor} roughness={0.95} />
        </mesh>
      ))}

      {/* Broken arch: two pillars + a tilted lintel */}
      <group position={[0, groundY, -7.5]}>
        <mesh castShadow receiveShadow position={[-1.6, 2.2, 0]}>
          <boxGeometry args={[0.8, 4.4, 0.8]} />
          <meshStandardMaterial color={stoneShadow} roughness={0.95} />
        </mesh>
        <mesh castShadow receiveShadow position={[1.6, 2.0, 0]} rotation={new Euler(0, 0, -0.08)}>
          <boxGeometry args={[0.8, 4.0, 0.8]} />
          <meshStandardMaterial color={stoneShadow} roughness={0.95} />
        </mesh>
        <mesh castShadow position={[0, 4.6, 0]} rotation={new Euler(0, 0, 0.18)}>
          <boxGeometry args={[3.6, 0.6, 0.9]} />
          <meshStandardMaterial color={stoneColor} roughness={0.95} />
        </mesh>
      </group>

      {/* Rubble scattered around */}
      {rubble.map((piece, i) => (
        <mesh key={`rubble-${i}`} castShadow receiveShadow position={piece.pos} rotation-y={piece.rot}>
          <dodecahedronGeometry args={[piece.size, 0]} />
          <meshStandardMaterial color={i % 2 === 0 ? stoneColor : stoneShadow} roughness={0.95} />
        </mesh>
      ))}

      {/* A leaning obelisk near the back */}
      <mesh castShadow receiveShadow position={[6.5, getGroundHeight(6.5, 4) + 2.6, 4]} rotation={new Euler(0.1, 0.4, -0.18)}>
        <boxGeometry args={[1.2, 5.4, 1.2]} />
        <meshStandardMaterial color={stoneColor} roughness={0.95} />
      </mesh>
    </group>
  );
}
