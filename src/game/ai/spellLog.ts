/**
 * Structured logger + ring buffer for the spell generation pipeline.
 *
 * The Sage was failing silently — `JSON.parse` exceptions and malformed JSON
 * tails were swallowed and surfaced as opaque "spoke in tongues" errors. Every
 * stage of the pipeline now writes through this module so:
 *   1. Failures include the raw model output (mirrored to localStorage so it
 *      survives a refresh).
 *   2. The error UI can show "Show details" without the developer rebuilding.
 *   3. The repair-loop has access to the last failed buffer.
 */

const LOG_PREFIX = "[Sage]";
const RING_SIZE = 128;
const STORAGE_KEY = "promptcast.spellLog.lastFailure";

export type SpellStage =
  | "load"
  | "concept"
  | "balance"
  | "compose"
  | "validate"
  | "repair";

export type SpellLogLevel = "debug" | "info" | "warn" | "error";

export type SpellLogEntry = {
  t: number;
  level: SpellLogLevel;
  stage: SpellStage;
  msg: string;
  data?: Record<string, unknown>;
};

export type SpellFailureSnapshot = {
  t: number;
  stage: SpellStage;
  message: string;
  rawOutput?: string;
  cause?: string;
  data?: Record<string, unknown>;
};

const ring: SpellLogEntry[] = [];
let lastFailure: SpellFailureSnapshot | null = null;

function pushRing(entry: SpellLogEntry): void {
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
}

function emit(entry: SpellLogEntry): void {
  pushRing(entry);
  const tag = `${LOG_PREFIX}[${entry.stage}]`;
  const fn =
    entry.level === "error"
      ? console.error
      : entry.level === "warn"
        ? console.warn
        : entry.level === "info"
          ? console.info
          : console.debug;
  if (entry.data !== undefined) {
    fn(tag, entry.msg, entry.data);
  } else {
    fn(tag, entry.msg);
  }
}

export const spellLog = {
  debug(stage: SpellStage, msg: string, data?: Record<string, unknown>) {
    emit({ t: Date.now(), level: "debug", stage, msg, data });
  },
  info(stage: SpellStage, msg: string, data?: Record<string, unknown>) {
    emit({ t: Date.now(), level: "info", stage, msg, data });
  },
  warn(stage: SpellStage, msg: string, data?: Record<string, unknown>) {
    emit({ t: Date.now(), level: "warn", stage, msg, data });
  },
  error(stage: SpellStage, msg: string, data?: Record<string, unknown>) {
    emit({ t: Date.now(), level: "error", stage, msg, data });
  },
  /** Records a hard failure and mirrors it to localStorage. */
  failure(snapshot: Omit<SpellFailureSnapshot, "t">): SpellFailureSnapshot {
    const full: SpellFailureSnapshot = { t: Date.now(), ...snapshot };
    lastFailure = full;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
      } catch {
        // localStorage may be unavailable (private mode / quota); ignore.
      }
    }
    emit({
      t: full.t,
      level: "error",
      stage: full.stage,
      msg: `failure: ${full.message}`,
      data: { rawOutputLen: full.rawOutput?.length, cause: full.cause },
    });
    return full;
  },
  getLastFailure(): SpellFailureSnapshot | null {
    if (lastFailure) return lastFailure;
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SpellFailureSnapshot) : null;
    } catch {
      return null;
    }
  },
  clearLastFailure() {
    lastFailure = null;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  },
  recent(count = 32): SpellLogEntry[] {
    return ring.slice(-count);
  },
};
