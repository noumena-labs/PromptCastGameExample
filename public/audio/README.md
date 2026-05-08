# Game Audio

Audio assets for PromptCast. The runtime tries `.ogg`, then ElevenLabs `.mp3`, then procedural `.wav`, and finally falls back to live procedural Web Audio if every file is missing.

## Workflow

1. `npm run dev`
2. Open `http://localhost:3000/dev/audio-library`
3. Review the catalog, prompts, and missing-file status.
4. For ElevenLabs generation, set `ELEVENLABS_API_KEY=...` in `.env.local`. Rotate the key if it has ever been shared in chat or committed.
5. Use **Generate 11Labs** per cue or **ElevenLabs Missing** for a sequential missing-only batch. Outputs are saved as `.mp3` beside each cue path.
6. Use **Generate Proc** for local procedural `.wav` placeholders when you do not want to spend ElevenLabs credits.
7. Replace generated files with final mastered `.ogg` assets when ready; `.ogg` always wins at runtime.

The dev tool also writes `public/audio/audio-generation.manifest.json` for ElevenLabs generations so prompts and model details are traceable.

## Target Structure

```text
public/audio/
  sfx/ui/
  sfx/wizard/
  sfx/world/
  sfx/spells/fire/
  sfx/spells/water_ice/
  sfx/spells/lightning/
  sfx/spells/earth/
  sfx/spells/dark/
  sfx/spells/light/
  sfx/spells/meteor_cosmic/
  sfx/delivery/
  music/
  ambience/
```

## Current Count

The catalog currently tracks 63 cues: UI, wizard, world pickups, seven spell alignments, delivery overlays, music, and ambience.
