import { z } from "zod";
import {
  coreVisualMeshIds,
  deliveryVehicleIds,
  impactVfxIds,
  spellAlignmentIds,
  spellShaderIdSet,
  spellShaderIds,
  travelVfxIds,
} from "@/game/spells/modules/spellIds";
import { alignmentCatalog } from "@/game/spells/modules/alignments";
import { deliveryVehicleCatalog } from "@/game/spells/modules/deliveryVehicles";
import { clampSpellModifiers } from "@/game/spells/modules/modifiers";
import { getShaderPreset } from "@/game/spells/modules/shaderPresets";
import { coreVisualMeshCatalog, impactVfxCatalog, travelVfxCatalog } from "@/game/spells/modules/vfxModules";
import type { SpellBuildSpec, SpellShaderSelection, SpellVfxPayload } from "@/game/spells/modules/spellIds";

export const spellShaderSelectionSchema = z.object({
  core: z.enum(spellShaderIds),
  trail: z.enum(spellShaderIds),
  impact: z.enum(spellShaderIds),
  decal: z.enum(spellShaderIds),
  aura: z.enum(spellShaderIds),
});

export const spellVfxPayloadSchema = z.object({
  coreMesh: z.enum(coreVisualMeshIds),
  travel: z.array(z.enum(travelVfxIds)).max(3),
  impact: z.array(z.enum(impactVfxIds)).min(1).max(4),
  shaders: spellShaderSelectionSchema,
});

export const spellBuildSpecSchema = z.object({
  name: z.string().min(1).max(96),
  alignment: z.enum(spellAlignmentIds),
  deliveryVehicle: z.enum(deliveryVehicleIds),
  vfx: spellVfxPayloadSchema,
  modifiers: z.object({
    scale: z.coerce.number().min(0.5).max(3),
    speed: z.coerce.number().min(0.5).max(2),
    duration: z.coerce.number().min(0.5).max(3),
    intensity: z.coerce.number().min(0.5).max(3),
  }),
  count: z.coerce.number().int().min(1).max(10),
  intentSummary: z.string().max(200),
  castImagery: z.string().max(240),
  impactImagery: z.string().max(240),
});

export function normalizeSpellBuildSpec(value: SpellBuildSpec): SpellBuildSpec {
  const delivery = deliveryVehicleCatalog[value.deliveryVehicle];
  const alignment = alignmentCatalog[value.alignment];
  if (!(value.vfx.coreMesh in coreVisualMeshCatalog)) {
    throw new Error(`Unknown core mesh: ${value.vfx.coreMesh}`);
  }
  for (const moduleId of value.vfx.travel) {
    if (!(moduleId in travelVfxCatalog)) throw new Error(`Unknown travel VFX module: ${moduleId}`);
  }
  for (const moduleId of value.vfx.impact) {
    if (!(moduleId in impactVfxCatalog)) throw new Error(`Unknown impact VFX module: ${moduleId}`);
  }
  if (value.count > delivery.maxCount) {
    throw new Error(`${value.deliveryVehicle} supports at most ${delivery.maxCount} projectiles/instances`);
  }
  if (value.vfx.impact.length === 0) {
    throw new Error("Spell VFX payload must include at least one impact module");
  }
  const shaders: SpellShaderSelection = {
    core: sanitizeShader(value.vfx.shaders.core, value.alignment, "core"),
    trail: sanitizeShader(value.vfx.shaders.trail, value.alignment, "trail"),
    impact: sanitizeShader(value.vfx.shaders.impact, value.alignment, "impact"),
    decal: sanitizeShader(value.vfx.shaders.decal, value.alignment, "decal"),
    aura: sanitizeShader(value.vfx.shaders.aura, value.alignment, "aura"),
  };
  if (alignment.defaultCoreMesh !== value.vfx.coreMesh && value.vfx.coreMesh === "none" && value.vfx.travel.length === 0) {
    throw new Error(`${value.alignment} pure-energy spells require at least one travel VFX module`);
  }
  const vfx: SpellVfxPayload = {
    coreMesh: value.vfx.coreMesh,
    travel: unique(value.vfx.travel).slice(0, 3),
    impact: unique(value.vfx.impact).slice(0, 4),
    shaders,
  };
  return {
    ...value,
    name: titleCase(value.name),
    vfx,
    modifiers: clampSpellModifiers(value.modifiers),
    count: value.count,
  };
}

function sanitizeShader<T extends keyof SpellShaderSelection>(
  value: SpellShaderSelection[T],
  alignment: SpellBuildSpec["alignment"],
  phase: T,
): SpellShaderSelection[T] {
  if (!spellShaderIdSet.has(value)) throw new Error(`Unknown shader preset: ${value}`);
  const preset = getShaderPreset(value);
  const alignmentDef = alignmentCatalog[alignment];
  if (!alignmentDef.allowedShaders.includes(value)) {
    console.warn(`[SpellBuildSpec] ${value} is outside ${alignment} shader guidance`);
  }
  if (!preset.compatibleAlignments.includes(alignment)) {
    console.warn(`[SpellBuildSpec] ${value} is outside ${alignment} shader compatibility guidance`);
  }
  if (!preset.compatiblePhases.includes(phase)) {
    console.warn(`[SpellBuildSpec] ${value} is outside ${phase} phase guidance`);
  }
  return value;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .slice(0, 32);
}
