"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isTouchDevice } from "./deviceCompat";

/**
 * React hook wrapper around `isTouchDevice()`.
 *
 * Implemented with `useSyncExternalStore` so the SSR snapshot is
 * deterministically `false` (no touch overlay during server-render) while
 * the client snapshot reads the real verdict synchronously on first render.
 * That avoids both hydration mismatches AND the cascading-render lint that
 * a `useEffect` + `setState` pattern would trigger.
 *
 * The verdict never changes within a page load (a user can't grow a
 * touchscreen mid-session), so the `subscribe` no-op is correct: React
 * only needs to call `getSnapshot()` once on mount.
 */
const subscribe = (): (() => void) => () => undefined;
const getServerSnapshot = (): boolean => false;
const getSnapshot = (): boolean => isTouchDevice();

export function useIsTouchDevice(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* ────────────────────────────────────────────────────────────────────────
   Mobile-HUD gating
   ────────────────────────────────────────────────────────────────────────
   The touch *input layer* (joystick, look-pad, on-screen cast button) ships
   to anything that reports `pointer: coarse` — a touch-screen laptop player
   needs joystick controls just like a phone player. The compact Mobile-HUD
   *visual layout*, however, should NOT clobber the desktop HUD on a 13"
   touch laptop.

   Detection is intentionally device-class, NOT viewport-size based. Width
   thresholds are brittle (DPR, browser chrome, split-screen, foldable
   transitions all push the boundary around) and previously caused the
   mobile HUD to silently no-op on real phones near the 480px line. Three
   signals must agree:
     1. `pointer: coarse`  — primary input is a finger/stylus
     2. `hover: none`      — no precise hover capability (filters touch
                              laptops which still expose hover via mouse)
     3. UA hints           — phone/tablet substring or `userAgentData.mobile`

   This hook still subscribes to resize + orientationchange because we
   continue to track `data-orientation` for landscape sub-rules even when
   the mobile-class verdict itself is stable for the session.
*/

interface UADataLike {
  mobile?: boolean;
}

function evalMobileHud(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  if (!coarse || !noHover) return false;
  // Prefer the structured Client Hints API when present; fall back to UA
  // string sniffing for browsers that don't expose `userAgentData`.
  const nav = window.navigator as Navigator & { userAgentData?: UADataLike };
  if (nav.userAgentData && typeof nav.userAgentData.mobile === "boolean") {
    return nav.userAgentData.mobile;
  }
  const ua = nav.userAgent || "";
  return /Android|iPhone|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i.test(ua);
}

/**
 * Tag `<body>` with `data-mobile="1"` whenever the current device + viewport
 * combo qualifies as phone-class with touch as the primary input. CSS reads
 * this attribute to opt the Mobile HUD redesign in / out without needing
 * width-only media queries (which can't differentiate between a phone and a
 * narrow desktop window with a mouse).
 */
export function useApplyMobileHudClass(): void {
  useEffect(() => {
    const apply = () => {
      const on = evalMobileHud();
      if (on) document.body.dataset.mobile = "1";
      else delete document.body.dataset.mobile;

      // Track orientation too so landscape-only rules can target without
      // a media query (`body[data-mobile="1"][data-orientation="landscape"]`).
      const landscape = window.innerWidth >= window.innerHeight;
      document.body.dataset.orientation = landscape ? "landscape" : "portrait";
    };
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      delete document.body.dataset.mobile;
      delete document.body.dataset.orientation;
    };
  }, []);
}
