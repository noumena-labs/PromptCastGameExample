import type { CogentEngine } from "cogentlm";
import { FORM_GRAMMAR } from "@/game/ai/grammar/spellGrammar";
import { extractJson, runChatCall, type StreamSink } from "@/game/ai/pipeline/callRunner";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import { formSchema, type SpellConcept, type SpellForm } from "@/game/spells/spellSchema";
import { clampScene } from "@/game/spells/sceneNode";

/**
 * Two sequential form calls — one for the CAST (travel) scene, one for the
 * IMPACT (eruption) scene. Each call:
 *   - Receives the concept's targeted imagery (cast_imagery / impact_imagery).
 *   - Emits ONE SceneNode tree (depth ≤ 1, root + ≤ 6 leaves) under FORM_GRAMMAR.
 *   - Parses against the SceneNode schema and clamps renderer-safe numeric bounds.
 *   - Retries only when the model fails to emit valid scene JSON.
 *
 * The renderer is a faithful interpreter. During pre-release we accept the
 * model's valid scene choices directly, then iterate on prompt quality from
 * observed results rather than rejecting post-build semantics here.
 */

const FORM_RETRY_LIMIT = 8;
const THINK_CLOSE = "</think>";

export type FormAttempt = {
  /** Which sub-stage is being attempted: "cast" or "impact". */
  scene: "cast" | "impact";
  n: number;
  total: number;
};

export type FormCallResult = {
  castForm: SpellForm;
  impactForm: SpellForm;
  rawOutput: { cast: string; impact: string };
  attempts: { cast: number; impact: number };
};

// ─────────────────────────────────────────────────────────────────────────────
// Cast scene system prompt
// ─────────────────────────────────────────────────────────────────────────────

const CAST_SYSTEM_PROMPT = `You are the Sage of the Sanctuary, sculpting the visible body of a spell IN FLIGHT. The CONCEPT is given, including a "cast imagery" line describing exactly what the player should see while the spell travels. Output a single SCENE TREE describing that travelling body.

Reason briefly inside <think>...</think>, then output ONLY the JSON object after </think>. No fences, no commentary.

The scene is one ROOT node plus up to 6 child nodes (depth 1, no grandchildren).

Each node has these fields, in this order:
  shape, color, emissiveIntensity, size, position, rotation, motion, motionSpeed, arrange, arrangeCount, arrangeRadius, particleCount, opacity

The ROOT node also has a "children" array at the end. Leaf nodes have no children field.

SHAPE (12): sphere | box | cylinder | cone | torus | ring | plane | tetra | octa | bar | disc | particle_cloud
COLOR: "#rrggbb" hex. Match the element AND the player's mood.
EMISSIVEINTENSITY: 0.0..4.0 (cores/beams 1.5-3.5; opaque bodies 0.5-1.5; smoke ≤ 0.6).
  KEEP AT MOST 2 nodes with emissiveIntensity > 0.5 across the whole scene.
SIZE: 0.05..8 meters.
POSITION/ROTATION: [x,y,z]. Local to the cast origin. y up. Magnitudes ≤ 4.
MOTION (10): static | spin | orbit | pulse | drift | fall | rise | swirl | expand | shake
MOTIONSPEED: 0..8.
ARRANGE (5): single | ring | line | stack | random.  ARRANGECOUNT 1..12.  ARRANGERADIUS 0..8.
PARTICLECOUNT: 0..200 (only for particle_cloud; total particles across scene ≤ 200).
OPACITY: 0..1.

═════════════════════════════════════════════════════════════════════════════
CAST RECIPES — match the deliveryFamily:

  projectile : a compact travelling core. Root size 0.4-1.2, emissiveIntensity ≥ 1.0
               OR opacity ≥ 0.85. Orbiting shards / trailing particle_cloud as
               children encouraged.

  beam       : a long thin line of energy. Root MUST be 'bar' or 'cylinder'.
               Root size 1.5-3.0, emissiveIntensity ≥ 1.5, opacity ≥ 0.8.

  sky        : something falling from above — a meteor, an icicle, a bolt.
               Pick a 3D body shape (sphere, box, cone, octa, tetra,
               particle_cloud). NEVER use plane / disc / ring (they look
               pinned in mid-air). A trailing particle_cloud child is great.

  self       : the wizard's body glow / channel halo. Compact, centered.
               Root size 0.6-1.4. Aura/ring children fine.

VISIBILITY FLOOR (universal):
  - root.size ≥ 0.4
  - root.opacity ≥ 0.5
  - root must be either opaque (opacity ≥ 0.8) OR self-illuminating
    (emissiveIntensity ≥ 0.8). Reserve low opacity for ornament children.

The player will see this scene WHILE the spell is in flight. It must read
clearly in motion.`;

// ─────────────────────────────────────────────────────────────────────────────
// Impact scene system prompt
// ─────────────────────────────────────────────────────────────────────────────

const IMPACT_SYSTEM_PROMPT = `You are the Sage of the Sanctuary, sculpting the ERUPTION that occurs at the destination of a spell. The CONCEPT is given, including a "impact imagery" line describing exactly what should erupt at the hit/landing point. Output a single SCENE TREE describing that eruption.

Reason briefly inside <think>...</think>, then output ONLY the JSON object after </think>. No fences, no commentary.

The scene is one ROOT node plus up to 6 child nodes (depth 1, no grandchildren).

Each node has these fields, in this order:
  shape, color, emissiveIntensity, size, position, rotation, motion, motionSpeed, arrange, arrangeCount, arrangeRadius, particleCount, opacity

The ROOT node also has a "children" array at the end. Leaf nodes have no children field.

SHAPE (12): sphere | box | cylinder | cone | torus | ring | plane | tetra | octa | bar | disc | particle_cloud
COLOR: "#rrggbb" hex.
EMISSIVEINTENSITY: 0.0..4.0. KEEP AT MOST 2 nodes with emissiveIntensity > 0.5.
SIZE: 0.05..8 meters.
POSITION/ROTATION: local to the impact origin. y up.
MOTION (10): static | spin | orbit | pulse | drift | fall | rise | swirl | expand | shake
ARRANGE (5): single | ring | line | stack | random.

═════════════════════════════════════════════════════════════════════════════
IMPACT RECIPES — match the impact field:

  single  : a brief eruption at the hit point — a spike of flame, a shock-
            flash, a gout of frost. Either root.size ≥ 0.8, OR include ≥ 2
            ornament children for visible mass. Use motion='expand', 'pulse',
            'rise', or 'shake' for drama.

  burst   : a brief expanding flash. Root motion='expand' or 'pulse'.
            Root size ≥ 0.9, emissiveIntensity ≥ 1.5.

  aoe     : a ground-hugging persistent zone. Root MUST be 'ring', 'disc',
            'plane', 'cylinder', or 'torus'. Root size 1.0-1.6, opacity ≥ 0.6.
            Add a rising particle_cloud or expanding ring child for vertical drama.

  wall    : a SOLID VERTICAL BARRIER. Root MUST be 'box', 'bar', or 'plane'.
            Root size ≥ 1.5, opacity ≥ 0.8, emissiveIntensity 0.5-2.0.
            EITHER make root.size ≥ 2.5 for a single wide slab,
            OR use arrange='line' with arrangeCount 3-8 + arrangeRadius 0.8-1.4
            so the wall actually spans horizontal space.
            NEVER use 'sphere' or 'particle_cloud' as the root for a wall.

  vortex  : a swirling annular structure. Root motion='swirl', 'spin', or
            'orbit'. Root shape: 'torus', 'ring', or 'cylinder'. Root size
            1.0-1.8.

  trap    : a flat sigil on the ground. Root MUST be 'ring', 'disc', or
            'plane'. Root size 0.8-1.4, opacity ≥ 0.6.

═════════════════════════════════════════════════════════════════════════════
DRAMA RULE: an impact must look like an EVENT. If root.size < 0.9, you MUST
include at least 2 ornament children supplying secondary motion / particles /
extra mass. Tiny single-shape impacts are forbidden.

VISIBILITY FLOOR (universal):
  - root.size ≥ 0.4
  - root.opacity ≥ 0.5
  - root must be either opaque (opacity ≥ 0.8) OR self-illuminating
    (emissiveIntensity ≥ 0.8).

STYLE CONTINUITY: keep palette and motif consistent with the cast scene
provided in the user message — the impact is the cast's payoff, not a
disconnected effect.`;

// ─────────────────────────────────────────────────────────────────────────────
// Per-call helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildCastUserMessage(
  prompt: string,
  concept: SpellConcept,
  attempt: number,
  previousViolations: string[] | null,
): string {
  const lines = [
    `Player prompt: ${prompt}`,
    "",
    `DELIVERY (visual recipe must match): ${concept.deliveryFamily}`,
    "",
    "CAST IMAGERY (most important — depict THIS):",
    `  ${concept.cast_imagery || "(none — invent something visually striking that matches the prompt)"}`,
    "",
    "CONCEPT:",
    `  name:           ${concept.name}`,
    `  element:        ${concept.element}`,
    `  deliveryFamily: ${concept.deliveryFamily}`,
    `  count:          ${concept.count}`,
    `  intent:         ${concept.intent_summary}`,
    "",
    "Output the cast scene JSON now.",
  ];
  if (previousViolations && previousViolations.length > 0) {
    lines.push(
      "",
      `Your previous attempt (${attempt - 1}/${FORM_RETRY_LIMIT}) was REJECTED. Fix these specific problems and re-emit the FULL scene JSON, corrected:`,
    );
    for (const v of previousViolations) lines.push(`  - ${v}`);
    lines.push("", "Do not repeat any of the rejected choices. Output the corrected JSON only.");
  } else if (attempt > 1) {
    lines.push("", `(retry ${attempt}/${FORM_RETRY_LIMIT})`);
  }
  return lines.join("\n");
}

function buildImpactUserMessage(
  prompt: string,
  concept: SpellConcept,
  castForm: SpellForm,
  attempt: number,
  previousViolations: string[] | null,
): string {
  const childHues = castForm.children.map((c) => c.color).slice(0, 4).join(", ");
  const lines = [
    `Player prompt: ${prompt}`,
    "",
    `IMPACT (visual recipe must match): ${concept.impact}`,
    "",
    "IMPACT IMAGERY (most important — depict THIS):",
    `  ${concept.impact_imagery || "(none — invent a dramatic eruption that matches the prompt)"}`,
    "",
    "CONCEPT:",
    `  name:           ${concept.name}`,
    `  element:        ${concept.element}`,
    `  deliveryFamily: ${concept.deliveryFamily}`,
    `  impact:         ${concept.impact}`,
    `  intent:         ${concept.intent_summary}`,
    "",
    "CAST SCENE (already chosen — match palette + motif):",
    `  rootShape: ${castForm.shape}`,
    `  rootColor: ${castForm.color}`,
    `  rootSize:  ${castForm.size}`,
    `  childHues: ${childHues || "(none)"}`,
    "",
    "Output the impact scene JSON now.",
  ];
  if (previousViolations && previousViolations.length > 0) {
    lines.push(
      "",
      `Your previous attempt (${attempt - 1}/${FORM_RETRY_LIMIT}) was REJECTED. Fix these specific problems and re-emit the FULL scene JSON, corrected:`,
    );
    for (const v of previousViolations) lines.push(`  - ${v}`);
    lines.push("", "Do not repeat any of the rejected choices. Output the corrected JSON only.");
  } else if (attempt > 1) {
    lines.push("", `(retry ${attempt}/${FORM_RETRY_LIMIT})`);
  }
  return lines.join("\n");
}

type RunSceneCallOpts = {
  engine: CogentEngine;
  systemPrompt: string;
  userMessage: (attempt: number, previousViolations: string[] | null) => string;
  signal?: AbortSignal;
  onToken?: StreamSink;
  onAttempt?: (n: number) => void;
  label: "cast" | "impact";
};

async function runSceneCall(opts: RunSceneCallOpts): Promise<{ form: SpellForm; rawOutput: string; attempts: number }> {
  let lastError: SpellGenerationError | null = null;
  let previousViolations: string[] | null = null;

  for (let attempt = 1; attempt <= FORM_RETRY_LIMIT; attempt += 1) {
    opts.onAttempt?.(attempt);
    try {
      const { buffer } = await runChatCall({
        engine: opts.engine,
        systemPrompt: opts.systemPrompt,
        prompt: opts.userMessage(attempt, previousViolations),
        maxTokens: 1400,
        grammar: FORM_GRAMMAR,
        signal: opts.signal,
        stage: "form",
        onToken: (token) => opts.onToken?.(token, "form"),
      });

      const closeIdx = buffer.indexOf(THINK_CLOSE);
      const tail = closeIdx === -1 ? buffer : buffer.slice(closeIdx + THINK_CLOSE.length);
      const extraction = extractJson(tail);
      if (!extraction.ok) {
        lastError = new SpellGenerationError({
          stage: "form",
          message: `${opts.label} JSON extract failed (attempt ${attempt}): ${extraction.reason}`,
          rawOutput: buffer,
          canRepair: true,
        });
        spellLog.warn("form", `${opts.label} attempt failed: extract`, { attempt, reason: extraction.reason });
        previousViolations = [`Your previous output was not valid JSON: ${extraction.reason}. Emit ONLY a single JSON object.`];
        continue;
      }

      const parsed = formSchema.safeParse(extraction.value);
      if (!parsed.success) {
        lastError = new SpellGenerationError({
          stage: "form",
          message: `${opts.label} zod parse failed (attempt ${attempt}): ${parsed.error.message}`,
          rawOutput: buffer,
          canRepair: true,
        });
        spellLog.warn("form", `${opts.label} attempt failed: zod`, { attempt, cause: parsed.error.message });
        previousViolations = [`Your previous output failed schema validation: ${parsed.error.message}. Re-check field types and ranges.`];
        continue;
      }

      const form = clampScene(parsed.data);
      spellLog.info("form", `${opts.label} ok`, {
        attempt,
        children: form.children.length,
        rootShape: form.shape,
        rootSize: form.size,
      });
      return { form, rawOutput: buffer, attempts: attempt };
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      lastError = new SpellGenerationError({
        stage: "form",
        message: `${opts.label} call threw (attempt ${attempt}): ${(err as Error).message}`,
        cause: err,
        canRepair: true,
      });
      spellLog.warn("form", `${opts.label} attempt threw`, { attempt, cause: (err as Error).message });
      previousViolations = null;
      continue;
    }
  }

  spellLog.failure({
    stage: "form",
    message: `${opts.label} call exhausted ${FORM_RETRY_LIMIT} attempts`,
    rawOutput: lastError?.rawOutput,
    cause: lastError?.message,
  });
  throw (
    lastError ??
    new SpellGenerationError({
      stage: "form",
      message: `${opts.label} call failed without error`,
      canRepair: true,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry: runFormCall — sequences cast then impact.
// ─────────────────────────────────────────────────────────────────────────────

export async function runFormCall(opts: {
  engine: CogentEngine;
  prompt: string;
  concept: SpellConcept;
  signal?: AbortSignal;
  onToken?: StreamSink;
  onAttempt?: (attempt: FormAttempt) => void;
}): Promise<FormCallResult> {
  spellLog.info("form", "start", {
    name: opts.concept.name,
    deliveryFamily: opts.concept.deliveryFamily,
    impact: opts.concept.impact,
  });

  // ── Cast scene ───────────────────────────────────────────────────────────
  const cast = await runSceneCall({
    engine: opts.engine,
    systemPrompt: CAST_SYSTEM_PROMPT,
    userMessage: (attempt, prev) => buildCastUserMessage(opts.prompt, opts.concept, attempt, prev),
    signal: opts.signal,
    onToken: opts.onToken,
    onAttempt: (n) => opts.onAttempt?.({ scene: "cast", n, total: FORM_RETRY_LIMIT }),
    label: "cast",
  });

  // ── Impact scene (uses cast for stylistic continuity) ────────────────────
  const impact = await runSceneCall({
    engine: opts.engine,
    systemPrompt: IMPACT_SYSTEM_PROMPT,
    userMessage: (attempt, prev) =>
      buildImpactUserMessage(opts.prompt, opts.concept, cast.form, attempt, prev),
    signal: opts.signal,
    onToken: opts.onToken,
    onAttempt: (n) => opts.onAttempt?.({ scene: "impact", n, total: FORM_RETRY_LIMIT }),
    label: "impact",
  });

  return {
    castForm: cast.form,
    impactForm: impact.form,
    rawOutput: { cast: cast.rawOutput, impact: impact.rawOutput },
    attempts: { cast: cast.attempts, impact: impact.attempts },
  };
}
