/** GBNF grammars for catalog-driven modular spell generation. */

import {
  coreVisualMeshIds,
  type DeliveryVehicleId,
  deliveryVehicleIds,
  impactVfxIds,
  type SpellAlignmentId,
  spellAlignmentIds,
  spellShaderIds,
  travelVfxIds,
} from "@/game/spells/modules/spellIds";

const COMMON = String.raw`
ws ::= (" " | "\t" | "\n" | "\r")*
digit ::= [0-9]
digits ::= digit+
number ::= digits ("." digits)?
string ::= "\"" string-char* "\""
string-char ::= [A-Za-z0-9 _.,:;!?'/()-]
`.trim();

const token = (value: string) => JSON.stringify(value);
const quotedToken = (value: string) => `${token("\"")} ${token(value)} ${token("\"")}`;
const prop = (name: string) => quotedToken(name);
const lit = (xs: readonly string[]) => xs.map(quotedToken).join(" | ");

function boundedArray(itemRule: string, min: number, max: number): string {
  const alternatives: string[] = [];
  if (min === 0) alternatives.push(`${token("[")} ws ${token("]")}`);
  for (let count = Math.max(1, min); count <= max; count += 1) {
    const items = Array.from({ length: count }, (_, index) =>
      index === 0 ? itemRule : `${token(",")} ws ${itemRule}`,
    ).join(" ws ");
    alternatives.push(`${token("[")} ws ${items} ws ${token("]")}`);
  }
  return alternatives.join(" | ");
}

const coreMeshLit = lit(coreVisualMeshIds);
const travelLit = lit(travelVfxIds);
const impactLit = lit(impactVfxIds);
const shaderLit = lit(spellShaderIds);

export type ConceptGrammarOptions = {
  allowedAlignments?: readonly SpellAlignmentId[];
  allowedDeliveryVehicles?: readonly DeliveryVehicleId[];
};

export function buildConceptGrammar(options: ConceptGrammarOptions = {}): string {
  const alignments = options.allowedAlignments?.length ? options.allowedAlignments : spellAlignmentIds;
  const deliveries = options.allowedDeliveryVehicles?.length ? options.allowedDeliveryVehicles : deliveryVehicleIds;
  const alignmentLit = lit(alignments);
  const deliveryLit = lit(deliveries);
  return [
    COMMON,
    `root ::= ws ${token("{")} ws ${prop("name")} ws ${token(":")} ws string ws ${token(",")} ws ${prop("alignment")} ws ${token(":")} ws alignment ws ${token(",")} ws ${prop("deliveryVehicle")} ws ${token(":")} ws delivery ws ${token(",")} ws ${prop("vfx")} ws ${token(":")} ws vfx ws ${token(",")} ws ${prop("modifiers")} ws ${token(":")} ws modifiers ws ${token(",")} ws ${prop("count")} ws ${token(":")} ws number ws ${token(",")} ws ${prop("intentSummary")} ws ${token(":")} ws string ws ${token(",")} ws ${prop("castImagery")} ws ${token(":")} ws string ws ${token(",")} ws ${prop("impactImagery")} ws ${token(":")} ws string ws ${token("}")} ws`,
    `vfx ::= ${token("{")} ws ${prop("coreMesh")} ws ${token(":")} ws coremesh ws ${token(",")} ws ${prop("travel")} ws ${token(":")} ws travel-array ws ${token(",")} ws ${prop("impact")} ws ${token(":")} ws impact-array ws ${token(",")} ws ${prop("shaders")} ws ${token(":")} ws shaders ws ${token("}")}`,
    `shaders ::= ${token("{")} ws ${prop("core")} ws ${token(":")} ws shader ws ${token(",")} ws ${prop("trail")} ws ${token(":")} ws shader ws ${token(",")} ws ${prop("impact")} ws ${token(":")} ws shader ws ${token(",")} ws ${prop("decal")} ws ${token(":")} ws shader ws ${token(",")} ws ${prop("aura")} ws ${token(":")} ws shader ws ${token("}")}`,
    `modifiers ::= ${token("{")} ws ${prop("scale")} ws ${token(":")} ws number ws ${token(",")} ws ${prop("speed")} ws ${token(":")} ws number ws ${token(",")} ws ${prop("duration")} ws ${token(":")} ws number ws ${token(",")} ws ${prop("intensity")} ws ${token(":")} ws number ws ${token("}")}`,
    `travel-array ::= ${boundedArray("travel", 0, 3)}`,
    `impact-array ::= ${boundedArray("impact", 1, 5)}`,
    `alignment ::= ${alignmentLit}`,
    `delivery ::= ${deliveryLit}`,
    `coremesh ::= ${coreMeshLit}`,
    `travel ::= ${travelLit}`,
    `impact ::= ${impactLit}`,
    `shader ::= ${shaderLit}`,
  ].join("\n");
}

export const CONCEPT_GRAMMAR = buildConceptGrammar();

export const BALANCE_GRAMMAR = [
  COMMON,
  `root ::= ws ${token("{")} ws ${prop("powerTier")} ws ${token(":")} ws number ws ${token("}")} ws`,
].join("\n");
