import type { CogentEngine } from "cogentlm";
import { normalizeSpell } from "@/game/spells/spellSchema";
import type { GeneratedSpell } from "@/game/types";

/**
 * Local mirror of cogentlm's `ModelLoadProgress` (not re-exported from the
 * barrel). Keep in sync with `cogentlm/dist/types/model-management/model-types.d.ts`.
 */
export type ModelLoadProgress = {
  phase: "metadata" | "download" | "store" | "load";
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  assetName?: string;
};

/**
 * Hard-coded GGUF model. Loaded once via OPFS-cached download (~730 MB) and
 * reused for the lifetime of the page. We deliberately pin the model so the
 * Sage's voice is consistent across players in a P2P match.
 */
export const MODEL_URL = "https://huggingface.co/LiquidAI/LFM2.5-1.2B-Thinking-GGUF/resolve/main/LFM2.5-1.2B-Thinking-Q4_K_M.gguf?download=true";

let enginePromise: Promise<CogentEngine> | null = null;
let modelLoadPromise: Promise<void> | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Progress fan-out: many UI surfaces want to observe the single in-flight load.
// ─────────────────────────────────────────────────────────────────────────────
type ProgressListener = (progress: ModelLoadProgress) => void;
const progressListeners = new Set<ProgressListener>();
let lastProgress: ModelLoadProgress | null = null;

function broadcastProgress(progress: ModelLoadProgress): void {
  lastProgress = progress;
  for (const listener of progressListeners) listener(progress);
}

export type SpellGenerationProgress = {
  /** Reasoning tokens streamed before the JSON spell appears. */
  reasoning: string;
  /** Phase of the streaming response. */
  phase: "thinking" | "writing" | "done";
};

export type SpellGenerationResult = {
  spell: GeneratedSpell;
  /** Full reasoning string captured during streaming. */
  reasoning: string;
};

/** Lazy access to the engine. Caller is expected to await `ensureModelLoaded`. */
export async function getCogentEngine(): Promise<CogentEngine> {
  if (!enginePromise) {
    enginePromise = import("cogentlm").then(({ CogentEngine }) => CogentEngine.create());
  }
  return enginePromise;
}

/**
 * Loads (or no-ops if already loaded) the LFM2 model. Subsequent calls return
 * the same in-flight promise so the loader UI can await this safely from many
 * places without re-downloading. Optional `onProgress` listener receives
 * `ModelLoadProgress` events; if a snapshot already exists it is replayed
 * synchronously before this function returns.
 */
export async function ensureModelLoaded(onProgress?: ProgressListener): Promise<void> {
  if (onProgress) {
    progressListeners.add(onProgress);
    if (lastProgress) onProgress(lastProgress);
  }
  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      const engine = await getCogentEngine();
      if (!engine.models.current()) {
        await engine.models.load(MODEL_URL, { onProgress: broadcastProgress });
      }
    })();
  }
  return modelLoadPromise;
}

/** Detach a progress listener previously passed to `ensureModelLoaded`. */
export function unsubscribeModelProgress(listener: ProgressListener): void {
  progressListeners.delete(listener);
}

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary, a magic-system designer. The player describes a spell. Think briefly inside <think>...</think>, then output a single strict JSON object describing the spell.

OUTPUT FORMAT — your reasoning is already wrapped in <think>...</think> by the runtime. After </think>, output ONLY the JSON object on its own (no markdown fences, no extra prose).

JSON SHAPE:
{ "name": "...", "element": "...", "delivery": "...", "impact": "...", "count": 1, "damage": 25, "speed": 18, "radius": 2.5, "durationMs": 1800, "cooldownMs": 5000, "manaCost": 35, "effects": [], "color": "#rrggbb" }

FIELDS:
- element: one of fire, ice, lightning, earth, arcane, shadow, nature
- delivery: how the spell reaches the target. one of:
    "projectile" — a single bolt or several fanned bolts cast forward from the wizard
    "beam"       — fast straight-line beam from the wizard
    "sky"        — meteors / lightning strikes / hail falls from above onto the aimed point
    "self"       — burst, nova, wall, or aura centered on the wizard
- impact: what happens when it lands. one of:
    "single" — single-target hit
    "aoe"    — lingering area damage
    "vortex" — pulls enemies toward the center (use with single or aoe)
    "wall"   — line-shaped barrier
    "trap"   — placed sigil that triggers on contact
    "burst"  — short instantaneous explosion
    "none"   — pure utility, no damage
- count: number of projectiles or impact points
    sky: 1-10 (use 4-8 for "shower"/"storm"/"rain", 1-3 for a single meteor)
    projectile: 1-5 (use 1 for a bolt; 3-5 for "volley"/"barrage"/"missiles")
    beam, self: always 1
- damage: 6-70 raw; the engine balances based on count and area
- radius: 0.5-9 meters
- durationMs: 450-6500
- effects: 0-2 of burn, slow, stun, pull, knockback, shield_break, poison
- color: optional hex color matching the spell's mood

EXAMPLES:

Player: "a freezing blizzard that slows everyone caught inside"
<think>Wide ice storm. Multiple frost shards rain from the sky covering an area, slowing on contact.</think>
{ "name": "Frost Blizzard", "element": "ice", "delivery": "sky", "impact": "aoe", "count": 6, "damage": 28, "speed": 22, "radius": 5.5, "durationMs": 3500, "cooldownMs": 7000, "manaCost": 55, "effects": ["slow"], "color": "#8ae9ff" }

Player: "fast lightning spear that stuns one target"
<think>Single high-speed bolt aimed at one enemy, stunning briefly on hit.</think>
{ "name": "Storm Spear", "element": "lightning", "delivery": "projectile", "impact": "single", "count": 1, "damage": 48, "speed": 36, "radius": 0.7, "durationMs": 900, "cooldownMs": 4500, "manaCost": 32, "effects": ["stun"], "color": "#fff36a" }

Player: "a swirling shadow vortex that pulls enemies in"
<think>Vortex centered ahead of the caster pulling enemies toward its core. Persists a few seconds.</think>
{ "name": "Shadow Maw", "element": "shadow", "delivery": "projectile", "impact": "vortex", "count": 1, "damage": 22, "speed": 14, "radius": 5, "durationMs": 4000, "cooldownMs": 9000, "manaCost": 60, "effects": ["pull"], "color": "#8d5aa8" }

Now respond to the player's prompt. Be concise. Output your <think>...</think> reasoning followed by ONLY the JSON object. No markdown fences. No extra commentary.`;

// ─────────────────────────────────────────────────────────────────────────────
// Streamed parsing (native <think>...</think> protocol)
// ─────────────────────────────────────────────────────────────────────────────

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * Splits a streaming buffer into reasoning (inside <think>...</think>) and the
 * JSON tail (everything after </think>). Tolerates a missing opening tag — some
 * runtimes inject it via the chat template so the assistant content begins with
 * raw reasoning.
 */
function splitResponse(text: string): { reasoning: string; spellJson: string | null } {
  const openIdx = text.indexOf(THINK_OPEN);
  const closeIdx = text.indexOf(THINK_CLOSE);
  const reasoningStart = openIdx === -1 ? 0 : openIdx + THINK_OPEN.length;

  if (closeIdx === -1) {
    // Still streaming reasoning; no JSON yet.
    return { reasoning: text.slice(reasoningStart).trim(), spellJson: null };
  }

  const reasoning = text.slice(reasoningStart, closeIdx).trim();
  const spellJson = text.slice(closeIdx + THINK_CLOSE.length);
  return { reasoning, spellJson };
}

function extractJsonObject(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Streams a spell generation. The provided `onProgress` callback is invoked
 * each time the reasoning string grows so the UI can render the Sage's
 * thoughts live. Resolves with the final balanced spell. Throws on abort,
 * network/runtime failure, or unparsable model output — the caller is
 * expected to surface a hard error and offer a Retry.
 */
export async function generateSpellFromPrompt(
  prompt: string,
  onProgress?: (progress: SpellGenerationProgress) => void,
  signal?: AbortSignal,
): Promise<SpellGenerationResult> {
  const cleanPrompt = prompt.trim().slice(0, 240);
  if (!cleanPrompt) {
    throw new Error("Empty prompt.");
  }

  await ensureModelLoaded();
  const engine = await getCogentEngine();

  let buffer = "";
  let lastReasoning = "";
  let phase: SpellGenerationProgress["phase"] = "thinking";

  const reply = await engine.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: cleanPrompt },
    ],
    {
      maxTokens: 512,
      signal,
      onToken: (token: string) => {
        buffer += token;
        const split = splitResponse(buffer);
        if (split.spellJson !== null && phase !== "writing") {
          phase = "writing";
        }
        if (split.reasoning !== lastReasoning) {
          lastReasoning = split.reasoning;
          onProgress?.({ reasoning: split.reasoning, phase });
        }
      },
    },
  );

  const fullText = reply || buffer;
  const split = splitResponse(fullText);
  const parsed = split.spellJson ? extractJsonObject(split.spellJson) : null;

  onProgress?.({ reasoning: split.reasoning, phase: "done" });

  if (!parsed) {
    throw new Error("The Sage spoke in tongues we could not transcribe.");
  }

  const spell = normalizeSpell({ ...parsed, reasoning: split.reasoning }, cleanPrompt);
  return { spell, reasoning: split.reasoning };
}
