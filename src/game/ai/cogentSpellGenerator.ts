import type { CogentEngine } from "cogentlm";
import { elementColors, normalizeSpell, type RawSpell } from "@/game/spells/spellSchema";
import type { GeneratedSpell, SpellEffect, SpellElement, SpellShape } from "@/game/types";

let enginePromise: Promise<CogentEngine> | null = null;

type SpellIntent = {
  element: SpellElement;
  shape: SpellShape;
  effects: SpellEffect[];
};

const keywordMap: Array<[RegExp, Partial<SpellIntent>]> = [
  [/fire|flame|burn|inferno|magma|lava/i, { element: "fire", effects: ["burn"] }],
  [/ice|frost|snow|blizzard|freeze|frozen/i, { element: "ice", effects: ["slow"] }],
  [/lightning|thunder|storm|spark|bolt/i, { element: "lightning", effects: ["stun"] }],
  [/earth|stone|rock|boulder|quake|vine/i, { element: "earth", effects: ["knockback"] }],
  [/shadow|void|dark|curse|nightmare/i, { element: "shadow", effects: ["shield_break"] }],
  [/nature|poison|thorn|spore|venom/i, { element: "nature", effects: ["poison"] }],
  [/tornado|vortex|whirlpool|black hole|pull|gravity/i, { shape: "vortex", effects: ["pull"] }],
  [/beam|laser|ray|stream/i, { shape: "beam" }],
  [/wall|barrier|line/i, { shape: "wall" }],
  [/trap|mine|rune|sigil/i, { shape: "trap" }],
  [/explosion|nova|burst|blast/i, { shape: "burst" }],
  [/rain|meteor|storm|area|circle|field/i, { shape: "aoe" }],
];

function inferIntent(prompt: string): SpellIntent {
  const intent: SpellIntent = { element: "arcane", shape: "projectile", effects: [] };
  for (const [pattern, partial] of keywordMap) {
    if (!pattern.test(prompt)) continue;
    if (partial.element) intent.element = partial.element;
    if (partial.shape) intent.shape = partial.shape;
    if (partial.effects) intent.effects.push(...partial.effects);
  }
  intent.effects = [...new Set(intent.effects)].slice(0, 2);
  return intent;
}

function fallbackRawSpell(prompt: string): RawSpell {
  const intent = inferIntent(prompt);
  const lower = prompt.toLowerCase();
  const massive = /massive|huge|giant|colossal|large/.test(lower);
  const fast = /fast|quick|rapid|swift/.test(lower);
  const devastating = /devastating|deadly|powerful|strong|massive/.test(lower);
  const lingering = /linger|lasting|field|storm|cloud|tornado|wall/.test(lower);
  const radius = intent.shape === "projectile" ? (massive ? 2.4 : 1.1) : massive ? 6.2 : 3.7;
  const damage = devastating ? 54 : intent.effects.length > 0 ? 36 : 30;
  const durationMs = intent.shape === "projectile" ? 1800 : lingering ? 4800 : 2600;

  return {
    name: `${intent.element} ${intent.shape}`,
    element: intent.element,
    shape: intent.shape,
    damage,
    speed: fast ? 25 : intent.shape === "beam" ? 36 : intent.shape === "projectile" ? 18 : 7,
    radius,
    durationMs,
    cooldownMs: 5500,
    manaCost: 45,
    effects: intent.effects,
    color: elementColors[intent.element],
  };
}

function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function getCogentEngine(): Promise<CogentEngine> {
  if (!enginePromise) {
    enginePromise = import("cogentlm").then(({ CogentEngine }) => CogentEngine.create());
  }
  return enginePromise;
}

export async function generateSpellFromPrompt(prompt: string): Promise<{ spell: GeneratedSpell; source: "cogentlm" | "fallback" }> {
  const cleanPrompt = prompt.trim().slice(0, 240);
  if (!cleanPrompt) {
    return { spell: normalizeSpell(fallbackRawSpell("arcane bolt"), "arcane bolt"), source: "fallback" };
  }

  const modelUrl = process.env.NEXT_PUBLIC_COGENT_MODEL_URL;
  if (!modelUrl) {
    return { spell: normalizeSpell(fallbackRawSpell(cleanPrompt), cleanPrompt), source: "fallback" };
  }

  try {
    const engine = await getCogentEngine();
    if (!engine.models.current()) {
      await engine.models.load(modelUrl);
    }
    const reply = await engine.chat([
      {
        role: "system",
        content:
          "Convert player spell prompts into strict JSON only. Use element fire, ice, lightning, earth, arcane, shadow, or nature. Use shape projectile, beam, aoe, vortex, wall, trap, or burst. Use effects burn, slow, stun, pull, knockback, shield_break, or poison.",
      },
      {
        role: "user",
        content: `Prompt: ${cleanPrompt}\nReturn JSON with name, element, shape, damage, speed, radius, durationMs, cooldownMs, manaCost, effects, color.`,
      },
    ]);
    const parsed = extractJson(reply);
    return { spell: normalizeSpell(parsed ?? fallbackRawSpell(cleanPrompt), cleanPrompt), source: parsed ? "cogentlm" : "fallback" };
  } catch (error) {
    console.warn("CogentLM generation failed, using fallback spell parser.", error);
    return { spell: normalizeSpell(fallbackRawSpell(cleanPrompt), cleanPrompt), source: "fallback" };
  }
}
