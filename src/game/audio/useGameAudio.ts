"use client";

import { useEffect, useRef } from "react";
import { audioRuntime } from "@/game/audio/audioRuntime";
import type { AudioCueId } from "@/game/audio/audioCatalog";

export function useLoopingAudio(id: AudioCueId | null, key: string, volume = 1) {
  const handleRef = useRef<{ stop: (fadeMs?: number) => void } | null>(null);

  useEffect(() => {
    handleRef.current?.stop(450);
    handleRef.current = null;
    if (!id) return;
    handleRef.current = audioRuntime.startLoop(id, key, { volume });
    return () => {
      handleRef.current?.stop(450);
      handleRef.current = null;
    };
  }, [id, key, volume]);
}

export function useAudioUnlock() {
  useEffect(() => {
    const unlock = () => audioRuntime.unlock();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
}

export function useUiClickAudio() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const interactive = target?.closest("button, a, input[type='radio'], input[type='checkbox']");
      if (!interactive || interactive.hasAttribute("disabled")) return;
      audioRuntime.play("ui_click");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
