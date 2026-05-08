import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { audioCueById, audioGeneratedFile, type AudioCue, type AudioCueId } from "@/game/audio/audioCatalog";

export const runtime = "nodejs";
export const maxDuration = 120;

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const OUTPUT_FORMAT = "mp3_44100_128";

type RequestBody = {
  cueId?: string;
  prompt?: string;
  durationSeconds?: number;
  promptInfluence?: number;
  force?: boolean;
};

type ManifestEntry = {
  cueId: AudioCueId;
  provider: "elevenlabs";
  endpoint: string;
  modelId: string;
  outputFormat: string;
  file: string;
  prompt: string;
  durationMs: number;
  generatedAt: string;
  bytes: number;
};

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing ELEVENLABS_API_KEY in .env.local." }, { status: 500 });
    }

    const body = await request.json() as RequestBody;
    const cueId = body.cueId as AudioCueId | undefined;
    if (!cueId || !audioCueById[cueId]) {
      return NextResponse.json({ error: "Unknown audio cue." }, { status: 400 });
    }

    const cue = audioCueById[cueId];
    const relativePublicPath = audioGeneratedFile(cue, "mp3");
    const outputPath = resolvePublicPath(relativePublicPath);
    if (!body.force && await exists(outputPath)) {
      return NextResponse.json({ error: "File already exists. Regenerate with force enabled.", file: relativePublicPath }, { status: 409 });
    }

    const prompt = normalizePrompt(body.prompt || cue.sourcePrompt, cue);
    const durationMs = generationDurationMs(cue, body.durationSeconds);
    const generated = await generateElevenLabsAudio({
      apiKey,
      cue,
      prompt,
      durationMs,
      promptInfluence: clamp01(body.promptInfluence ?? cue.promptInfluence ?? 0.45),
    });

    if (generated.bytes.length < 128) {
      return NextResponse.json({ error: "ElevenLabs returned an unexpectedly small audio payload." }, { status: 502 });
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated.bytes);

    const entry: ManifestEntry = {
      cueId,
      provider: "elevenlabs",
      endpoint: generated.endpoint,
      modelId: generated.modelId,
      outputFormat: OUTPUT_FORMAT,
      file: relativePublicPath,
      prompt,
      durationMs,
      generatedAt: new Date().toISOString(),
      bytes: generated.bytes.length,
    };
    await appendManifest(entry);

    return NextResponse.json({ file: relativePublicPath, bytes: generated.bytes.length, savedAt: entry.generatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to generate ElevenLabs audio." },
      { status: 500 },
    );
  }
}

async function generateElevenLabsAudio({
  apiKey,
  cue,
  prompt,
  durationMs,
  promptInfluence,
}: {
  apiKey: string;
  cue: AudioCue;
  prompt: string;
  durationMs: number;
  promptInfluence: number;
}): Promise<{ bytes: Uint8Array; endpoint: string; modelId: string }> {
  if (cue.generationKind === "music") {
    const endpoint = `${ELEVENLABS_BASE_URL}/music?output_format=${OUTPUT_FORMAT}`;
    const modelId = "music_v1";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        prompt,
        music_length_ms: Math.max(3000, Math.min(600000, durationMs)),
        model_id: modelId,
        force_instrumental: true,
      }),
    });
    return handleElevenLabsResponse(response, endpoint, modelId);
  }

  const endpoint = `${ELEVENLABS_BASE_URL}/sound-generation?output_format=${OUTPUT_FORMAT}`;
  const modelId = "eleven_text_to_sound_v2";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: prompt,
      loop: cue.loop === true,
      duration_seconds: Math.max(0.5, Math.min(30, durationMs / 1000)),
      prompt_influence: promptInfluence,
      model_id: modelId,
    }),
  });
  return handleElevenLabsResponse(response, endpoint, modelId);
}

async function handleElevenLabsResponse(response: Response, endpoint: string, modelId: string) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    const message = new TextDecoder().decode(bytes).slice(0, 800) || response.statusText;
    throw new Error(`ElevenLabs generation failed (${response.status}): ${message}`);
  }
  return { bytes, endpoint, modelId };
}

function generationDurationMs(cue: AudioCue, overrideSeconds?: number): number {
  if (typeof overrideSeconds === "number" && Number.isFinite(overrideSeconds)) {
    return Math.round(Math.max(0.5, overrideSeconds) * 1000);
  }
  if (cue.generationKind === "music") return Math.max(3000, cue.durationHintMs);
  return Math.max(500, Math.min(30000, cue.durationHintMs));
}

function normalizePrompt(prompt: string, cue: AudioCue): string {
  const suffix = cue.generationKind === "music"
    ? "Instrumental, loopable, no vocals, no spoken words, game soundtrack, seamless ending."
    : "Clean game-ready sound effect, no voice, no speech, no music bed, dry enough for gameplay mixing.";
  return `${prompt.trim()}. ${suffix}`.slice(0, 950);
}

function resolvePublicPath(relativePublicPath: string): string {
  const publicRoot = path.join(process.cwd(), "public");
  const outputPath = path.normalize(path.join(publicRoot, relativePublicPath));
  if (!outputPath.startsWith(publicRoot)) throw new Error("Invalid output path.");
  return outputPath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function appendManifest(entry: ManifestEntry) {
  const manifestPath = resolvePublicPath("/audio/audio-generation.manifest.json");
  let entries: ManifestEntry[] = [];
  try {
    entries = JSON.parse(await readFile(manifestPath, "utf8")) as ManifestEntry[];
  } catch {
    entries = [];
  }
  const next = [entry, ...entries.filter((item) => item.cueId !== entry.cueId)].slice(0, 250);
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
