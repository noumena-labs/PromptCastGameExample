/**
 * GBNF grammars for the multi-call spell pipeline.
 *
 * Cogentlm's `ChatOptions.grammar` accepts a GBNF string (llama.cpp dialect).
 * We constrain each call to a tight JSON shape so the model physically cannot
 * emit prose, fenced code blocks, or trailing commentary. This is the primary
 * defense against the "Sage spoke in tongues" failure.
 *
 * Notes:
 *   - GBNF is permissive about whitespace; we always allow optional `ws`
 *     between tokens.
 *   - Numbers are kept loose (signed integers + floats) — Zod re-clamps.
 *   - The reasoning <think>...</think> block lives BEFORE the JSON. We do NOT
 *     constrain reasoning. We only constrain the post-think JSON body, by
 *     pre-feeding the model with the closing `</think>` and starting the
 *     grammar at `{`. See `pipeline/index.ts` for that strategy.
 */

const COMMON = `
ws ::= [ \\t\\n\\r]*
sign ::= "-"?
digit ::= [0-9]
digits ::= digit+
number ::= sign digits ("." digits)? ([eE] sign digits)?
string-char ::= [^"\\\\] | "\\\\" ["\\\\/bfnrt]
string ::= "\\"" string-char* "\\""
hexdigit ::= [0-9a-fA-F]
hexcolor ::= "\\"#" hexdigit hexdigit hexdigit hexdigit hexdigit hexdigit "\\""
bool ::= "true" | "false"
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Concept call grammar
// ─────────────────────────────────────────────────────────────────────────────
const archetypeLiteral = [
  "meteor_strike",
  "meteor_shower",
  "lightning_bolt",
  "lightning_storm",
  "blackhole",
  "fireball",
  "fire_tornado",
  "frost_nova",
  "ice_shard",
  "shadow_orb",
  "nature_thorns",
  "arcane_beam",
  "arcane_orb",
  "shield",
  "custom",
]
  .map((s) => `"\\"${s}\\""`)
  .join(" | ");

const elementLiteral = ["fire", "ice", "lightning", "earth", "arcane", "shadow", "nature"]
  .map((s) => `"\\"${s}\\""`)
  .join(" | ");

const scaleLiteral = ["small", "medium", "large", "epic"].map((s) => `"\\"${s}\\""`).join(" | ");

export const CONCEPT_GRAMMAR = `
${COMMON}
root ::= ws "{" ws "\\"archetype\\"" ws ":" ws archetype ws "," ws "\\"element\\"" ws ":" ws element ws "," ws "\\"intent_summary\\"" ws ":" ws string ws "," ws "\\"scale\\"" ws ":" ws scale ws "}" ws
archetype ::= ${archetypeLiteral}
element ::= ${elementLiteral}
scale ::= ${scaleLiteral}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Mechanics call grammar
// ─────────────────────────────────────────────────────────────────────────────
const deliveryLiteral = ["projectile", "beam", "sky", "self"].map((s) => `"\\"${s}\\""`).join(" | ");
const impactLiteral = ["single", "aoe", "vortex", "wall", "trap", "burst", "none"]
  .map((s) => `"\\"${s}\\""`)
  .join(" | ");
const effectLiteral = ["burn", "slow", "stun", "pull", "knockback", "shield_break", "poison"]
  .map((s) => `"\\"${s}\\""`)
  .join(" | ");

export const MECHANICS_GRAMMAR = `
${COMMON}
root ::= ws "{" ws "\\"name\\"" ws ":" ws string ws "," ws "\\"delivery\\"" ws ":" ws delivery ws "," ws "\\"impact\\"" ws ":" ws impact ws "," ws "\\"count\\"" ws ":" ws number ws "," ws "\\"damage\\"" ws ":" ws number ws "," ws "\\"speed\\"" ws ":" ws number ws "," ws "\\"radius\\"" ws ":" ws number ws "," ws "\\"durationMs\\"" ws ":" ws number ws "," ws "\\"effects\\"" ws ":" ws effect-array ws "}" ws
delivery ::= ${deliveryLiteral}
impact ::= ${impactLiteral}
effect ::= ${effectLiteral}
effect-array ::= "[" ws "]" | "[" ws effect (ws "," ws effect)* ws "]"
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Visual call grammar (palette + optional motion + optional param overrides)
//
// Kept INTENTIONALLY narrow: we don't let the LLM compose primitives from
// scratch. It only chooses palette colors + motion + an emissive intensity.
// Primitives come from the archetype default. This shrinks the LLM's output
// surface ~10x.
// ─────────────────────────────────────────────────────────────────────────────
const motionLiteral = ["fall", "rise", "spiral", "implode", "explode", "linger", "travel"]
  .map((s) => `"\\"${s}\\""`)
  .join(" | ");

export const VISUAL_GRAMMAR = `
${COMMON}
root ::= ws "{" ws "\\"primary\\"" ws ":" ws hexcolor ws "," ws "\\"secondary\\"" ws ":" ws hexcolor ws "," ws "\\"accent\\"" ws ":" ws hexcolor ws "," ws "\\"emissive\\"" ws ":" ws number ws "," ws "\\"motion\\"" ws ":" ws motion ws "}" ws
motion ::= ${motionLiteral}
`.trim();
