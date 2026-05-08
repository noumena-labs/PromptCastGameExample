import { alignmentCatalog } from "@/game/spells/modules/alignments";
import { deliveryVehicleCatalog } from "@/game/spells/modules/deliveryVehicles";
import type {
  DeliveryVehicleId,
  SpellAlignmentId,
  SpellBuildSpec,
  SpellShaderSelection,
  SpellVfxPayload,
} from "@/game/spells/modules/spellIds";

export type SpellIntent = {
  label: string;
  reason: string;
  allowedAlignments?: SpellAlignmentId[];
  allowedDeliveryVehicles?: DeliveryVehicleId[];
  forcedAlignment?: SpellAlignmentId;
  forcedDeliveryVehicle?: DeliveryVehicleId;
  forcedCoreMesh?: SpellVfxPayload["coreMesh"];
  minCount?: number;
  preferredCount?: number;
  requiredTravel?: SpellVfxPayload["travel"];
  requiredImpact?: SpellVfxPayload["impact"];
  forbiddenDeliveryVehicles?: DeliveryVehicleId[];
};

export type IntentCorrection = {
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
};

export type IntentConstrainedSpec = {
  spec: SpellBuildSpec;
  intent: SpellIntent;
  corrections: IntentCorrection[];
};

const ALL_ALIGNMENTS: SpellAlignmentId[] = ["fire", "water_ice", "lightning", "earth", "dark", "light", "meteor_cosmic"];
const ALL_DELIVERY_VEHICLES: DeliveryVehicleId[] = ["projectile_linear", "projectile_arcing", "skyfall", "instant_hitscan", "ground_eruption", "aura_orbit"];

const METEOR_RE = /\b(meteor|meteors|meteorite|meteorites|comet|comets|asteroid|asteroids|starfall|falling star|falling stars|sky rock|sky rocks)\b/;
const SHOWER_RE = /\b(shower|rain|raining|barrage|storm|volley|many|several|multiple)\b/;
const SKY_LIGHTNING_RE = /\b(lightning|thunderbolt|bolt)\b.*\b(strike|strikes|from the sky|sky|heaven|heavens)\b|\b(strike|strikes)\b.*\b(lightning|thunderbolt|from the sky)\b/;
const CHAIN_LIGHTNING_RE = /\b(chain lightning|chain bolt|forked lightning|forking lightning)\b/;
const BEAM_RE = /\b(beam|ray|laser|lance of light|holy ray|sunbeam|psychic lash|lash)\b/;
const AURA_RE = /\b(aura|orbit|orbiting|shield|barrier|halo around|around me|around the caster|protective ring|ward)\b/;
const GROUND_RE = /\b(wall|cage|prison|bars|roots|thorns|spikes|spike|pillar|column|eruption|erupt|erupts|geyser|volcano|volcanic|vent|sigil|rune|circle under|under the target|rising|rise from|rises from|fissure|crack|crevasse)\b/;
const ARC_RE = /\b(lob|lobbed|hurl|hurled|throw|thrown|catapult|arc|arcing|boulder|rock chunk|chunk|bomb|grenade|grenades)\b/;
const PROJECTILE_RE = /\b(bolt|orb|ball|fireball|lance|missile|shard|arrow|spear|dart)\b/;

const ALIGNMENT_CUES: Array<{ alignment: SpellAlignmentId; re: RegExp }> = [
  { alignment: "water_ice", re: /\b(frost|ice|icy|snow|blizzard|hail|water|mist|frozen|freezing)\b/ },
  { alignment: "lightning", re: /\b(lightning|thunder|thunderbolt|electric|storm|plasma)\b/ },
  { alignment: "dark", re: /\b(shadow|void|dark|black|necrotic|death|leech|obsidian)\b/ },
  { alignment: "light", re: /\b(holy|radiant|radiance|sun|sunbeam|light|healing|heal|gold|golden|divine)\b/ },
  { alignment: "earth", re: /\b(earth|stone|rock|boulder|sand|dust|thorn|thorns|root|roots|moss|vine|vines)\b/ },
  { alignment: "fire", re: /\b(fire|flame|flames|burning|ember|molten|lava|inferno|pyre)\b/ },
];

export function inferSpellIntent(prompt: string): SpellIntent {
  const text = normalizePrompt(prompt);

  if (METEOR_RE.test(text)) {
    const shower = SHOWER_RE.test(text);
    return {
      label: shower ? "meteor_shower" : "meteor_skyfall",
      reason: shower ? "Meteor shower cues require multiple cosmic skyfall impacts." : "Meteor/comet cues require a delayed cosmic skyfall impact.",
      allowedAlignments: ["meteor_cosmic"],
      allowedDeliveryVehicles: ["skyfall"],
      forcedAlignment: "meteor_cosmic",
      forcedDeliveryVehicle: "skyfall",
      forcedCoreMesh: "boulder",
      minCount: shower ? 3 : 1,
      preferredCount: shower ? 5 : 1,
      requiredTravel: ["particle_trail", "core_glow"],
      requiredImpact: ["burst_explosion", "flash", "ground_decal"],
      forbiddenDeliveryVehicles: ["instant_hitscan"],
    };
  }

  if (CHAIN_LIGHTNING_RE.test(text)) {
    return {
      label: "chain_lightning",
      reason: "Chain lightning is an instant branching electrical ray.",
      allowedAlignments: ["lightning"],
      allowedDeliveryVehicles: ["instant_hitscan"],
      forcedAlignment: "lightning",
      forcedDeliveryVehicle: "instant_hitscan",
      forcedCoreMesh: "none",
      requiredTravel: ["core_glow", "swirling_vortex"],
      requiredImpact: ["flash", "burst_explosion"],
    };
  }

  if (SKY_LIGHTNING_RE.test(text)) {
    return {
      label: "sky_lightning",
      reason: "Lightning called from above should descend onto the target rather than fire from the caster.",
      allowedAlignments: ["lightning"],
      allowedDeliveryVehicles: ["skyfall"],
      forcedAlignment: "lightning",
      forcedDeliveryVehicle: "skyfall",
      forcedCoreMesh: "none",
      requiredTravel: ["core_glow", "swirling_vortex"],
      requiredImpact: ["flash", "burst_explosion", "ground_decal"],
    };
  }

  if (AURA_RE.test(text)) {
    return withAlignmentCue(text, {
      label: "aura_orbit",
      reason: "Aura, orbit, shield, and caster-ring prompts attach to the caster.",
      allowedAlignments: ALL_ALIGNMENTS,
      allowedDeliveryVehicles: ["aura_orbit"],
      forcedDeliveryVehicle: "aura_orbit",
      requiredTravel: ["core_glow", "swirling_vortex"],
      requiredImpact: ["ground_decal"],
    });
  }

  if (GROUND_RE.test(text)) {
    return withAlignmentCue(text, {
      label: "ground_eruption",
      reason: "Walls, cages, spikes, pillars, and sigils should appear from the target ground.",
      allowedAlignments: ALL_ALIGNMENTS,
      allowedDeliveryVehicles: ["ground_eruption"],
      forcedDeliveryVehicle: "ground_eruption",
      requiredImpact: ["ground_decal"],
    });
  }

  if (BEAM_RE.test(text)) {
    return withAlignmentCue(text, {
      label: "beam_hitscan",
      reason: "Beam, ray, laser, and lash prompts are immediate line effects.",
      allowedAlignments: ["light", "lightning", "dark"],
      allowedDeliveryVehicles: ["instant_hitscan"],
      forcedDeliveryVehicle: "instant_hitscan",
      forcedCoreMesh: "none",
      requiredTravel: ["core_glow"],
      requiredImpact: ["flash"],
    });
  }

  if (ARC_RE.test(text)) {
    return withAlignmentCue(text, {
      label: "arcing_projectile",
      reason: "Lobbed, hurled, or heavy chunk prompts should arc under gravity.",
      allowedAlignments: ["earth", "fire", "meteor_cosmic"],
      allowedDeliveryVehicles: ["projectile_arcing"],
      forcedDeliveryVehicle: "projectile_arcing",
      forcedCoreMesh: "boulder",
      requiredTravel: ["particle_trail"],
      requiredImpact: ["burst_explosion", "ground_decal"],
    });
  }

  if (PROJECTILE_RE.test(text)) {
    return withAlignmentCue(text, {
      label: "linear_projectile",
      reason: "Bolt, orb, lance, missile, and shard prompts should visibly travel from the caster.",
      allowedAlignments: ALL_ALIGNMENTS,
      allowedDeliveryVehicles: ["projectile_linear"],
      forcedDeliveryVehicle: "projectile_linear",
      requiredTravel: ["particle_trail", "core_glow"],
      requiredImpact: ["burst_explosion"],
    });
  }

  return withAlignmentCue(text, {
    label: "open_spell",
    reason: "No hard delivery cue detected; model may choose any compatible spell vehicle.",
    allowedAlignments: ALL_ALIGNMENTS,
    allowedDeliveryVehicles: ALL_DELIVERY_VEHICLES,
  });
}

export function applyIntentConstraints(prompt: string, input: SpellBuildSpec): IntentConstrainedSpec {
  const intent = inferSpellIntent(prompt);
  const corrections: IntentCorrection[] = [];
  let spec: SpellBuildSpec = { ...input, vfx: cloneVfx(input.vfx), modifiers: { ...input.modifiers } };

  if (intent.forcedAlignment && spec.alignment !== intent.forcedAlignment) {
    corrections.push({ field: "alignment", from: spec.alignment, to: intent.forcedAlignment, reason: intent.reason });
    spec = { ...spec, alignment: intent.forcedAlignment, vfx: mergeDefaults(spec.vfx, intent.forcedAlignment) };
  } else if (intent.allowedAlignments && !intent.allowedAlignments.includes(spec.alignment)) {
    const next = intent.allowedAlignments[0] ?? spec.alignment;
    corrections.push({ field: "alignment", from: spec.alignment, to: next, reason: intent.reason });
    spec = { ...spec, alignment: next, vfx: mergeDefaults(spec.vfx, next) };
  }

  if (intent.forcedDeliveryVehicle && spec.deliveryVehicle !== intent.forcedDeliveryVehicle) {
    corrections.push({ field: "deliveryVehicle", from: spec.deliveryVehicle, to: intent.forcedDeliveryVehicle, reason: intent.reason });
    spec = { ...spec, deliveryVehicle: intent.forcedDeliveryVehicle };
  } else if (intent.allowedDeliveryVehicles && !intent.allowedDeliveryVehicles.includes(spec.deliveryVehicle)) {
    const next = intent.allowedDeliveryVehicles[0] ?? spec.deliveryVehicle;
    corrections.push({ field: "deliveryVehicle", from: spec.deliveryVehicle, to: next, reason: intent.reason });
    spec = { ...spec, deliveryVehicle: next };
  }

  if (intent.forbiddenDeliveryVehicles?.includes(spec.deliveryVehicle)) {
    const next = intent.forcedDeliveryVehicle ?? intent.allowedDeliveryVehicles?.[0] ?? "projectile_linear";
    corrections.push({ field: "deliveryVehicle", from: spec.deliveryVehicle, to: next, reason: `${intent.reason} Forbidden vehicle was selected.` });
    spec = { ...spec, deliveryVehicle: next };
  }

  const maxCount = deliveryVehicleCatalog[spec.deliveryVehicle].maxCount;
  if (spec.count > maxCount) {
    corrections.push({ field: "count", from: spec.count, to: maxCount, reason: `${spec.deliveryVehicle} supports at most ${maxCount} instances.` });
    spec = { ...spec, count: maxCount };
  }

  if (intent.forcedCoreMesh && spec.vfx.coreMesh !== intent.forcedCoreMesh) {
    corrections.push({ field: "vfx.coreMesh", from: spec.vfx.coreMesh, to: intent.forcedCoreMesh, reason: intent.reason });
    spec = { ...spec, vfx: { ...spec.vfx, coreMesh: intent.forcedCoreMesh } };
  }

  if (intent.requiredTravel?.length) {
    const next = appendUnique(spec.vfx.travel, intent.requiredTravel, 3);
    if (!sameArray(spec.vfx.travel, next)) {
      corrections.push({ field: "vfx.travel", from: spec.vfx.travel, to: next, reason: intent.reason });
      spec = { ...spec, vfx: { ...spec.vfx, travel: next } };
    }
  }

  if (intent.requiredImpact?.length) {
    const next = appendUnique(spec.vfx.impact, intent.requiredImpact, 4);
    if (!sameArray(spec.vfx.impact, next)) {
      corrections.push({ field: "vfx.impact", from: spec.vfx.impact, to: next, reason: intent.reason });
      spec = { ...spec, vfx: { ...spec.vfx, impact: next } };
    }
  }

  if (intent.minCount !== undefined && spec.count < intent.minCount) {
    const next = Math.min(deliveryVehicleCatalog[spec.deliveryVehicle].maxCount, intent.preferredCount ?? intent.minCount);
    corrections.push({ field: "count", from: spec.count, to: next, reason: intent.reason });
    spec = { ...spec, count: next };
  }

  return { spec, intent, corrections };
}

export function describeIntentForPrompt(intent: SpellIntent): string {
  const lines = [
    `Detected intent: ${intent.label}`,
    `Reason: ${intent.reason}`,
  ];
  if (intent.allowedAlignments?.length) lines.push(`Allowed alignments: ${intent.allowedAlignments.join(", ")}`);
  if (intent.allowedDeliveryVehicles?.length) lines.push(`Allowed delivery vehicles: ${intent.allowedDeliveryVehicles.join(", ")}`);
  if (intent.forcedAlignment) lines.push(`Forced alignment: ${intent.forcedAlignment}`);
  if (intent.forcedDeliveryVehicle) lines.push(`Forced delivery vehicle: ${intent.forcedDeliveryVehicle}`);
  if (intent.forbiddenDeliveryVehicles?.length) lines.push(`Forbidden delivery vehicles: ${intent.forbiddenDeliveryVehicles.join(", ")}`);
  if (intent.forcedCoreMesh) lines.push(`Forced core mesh: ${intent.forcedCoreMesh}`);
  if (intent.minCount !== undefined) lines.push(`Minimum count: ${intent.minCount}`);
  return lines.join("\n");
}

function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/[_-]/g, " ");
}

function withAlignmentCue(text: string, intent: SpellIntent): SpellIntent {
  const cue = ALIGNMENT_CUES.find((item) => item.re.test(text))?.alignment;
  if (!cue || intent.forcedAlignment) return intent;
  if (intent.allowedAlignments?.length && !intent.allowedAlignments.includes(cue)) return intent;
  return {
    ...intent,
    allowedAlignments: [cue],
    forcedAlignment: cue,
    reason: `${intent.reason} The prompt also explicitly cues ${cue}.`,
  };
}

function cloneVfx(vfx: SpellVfxPayload): SpellVfxPayload {
  return {
    coreMesh: vfx.coreMesh,
    travel: [...vfx.travel],
    impact: [...vfx.impact],
    shaders: { ...vfx.shaders },
  };
}

function mergeDefaults(vfx: SpellVfxPayload, alignment: SpellAlignmentId): SpellVfxPayload {
  const defaults = alignmentCatalog[alignment];
  const shaders: SpellShaderSelection = { ...defaults.defaultShaders };
  return {
    coreMesh: vfx.coreMesh,
    travel: appendUnique(vfx.travel, defaults.defaultTravel, 3),
    impact: appendUnique(vfx.impact, defaults.defaultImpact, 4),
    shaders,
  };
}

function appendUnique<T>(current: T[], required: readonly T[], max: number): T[] {
  const next = [...required];
  for (const item of current) {
    if (!next.includes(item)) next.push(item);
  }
  return next.slice(0, max);
}

function sameArray<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
