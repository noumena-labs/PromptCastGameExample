import type { AudioCue, AudioCueId } from "@/game/audio/audioCatalog";

const SAMPLE_RATE = 44100;

type RenderOptions = {
  sampleRate?: number;
  durationMs?: number;
};

export async function renderProceduralCue(cue: AudioCue, options: RenderOptions = {}): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const durationMs = Math.max(90, Math.min(options.durationMs ?? cue.durationHintMs, cue.loop ? 6000 : 1800));
  const length = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
  const context = new OfflineAudioContext(1, length, sampleRate);
  const output = context.createGain();
  output.gain.value = 0.88;
  output.connect(context.destination);

  buildCueGraph(context, output, cue);
  return context.startRendering();
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length * channels * 2 + 44;
  const view = new DataView(new ArrayBuffer(length));
  let offset = 0;

  writeString(view, offset, "RIFF"); offset += 4;
  view.setUint32(offset, length - 8, true); offset += 4;
  writeString(view, offset, "WAVE"); offset += 4;
  writeString(view, offset, "fmt "); offset += 4;
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, channels, true); offset += 2;
  view.setUint32(offset, buffer.sampleRate, true); offset += 4;
  view.setUint32(offset, buffer.sampleRate * channels * 2, true); offset += 4;
  view.setUint16(offset, channels * 2, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString(view, offset, "data"); offset += 4;
  view.setUint32(offset, length - offset - 4, true); offset += 4;

  const data = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let i = 0; i < buffer.length; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, data[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: "audio/wav" });
}

export function placeholderFilename(cue: AudioCue): string {
  return cue.file.split("/").pop()?.replace(/\.ogg$/i, ".wav") ?? `${cue.id}.wav`;
}

function buildCueGraph(context: OfflineAudioContext, destination: GainNode, cue: AudioCue) {
  if (cue.group === "music" || cue.group === "ambience") {
    renderLoopBed(context, destination, cue);
    return;
  }

  if (cue.id.startsWith("ui_")) {
    renderUiCue(context, destination, cue.id);
    return;
  }

  if (cue.id.includes("footstep")) {
    renderNoiseHit(context, destination, 0.04, 0.16, 500, 0.18);
    renderTone(context, destination, 90, 70, 0, 0.12, 0.12, "triangle");
    return;
  }

  if (cue.id.startsWith("spell_")) {
    renderSpellCue(context, destination, cue.id);
    return;
  }

  if (cue.id.startsWith("delivery_")) {
    renderDeliveryCue(context, destination, cue.id);
    return;
  }

  renderWorldCue(context, destination, cue.id);
}

function renderUiCue(context: OfflineAudioContext, destination: GainNode, id: AudioCueId) {
  if (id === "ui_error") {
    renderTone(context, destination, 180, 120, 0, 0.18, 0.22, "sawtooth");
    return;
  }
  if (id === "ui_spell_bind") {
    renderTone(context, destination, 420, 720, 0, 0.36, 0.24, "sine");
    renderTone(context, destination, 840, 1280, 0.08, 0.42, 0.18, "triangle");
    return;
  }
  const base = id === "ui_confirm" ? 520 : id === "ui_cancel" || id === "ui_panel_close" ? 260 : 360;
  renderTone(context, destination, base, base * 1.35, 0, 0.11, 0.18, "triangle");
  renderNoiseHit(context, destination, 0, 0.06, 1800, 0.08);
}

function renderWorldCue(context: OfflineAudioContext, destination: GainNode, id: AudioCueId) {
  if (id === "world_mana_collect") {
    renderTone(context, destination, 720, 1180, 0, 0.22, 0.28, "sine");
    return;
  }
  if (id === "world_crystal_collect" || id === "world_sanctuary_enter") {
    renderTone(context, destination, 320, 620, 0, 0.7, 0.26, "sine");
    renderTone(context, destination, 640, 960, 0.04, 0.74, 0.16, "triangle");
    return;
  }
  if (id === "wizard_death") {
    renderNoiseHit(context, destination, 0, 0.55, 900, 0.32);
    renderTone(context, destination, 240, 60, 0, 0.95, 0.34, "sawtooth");
    return;
  }
  if (id === "wizard_spawn") {
    renderTone(context, destination, 180, 720, 0, 0.75, 0.28, "sine");
    renderNoiseHit(context, destination, 0.12, 0.44, 3000, 0.12);
    return;
  }
  renderNoiseHit(context, destination, 0, 0.22, 1100, 0.22);
  renderTone(context, destination, 210, 140, 0, 0.2, 0.14, "triangle");
}

function renderSpellCue(context: OfflineAudioContext, destination: GainNode, id: string) {
  const alignment = id.replace(/^spell_/, "").replace(/_(cast|travel_loop|impact|linger_loop)$/, "");
  const phase = id.endsWith("impact") ? "impact" : id.endsWith("travel_loop") ? "travel" : id.endsWith("linger_loop") ? "linger" : "cast";
  const base = alignment === "fire" ? 180 : alignment === "water_ice" ? 640 : alignment === "lightning" ? 920 : alignment === "earth" ? 100 : alignment === "dark" ? 130 : alignment === "meteor_cosmic" ? 90 : 520;
  const top = alignment === "lightning" ? 2400 : alignment === "water_ice" || alignment === "light" ? base * 2.1 : base * 1.45;

  if (phase === "impact") {
    renderNoiseHit(context, destination, 0, 0.42, alignment === "earth" ? 520 : 1800, alignment === "earth" ? 0.5 : 0.34);
    renderTone(context, destination, top, base, 0, 0.55, 0.3, alignment === "lightning" ? "square" : "sawtooth");
    return;
  }
  if (phase === "travel" || phase === "linger") {
    renderTone(context, destination, base, top, 0, 1.4, phase === "linger" ? 0.18 : 0.24, "sine", true);
    renderNoiseHit(context, destination, 0, 1.3, alignment === "earth" ? 430 : 2600, 0.1);
    return;
  }
  renderTone(context, destination, base, top, 0, 0.35, 0.26, alignment === "earth" ? "triangle" : "sine");
  renderNoiseHit(context, destination, 0.02, 0.24, 1600, 0.14);
}

function renderDeliveryCue(context: OfflineAudioContext, destination: GainNode, id: string) {
  const low = id.includes("skyfall") || id.includes("ground_eruption") ? 70 : 180;
  const high = id.includes("instant_hitscan") ? 2200 : id.includes("aura_orbit") ? 520 : 820;
  renderTone(context, destination, low, high, 0, id.includes("aura_orbit") ? 1.4 : 0.42, 0.2, "sine", id.includes("aura_orbit"));
  renderNoiseHit(context, destination, 0, id.includes("aura_orbit") ? 1.2 : 0.3, 1400, 0.12);
}

function renderLoopBed(context: OfflineAudioContext, destination: GainNode, cue: AudioCue) {
  const length = context.length / context.sampleRate;
  const base = cue.group === "ambience" ? 110 : cue.id === "music_sanctuary_loop" ? 220 : 146;
  renderTone(context, destination, base, base * 1.01, 0, length, cue.group === "ambience" ? 0.08 : 0.12, "sine", true);
  renderTone(context, destination, base * 1.5, base * 1.52, 0, length, cue.group === "ambience" ? 0.04 : 0.08, "triangle", true);
  renderNoiseHit(context, destination, 0, length, cue.group === "ambience" ? 1800 : 900, cue.group === "ambience" ? 0.05 : 0.025);
}

function renderTone(
  context: OfflineAudioContext,
  destination: GainNode,
  fromHz: number,
  toHz: number,
  start: number,
  duration: number,
  gainValue: number,
  type: OscillatorType,
  slowFade = false,
) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), start + Math.max(0.02, duration));
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + (slowFade ? Math.min(1, duration * 0.25) : 0.018));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function renderNoiseHit(
  context: OfflineAudioContext,
  destination: GainNode,
  start: number,
  duration: number,
  cutoffHz: number,
  gainValue: number,
) {
  const length = Math.max(1, Math.ceil(duration * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let held = 0;
  for (let i = 0; i < length; i += 1) {
    if (i % 4 === 0) held = Math.random() * 2 - 1;
    data[i] = held;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.value = cutoffHz;
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(start);
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}
