import type { DeliveryVehicleId, SpellAlignmentId } from "@/game/spells/modules/spellIds";

export type AudioGroup = "ui" | "sfx" | "music" | "ambience";
export type AudioGenerationKind = "sound-effect" | "music";

export type AudioCueId =
  | "ui_click"
  | "ui_confirm"
  | "ui_cancel"
  | "ui_error"
  | "ui_panel_open"
  | "ui_panel_close"
  | "ui_slot_select"
  | "ui_spell_bind"
  | "wizard_spawn"
  | "wizard_death"
  | "wizard_hurt"
  | "wizard_jump"
  | "wizard_land"
  | "wizard_cast_charge"
  | "wizard_cast_release"
  | "wizard_cast_fail"
  | "wizard_footstep_grass_01"
  | "wizard_footstep_grass_02"
  | "wizard_footstep_grass_03"
  | "wizard_footstep_grass_04"
  | "world_mana_collect"
  | "world_crystal_collect"
  | "world_dummy_hit"
  | "world_sanctuary_enter"
  | "world_sanctuary_exit"
  | SpellAudioCueId
  | DeliveryAudioCueId
  | "music_menu_loop"
  | "music_arena_loop"
  | "music_sanctuary_loop"
  | "ambience_meadow_loop"
  | "ambience_meadow_loop_song";

export type SpellAudioPhase = "cast" | "travel_loop" | "impact" | "linger_loop";
export type SpellAudioCueId = `spell_${SpellAlignmentId}_${SpellAudioPhase}`;

export type DeliveryAudioCueId = `delivery_${DeliveryVehicleId}`;

export type AudioCue = {
  id: AudioCueId;
  file: string;
  group: AudioGroup;
  loop?: boolean;
  volume: number;
  maxDistance?: number;
  minIntervalMs?: number;
  durationHintMs: number;
  description: string;
  sourcePrompt: string;
  generationKind: AudioGenerationKind;
  promptInfluence?: number;
};

const spellPromptByAlignment: Record<SpellAlignmentId, string> = {
  fire: "hot magical flame, embers, smoke, aggressive but clean fantasy spell sound",
  water_ice: "icy crystal shimmer, frosty air, water sparkle, crisp fantasy spell sound",
  lightning: "electric arc, plasma crackle, bright magical lightning snap",
  earth: "stone grind, dust burst, heavy rocky magical impact",
  dark: "void whoosh, shadow smoke, necrotic low magical texture",
  light: "holy chime, radiant shimmer, warm magical glimmer",
  meteor_cosmic: "deep cosmic rumble, starfield shimmer, meteor fire trail",
};

const alignmentVolumes: Record<SpellAudioPhase, number> = {
  cast: 0.62,
  travel_loop: 0.32,
  impact: 0.74,
  linger_loop: 0.26,
};

const spellPhaseDescriptions: Record<SpellAudioPhase, string> = {
  cast: "Short spell casting onset.",
  travel_loop: "Loopable spell travel bed for projectiles and skyfall objects.",
  impact: "Spell impact hit or burst.",
  linger_loop: "Loopable lingering area/status bed.",
};

const deliveryPrompts: Record<DeliveryVehicleId, string> = {
  projectile_linear: "fast magical projectile whoosh, short clean pass-by",
  projectile_arcing: "arcing magical lob whoosh, rising then falling movement",
  skyfall: "distant incoming meteor whistling downward with low rumble",
  instant_hitscan: "instant magical beam snap, sharp laser-like hit",
  ground_eruption: "ground cracking upward, earth rupture magical burst",
  aura_orbit: "soft orbital magical swirl loop, protective aura movement",
};

const baseCues = [
  cue("ui_click", "/audio/sfx/ui/ui_click.ogg", "ui", 0.32, 90, "Soft parchment button click.", "short soft UI click, parchment and wood, non-harsh"),
  cue("ui_confirm", "/audio/sfx/ui/ui_confirm.ogg", "ui", 0.42, 180, "Positive confirm chime.", "short positive fantasy UI confirmation chime"),
  cue("ui_cancel", "/audio/sfx/ui/ui_cancel.ogg", "ui", 0.35, 150, "Back/cancel tick.", "short low fantasy UI cancel tick"),
  cue("ui_error", "/audio/sfx/ui/ui_error.ogg", "ui", 0.38, 240, "Soft error thud.", "short soft magical error thud, not abrasive"),
  cue("ui_panel_open", "/audio/sfx/ui/ui_panel_open.ogg", "ui", 0.38, 260, "Panel opening flourish.", "short paper and magic panel open flourish"),
  cue("ui_panel_close", "/audio/sfx/ui/ui_panel_close.ogg", "ui", 0.34, 220, "Panel closing fold.", "short paper and magic panel close fold"),
  cue("ui_slot_select", "/audio/sfx/ui/ui_slot_select.ogg", "ui", 0.36, 120, "Runestone slot select.", "short stone rune selection tap with tiny sparkle"),
  cue("ui_spell_bind", "/audio/sfx/ui/ui_spell_bind.ogg", "ui", 0.52, 700, "Spell binding success.", "fantasy spell binding success, rune locks into stone"),

  cue("wizard_spawn", "/audio/sfx/wizard/wizard_spawn.ogg", "sfx", 0.62, 760, "Wizard reforms at spawn.", "magical wizard respawn shimmer, gentle rise"),
  cue("wizard_death", "/audio/sfx/wizard/wizard_death.ogg", "sfx", 0.78, 1100, "Wizard defeat burst.", "magical wizard death burst, airy dissolve, not gory"),
  cue("wizard_hurt", "/audio/sfx/wizard/wizard_hurt.ogg", "sfx", 0.48, 260, "Wizard takes damage.", "short magical hurt impact on cloth and shield"),
  cue("wizard_jump", "/audio/sfx/wizard/wizard_jump.ogg", "sfx", 0.4, 160, "Wizard jump takeoff.", "short cloth jump takeoff with small magic lift"),
  cue("wizard_land", "/audio/sfx/wizard/wizard_land.ogg", "sfx", 0.46, 220, "Wizard landing step.", "soft boot landing on grass and dirt"),
  cue("wizard_cast_charge", "/audio/sfx/wizard/wizard_cast_charge.ogg", "sfx", 0.36, 360, "Cast charge shimmer.", "short magical energy gathering in hand"),
  cue("wizard_cast_release", "/audio/sfx/wizard/wizard_cast_release.ogg", "sfx", 0.56, 240, "Generic cast release.", "short magical spell release whoosh"),
  cue("wizard_cast_fail", "/audio/sfx/wizard/wizard_cast_fail.ogg", "sfx", 0.38, 180, "Failed cast.", "short dry failed magic fizz"),
  cue("wizard_footstep_grass_01", "/audio/sfx/wizard/wizard_footstep_grass_01.ogg", "sfx", 0.26, 120, "Grass footstep variant 1.", "quiet boot footstep on meadow grass variant one"),
  cue("wizard_footstep_grass_02", "/audio/sfx/wizard/wizard_footstep_grass_02.ogg", "sfx", 0.26, 120, "Grass footstep variant 2.", "quiet boot footstep on meadow grass variant two"),
  cue("wizard_footstep_grass_03", "/audio/sfx/wizard/wizard_footstep_grass_03.ogg", "sfx", 0.26, 120, "Grass footstep variant 3.", "quiet boot footstep on meadow grass variant three"),
  cue("wizard_footstep_grass_04", "/audio/sfx/wizard/wizard_footstep_grass_04.ogg", "sfx", 0.26, 120, "Grass footstep variant 4.", "quiet boot footstep on meadow grass variant four"),

  cue("world_mana_collect", "/audio/sfx/world/world_mana_collect.ogg", "sfx", 0.5, 320, "Mana mote pickup.", "small magical mana pickup sparkle"),
  cue("world_crystal_collect", "/audio/sfx/world/world_crystal_collect.ogg", "sfx", 0.62, 540, "Aura crystal pickup.", "bright crystal pickup chime with aura resonance"),
  cue("world_dummy_hit", "/audio/sfx/world/world_dummy_hit.ogg", "sfx", 0.42, 220, "Target dummy hit.", "wooden training dummy hit with small magic pop"),
  cue("world_sanctuary_enter", "/audio/sfx/world/world_sanctuary_enter.ogg", "sfx", 0.68, 900, "Sanctuary opens.", "magical sanctuary shield opens, warm protective bloom"),
  cue("world_sanctuary_exit", "/audio/sfx/world/world_sanctuary_exit.ogg", "sfx", 0.58, 620, "Sanctuary closes.", "magical sanctuary shield closes and fades"),

  musicCue("music_menu_loop", "/audio/music/music_menu_loop.ogg", "Menu music loop.", "loopable fantasy meadow menu music, warm ancient codex, 60 seconds"),
  musicCue("music_arena_loop", "/audio/music/music_arena_loop.ogg", "Arena music loop.", "loopable light fantasy duel music, meadow percussion, not too intense, 90 seconds"),
  musicCue("music_sanctuary_loop", "/audio/music/music_sanctuary_loop.ogg", "Sanctuary music loop.", "loopable mystical sanctuary music, soft choir, arcane writing, 60 seconds"),
  ambienceCue("ambience_meadow_loop", "/audio/ambience/ambience_meadow_loop.ogg", "Meadow ambience loop.", "loopable meadow ambience, soft wind, distant birds, subtle magical hum, 90 seconds"),
  ambienceCue("ambience_meadow_loop_song", "/audio/ambience/ambience_meadow_loop_song.ogg", "Meadow ambience loop.", "loopable meadow ambience, soft wind, distant birds, subtle magical hum, 90 seconds"),
] satisfies AudioCue[];

const spellCues = (Object.entries(spellPromptByAlignment) as Array<[SpellAlignmentId, string]>).flatMap(
  ([alignment, prompt]) =>
    (["cast", "travel_loop", "impact", "linger_loop"] as SpellAudioPhase[]).map((phase) =>
      cue(
        `spell_${alignment}_${phase}`,
        `/audio/sfx/spells/${alignment}/spell_${alignment}_${phase}.ogg`,
        "sfx",
        alignmentVolumes[phase],
        phase === "impact" ? 760 : phase === "travel_loop" || phase === "linger_loop" ? 1400 : 360,
        `${spellPhaseDescriptions[phase]} ${alignment}.`,
        `${prompt}, ${phase.replace("_", " ")}, game ready, clean mix`,
        phase === "travel_loop" || phase === "linger_loop",
      ),
    ),
);

const deliveryCues = (Object.entries(deliveryPrompts) as Array<[DeliveryVehicleId, string]>).map(([delivery, prompt]) =>
  cue(
    `delivery_${delivery}`,
    `/audio/sfx/delivery/delivery_${delivery}.ogg`,
    "sfx",
    delivery === "skyfall" || delivery === "ground_eruption" ? 0.54 : 0.34,
    delivery === "aura_orbit" ? 1400 : 420,
    `Delivery overlay for ${delivery}.`,
    `${prompt}, fantasy spell movement layer, game ready`,
    delivery === "aura_orbit",
  ),
);

export const audioCatalog = [...baseCues, ...spellCues, ...deliveryCues] satisfies AudioCue[];

export const audioCueById: Record<AudioCueId, AudioCue> = Object.fromEntries(
  audioCatalog.map((cueItem) => [cueItem.id, cueItem]),
) as Record<AudioCueId, AudioCue>;

export const audioFileCandidates = (cue: AudioCue): string[] => [
  cue.file,
  cue.file.replace(/\.ogg$/i, ".mp3"),
  cue.file.replace(/\.ogg$/i, ".wav"),
];

export const audioGeneratedFile = (cue: AudioCue, extension: "mp3" | "wav"): string => cue.file.replace(/\.ogg$/i, `.${extension}`);

export function spellAudioCue(alignment: SpellAlignmentId, phase: SpellAudioPhase): SpellAudioCueId {
  return `spell_${alignment}_${phase}`;
}

export function deliveryAudioCue(delivery: DeliveryVehicleId): DeliveryAudioCueId {
  return `delivery_${delivery}`;
}

function cue(
  id: AudioCueId,
  file: string,
  group: AudioGroup,
  volume: number,
  durationHintMs: number,
  description: string,
  sourcePrompt: string,
  loop = false,
): AudioCue {
  return {
    id,
    file,
    group,
    loop,
    volume,
    maxDistance: group === "sfx" ? 36 : undefined,
    minIntervalMs: id.includes("footstep") ? 110 : id.includes("travel_loop") ? 350 : 40,
    durationHintMs,
    description,
    sourcePrompt,
    generationKind: group === "music" ? "music" : "sound-effect",
    promptInfluence: loop ? 0.42 : group === "ui" ? 0.62 : 0.48,
  };
}

function musicCue(id: AudioCueId, file: string, description: string, sourcePrompt: string): AudioCue {
  return {
    id,
    file,
    group: "music",
    loop: true,
    volume: 0.42,
    durationHintMs: 60000,
    description,
    sourcePrompt,
    generationKind: "music",
  };
}

function ambienceCue(id: AudioCueId, file: string, description: string, sourcePrompt: string): AudioCue {
  return {
    id,
    file,
    group: "ambience",
    loop: true,
    volume: 0.34,
    durationHintMs: 90000,
    description,
    sourcePrompt,
    generationKind: "sound-effect",
    promptInfluence: 0.38,
  };
}
