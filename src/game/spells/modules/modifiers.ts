import type { SpellModifierSet } from "@/game/spells/modules/spellIds";

export const defaultSpellModifiers: SpellModifierSet = {
  scale: 1,
  speed: 1,
  duration: 1,
  intensity: 1,
};

export const modifierBounds: Record<keyof SpellModifierSet, { min: number; max: number }> = {
  scale: { min: 0.5, max: 3 },
  speed: { min: 0.5, max: 2 },
  duration: { min: 0.5, max: 3 },
  intensity: { min: 0.5, max: 3 },
};

export function clampSpellModifiers(value: Partial<SpellModifierSet>): SpellModifierSet {
  return {
    scale: clampModifier("scale", value.scale ?? defaultSpellModifiers.scale),
    speed: clampModifier("speed", value.speed ?? defaultSpellModifiers.speed),
    duration: clampModifier("duration", value.duration ?? defaultSpellModifiers.duration),
    intensity: clampModifier("intensity", value.intensity ?? defaultSpellModifiers.intensity),
  };
}

function clampModifier(key: keyof SpellModifierSet, value: number): number {
  const bounds = modifierBounds[key];
  return Number(Math.max(bounds.min, Math.min(bounds.max, value)).toFixed(2));
}
