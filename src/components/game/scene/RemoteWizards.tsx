"use client";

import { Billboard, Text } from "@react-three/drei";
import { LOCAL_PLAYER_ID } from "@/game/config/gameConfig";
import { useGameStore } from "@/game/state/gameStore";
import { WizardModel } from "@/components/game/scene/WizardModel";

export function RemoteWizards() {
  const localPlayerId = useGameStore((state) => state.localPlayerId);
  const playersById = useGameStore((state) => state.players);
  const players = Object.values(playersById).filter((player) => player.id !== localPlayerId && player.id !== LOCAL_PLAYER_ID);

  return (
    <group>
      {players.map((player) => (
        <group key={player.id} position={player.position} rotation-y={player.rotationY}>
          <WizardModel color={player.color} shielded={player.isShielded} />
          <Billboard position={[0, 2.9, 0]}>
            <Text fontSize={0.35} color="#f4f7e8" anchorX="center" anchorY="middle">
              {player.name}
            </Text>
          </Billboard>
        </group>
      ))}
    </group>
  );
}
