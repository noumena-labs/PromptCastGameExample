"use client";

// QuarksProviderRoot
// -----------------------------------------------------------------------------
// Owns ONE three.quarks BatchedRenderer for the entire scene. All
// QuarksEmitterNode children register their ParticleSystems here, which keeps
// draw calls collapsed into a single batch per material/render-mode group.
//
// Why a context (vs. importing a module-level singleton)?
//   - The BatchedRenderer is a THREE.Object3D; it must live inside the R3F
//     scene graph for one Canvas, and must be re-created if the Canvas remounts.
//   - We tick it from useFrame, which only works inside <Canvas>.

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BatchedRenderer } from "three.quarks";

const LIVE_QUARKS_BUDGET = 900;
const MIN_RESERVATION_SCALE = 0.15;

export type QuarksBudgetReservation = {
  scale: number;
  cost: number;
};

type QuarksContextValue = {
  renderer: BatchedRenderer;
  reserveBudget: (requestedCost: number) => QuarksBudgetReservation;
  releaseBudget: (reservation: QuarksBudgetReservation) => void;
};

const QuarksContext = createContext<QuarksContextValue | null>(null);

export function useQuarksRenderer(): BatchedRenderer {
  const ctx = useContext(QuarksContext);
  if (!ctx) {
    throw new Error(
      "useQuarksRenderer must be used inside <QuarksProviderRoot>"
    );
  }
  return ctx.renderer;
}

export function useQuarksRuntime(): QuarksContextValue {
  const ctx = useContext(QuarksContext);
  if (!ctx) {
    throw new Error(
      "useQuarksRuntime must be used inside <QuarksProviderRoot>"
    );
  }
  return ctx;
}

/**
 * Optional accessor for code that may render outside the provider (e.g. a
 * preview route that mounts the scene without the provider). Returns null
 * instead of throwing.
 */
export function useOptionalQuarksRenderer(): BatchedRenderer | null {
  return useContext(QuarksContext)?.renderer ?? null;
}

export function QuarksProviderRoot({
  children,
}: {
  children: React.ReactNode;
}) {
  // One renderer per Canvas lifetime.
  const renderer = useMemo(() => new BatchedRenderer(), []);
  const liveBudget = useRef(0);

  const reserveBudget = useCallback((requestedCost: number): QuarksBudgetReservation => {
    if (requestedCost <= 0) return { scale: 1, cost: 0 };

    const remaining = Math.max(0, LIVE_QUARKS_BUDGET - liveBudget.current);
    const scale = Math.min(1, remaining / requestedCost);
    if (scale < MIN_RESERVATION_SCALE) return { scale: 0, cost: 0 };

    const cost = requestedCost * scale;
    liveBudget.current += cost;
    return { scale, cost };
  }, []);

  const releaseBudget = useCallback((reservation: QuarksBudgetReservation) => {
    if (reservation.cost <= 0) return;
    liveBudget.current = Math.max(0, liveBudget.current - reservation.cost);
  }, []);

  const value = useMemo<QuarksContextValue>(
    () => ({ renderer, reserveBudget, releaseBudget }),
    [renderer, reserveBudget, releaseBudget],
  );

  // Tick all registered systems once per frame.
  // BatchedRenderer.update(delta) advances every system it owns.
  const lastDelta = useRef(0);
  useFrame((_, delta) => {
    // Clamp delta to avoid huge jumps after tab visibility changes.
    const clamped = Math.min(delta, 0.05);
    lastDelta.current = clamped;
    renderer.update(clamped);
  });

  return (
    <QuarksContext.Provider value={value}>
      {/* The BatchedRenderer is itself an Object3D and must be in the scene
          graph so its internal SpriteBatches/TrailBatches render. */}
      <primitive object={renderer} />
      {children}
    </QuarksContext.Provider>
  );
}
