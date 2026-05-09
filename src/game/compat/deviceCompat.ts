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
 * Detection is heuristic-only (no async WebGPU adapter probing). The key
 * signal is mobile-vs-desktop + Chrome-vs-anything-else + WebGPU presence.
 * False positives (we mark someone "limited" when they could actually run
 * the model) are acceptable; false negatives (we let an incapable device
 * through and then the model load hangs) are not.
 */

type UserAgentBrand = { brand: string; version: string };
type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { brands?: UserAgentBrand[]; mobile?: boolean };
  gpu?: unknown;
};

export type CompatReason = "mobile" | "no-webgpu" | "not-chrome";

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
 */
export function getCompatibility(): CompatResult {
  if (cached) return cached;
  cached = detectCompatibility();
  return cached;
}

/**
 * Reset the memoized result. Intended for tests only.
 */
export function __resetCompatibilityCacheForTests(): void {
  cached = null;
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

  let title = "Device Not Supported";
  let eyebrow = "~ Compatibility Notice ~";
  if (isMobile) {
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
  bullets.push(
    "You may still enter the meadow in Limited Mode \u2014 you will wield the basic Magic Missile, but the Inscription Crystal will lie shattered, and no new spells may be bound.",
  );

  return {
    eyebrow,
    title,
    bullets,
    showInstallChrome: !isChrome && !isMobile && reasons.length > 0,
  };
}
