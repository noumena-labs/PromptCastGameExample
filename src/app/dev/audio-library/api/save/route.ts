import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { audioCueById, audioGeneratedFile, type AudioCueId } from "@/game/audio/audioCatalog";

export const runtime = "nodejs";

const wavHeader = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

export async function POST(request: NextRequest) {
  const cueId = request.nextUrl.searchParams.get("cueId") as AudioCueId | null;
  if (!cueId || !audioCueById[cueId]) {
    return NextResponse.json({ error: "Unknown audio cue." }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("audio/wav") && !contentType.includes("application/octet-stream")) {
    return NextResponse.json({ error: "Expected audio/wav body." }, { status: 415 });
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 44 || !hasPrefix(bytes, wavHeader)) {
    return NextResponse.json({ error: "Invalid WAV file." }, { status: 400 });
  }

  const relativePublicPath = audioGeneratedFile(audioCueById[cueId], "wav");
  const publicRoot = path.join(process.cwd(), "public");
  const outputPath = path.normalize(path.join(publicRoot, relativePublicPath));
  if (!outputPath.startsWith(publicRoot)) {
    return NextResponse.json({ error: "Invalid output path." }, { status: 400 });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);

  return NextResponse.json({ file: relativePublicPath, bytes: bytes.length, savedAt: new Date().toISOString() });
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}
