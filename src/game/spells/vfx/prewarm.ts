/**
 * Spell asset prewarm pipeline.
 *
 * The first cast of any spell flavor is the worst frame the player will ever
 * see, because three independent systems have cold caches:
 *
 *   1. VFX PNG sprite atlases (three.quarks `loadVfxTexture`) — first use
 *      triggers a network fetch + decode, then a GPU texture re-upload when
 *      the real image replaces the 1x1 white placeholder.
 *   2. GLSL shader programs (`SpellShaderMaterial`) — first bind of each
 *      unique alignment+phase combo causes a driver-blocking compile + link.
 *   3. Audio cues (`audioRuntime.play`) — first call hits a network endpoint
 *      to resolve the file, fetches the OGG, and runs `decodeAudioData` on
 *      the audio thread.
 *
 * Magic Missile is the default starter spell and is cast far more frequently
 * than anything else, so its assets are warmed eagerly on boot. The remaining
 * alignments are warmed lazily during browser idle time.
 */

import { audioRuntime } from "@/game/audio/audioRuntime";
import {
  deliveryAudioCue,
  spellAudioCue,
  type SpellAudioPhase,
} from "@/game/audio/audioCatalog";
import {
  spellAlignmentIds,
  deliveryVehicleIds,
} from "@/game/spells/modules/spellIds";
import { prewarmVfxTextures } from "@/components/game/scene/quarks/presets";

// All VFX texture filenames currently referenced from quarks presets.ts.
// Keep in sync with `loadVfxTexture(...)` call sites.
const ALL_VFX_TEXTURES: string[] = [
  "smoke_puff_soft.png",
  "dust_puff.png",
  "ember_dot.png",
  "spark_streak.png",
  "fire_flipbook_4x4.png",
  "debris_chunk_albedo.png",
  // Not currently sampled by any preset but listed in /public/textures/vfx
  // so we warm it too in case future presets reference it.
  "smoke_noise_tile.png",
  "crack_glow.png",
];

// Magic Missile uses the light alignment and projectile_linear delivery.
// These are the cues that fire on every Magic Missile cast.
const MAGIC_MISSILE_AUDIO_CUES = [
  "wizard_cast_release",
  spellAudioCue("light", "cast"),
  spellAudioCue("light", "travel_loop"),
  spellAudioCue("light", "impact"),
  spellAudioCue("light", "linger_loop"),
  deliveryAudioCue("projectile_linear"),
] as const;

const ALL_AUDIO_PHASES: SpellAudioPhase[] = [
  "cast",
  "travel_loop",
  "impact",
  "linger_loop",
];

let _magicMissileWarmed = false;
let _allWarmed = false;

/**
 * Warm Magic Missile's full asset chain (textures + audio). Called as soon
 * as the GameClient mounts so that by the time the player can move and cast,
 * every cold-cache cliff for the default spell has already been paid.
 */
export function prewarmMagicMissile(): Promise<void> {
  if (_magicMissileWarmed) return Promise.resolve();
  _magicMissileWarmed = true;

  // Magic Missile only needs the light-alignment subset of VFX textures
  // (smoke_puff_soft, ember_dot, spark_streak), but warming the full set
  // early is cheap and removes hitches on follow-up crafted spells.
  const texturesPromise = prewarmVfxTextures([
    "smoke_puff_soft.png",
    "ember_dot.png",
    "spark_streak.png",
  ]);
  const audioPromise = audioRuntime.prewarm([...MAGIC_MISSILE_AUDIO_CUES]);

  return Promise.all([texturesPromise, audioPromise]).then(() => undefined);
}

/**
 * Schedule prewarm of every alignment + delivery vehicle's assets during
 * browser idle time. Spread across multiple idle slots so a single chunk
 * never exceeds a frame budget.
 */
export function prewarmAlignmentsIdle(): void {
  if (_allWarmed) return;
  _allWarmed = true;
  if (typeof window === "undefined") return;

  // 1) Warm remaining VFX textures on the next idle slot.
  scheduleIdle(() => {
    void prewarmVfxTextures(ALL_VFX_TEXTURES);
  });

  // 2) Warm audio per alignment (one alignment per idle slot to spread cost).
  spellAlignmentIds.forEach((alignment, index) => {
    scheduleIdle(() => {
      const cues = ALL_AUDIO_PHASES.map((phase) =>
        spellAudioCue(alignment, phase),
      );
      void audioRuntime.prewarm(cues);
    }, index * 50);
  });

  // 3) Warm one delivery cue per idle slot.
  deliveryVehicleIds.forEach((vehicleId, index) => {
    scheduleIdle(() => {
      void audioRuntime.prewarm([deliveryAudioCue(vehicleId)]);
    }, spellAlignmentIds.length * 50 + index * 50);
  });
}

function scheduleIdle(cb: () => void, delayMs = 0): void {
  if (typeof window === "undefined") {
    cb();
    return;
  }
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  const run = () => {
    if (typeof ric === "function") {
      ric(cb, { timeout: 1000 });
    } else {
      window.setTimeout(cb, 0);
    }
  };
  if (delayMs > 0) {
    window.setTimeout(run, delayMs);
  } else {
    run();
  }
}
