/**
 * GBNF grammars for the multi-call spell pipeline.
 *
 * Cogentlm's `ChatOptions.grammar` accepts a GBNF string (llama.cpp dialect).
 * We constrain each call to a tight JSON shape so the model physically cannot
 * emit prose, fenced code blocks, or trailing commentary.
 *
 * Notes:
 *   - GBNF is permissive about whitespace; we always allow optional `ws`.
 *   - Numbers are kept loose (signed integers + floats) — Zod re-clamps.
 *   - llama.cpp GBNF requires single-line rule bodies. The `root ::=` for each
 *     grammar MUST be on one line — do NOT line-wrap rule bodies.
 *   - Every stage emits structured JSON directly. We use the Instruct model
 *     and keep prompts aligned with the grammar: no hidden thinking prefix,
 *     no fenced code blocks, no commentary.
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

const lit = (xs: readonly string[]) => xs.map((s) => `"\\"${s}\\""`).join(" | ");

const elementLit = lit(["fire", "ice", "lightning", "earth", "arcane", "shadow", "nature"]);
const deliveryLit = lit(["projectile", "beam", "sky", "self"]);
const impactLit = lit(["single", "aoe", "vortex", "wall", "trap", "burst", "none"]);
const placementLit = lit(["target", "front", "self"]);
const effectLit = lit(["burn", "slow", "stun", "pull", "knockback", "shield_break", "poison"]);
const shapeLit = lit([
  "sphere",
  "box",
  "cylinder",
  "cone",
  "torus",
  "ring",
  "plane",
  "tetra",
  "octa",
  "bar",
  "disc",
  "particle_cloud",
]);
const motionLit = lit([
  "static",
  "spin",
  "orbit",
  "pulse",
  "drift",
  "fall",
  "rise",
  "swirl",
  "expand",
  "shake",
]);
const arrangeLit = lit(["single", "ring", "line", "stack", "random"]);

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — concept
// ─────────────────────────────────────────────────────────────────────────────

const CONCEPT_FIELDS = [
  `"\\"name\\"" ws ":" ws string`,
  `"\\"element\\"" ws ":" ws element`,
  `"\\"deliveryFamily\\"" ws ":" ws delivery`,
  `"\\"impact\\"" ws ":" ws impact`,
  `"\\"placement\\"" ws ":" ws placement`,
  `"\\"intent_summary\\"" ws ":" ws string`,
  `"\\"cast_imagery\\"" ws ":" ws string`,
  `"\\"impact_imagery\\"" ws ":" ws string`,
  `"\\"effects\\"" ws ":" ws effect-array`,
  `"\\"count\\"" ws ":" ws number`,
].join(` ws "," ws `);

export const CONCEPT_GRAMMAR = `
${COMMON}
root ::= ws "{" ws ${CONCEPT_FIELDS} ws "}" ws
element ::= ${elementLit}
delivery ::= ${deliveryLit}
impact ::= ${impactLit}
placement ::= ${placementLit}
effect ::= ${effectLit}
effect-array ::= "[" ws "]" | "[" ws effect (ws "," ws effect)* ws "]"
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — balance
// ─────────────────────────────────────────────────────────────────────────────

export const BALANCE_GRAMMAR = `
${COMMON}
root ::= ws "{" ws "\\"powerTier\\"" ws ":" ws number ws "}" ws
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — form (SceneNode DSL, depth ≤ 1)
//
// Root has all leaf fields plus optional "children" array (≤ 6 leaves). Leaves
// have no children. We model both with a `node-body` rule for the per-field
// content and split root vs leaf at the top level (children only on root).
// ─────────────────────────────────────────────────────────────────────────────

const VEC3_RULE = `vec3 ::= "[" ws number ws "," ws number ws "," ws number ws "]"`;

// All shared leaf fields, in fixed order. Single-line.
const NODE_FIELDS = [
  `"\\"shape\\"" ws ":" ws shape`,
  `"\\"color\\"" ws ":" ws hexcolor`,
  `"\\"emissiveIntensity\\"" ws ":" ws number`,
  `"\\"size\\"" ws ":" ws number`,
  `"\\"position\\"" ws ":" ws vec3`,
  `"\\"rotation\\"" ws ":" ws vec3`,
  `"\\"motion\\"" ws ":" ws motion`,
  `"\\"motionSpeed\\"" ws ":" ws number`,
  `"\\"arrange\\"" ws ":" ws arrange`,
  `"\\"arrangeCount\\"" ws ":" ws number`,
  `"\\"arrangeRadius\\"" ws ":" ws number`,
  `"\\"particleCount\\"" ws ":" ws number`,
  `"\\"opacity\\"" ws ":" ws number`,
].join(` ws "," ws `);

export const FORM_GRAMMAR = `
${COMMON}
${VEC3_RULE}
root ::= ws "{" ws ${NODE_FIELDS} ws "," ws "\\"children\\"" ws ":" ws children-array ws "}" ws
leaf ::= "{" ws ${NODE_FIELDS} ws "}"
children-array ::= "[" ws "]" | "[" ws leaf (ws "," ws leaf)* ws "]"
shape ::= ${shapeLit}
motion ::= ${motionLit}
arrange ::= ${arrangeLit}
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Stage 4 — palette
// ─────────────────────────────────────────────────────────────────────────────

export const PALETTE_GRAMMAR = `
${COMMON}
root ::= ws "{" ws "\\"primary\\"" ws ":" ws hexcolor ws "," ws "\\"emissiveBoost\\"" ws ":" ws number ws "}" ws
`.trim();
