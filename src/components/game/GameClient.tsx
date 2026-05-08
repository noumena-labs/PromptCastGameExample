"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { peerSession } from "@/game/networking/peerSession";
import { DEFAULT_WIZARD_PROFILE, loadWizardProfile, saveWizardProfile } from "@/game/playerProfile";
import { useGameStore } from "@/game/state/gameStore";

const PromptCastCanvas = dynamic(() => import("@/components/game/PromptCastCanvas").then((module) => module.PromptCastCanvas), {
  ssr: false,
  loading: () => <div className="loadingScreen">Loading arena...</div>,
});

export default function GameClient() {
  return (
    <Suspense fallback={<div className="loadingScreen">Loading match...</div>}>
      <GameClientInner />
    </Suspense>
  );
}

function GameClientInner() {
  const params = useSearchParams();
  const rejoinInFlight = useRef<Promise<string> | null>(null);
  const rejoinRoom = useRef<string | null>(null);
  const setMode = useGameStore((state) => state.setMode);
  const setLocalIdentity = useGameStore((state) => state.setLocalIdentity);
  const addLog = useGameStore((state) => state.addLog);

  useEffect(() => {
    const mode = params.get("mode");
    const room = params.get("room");
    if (mode === "host") {
      setMode("host", room);
      addLog(`Hosting room ${room ?? "unknown"}.`);
    } else if (mode === "client") {
      setMode("client", room);
      addLog(`Joined room ${room ?? "unknown"}.`);
      if (!room) return;

      const session = peerSession.getSnapshot();
      const profile = loadWizardProfile();
      const name = profile.name || DEFAULT_WIZARD_PROFILE.name;
      saveWizardProfile({ ...profile, name });
      if (session.role === "client" && session.roomCode === room && session.peerId) {
        setLocalIdentity(session.peerId, name, profile.color);
        return;
      }
      if (!rejoinInFlight.current || rejoinRoom.current !== room) {
        rejoinRoom.current = room;
        rejoinInFlight.current = peerSession.joinRoom(room);
      }

      let cancelled = false;
      rejoinInFlight.current
        .then((clientId) => {
          if (cancelled || !clientId) return;
          setLocalIdentity(clientId, name, profile.color);
          setMode("client", room);
          addLog(`Reconnected to room ${room}.`);
        })
        .catch((error) => {
          if (cancelled) return;
          addLog(error instanceof Error ? `Unable to reconnect: ${error.message}` : "Unable to reconnect to host.");
        })
        .finally(() => {
          if (rejoinRoom.current !== room) return;
          rejoinInFlight.current = null;
        });

      return () => {
        cancelled = true;
      };
    } else {
      setMode("solo", null);
    }
  }, [addLog, params, setLocalIdentity, setMode]);

  return <PromptCastCanvas />;
}
