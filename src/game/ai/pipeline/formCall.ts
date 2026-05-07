import type { CogentEngine } from "cogentlm";
import { FORM_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { formSchema, type SpellConcept, type SpellForm } from "@/game/spells/spellSchema";
import { clampScene } from "@/game/spells/sceneNode";

/**
 * Form call: the LLM emits a SceneNode tree (depth ≤ 1, root + ≤ 6 leaves)
 * describing the spell's visible shape. This is the largest, most failure-
 * prone call in the pipeline — the JSON is dense, the grammar is recursive.
 *
 * Strategy: retry up to FORM_RETRY_LIMIT times internally with fresh re-rolls
 * (NOT repair-feed). After exhausting attempts we raise a SpellGenerationError;
 * the caller's UI may still offer the player a top-level Repair retry.
 *
 * We also stream attempt progress via `onAttempt` so the prompt overlay can
 * show "Sage is reshaping the form (2/4)…".
 */

const SYSTEM_PROMPT = `You are the Sage of the Sanctuary, sculpting the visible form of a spell. The CONCEPT is given. Output a small SCENE TREE describing what the player will see.

Output ONLY a JSON object on its own line. No reasoning, no fences, no commentary.

The scene is one ROOT node plus up to 6 child nodes (depth 1, no grandchildren).

Each node has these fields, in this order:
  shape, color, emissiveIntensity, size, position, rotation, motion, motionSpeed, arrange, arrangeCount, arrangeRadius, particleCount, opacity

The ROOT node also has a "children" array at the end. Leaf nodes have no children field.

SHAPE (12): sphere | box | cylinder | cone | torus | ring | plane | tetra | octa | bar | disc | particle_cloud
  - particle_cloud emits N particles where N = particleCount (1..200; total across the whole scene must stay ≤ 200).
  - Other shapes ignore particleCount; set it to 0 for non-clouds.

COLOR: "#rrggbb" hex. Choose colors that match the element AND the player's mood (cursed → desaturated greens / purples; righteous → gold / white; rotten → sickly green; void → near-black).

EMISSIVEINTENSITY: 0.0..4.0 — how brightly the node self-illuminates. Lightning / beams / cores: 2.0-3.5. Solid projectiles: 1.0-2.0. Smoke / shadow: 0.0-0.6.
  KEEP AT MOST 2 nodes with emissiveIntensity > 0.5 across the whole scene. Lights are expensive.

SIZE: 0.05..8 (meters, very roughly).

POSITION: [x, y, z] — local offset from the spell origin. y is up. Keep magnitudes ≤ 4.
ROTATION: [x, y, z] — euler radians. Use [0,0,0] unless tilting matters.

MOTION (10): static | spin | orbit | pulse | drift | fall | rise | swirl | expand | shake
MOTIONSPEED: 0..8.

ARRANGE (5): single | ring | line | stack | random
  - single: one instance.
  - ring: arrangeCount instances around the local origin at arrangeRadius.
  - line: arrangeCount instances spaced by arrangeRadius along local +x.
  - stack: arrangeCount instances spaced vertically by arrangeRadius.
  - random: arrangeCount instances scattered within arrangeRadius (seeded).
ARRANGECOUNT: 1..12. ARRANGERADIUS: 0..8.

PARTICLECOUNT: integer 0..200. Only meaningful for shape = particle_cloud.

OPACITY: 0..1. Use < 1 for smoke, mist, ghostly auras.

Compose the form like a small Three.js scene. The ROOT is usually the dominant body (orb, beam core, vortex hub). Children are ornaments — orbiting shards, trailing sparks, an outer ring, ground crackle. Be expressive but parsimonious.`;

export type FormAttempt = {
  n: number;
  total: number;
};

export type FormCallResult = {
  form: SpellForm;
  rawOutput: string;
  attempts: number;
};

const PREFIX = "</think>";
const FORM_RETRY_LIMIT = 4;

function buildUserMessage(prompt: string, concept: SpellConcept, attempt: number): string {
  const lines = [
    `Player prompt: ${prompt}`,
    "",
    "CONCEPT:",
    `  name:           ${concept.name}`,
    `  element:        ${concept.element}`,
    `  deliveryFamily: ${concept.deliveryFamily}`,
    `  impact:         ${concept.impact}`,
    `  count:          ${concept.count}`,
    `  intent:         ${concept.intent_summary}`,
    "",
    "Output the scene JSON now.",
  ];
  if (attempt > 1) {
    lines.push("", `(retry ${attempt}/${FORM_RETRY_LIMIT} — keep it concise; fewer children if needed.)`);
  }
  return lines.join("\n");
}

export async function runFormCall(opts: {
  engine: CogentEngine;
  prompt: string;
  concept: SpellConcept;
  signal?: AbortSignal;
  onToken?: StreamSink;
  onAttempt?: (attempt: FormAttempt) => void;
}): Promise<FormCallResult> {
  spellLog.info("form", "start", { name: opts.concept.name });

  let lastError: SpellGenerationError | null = null;

  for (let attempt = 1; attempt <= FORM_RETRY_LIMIT; attempt += 1) {
    opts.onAttempt?.({ n: attempt, total: FORM_RETRY_LIMIT });
    try {
      const { buffer } = await runChatCall({
        engine: opts.engine,
        systemPrompt: SYSTEM_PROMPT,
        prompt: buildUserMessage(opts.prompt, opts.concept, attempt),
        maxTokens: 640,
        grammar: FORM_GRAMMAR,
        assistantPrefix: PREFIX,
        signal: opts.signal,
        stage: "form",
        onToken: (token) => opts.onToken?.(token, "form"),
      });

      const tail = buffer.startsWith(PREFIX) ? buffer.slice(PREFIX.length) : buffer;
      const extraction = extractJson(tail);
      if (!extraction.ok) {
        lastError = new SpellGenerationError({
          stage: "form",
          message: `form JSON extract failed (attempt ${attempt}): ${extraction.reason}`,
          rawOutput: buffer,
          canRepair: true,
        });
        spellLog.warn("form", "attempt failed: extract", { attempt, reason: extraction.reason });
        continue;
      }

      const parsed = formSchema.safeParse(extraction.value);
      if (!parsed.success) {
        lastError = new SpellGenerationError({
          stage: "form",
          message: `form zod parse failed (attempt ${attempt}): ${parsed.error.message}`,
          rawOutput: buffer,
          canRepair: true,
        });
        spellLog.warn("form", "attempt failed: zod", { attempt, cause: parsed.error.message });
        continue;
      }

      const form = clampScene(parsed.data);
      spellLog.info("form", "ok", {
        attempt,
        children: form.children.length,
        rootShape: form.shape,
      });
      return { form, rawOutput: buffer, attempts: attempt };
    } catch (err) {
      // Network / abort / engine error — bubble up, no retry.
      if ((err as Error).name === "AbortError") throw err;
      lastError = new SpellGenerationError({
        stage: "form",
        message: `form call threw (attempt ${attempt}): ${(err as Error).message}`,
        cause: err,
        canRepair: true,
      });
      spellLog.warn("form", "attempt threw", { attempt, cause: (err as Error).message });
      continue;
    }
  }

  spellLog.failure({
    stage: "form",
    message: `form call exhausted ${FORM_RETRY_LIMIT} attempts`,
    rawOutput: lastError?.rawOutput,
    cause: lastError?.message,
  });
  throw (
    lastError ??
    new SpellGenerationError({
      stage: "form",
      message: "form call failed without error",
      canRepair: true,
    })
  );
}
