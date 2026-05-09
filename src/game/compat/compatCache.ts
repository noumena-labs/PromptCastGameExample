/**
 * Persistent compatibility-verdict cache.
 *
 * Device + browser compatibility is invariant for a given UA, so we persist
 * the verdict to `localStorage` to:
 *   1. Skip the heuristic UA parse on repeat visits.
 *   2. Remember "this device failed cogentlm at runtime" so future visits
 *      go straight to Limited Mode without trying (and failing) to load the
 *      model again.
 *
 * The cache is keyed by `navigator.userAgent`. A UA change (browser update
 * that adds WebGPU, switching browsers, different device) invalidates the
 * stored verdict and the next caller falls back to fresh detection.
 *
 * All storage I/O is wrapped in try/catch — Safari private mode, disabled
 * storage, quota errors, and serialization failures must never crash the
 * page. Cache miss is the safe default.
 */

import type { CompatResult } from "./deviceCompat";

const STORAGE_KEY = "promptcast.compat.v1";

/**
 * Source of a cached verdict:
 *   - "heuristic": produced by `detectCompatibility()` from UA + WebGPU
 *     presence. Both compatible and incompatible verdicts are cached.
 *   - "runtime":   produced by `markRuntimeIncompatible()` after cogentlm
 *     failed to initialize. Always incompatible.
 */
export type CompatCacheSource = "heuristic" | "runtime";

type CachedEnvelope = {
  result: CompatResult;
  userAgent: string;
  source: CompatCacheSource;
  cachedAt: number;
};

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function currentUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

/**
 * Light schema check — protects against legacy / corrupted cache entries
 * surviving across format changes. We don't validate every field deeply;
 * the goal is only to reject obvious garbage so a stale envelope doesn't
 * crash callers downstream.
 */
function isValidEnvelope(value: unknown): value is CachedEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.userAgent !== "string") return false;
  if (typeof v.cachedAt !== "number") return false;
  if (v.source !== "heuristic" && v.source !== "runtime") return false;
  const r = v.result as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return false;
  if (typeof r.compatible !== "boolean") return false;
  if (!Array.isArray(r.reasons)) return false;
  if (typeof r.isMobile !== "boolean") return false;
  if (typeof r.isChrome !== "boolean") return false;
  if (typeof r.hasWebGpu !== "boolean") return false;
  return true;
}

/**
 * Read the cached verdict if one exists for this exact `userAgent`. Returns
 * `null` on:
 *   - Missing entry
 *   - Storage unavailable / private mode
 *   - JSON parse failure
 *   - Schema mismatch
 *   - UA mismatch (browser update, different device)
 */
export function loadCachedCompat(): CompatResult | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Drop the corrupt entry so it does not keep failing every visit.
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }

  if (!isValidEnvelope(parsed)) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }

  if (parsed.userAgent !== currentUserAgent()) {
    // UA changed — most likely a browser update or different device. Don't
    // delete proactively; saving a fresh entry below will overwrite.
    return null;
  }

  return parsed.result;
}

/**
 * Persist a verdict for this UA. Overwrites any prior entry. Silently no-ops
 * if storage is unavailable.
 */
export function saveCachedCompat(result: CompatResult, source: CompatCacheSource): void {
  const storage = getStorage();
  if (!storage) return;
  const envelope: CachedEnvelope = {
    result,
    userAgent: currentUserAgent(),
    source,
    cachedAt: Date.now(),
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    /* ignore quota / serialization errors */
  }
}

/**
 * Drop the cached verdict. Exposed for tests and for a possible future
 * "Re-test compatibility" affordance in the landing modal.
 */
export function clearCachedCompat(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
