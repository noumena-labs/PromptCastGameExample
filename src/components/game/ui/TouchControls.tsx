"use client";

import { useEffect, useRef, useState } from "react";
import nipplejs from "nipplejs";

type JoystickCollection = ReturnType<typeof nipplejs.create>;
import {
  addTouchLookDelta,
  clearTouchMove,
  setTouchActive,
  setTouchJump,
  setTouchLmb,
  setTouchMove,
} from "@/game/input/touchInputBus";
import { useGameStore } from "@/game/state/gameStore";
import { MAGIC_MISSILE } from "@/game/config/gameConfig";

/**
 * Mobile-only DOM overlay providing the three pieces of input the touch
 * player can't otherwise produce:
 *
 *   1. A nipplejs virtual joystick on the bottom-left for movement.
 *   2. A right-half invisible drag-pad for camera look (yaw / pitch).
 *   3. A jump button just above the joystick.
 *
 * The component never re-renders in response to game state — it only
 * registers DOM-level event handlers that push into `touchInputBus`. The
 * `useGameStore` subscription is only used to suppress all touch input
 * while the prompt overlay is open (so swiping the prompt doesn't also
 * spin the camera underneath).
 *
 * Cast / spell buttons live in `GameHud.tsx` (the existing Spell Tome
 * runestones become tappable on touch). This component intentionally does
 * not own those — keeping a single source of truth for spell UI across
 * desktop and mobile.
 */
export function TouchControls() {
  const joyZoneRef = useRef<HTMLDivElement | null>(null);
  const lookZoneRef = useRef<HTMLDivElement | null>(null);
  const promptOpenRef = useRef(false);

  // Keep a ref of `promptOpen` so event handlers can read the latest value
  // without re-binding the DOM listeners.
  const promptOpen = useGameStore((state) => state.promptOpen);
  // Subscribe to the local player's base-spell cooldown so the cast
  // button can render an accurate cooldown ring. Sanctuary lives inside
  // the Spell Tome panel (see GameHud.tsx) so we don't read aura here.
  const localPlayerId = useGameStore((state) => state.localPlayerId);
  const baseCooldownAt = useGameStore(
    (state) => state.players[localPlayerId]?.cooldowns[MAGIC_MISSILE.id],
  );

  // Tick a 100ms clock so the conic-gradient cooldown ring updates smoothly.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const cdRemaining = baseCooldownAt ? Math.max(0, baseCooldownAt - now) : 0;
  const cooling = cdRemaining > 0 && now > 0;
  const cooldownDeg = cooling
    ? Math.round((1 - cdRemaining / MAGIC_MISSILE.cooldownMs) * 360)
    : 360;

  useEffect(() => {
    promptOpenRef.current = promptOpen;
    if (promptOpen) {
      // Cancel any in-flight inputs when the prompt opens so the player
      // doesn't keep walking / firing while typing a spell.
      clearTouchMove();
      setTouchJump(false);
      setTouchLmb(false);
    }
  }, [promptOpen]);

  // Mark the bus as touch-active for the lifetime of this component. Used
  // by `LocalWizard` to skip pointer-lock and accept touch-look input even
  // without a locked pointer.
  useEffect(() => {
    setTouchActive(true);
    return () => {
      setTouchActive(false);
      clearTouchMove();
      setTouchJump(false);
      setTouchLmb(false);
    };
  }, []);

  // ── Virtual joystick (nipplejs) ──────────────────────────────────────
  useEffect(() => {
    const zone = joyZoneRef.current;
    if (!zone) return;
    let manager: JoystickCollection | null = null;
    try {
      manager = nipplejs.create({
        zone,
        mode: "static",
        position: { left: "50%", top: "50%" },
        color: "rgba(243, 230, 196, 0.85)",
        size: 120,
        threshold: 0.1,
        fadeTime: 120,
        restOpacity: 0.55,
      });
    } catch (err) {
      // Some old WebViews fail to instantiate nipplejs; fall back to no
      // joystick rather than crashing the canvas.
      console.warn("[TouchControls] nipplejs init failed", err);
      return;
    }

    manager.on("move", (evt) => {
      if (promptOpenRef.current) return;
      // nipplejs's `move` event packs the joystick data on `evt.data`. The
      // `vector` field is normalized to [-1, 1] on each axis with +y = up
      // (forward in our convention).
      const v = evt?.data?.vector;
      if (!v) return;
      setTouchMove(v.x, v.y);
    });

    manager.on("end", () => {
      clearTouchMove();
    });

    return () => {
      manager?.destroy();
    };
  }, []);

  // ── Right-half look-pad ──────────────────────────────────────────────
  // We listen on the look-zone div (positioned over the right half of the
  // screen) and convert pointer movement into accumulated yaw/pitch
  // deltas. Multi-touch is supported by tracking only the first pointer
  // that landed on this surface — the joystick gets its own pointer.
  useEffect(() => {
    const zone = lookZoneRef.current;
    if (!zone) return;

    let activePointerId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (promptOpenRef.current) return;
      if (activePointerId !== null) return; // already tracking a pointer
      // Only respond to actual touch / pen — desktop mouse should keep
      // using the existing pointer-lock flow even on touch-capable laptops.
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      activePointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      try {
        zone.setPointerCapture(event.pointerId);
      } catch {
        /* ignore — non-fatal */
      }
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      if (promptOpenRef.current) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      addTouchLookDelta(dx, dy);
      event.preventDefault();
    };

    const endPointer = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      try {
        zone.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    };

    zone.addEventListener("pointerdown", onPointerDown, { passive: false });
    zone.addEventListener("pointermove", onPointerMove, { passive: false });
    zone.addEventListener("pointerup", endPointer);
    zone.addEventListener("pointercancel", endPointer);
    zone.addEventListener("pointerleave", endPointer);
    return () => {
      zone.removeEventListener("pointerdown", onPointerDown);
      zone.removeEventListener("pointermove", onPointerMove);
      zone.removeEventListener("pointerup", endPointer);
      zone.removeEventListener("pointercancel", endPointer);
      zone.removeEventListener("pointerleave", endPointer);
    };
  }, []);

  return (
    <div className="touchControls" aria-hidden>
      {/*
        Right-half invisible look-pad. Sits BEHIND the action buttons /
        runestones in the visual stack so taps on cast UI take precedence,
        but still covers the canvas area on the right side of the screen.
      */}
      <div ref={lookZoneRef} className="touchLookZone" />

      {/* Joystick zone, bottom-left. */}
      <div ref={joyZoneRef} className="touchJoystickZone" />

      {/*
        Bottom-right thumb cluster. Per modern controller convention we
        keep Jump and Cast adjacent so the right thumb can hop between
        them (or hit Cast → Jump in quick succession). Sanctuary lives
        in the Spell Tome panel above (see GameHud.tsx) since it's a
        spell-state action, not a movement / fire input.
      */}
      <div className="touchActionCluster">
        <div className="touchPrimaryRow">
          <button
            type="button"
            className="touchJumpButton"
            aria-label="Jump"
            onPointerDown={(event) => {
              event.preventDefault();
              setTouchJump(true);
            }}
            onPointerUp={() => setTouchJump(false)}
            onPointerCancel={() => setTouchJump(false)}
            onPointerLeave={() => setTouchJump(false)}
          >
            ⤒
          </button>

          {/*
            Magic-Missile (LMB-equivalent) hold button. Shows a
            conic-gradient cooldown ring while the base spell is on
            cooldown so the player gets visual feedback identical to the
            runestone cooldown sweep.
          */}
          <button
            type="button"
            className={`touchCastButton${cooling ? " cooling" : ""}`}
            aria-label="Cast Magic Missile"
            onPointerDown={(event) => {
              event.preventDefault();
              setTouchLmb(true);
            }}
            onPointerUp={() => setTouchLmb(false)}
            onPointerCancel={() => setTouchLmb(false)}
            onPointerLeave={() => setTouchLmb(false)}
          >
            {cooling ? (
              <span
                className="touchCooldownRing"
                aria-hidden
                style={{
                  background: `conic-gradient(rgba(20,12,6,0.6) ${cooldownDeg}deg, rgba(20,12,6,0) ${cooldownDeg}deg)`,
                }}
              />
            ) : null}
            <span className="touchCastGlyph">✦</span>
          </button>
        </div>
      </div>
    </div>
  );
}
