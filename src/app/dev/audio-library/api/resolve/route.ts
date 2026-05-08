import { stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { audioCueById, audioFileCandidates, type AudioCueId } from "@/game/audio/audioCatalog";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const cueId = request.nextUrl.searchParams.get("cueId") as AudioCueId | null;
  if (!cueId || !audioCueById[cueId]) {
    return NextResponse.json({ error: "Unknown audio cue." }, { status: 400 });
  }

  for (const file of audioFileCandidates(audioCueById[cueId])) {
    if (await publicFileExists(file)) return NextResponse.json({ file });
  }

  return NextResponse.json({ file: null });
}

async function publicFileExists(publicPath: string): Promise<boolean> {
  const publicRoot = path.join(process.cwd(), "public");
  const filePath = path.normalize(path.join(publicRoot, publicPath));
  if (!filePath.startsWith(publicRoot)) return false;
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}
