"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
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
  const setMode = useGameStore((state) => state.setMode);
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
    } else {
      setMode("solo", null);
    }
  }, [addLog, params, setMode]);

  return <PromptCastCanvas />;
}
