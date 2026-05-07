"use client";

import { useEffect, useState } from "react";
import { peerSession } from "@/game/networking/peerSession";

export function usePeerSession() {
  const [snapshot, setSnapshot] = useState(peerSession.getSnapshot());

  useEffect(() => peerSession.subscribe(setSnapshot), []);

  return snapshot;
}
