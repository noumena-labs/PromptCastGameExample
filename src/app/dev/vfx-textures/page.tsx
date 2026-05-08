"use client";

import { useEffect, useRef, useState } from "react";
import {
  GENERATORS,
  TEXTURE_SPECS,
  type TextureKind,
  type TextureSpec,
} from "./textureGenerators";

// Dev tool: generate VFX textures offline, preview them, and download as PNGs
// (or the whole set as a manifest). Not linked from the game UI.

type SeedMap = Record<TextureKind, number>;

const KINDS = Object.keys(TEXTURE_SPECS) as TextureKind[];

function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.putImageData(img, 0, 0);
  return c;
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function TexturePreview({
  spec,
  seed,
  onSeedChange,
}: {
  spec: TextureSpec;
  seed: number;
  onSeedChange: (v: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setGenerating(true);
    // Defer to next frame so the UI can paint "generating".
    const handle = requestAnimationFrame(() => {
      if (cancelled) return;
      const img = GENERATORS[spec.id]({ seed });
      const src = imageDataToCanvas(img);
      const dst = canvasRef.current;
      if (dst) {
        dst.width = img.width;
        dst.height = img.height;
        const ctx = dst.getContext("2d")!;
        ctx.clearRect(0, 0, dst.width, dst.height);
        ctx.drawImage(src, 0, 0);
      }
      setGenerating(false);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, [spec.id, seed]);

  return (
    <div className="vfx-card">
      <div className="vfx-card-header">
        <div>
          <div className="vfx-title">{spec.filename}</div>
          <div className="vfx-sub">
            {spec.width} × {spec.height}
          </div>
        </div>
        <button
          className="vfx-btn"
          onClick={() => {
            const c = canvasRef.current;
            if (c) downloadCanvas(c, spec.filename);
          }}
        >
          Download
        </button>
      </div>
      <div className="vfx-desc">{spec.description}</div>
      <div className="vfx-canvas-wrap">
        {/* Checkerboard for alpha visibility */}
        <div className="vfx-checker" />
        <canvas ref={canvasRef} className="vfx-canvas" />
        {generating ? <div className="vfx-overlay">generating…</div> : null}
      </div>
      <div className="vfx-controls">
        <label className="vfx-label">
          <span>seed</span>
          <input
            type="range"
            min={0}
            max={255}
            value={seed}
            onChange={(e) => onSeedChange(Number(e.target.value))}
          />
          <span className="vfx-num">{seed}</span>
        </label>
      </div>
    </div>
  );
}

export default function VfxTexturesPage() {
  const [seeds, setSeeds] = useState<SeedMap>(() => {
    const initial: Partial<SeedMap> = {};
    for (const k of KINDS) initial[k] = 11;
    return initial as SeedMap;
  });

  const downloadAll = async () => {
    for (const kind of KINDS) {
      const spec = TEXTURE_SPECS[kind];
      const img = GENERATORS[kind]({ seed: seeds[kind] });
      const canvas = imageDataToCanvas(img);
      // Stagger so the browser doesn't drop downloads.
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = spec.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }
          resolve();
        }, "image/png");
      });
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  const downloadManifest = () => {
    const manifest = {
      generatedAt: new Date().toISOString(),
      basePath: "/textures/vfx/",
      textures: KINDS.map((k) => ({
        id: k,
        filename: TEXTURE_SPECS[k].filename,
        width: TEXTURE_SPECS[k].width,
        height: TEXTURE_SPECS[k].height,
        description: TEXTURE_SPECS[k].description,
        seed: seeds[k],
      })),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vfx-textures.manifest.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="vfx-page">
      <header className="vfx-header">
        <h1>VFX Texture Generator</h1>
        <p>
          Procedural textures for three.quarks particles. Save the PNGs into{" "}
          <code>public/textures/vfx/</code>.
        </p>
        <div className="vfx-actions">
          <button className="vfx-btn vfx-btn-primary" onClick={downloadAll}>
            Download All
          </button>
          <button className="vfx-btn" onClick={downloadManifest}>
            Download Manifest JSON
          </button>
        </div>
      </header>

      <div className="vfx-grid">
        {KINDS.map((kind) => (
          <TexturePreview
            key={kind}
            spec={TEXTURE_SPECS[kind]}
            seed={seeds[kind]}
            onSeedChange={(v) =>
              setSeeds((prev) => ({ ...prev, [kind]: v }))
            }
          />
        ))}
      </div>

      <style jsx global>{`
        .vfx-page {
          min-height: 100vh;
          padding: 32px;
          background: var(--parchment, #f3ead0);
          color: var(--ink, #2a1f10);
          font-family: var(--font-serif, Georgia, serif);
        }
        .vfx-header h1 {
          margin: 0 0 8px;
          font-size: 28px;
          letter-spacing: 0.02em;
        }
        .vfx-header p {
          margin: 0 0 16px;
          opacity: 0.8;
        }
        .vfx-actions {
          display: flex;
          gap: 12px;
          margin-bottom: 24px;
        }
        .vfx-btn {
          background: transparent;
          border: 1px solid var(--ink, #2a1f10);
          color: var(--ink, #2a1f10);
          padding: 6px 14px;
          font-family: inherit;
          font-size: 13px;
          cursor: pointer;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .vfx-btn:hover {
          background: var(--ink, #2a1f10);
          color: var(--parchment, #f3ead0);
        }
        .vfx-btn-primary {
          background: var(--gold, #b8862b);
          border-color: var(--gold, #b8862b);
          color: #1a1208;
        }
        .vfx-btn-primary:hover {
          background: #d4a040;
          color: #1a1208;
        }
        .vfx-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }
        .vfx-card {
          background: rgba(255, 255, 255, 0.35);
          border: 1px solid rgba(42, 31, 16, 0.25);
          padding: 14px;
        }
        .vfx-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 6px;
        }
        .vfx-title {
          font-weight: 600;
          font-size: 14px;
        }
        .vfx-sub {
          font-size: 11px;
          opacity: 0.7;
        }
        .vfx-desc {
          font-size: 12px;
          opacity: 0.75;
          margin-bottom: 10px;
          min-height: 32px;
        }
        .vfx-canvas-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 1 / 1;
          background: #222;
          overflow: hidden;
        }
        .vfx-checker {
          position: absolute;
          inset: 0;
          background-image: linear-gradient(45deg, #555 25%, transparent 25%),
            linear-gradient(-45deg, #555 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #555 75%),
            linear-gradient(-45deg, transparent 75%, #555 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
          opacity: 0.4;
        }
        .vfx-canvas {
          position: relative;
          width: 100%;
          height: 100%;
          image-rendering: pixelated;
        }
        .vfx-overlay {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          background: rgba(0, 0, 0, 0.4);
          color: #fff;
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .vfx-controls {
          margin-top: 10px;
        }
        .vfx-label {
          display: grid;
          grid-template-columns: 50px 1fr 40px;
          gap: 8px;
          align-items: center;
          font-size: 12px;
        }
        .vfx-num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}
