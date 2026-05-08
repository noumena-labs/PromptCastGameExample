import { audioCueById, audioFileCandidates, type AudioCue, type AudioCueId } from "@/game/audio/audioCatalog";
import type { Vec3 } from "@/game/types";

type PlayOptions = {
  volume?: number;
  position?: Vec3;
  listener?: Vec3;
  playbackRate?: number;
};

type LoopHandle = {
  id: string;
  stop: (fadeMs?: number) => void;
};

type ActiveLoop = {
  source: AudioBufferSourceNode | OscillatorNode;
  gain: GainNode;
};

const MASTER_VOLUME = 0.85;

class AudioRuntime {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<AudioCueId, AudioBuffer | null>();
  private loading = new Map<AudioCueId, Promise<AudioBuffer | null>>();
  private lastPlayed = new Map<string, number>();
  private loops = new Map<string, ActiveLoop>();
  private loopTokens = new Map<string, symbol>();
  private unlocked = false;

  unlock() {
    const context = this.ensureContext();
    if (context.state === "suspended") void context.resume();
    this.unlocked = true;
  }

  play(id: AudioCueId, options: PlayOptions = {}) {
    const cue = audioCueById[id];
    if (!cue) return;
    const context = this.ensureContext();
    if (context.state === "suspended") void context.resume();
    if (!this.unlocked && cue.group !== "music" && cue.group !== "ambience") this.unlocked = true;

    const timestamp = performance.now();
    const intervalKey = options.position ? `${id}:${options.position.map((n) => Math.round(n)).join(",")}` : id;
    const minInterval = cue.minIntervalMs ?? 0;
    if (timestamp - (this.lastPlayed.get(intervalKey) ?? 0) < minInterval) return;
    this.lastPlayed.set(intervalKey, timestamp);

    const gain = this.createGain(cue, options);
    gain.connect(this.master!);

    void this.load(cue).then((buffer) => {
      if (!buffer) {
        this.playFallback(cue, gain);
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = options.playbackRate ?? pitchJitter(id);
      source.connect(gain);
      source.start();
      source.onended = () => gain.disconnect();
    });
  }

  startLoop(id: AudioCueId, key: string = id, options: PlayOptions = {}): LoopHandle {
    const cue = audioCueById[id];
    if (!cue) return { id: key, stop: () => undefined };
    this.unlock();
    this.stopLoop(key, 180);
    const context = this.ensureContext();
    const token = Symbol(key);
    this.loopTokens.set(key, token);
    const gain = this.createGain(cue, options);
    gain.gain.value = 0.0001;
    gain.connect(this.master!);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, cue.volume * (options.volume ?? 1)), context.currentTime + 0.45);

    void this.load(cue).then((buffer) => {
      if (this.loopTokens.get(key) !== token || this.loops.has(key)) return;
      if (buffer) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain);
        source.start();
        this.loops.set(key, { source, gain });
      } else {
        const source = context.createOscillator();
        source.type = cue.group === "ambience" ? "sine" : "triangle";
        source.frequency.value = cue.group === "ambience" ? 110 : id === "music_sanctuary_loop" ? 220 : 146;
        source.connect(gain);
        source.start();
        this.loops.set(key, { source, gain });
      }
    });

    return { id: key, stop: (fadeMs = 300) => this.stopLoop(key, fadeMs) };
  }

  stopLoop(key: string, fadeMs = 300) {
    const active = this.loops.get(key);
    this.loopTokens.delete(key);
    if (!active) return;
    this.loops.delete(key);
    const context = this.ensureContext();
    const stopAt = context.currentTime + fadeMs / 1000;
    active.gain.gain.cancelScheduledValues(context.currentTime);
    active.gain.gain.setValueAtTime(Math.max(active.gain.gain.value, 0.0001), context.currentTime);
    active.gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    try {
      active.source.stop(stopAt + 0.02);
    } catch {
      // Source may already be stopped.
    }
    window.setTimeout(() => active.gain.disconnect(), fadeMs + 80);
  }

  stopAllLoops(fadeMs = 300) {
    for (const key of Array.from(this.loops.keys())) this.stopLoop(key, fadeMs);
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(context.destination);
    this.context = context;
    this.master = master;
    return context;
  }

  private async load(cue: AudioCue): Promise<AudioBuffer | null> {
    if (this.buffers.has(cue.id)) return this.buffers.get(cue.id) ?? null;
    const existing = this.loading.get(cue.id);
    if (existing) return existing;
    const promise = fetchFirstAudio(cue)
      .then((data) => (data ? this.ensureContext().decodeAudioData(data) : null))
      .catch(() => null)
      .then((buffer) => {
        if (buffer) this.buffers.set(cue.id, buffer);
        this.loading.delete(cue.id);
        return buffer;
      });
    this.loading.set(cue.id, promise);
    return promise;
  }

  private createGain(cue: AudioCue, options: PlayOptions): GainNode {
    const context = this.ensureContext();
    const gain = context.createGain();
    const distanceVolume = cue.maxDistance && options.position && options.listener
      ? attenuation(options.position, options.listener, cue.maxDistance)
      : 1;
    gain.gain.value = cue.volume * (options.volume ?? 1) * distanceVolume;
    return gain;
  }

  private playFallback(cue: AudioCue, gain: GainNode) {
    const context = this.ensureContext();
    if (cue.group === "music" || cue.group === "ambience") return;
    const osc = context.createOscillator();
    const noiseGain = context.createGain();
    const duration = Math.min(0.9, Math.max(0.08, cue.durationHintMs / 1000));
    osc.type = fallbackWave(cue.id);
    osc.frequency.setValueAtTime(fallbackFrequency(cue.id), context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, fallbackFrequency(cue.id) * 1.8), context.currentTime + duration * 0.65);
    noiseGain.gain.setValueAtTime(0.0001, context.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain.gain.value), context.currentTime + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    osc.connect(noiseGain);
    noiseGain.connect(gain);
    osc.start();
    osc.stop(context.currentTime + duration + 0.02);
    window.setTimeout(() => gain.disconnect(), duration * 1000 + 100);
  }
}

async function fetchFirstAudio(cue: AudioCue): Promise<ArrayBuffer | null> {
  for (const file of audioFileCandidates(cue)) {
    try {
      const response = await fetch(file);
      if (response.ok) return response.arrayBuffer();
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export const audioRuntime = new AudioRuntime();

if (typeof window !== "undefined") {
  const unlock = () => audioRuntime.unlock();
  window.addEventListener("pointerdown", unlock, { once: true, passive: true });
  window.addEventListener("keydown", unlock, { once: true });
}

function attenuation(position: Vec3, listener: Vec3, maxDistance: number): number {
  const distance = Math.hypot(position[0] - listener[0], position[1] - listener[1], position[2] - listener[2]);
  if (distance >= maxDistance) return 0;
  return Math.max(0, 1 - distance / maxDistance) ** 1.35;
}

function pitchJitter(id: AudioCueId): number {
  if (id.includes("footstep")) return 0.92 + Math.random() * 0.16;
  if (id.startsWith("ui_")) return 0.98 + Math.random() * 0.04;
  return 0.96 + Math.random() * 0.08;
}

function fallbackFrequency(id: AudioCueId): number {
  if (id.includes("lightning")) return 880;
  if (id.includes("water_ice")) return 640;
  if (id.includes("earth") || id.includes("meteor") || id.includes("death")) return 120;
  if (id.includes("dark")) return 160;
  if (id.includes("fire")) return 220;
  if (id.includes("light") || id.includes("crystal")) return 520;
  if (id.startsWith("ui_")) return 360;
  return 240;
}

function fallbackWave(id: AudioCueId): OscillatorType {
  if (id.includes("lightning") || id.includes("error")) return "square";
  if (id.includes("fire") || id.includes("dark") || id.includes("meteor")) return "sawtooth";
  return "triangle";
}
