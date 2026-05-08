"use client";

import { useEffect, useMemo, useState } from "react";
import { audioCatalog, audioFileCandidates, audioGeneratedFile, type AudioCue } from "@/game/audio/audioCatalog";
import { audioBufferToWav, renderProceduralCue } from "./proceduralAudio";

type Status = "checking" | "found" | "missing";
type StatusMap = Record<string, Status>;
type FileMap = Record<string, string>;
type SourceMap = Record<string, string>;
type PromptMap = Record<string, string>;

const groups = ["ui", "sfx", "music", "ambience"] as const;

export default function AudioLibraryPage() {
  const [statuses, setStatuses] = useState<StatusMap>(() => Object.fromEntries(audioCatalog.map((cue) => [cue.id, "checking"])));
  const [generating, setGenerating] = useState<string | null>(null);
  const [provider, setProvider] = useState<"procedural" | "elevenlabs" | null>(null);
  const [files, setFiles] = useState<FileMap>({});
  const [sources, setSources] = useState<SourceMap>({});
  const [promptOverrides, setPromptOverrides] = useState<PromptMap>({});
  const [error, setError] = useState<string | null>(null);
  const counts = useMemo(() => {
    const found = Object.values(statuses).filter((status) => status === "found").length;
    return { found, missing: audioCatalog.length - found, total: audioCatalog.length };
  }, [statuses]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      audioCatalog.map(async (cue) => {
        try {
          const result = await checkCueFile(cue);
          return [cue.id, result.status, result.file, result.source] as const;
        } catch {
          return [cue.id, "missing", audioGeneratedFile(cue, "mp3"), "missing"] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setStatuses(Object.fromEntries(entries.map(([id, status]) => [id, status])));
      setFiles(Object.fromEntries(entries.flatMap(([id, status, file]) => (status === "found" && file ? [[id, file]] : []))));
      setSources(Object.fromEntries(entries.map(([id, , , source]) => [id, source])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const generateAndSave = async (cue: AudioCue) => {
    setGenerating(cue.id);
    setProvider("procedural");
    setError(null);
    try {
      const buffer = await renderProceduralCue(cue);
      const blob = audioBufferToWav(buffer);
      const response = await fetch(`/dev/audio-library/api/save?cueId=${encodeURIComponent(cue.id)}`, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: blob,
      });
      const payload = await response.json() as { file?: string; error?: string };
      if (!response.ok || !payload.file) throw new Error(payload.error ?? "Unable to save generated audio.");
      const cacheBusted = `${payload.file}?v=${Date.now()}`;
      setStatuses((current) => ({ ...current, [cue.id]: "found" }));
      setFiles((current) => ({ ...current, [cue.id]: cacheBusted }));
      setSources((current) => ({ ...current, [cue.id]: "procedural wav" }));
    } finally {
      setGenerating(null);
      setProvider(null);
    }
  };

  const generateElevenLabs = async (cue: AudioCue, force = true) => {
    setGenerating(cue.id);
    setProvider("elevenlabs");
    setError(null);
    try {
      const response = await fetch("/dev/audio-library/api/elevenlabs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cueId: cue.id,
          prompt: promptOverrides[cue.id] || cue.sourcePrompt,
          durationSeconds: durationSecondsForCue(cue),
          promptInfluence: cue.promptInfluence,
          force,
        }),
      });
      const payload = await response.json() as { file?: string; error?: string };
      if (!response.ok || !payload.file) throw new Error(payload.error ?? "Unable to generate ElevenLabs audio.");
      const cacheBusted = `${payload.file}?v=${Date.now()}`;
      setStatuses((current) => ({ ...current, [cue.id]: "found" }));
      setFiles((current) => ({ ...current, [cue.id]: cacheBusted }));
      setSources((current) => ({ ...current, [cue.id]: "elevenlabs mp3" }));
    } finally {
      setGenerating(null);
      setProvider(null);
    }
  };

  const downloadManifest = () => {
    downloadBlob(
      new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), audio: audioCatalog }, null, 2)], { type: "application/json" }),
      "audio-library.manifest.json",
    );
  };

  const generateMissing = async (mode: "procedural" | "elevenlabs") => {
    if (mode === "elevenlabs" && !window.confirm(`Generate ${counts.missing} missing cues with ElevenLabs? This may consume ElevenLabs credits.`)) return;
    setError(null);
    try {
      for (const cue of audioCatalog) {
        if (statuses[cue.id] === "found") continue;
        setGenerating(cue.id);
        setProvider(mode);
        if (mode === "elevenlabs") {
          await generateElevenLabs(cue, false);
        } else {
          const buffer = await renderProceduralCue(cue);
          const blob = audioBufferToWav(buffer);
          const response = await fetch(`/dev/audio-library/api/save?cueId=${encodeURIComponent(cue.id)}`, {
            method: "POST",
            headers: { "content-type": "audio/wav" },
            body: blob,
          });
          const payload = await response.json() as { file?: string; error?: string };
          if (!response.ok || !payload.file) throw new Error(payload.error ?? `Unable to save ${cue.id}.`);
          const cacheBusted = `${payload.file}?v=${Date.now()}`;
          setStatuses((current) => ({ ...current, [cue.id]: "found" }));
          setFiles((current) => ({ ...current, [cue.id]: cacheBusted }));
          setSources((current) => ({ ...current, [cue.id]: "procedural wav" }));
        }
        await new Promise((resolve) => window.setTimeout(resolve, 90));
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save generated audio.");
    } finally {
      setGenerating(null);
      setProvider(null);
    }
  };

  return (
    <main className="audioPage">
      <header className="audioHeader">
        <div>
          <h1>Audio Library</h1>
          <p>
            Source list, prompts, preview, procedural placeholders, and ElevenLabs generation saved directly into <code>public/audio</code>.
          </p>
          <p className="audioCount">
            {counts.found} found · {counts.missing} missing · {counts.total} total
          </p>
        </div>
        <div className="audioActions">
          <button type="button" onClick={() => void generateMissing("elevenlabs")} disabled={generating !== null || counts.missing === 0}>
            ElevenLabs Missing
          </button>
          <button type="button" onClick={() => void generateMissing("procedural")} disabled={generating !== null || counts.missing === 0}>
            Procedural Missing
          </button>
          <button type="button" onClick={downloadManifest}>
            Download Manifest
          </button>
        </div>
      </header>
      {error ? <div className="audioError">{error}</div> : null}

      {groups.map((group) => {
        const cues = audioCatalog.filter((cue) => cue.group === group);
        return (
          <section key={group} className="audioSection">
            <h2>{group}</h2>
            <div className="audioGrid">
              {cues.map((cue) => (
                <article key={cue.id} className="audioCard" data-status={statuses[cue.id]}>
                  <div className="audioCardHeader">
                    <div>
                      <h3>{cue.id}</h3>
                      <span>{cue.loop ? "loop" : "one-shot"} · {cue.generationKind} · {durationSecondsForCue(cue)}s</span>
                    </div>
                    <strong>{statuses[cue.id]}</strong>
                  </div>
                  <p>{cue.description}</p>
                  <code>{cue.file}</code>
                  <div className="audioSource">source: {sources[cue.id] ?? "checking"}</div>
                  <label>
                    ElevenLabs prompt
                    <textarea
                      value={promptOverrides[cue.id] ?? cue.sourcePrompt}
                      rows={4}
                      onChange={(event) => setPromptOverrides((current) => ({ ...current, [cue.id]: event.target.value }))}
                    />
                  </label>
                  <div className="audioCardActions">
                    {statuses[cue.id] === "found" && files[cue.id] ? <audio key={files[cue.id]} controls src={files[cue.id]} preload="metadata" /> : null}
                    <button type="button" onClick={() => void generateElevenLabs(cue).catch((saveError) => setError(saveError instanceof Error ? saveError.message : "Unable to generate ElevenLabs audio."))} disabled={generating !== null}>
                      {generating === cue.id && provider === "elevenlabs" ? "ElevenLabs..." : statuses[cue.id] === "found" ? "Regen 11Labs" : "Generate 11Labs"}
                    </button>
                    <button type="button" onClick={() => void generateAndSave(cue).catch((saveError) => setError(saveError instanceof Error ? saveError.message : "Unable to save generated audio."))} disabled={generating !== null}>
                      {generating === cue.id && provider === "procedural" ? "Procedural..." : statuses[cue.id] === "found" ? "Regen Proc" : "Generate Proc"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      <style jsx>{`
        .audioPage { min-height: 100vh; padding: 32px; background: #16100b; color: #f2dfbd; font-family: Georgia, serif; }
        .audioHeader { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 28px; }
        h1, h2, h3, p { margin: 0; }
        h1 { font-size: 34px; }
        h2 { margin: 28px 0 14px; text-transform: uppercase; letter-spacing: 0.12em; color: #d7a64a; }
        .audioHeader p { margin-top: 8px; color: #cbb58e; }
        .audioCount { font-size: 14px; }
        .audioError { border: 1px solid rgba(230, 98, 72, 0.75); background: rgba(230, 98, 72, 0.12); color: #ffb4a5; padding: 12px 14px; margin-bottom: 18px; }
        .audioActions { display: flex; gap: 12px; flex-wrap: wrap; }
        button { border: 1px solid #c99742; background: #c99742; color: #1a1208; padding: 8px 13px; cursor: pointer; font-family: inherit; text-transform: uppercase; letter-spacing: 0.06em; }
        button:disabled { opacity: 0.45; cursor: wait; }
        .audioGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }
        .audioCard { border: 1px solid rgba(215, 166, 74, 0.45); background: rgba(255, 239, 199, 0.06); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .audioCard[data-status="missing"] { border-color: rgba(230, 98, 72, 0.65); }
        .audioCard[data-status="found"] { border-color: rgba(118, 214, 142, 0.7); }
        .audioCardHeader { display: flex; justify-content: space-between; gap: 12px; }
        .audioCardHeader span, .audioCard p, label { color: #cbb58e; font-size: 13px; }
        .audioCardHeader strong { text-transform: uppercase; font-size: 11px; letter-spacing: 0.12em; }
        .audioSource { color: #e2bc74; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
        code { display: block; padding: 7px; background: rgba(0,0,0,0.25); color: #ffe9b0; overflow-wrap: anywhere; }
        label { display: grid; gap: 6px; }
        textarea { resize: vertical; min-height: 58px; background: rgba(0,0,0,0.22); color: #f2dfbd; border: 1px solid rgba(215, 166, 74, 0.35); padding: 8px; font-family: Consolas, monospace; }
        .audioCardActions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        audio { max-width: 230px; height: 34px; }
        @media (max-width: 720px) { .audioPage { padding: 18px; } .audioHeader { display: block; } .audioActions { margin-top: 16px; } }
      `}</style>
    </main>
  );
}

async function checkCueFile(cue: AudioCue): Promise<{ status: Status; file: string; source: string }> {
  const candidates = audioFileCandidates(cue);
  for (const file of candidates) {
    const response = await fetch(file, { method: "HEAD", cache: "no-store" });
    if (response.ok) return { status: "found", file, source: sourceLabel(file) };
  }
  return { status: "missing", file: audioGeneratedFile(cue, "mp3"), source: "missing" };
}

function sourceLabel(file: string): string {
  if (file.endsWith(".ogg")) return "final ogg";
  if (file.endsWith(".mp3")) return "elevenlabs mp3";
  if (file.endsWith(".wav")) return "procedural wav";
  return "unknown";
}

function durationSecondsForCue(cue: AudioCue): number {
  const durationMs = cue.generationKind === "music" ? Math.max(3000, cue.durationHintMs) : Math.max(500, Math.min(30000, cue.durationHintMs));
  return Number((durationMs / 1000).toFixed(2));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
