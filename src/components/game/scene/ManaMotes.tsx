"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { AdditiveBlending, Group } from "three";
import { useShallow } from "zustand/react/shallow";
import { useGameStore } from "@/game/state/gameStore";

export function ManaMotes() {
  const moteIds = useGameStore(useShallow((state) => state.manaMotes.map((m) => m.id)));

  return (
    <group>
      {moteIds.map((id, index) => (
        <Mote key={id} id={id} phase={index} />
      ))}
    </group>
  );
}

function Mote({ id, phase }: { id: string; phase: number }) {
  const mote = useGameStore((state) => state.manaMotes.find((m) => m.id === id));
  const group = useRef<Group>(null);

  useFrame((state) => {
    if (!group.current || !mote) return;
    const t = state.clock.elapsedTime;
    group.current.position.y = mote.position[1] + Math.sin(t * 2.4 + phase * 0.7) * 0.18;
    group.current.rotation.y = t * 0.9 + phase;

    // Pulse + fade for ephemeral kill-drops as they near decay.
    if (mote.ephemeral && mote.decayAt) {
      const remaining = mote.decayAt - Date.now();
      const fade = Math.max(0, Math.min(1, remaining / 2000));
      const pulse = 0.85 + Math.sin(t * 6 + phase) * 0.15;
      group.current.scale.setScalar(pulse * (0.6 + 0.4 * fade));
    } else {
      const pulse = 0.92 + Math.sin(t * 3 + phase) * 0.08;
      group.current.scale.setScalar(pulse);
    }
  });

  if (!mote?.active) return null;

  const core = mote.ephemeral ? "#9fe9ff" : "#7ec4ff";
  const halo = mote.ephemeral ? "#bff3ff" : "#5ea7ff";

  return (
    <group ref={group} position={[mote.position[0], mote.position[1], mote.position[2]]}>
      <mesh>
        <sphereGeometry args={[0.18, 12, 10]} />
        <meshBasicMaterial color={core} transparent opacity={0.95} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.42, 14, 12]} />
        <meshBasicMaterial color={halo} transparent opacity={0.28} blending={AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
