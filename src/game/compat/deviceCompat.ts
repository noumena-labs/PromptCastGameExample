/**
 * Device & browser compatibility detection for PromptCast.
 *
 * The cogentlm library that powers in-browser spell generation has hard
 * requirements that are not met by every device:
 *   - WebGPU support (i.e. `navigator.gpu`) — currently desktop Chrome only
 *     in a stable, reliable form.
 *   - Sufficient GPU/RAM headroom for the LFM2 model — mobile devices fall
 *     well short.
 *
 * Rather than fail loudly when the model load times out or the WebGPU adapter
 * comes back incompatible, we detect up-front and route incompatible devices
 * into a "Limited Mode" that ships only the static Magic Missile spell.
 *
 * Detection has two layers:
 *   1. Heuristic up-front (UA + WebGPU presence). False positives are
 *      acceptable; false negatives are not.
 *   2. Runtime promotion: if heuristic detection passes but cogentlm's
 *      engine creation or model load fails, we demote the device via
 *      `markRuntimeIncompatible()` and persist the verdict so subsequent
 *      visits skip the failing init path entirely.
 *
 * Both verdicts are cached in `localStorage` (see `compatCache.ts`) keyed by
 * `navigator.userAgent`. A UA change invalidates the entry automatically.
 */

import {
  clearCachedCompat,
  loadCachedCompat,
  saveCachedCompat,
} from "./compatCache";

type UserAgentBrand = { brand: string; version: string };
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { brands?: UserAgentBrand[]; mobile?: boolean };
  gpu?: unknown;
};

export type CompatReason = "mobile" | "no-webgpu" | "not-chrome" | "runtime-failure";

export type CompatResult = {
  /** Overall verdict: true means full local-inference experience is allowed. */
  compatible: boolean;
  /** Why we marked this device limited. Empty when `compatible` is true. */
  reasons: CompatReason[];
  isMobile: boolean;
  isChrome: boolean;
  hasWebGpu: boolean;
};

const FULLY_COMPATIBLE: CompatResult = {
  compatible: true,
  reasons: [],
  isMobile: false,
  isChrome: true,
  hasWebGpu: true,
};

let cached: CompatResult | null = null;

function detectMobile(nav: NavigatorWithUserAgentData): boolean {
  // Prefer the explicit UA-CH `mobile` boolean when available — Chrome on
  // Android sets it correctly, while desktop UA-CH leaves it false even when
  // the legacy UA string contains substrings like "Mobile" in extensions.
  if (typeof nav.userAgentData?.mobile === "boolean") {
    if (nav.userAgentData.mobile) return true;
    // UA-CH mobile=false is authoritative on Chromium browsers; trust it.
    return false;
  }
  const ua = nav.userAgent || "";
  // Standard mobile regex — covers phones and most tablets.
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return true;
  }
  // iPadOS 13+ reports as Mac in UA but exposes touch. Heuristic catches it.
  if (
    typeof nav.maxTouchPoints === "number" &&
    nav.maxTouchPoints > 1 &&
    /Macintosh/i.test(ua)
  ) {
    return true;
  }
  return false;
}

function detectChrome(nav: NavigatorWithUserAgentData): boolean {
  const brands = nav.userAgentData?.brands;
  if (brands?.some(({ brand }) => brand.toLowerCase() === "google chrome")) return true;
  const ua = nav.userAgent || "";
  const isGoogleChrome = /Chrome\//.test(ua) && nav.vendor === "Google Inc.";
  const isAlternateChromiumBrowser = /Edg|OPR|Opera|SamsungBrowser|CriOS|FxiOS|Chromium/.test(ua);
  return isGoogleChrome && !isAlternateChromiumBrowser;
}

function detectWebGpu(nav: NavigatorWithUserAgentData): boolean {
  return typeof nav.gpu !== "undefined" && nav.gpu !== null;
}

/**
 * Run the full detection. Caller-side modules should prefer
 * `getCompatibility()` which memoizes — `detectCompatibility` is exported
 * mainly for tests and for the rare case where a caller wants a fresh read.
 */
export function detectCompatibility(): CompatResult {
  if (typeof navigator === "undefined") {
    // SSR / Node: assume compatible to avoid flashing the modal during
    // hydration. The client-side hook will replace this verdict on mount.
    return FULLY_COMPATIBLE;
  }
  const nav = navigator as NavigatorWithUserAgentData;
  const isMobile = detectMobile(nav);
  const isChrome = detectChrome(nav);
  const hasWebGpu = detectWebGpu(nav);

  const reasons: CompatReason[] = [];
  if (isMobile) reasons.push("mobile");
  if (!isChrome) reasons.push("not-chrome");
  if (!hasWebGpu) reasons.push("no-webgpu");

  const compatible = reasons.length === 0;
  return { compatible, reasons, isMobile, isChrome, hasWebGpu };
}

/**
 * Memoized variant — the result never changes within a page load (the user
 * cannot swap browsers without reloading), so we compute once and reuse.
 *
 * Lookup order:
 *   1. In-memory `cached` (set on first call this page-load, or by
 *      `markRuntimeIncompatible()` after a runtime failure).
 *   2. `localStorage` cache, if the entry's `userAgent` still matches the
 *      current navigator. This persists both heuristic verdicts and prior
 *      runtime-failure demotions across page loads.
 *   3. Fresh heuristic detection. The result is then persisted so future
 *      visits hit the cache.
 */
export function getCompatibility(): CompatResult {
  if (cached) return cached;

  const fromCache = loadCachedCompat();
  if (fromCache) {
    cached = fromCache;
    return cached;
  }

  const detected = detectCompatibility();
  cached = detected;
  // Skip persisting the SSR placeholder — it's an assumption, not a verdict.
  // We detect that case by the absence of a real `navigator`.
  if (typeof navigator !== "undefined") {
    saveCachedCompat(detected, "heuristic");
  }
  return cached;
}

/**
 * Promote a device to Limited Mode after a runtime failure. Called by the
 * model loader when `getCogentEngine()` or `ensureModelLoaded()` rejects:
 * the heuristic said we were fine, but the runtime disagreed.
 *
 * The returned verdict preserves the current heuristic flags (so the copy
 * can still report e.g. that the user IS on Chrome with WebGPU) but flips
 * `compatible` to false and tags the failure as `"runtime-failure"`. The
 * verdict is persisted so the next page load short-circuits cogentlm boot
 * and goes straight to Limited Mode.
 *
 * The `error` argument is currently unused in the verdict itself but is
 * forwarded by the caller into spell-load diagnostics; we accept it here
 * to make future enrichment (capturing message / name in the cache) a
 * single-file change.
 */
export function markRuntimeIncompatible(_error: unknown): CompatResult {
  // Re-read raw signals so the verdict reflects the device as it actually
  // is, not whatever the heuristic happened to memoize earlier.
  let isMobile = false;
  let isChrome = true;
  let hasWebGpu = true;
  if (typeof navigator !== "undefined") {
    const nav = navigator as NavigatorWithUserAgentData;
    isMobile = detectMobile(nav);
    isChrome = detectChrome(nav);
    hasWebGpu = detectWebGpu(nav);
  }

  const result: CompatResult = {
    compatible: false,
    reasons: ["runtime-failure"],
    isMobile,
    isChrome,
    hasWebGpu,
  };

  cached = result;
  saveCachedCompat(result, "runtime");
  return result;
}

/**
 * Reset the memoized result. Intended for tests only.
 */
export function __resetCompatibilityCacheForTests(): void {
  cached = null;
  clearCachedCompat();
}

/**
 * Returns true when the current device should receive the touch UI overlay.
 *
 * This is intentionally orthogonal to `getCompatibility().isMobile` — that
 * verdict drives Limited Mode (no AI spell forge), while this helper drives
 * input/HUD branching for any pointer-coarse surface (phones, tablets,
 * 2-in-1s in tablet mode). Desktops with mice are unaffected.
 *
 * Detection order:
 *   1. CSS `(pointer: coarse)` media query — modern, accurate.
 *   2. `'ontouchstart' in window` fallback for older WebViews.
 *   3. `navigator.maxTouchPoints > 0` belt-and-suspenders catch.
 *
 * Safe to call during render; falls back to `false` under SSR.
 */
let cachedIsTouch: boolean | null = null;
export function isTouchDevice(): boolean {
  if (cachedIsTouch !== null) return cachedIsTouch;
  if (typeof window === "undefined") return false;
  let coarse = false;
  try {
    coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
  } catch {
    coarse = false;
  }
  const hasTouchEvents =
    typeof window !== "undefined" && "ontouchstart" in window;
  const hasTouchPoints =
    typeof navigator !== "undefined" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 0;
  cachedIsTouch = coarse || hasTouchEvents || hasTouchPoints;
  return cachedIsTouch;
}

/**
 * Reset the memoized touch-device verdict. Intended for tests only.
 */
export function __resetTouchDeviceCacheForTests(): void {
  cachedIsTouch = null;
}

/**
 * Human-facing copy for the compatibility modal / HUD info panel. The title
 * and body change based on which detection signals failed: a user on an
 * iPhone gets a different message than one on Firefox desktop. Centralized
 * here so both the landing-page modal and the in-game capsule speak with
 * one voice.
 */
export type CompatCopy = {
  eyebrow: string;
  title: string;
  bullets: string[];
  /** Whether the "Install Chrome" CTA is appropriate for this verdict. */
  showInstallChrome: boolean;
};

export function describeCompat(compat: CompatResult): CompatCopy {
  const { isMobile, isChrome, hasWebGpu, reasons } = compat;
  const isRuntimeFailure = reasons.includes("runtime-failure");

  let title = "Device Not Supported";
  let eyebrow = "~ Compatibility Notice ~";
  if (isRuntimeFailure) {
    // Runtime-failure copy takes precedence — the heuristic flags may all
    // look fine (Chrome desktop with WebGPU), so the hardware-flavored
    // titles below would be misleading.
    title = "The Sage Faltered";
    eyebrow = "~ A Late Calamity ~";
  } else if (isMobile) {
    title = "Desktop Required";
    eyebrow = "~ A Desk Awaits ~";
  } else if (!isChrome) {
    title = "Chrome Desktop Required";
    eyebrow = "~ Browser Requirement ~";
  } else if (!hasWebGpu) {
    title = "Modern GPU Required";
    eyebrow = "~ Hardware Requirement ~";
  }

  const bullets: string[] = [];
  if (isRuntimeFailure) {
    bullets.push(
      "The rite began, but the Inscription Crystal cracked beneath the weight of it. The local Sage could not be summoned on this device, even though the omens looked fair.",
    );
    bullets.push(
      "This often means the WebGPU runtime, the worker, or device memory could not bear the LFM2 model. The verdict has been remembered, so future visits will go straight to Limited Mode.",
    );
  } else {
    if (isMobile) {
      bullets.push(
        "PromptCast runs a small language model directly in your browser to forge spells. Mobile devices lack the GPU and memory headroom required.",
      );
    }
    if (!isChrome && !isMobile) {
      bullets.push(
        "Spell inscription depends on WebGPU features that are stable today only in Chrome on desktop. Most recent Mac, Windows, and Linux machines work.",
      );
    }
    if (!hasWebGpu && !isMobile) {
      bullets.push(
        "Your browser does not expose WebGPU. The local Sage cannot speak without it.",
      );
    }
  }

  bullets.push(
    "You may still enter the meadow in Limited Mode \u2014 you will wield the basic Magic Missile, but the Inscription Crystal will lie shattered, and no new spells may be bound.",
  );

  return {
    eyebrow,
    title,
    bullets,
    // A runtime failure on Chrome desktop is not solved by installing
    // Chrome, so suppress the CTA in that case even when `!isChrome` would
    // otherwise be falsy.
    showInstallChrome: !isRuntimeFailure && !isChrome && !isMobile && reasons.length > 0,
  };
}
