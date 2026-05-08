import type { CogentEngine } from "cogentlm";
import { runSpellPipeline, type PipelineProgress, type PipelineStage } from "@/game/ai/pipeline";
import { SpellGenerationError } from "@/game/ai/spellGenerationError";
import { spellLog } from "@/game/ai/spellLog";
import type { GeneratedSpell } from "@/game/types";

/**
 * Public entry point for spell generation.
 *
 * This module owns the singletons (engine + model load promise + progress
 * fan-out) and delegates the actual prompt → spell work to the multi-call
 * pipeline in `./pipeline`. The previous single-call implementation lived
 * here; it was retired when the grammar-driven pipeline landed.
 */

/**
 * Local mirror of cogentlm's `ModelLoadProgress` (not re-exported from the
 * barrel). Keep in sync with `cogentlm/dist/types/model-management/model-types.d.ts`.
 */
export type ModelLoadProgress = {
  phase: "metadata" | "download" | "store" | "load";
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  assetName?: string;
};

/**
 * Hard-coded GGUF model. Loaded once via OPFS-cached download and
 * reused for the lifetime of the page. We deliberately pin the model so the
 * Sage's voice is consistent across players in a P2P match. The Instruct
 * variant is better suited to our grammar-constrained JSON pipeline than the
 * Thinking variant, which tends to leak reasoning tokens into structured calls.
 */
export const MODEL_URL = "https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF/resolve/main/LFM2.5-1.2B-Instruct-Q4_K_M.gguf?download=true";

let enginePromise: Promise<CogentEngine> | null = null;
let modelLoadPromise: Promise<void> | null = null;
let engineDiagnosticsAttached = false;

type BrowserNavigator = Navigator & {
  deviceMemory?: number;
  gpu?: unknown;
  storage?: StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
};

type CogentDiagnosticEntry = {
  t: number;
  event: string;
  data?: Record<string, unknown>;
};

declare global {
  interface Window {
    __promptcastCogentDiagnostics?: CogentDiagnosticEntry[];
  }
}

const DIAGNOSTIC_PREFIX = "[CogentLoad]";
const DIAGNOSTIC_STORAGE_KEY = "promptcast.cogentDiagnostics";
const DIAGNOSTIC_ENABLE_STORAGE_KEY = "promptcast.cogentDebug";
const DIAGNOSTIC_ENTRY_LIMIT = 80;
const PROGRESS_LOG_INTERVAL_MS = 10_000;
const PROGRESS_LOG_PERCENT_STEP = 10;
const COGENT_STORAGE_DIR = "cogent-models";
const COGENT_REGISTRY_FILE = "registry.json";

type RemoteModelMetadata = {
  canonicalUrl: string;
  name: string;
  bytes: number;
  etag: string;
  lastModified: string;
};

type CogentAssetRecord = {
  id: string;
  kind: "model" | "projector" | "shard";
  name: string;
  hash: string;
  bytes: number;
  storagePath: string;
  sourceUrl?: string;
  sourceEtag?: string;
  sourceLastModified?: string;
  refCount: number;
  createdAt: string;
  inspection?: unknown;
};

type CogentRegistryManifest = {
  version: 3;
  projectorIndexRevision: number;
  assets: Record<string, CogentAssetRecord>;
  models: Record<string, unknown>;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
};

let diagnosticEntries: CogentDiagnosticEntry[] = [];
let diagnosticLoggingEnabled: boolean | null = null;
let modelLoadStartedAt = 0;
let phaseStartedAt = 0;
let activeProgressPhase: ModelLoadProgress["phase"] | null = null;
let lastProgressLogAt = 0;
let lastProgressLogPercent: number | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function elapsedSince(startedAt: number): number | null {
  return startedAt > 0 ? Math.round(nowMs() - startedAt) : null;
}

function isCogentDebugLoggingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (diagnosticLoggingEnabled !== null) return diagnosticLoggingEnabled;

  try {
    const params = new URLSearchParams(window.location.search);
    diagnosticLoggingEnabled =
      process.env.NODE_ENV !== "production" ||
      params.has("debugCogent") ||
      window.localStorage.getItem(DIAGNOSTIC_ENABLE_STORAGE_KEY) === "1";
  } catch {
    diagnosticLoggingEnabled = process.env.NODE_ENV !== "production";
  }

  return diagnosticLoggingEnabled;
}

function persistCogentDiagnostics(): void {
  if (typeof window === "undefined") return;
  window.__promptcastCogentDiagnostics = diagnosticEntries;
  try {
    window.localStorage.setItem(DIAGNOSTIC_STORAGE_KEY, JSON.stringify(diagnosticEntries));
  } catch {
    // Storage may be disabled or full; console diagnostics still work.
  }
}

function recordCogentDiagnostic(event: string, data?: Record<string, unknown>): void {
  const entry: CogentDiagnosticEntry = { t: Date.now(), event, data };
  diagnosticEntries = [...diagnosticEntries.slice(-(DIAGNOSTIC_ENTRY_LIMIT - 1)), entry];
  persistCogentDiagnostics();

  if (isCogentDebugLoggingEnabled()) {
    if (data) {
      console.info(DIAGNOSTIC_PREFIX, event, data);
    } else {
      console.info(DIAGNOSTIC_PREFIX, event);
    }
  }
}

function getBrowserDiagnostics(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const nav = navigator as BrowserNavigator;
  return {
    origin: window.location.origin,
    path: window.location.pathname,
    userAgent: navigator.userAgent,
    crossOriginIsolated: window.crossOriginIsolated,
    isSecureContext: window.isSecureContext,
    hasWorker: typeof Worker === "function",
    hasWebAssembly: typeof WebAssembly === "object",
    hasSharedArrayBuffer: typeof SharedArrayBuffer === "function",
    hasAtomics: typeof Atomics === "object",
    hasOpfs: typeof nav.storage?.getDirectory === "function",
    hasWebGpu: nav.gpu !== undefined,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
  };
}

function normalizeAssetName(name: string): string {
  const trimmed = name.trim();
  return (trimmed.length > 0 ? trimmed : "model.gguf").replace(/[\\/:*?"<>|]+/g, "-");
}

function fileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.href : undefined);
    return normalizeAssetName(decodeURIComponent(parsed.pathname.split("/").pop() || "model.gguf"));
  } catch {
    return normalizeAssetName(url.split("/").pop()?.split("?")[0] ?? "model.gguf");
  }
}

function syntheticAssetHash(metadata: RemoteModelMetadata): string {
  return `remote-${metadata.bytes}-${metadata.etag || metadata.lastModified}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function emptyCogentManifest(): CogentRegistryManifest {
  return { version: 3, projectorIndexRevision: 0, assets: {}, models: {} };
}

function parseCogentManifest(text: string | null): CogentRegistryManifest {
  if (!text) return emptyCogentManifest();
  const parsed = JSON.parse(text) as CogentRegistryManifest;
  if (parsed.version !== 3 || typeof parsed.assets !== "object" || typeof parsed.models !== "object") {
    throw new Error("Cogent registry is not manifest version 3.");
  }
  return parsed;
}

async function readTextFile(dir: FileSystemDirectoryHandle, fileName: string): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(fileName);
    return await (await handle.getFile()).text();
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") return null;
    throw err;
  }
}

async function writeTextFile(dir: FileSystemDirectoryHandle, fileName: string, text: string): Promise<void> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // ignore abort failure
    }
    throw err;
  }
}

async function getCogentStorageRoot(): Promise<FileSystemDirectoryHandle> {
  const getDirectory = (navigator as BrowserNavigator).storage?.getDirectory;
  if (!getDirectory) throw new Error("OPFS is unavailable.");
  const root = await getDirectory.call(navigator.storage);
  return root.getDirectoryHandle(COGENT_STORAGE_DIR, { create: true });
}

async function resolveRemoteModelMetadata(signal?: AbortSignal): Promise<RemoteModelMetadata> {
  let response: Response;
  try {
    response = await fetch(MODEL_URL, { method: "HEAD", signal });
  } catch (err) {
    throw new Error("Unable to read model metadata.", { cause: err });
  }
  if (!response.ok) throw new Error(`Unable to read model metadata (HTTP ${response.status}).`);

  const bytes = Number.parseInt(response.headers.get("Content-Length") ?? "", 10);
  const etag = response.headers.get("ETag")?.trim() ?? "";
  const lastModified = response.headers.get("Last-Modified")?.trim() ?? "";
  if (!Number.isFinite(bytes) || bytes <= 0 || (etag.length === 0 && lastModified.length === 0)) {
    throw new Error("Model metadata is missing Content-Length, ETag, or Last-Modified.");
  }

  return {
    canonicalUrl: new URL(MODEL_URL, window.location.href).toString(),
    name: fileNameFromUrl(MODEL_URL),
    bytes,
    etag,
    lastModified,
  };
}

function findRegisteredRemoteAsset(
  manifest: CogentRegistryManifest,
  metadata: RemoteModelMetadata,
): CogentAssetRecord | null {
  return Object.values(manifest.assets).find((asset) => (
    asset.kind === "model" &&
    asset.sourceUrl === metadata.canonicalUrl &&
    asset.sourceEtag === metadata.etag &&
    asset.sourceLastModified === metadata.lastModified &&
    asset.bytes === metadata.bytes
  )) ?? null;
}

async function getOpfsFile(dir: FileSystemDirectoryHandle, fileName: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(fileName)).getFile();
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") return null;
    throw err;
  }
}

async function findReusableOpfsModelFile(
  dir: FileSystemDirectoryHandle,
  metadata: RemoteModelMetadata,
): Promise<string | null> {
  const entries = (dir as IterableDirectoryHandle).entries;
  if (!entries) return null;

  for await (const [fileName, handle] of entries.call(dir)) {
    if (handle.kind !== "file" || !fileName.endsWith(metadata.name)) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    if (file.size === metadata.bytes) {
      recordCogentDiagnostic("asset:direct-register:reuse-opfs-file", { fileName, bytes: file.size });
      return fileName;
    }
  }

  return null;
}

async function streamRemoteModelToOpfs(
  dir: FileSystemDirectoryHandle,
  storagePath: string,
  metadata: RemoteModelMetadata,
  signal: AbortSignal | undefined,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(metadata.canonicalUrl, { signal });
  } catch (err) {
    throw new Error("Failed to download model.", { cause: err });
  }
  if (!response.ok || !response.body) throw new Error(`Failed to download model (HTTP ${response.status}).`);

  const handle = await dir.getFileHandle(storagePath, { create: true });
  const writable = await handle.createWritable();
  try {
    let written = 0;
    const reader = response.body.getReader();
    while (true) {
      if (signal?.aborted) throw new DOMException("Model download aborted.", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await writable.write(value);
      written += value.byteLength;
      broadcastProgress({
        phase: "download",
        loadedBytes: written,
        totalBytes: metadata.bytes,
        percent: Math.min(100, Math.round((written / metadata.bytes) * 100)),
        assetName: metadata.name,
      });
    }
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // ignore abort failure
    }
    try {
      await dir.removeEntry(storagePath);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

async function ensureRemoteModelRegistered(signal?: AbortSignal): Promise<boolean> {
  if (typeof window === "undefined") return false;

  recordCogentDiagnostic("asset:direct-register:start");
  broadcastProgress({ phase: "metadata", loadedBytes: 0, totalBytes: null, percent: null, assetName: MODEL_URL });

  const metadata = await resolveRemoteModelMetadata(signal);
  const dir = await getCogentStorageRoot();
  const manifest = parseCogentManifest(await readTextFile(dir, COGENT_REGISTRY_FILE));
  const existing = findRegisteredRemoteAsset(manifest, metadata);
  if (existing) {
    const existingFile = await getOpfsFile(dir, existing.storagePath);
    if (existingFile?.size === existing.bytes) {
      recordCogentDiagnostic("asset:direct-register:existing", {
        storagePath: existing.storagePath,
        bytes: existing.bytes,
      });
      return true;
    }
  }

  const id = `asset-${syntheticAssetHash(metadata)}`;
  let storagePath = `${id}-${metadata.name}`;
  const cachedFile = await getOpfsFile(dir, storagePath);
  if (cachedFile?.size !== metadata.bytes) {
    storagePath = await findReusableOpfsModelFile(dir, metadata) ?? storagePath;
    const reusableFile = await getOpfsFile(dir, storagePath);
    if (reusableFile?.size !== metadata.bytes) {
      await streamRemoteModelToOpfs(dir, storagePath, metadata, signal);
    }
  }

  broadcastProgress({
    phase: "store",
    loadedBytes: metadata.bytes,
    totalBytes: metadata.bytes,
    percent: 100,
    assetName: metadata.name,
  });

  const now = new Date().toISOString();
  manifest.assets[id] = {
    id,
    kind: "model",
    name: metadata.name,
    hash: syntheticAssetHash(metadata),
    bytes: metadata.bytes,
    storagePath,
    sourceUrl: metadata.canonicalUrl,
    sourceEtag: metadata.etag,
    sourceLastModified: metadata.lastModified,
    refCount: manifest.assets[id]?.refCount ?? 0,
    createdAt: manifest.assets[id]?.createdAt ?? now,
  };
  await writeTextFile(dir, COGENT_REGISTRY_FILE, JSON.stringify(manifest, null, 2));
  recordCogentDiagnostic("asset:direct-register:done", { id, storagePath, bytes: metadata.bytes });
  return true;
}

function summarizeModelInfo(model: ReturnType<CogentEngine["models"]["current"]>): Record<string, unknown> | null {
  if (!model) return null;
  return {
    id: model.id,
    name: model.name,
    source: model.source,
    status: model.status,
    bytes: model.bytes,
    loaded: model.loaded,
  };
}

function attachEngineDiagnostics(engine: CogentEngine): void {
  if (engineDiagnosticsAttached) return;
  engineDiagnosticsAttached = true;
  try {
    engine.observability.subscribe((event) => {
      recordCogentDiagnostic(`observability:${event.type}`, {
        state: event.snapshot.state,
        mode: event.snapshot.mode,
        model: summarizeModelInfo(event.snapshot.model),
        queryStatus: event.snapshot.query?.status,
        errorCode: event.snapshot.query?.errorCode,
        errorMessage: event.snapshot.query?.errorMessage,
        elapsedMs: elapsedSince(modelLoadStartedAt),
      });
    });
  } catch (err) {
    recordCogentDiagnostic("observability:subscribe-failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function shouldLogProgressSnapshot(progress: ModelLoadProgress, force = false): boolean {
  const now = nowMs();
  const percent = progress.percent ?? null;
  const percentAdvanced =
    percent !== null &&
    (lastProgressLogPercent === null || Math.abs(percent - lastProgressLogPercent) >= PROGRESS_LOG_PERCENT_STEP);
  const intervalElapsed = now - lastProgressLogAt >= PROGRESS_LOG_INTERVAL_MS;

  if (!force && !percentAdvanced && !intervalElapsed) return false;

  lastProgressLogAt = now;
  lastProgressLogPercent = percent;
  return true;
}

function recordProgressDiagnostic(progress: ModelLoadProgress): void {
  const now = nowMs();
  const phaseChanged = progress.phase !== activeProgressPhase;
  const previousPhase = activeProgressPhase;
  const previousPhaseElapsedMs = elapsedSince(phaseStartedAt);

  if (phaseChanged) {
    activeProgressPhase = progress.phase;
    phaseStartedAt = now;
    lastProgressLogAt = 0;
    lastProgressLogPercent = null;
  }

  if (!shouldLogProgressSnapshot(progress, phaseChanged)) return;

  recordCogentDiagnostic(phaseChanged ? "progress:phase" : "progress:update", {
    phase: progress.phase,
    previousPhase,
    previousPhaseElapsedMs,
    loadedBytes: progress.loadedBytes,
    totalBytes: progress.totalBytes,
    percent: progress.percent,
    assetName: progress.assetName,
    loadElapsedMs: elapsedSince(modelLoadStartedAt),
    phaseElapsedMs: elapsedSince(phaseStartedAt),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress fan-out: many UI surfaces want to observe the single in-flight load.
// ─────────────────────────────────────────────────────────────────────────────
type ProgressListener = (progress: ModelLoadProgress) => void;
const progressListeners = new Set<ProgressListener>();
let lastProgress: ModelLoadProgress | null = null;

function broadcastProgress(progress: ModelLoadProgress): void {
  recordProgressDiagnostic(progress);
  lastProgress = progress;
  for (const listener of progressListeners) listener(progress);
}

/**
 * Streamed progress shape exposed to the UI. The pipeline emits richer
 * `PipelineProgress` events; we narrow them here so the existing
 * PromptOverlay contract (`reasoning`, `phase`) keeps working.
 */
export type SpellGenerationProgress = {
  /** Reserved for optional explanation text; currently empty for JSON-only calls. */
  reasoning: string;
  /** Phase of the streaming response. */
  phase: "writing" | "done";
  /** Pipeline stage emitting this update. */
  stage: PipelineProgress["stage"];
  /** Newly emitted tokens since the last progress event. */
  tokenDelta: string;
  /** Set on stage start — UI inserts a header/separator. */
  segmentStart?: { stage: PipelineStage; attempt?: number; retryReason?: string };
  /** Snapshot of every completed stage's final raw buffer. */
  outputs: Partial<Record<PipelineStage, string>>;
};

export type SpellGenerationResult = {
  spell: GeneratedSpell;
  /** Full reasoning string captured during streaming. */
  reasoning: string;
};

/** Lazy access to the engine. Caller is expected to await `ensureModelLoaded`. */
export async function getCogentEngine(): Promise<CogentEngine> {
  if (!enginePromise) {
    recordCogentDiagnostic("engine:create:start", getBrowserDiagnostics());
    const startedAt = nowMs();
    enginePromise = import("cogentlm")
      .then(({ CogentEngine }) => CogentEngine.create({ executionMode: "worker" }))
      .then((engine) => {
        attachEngineDiagnostics(engine);
        recordCogentDiagnostic("engine:create:done", { elapsedMs: elapsedSince(startedAt) });
        return engine;
      })
      .catch((err) => {
        enginePromise = null;
        recordCogentDiagnostic("engine:create:error", {
          elapsedMs: elapsedSince(startedAt),
          message: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : undefined,
        });
        throw err;
      });
  }
  return enginePromise;
}

/**
 * Loads (or no-ops if already loaded) the LFM2 model. Subsequent calls return
 * the same in-flight promise so the loader UI can await this safely from many
 * places without re-downloading. Optional `onProgress` listener receives
 * `ModelLoadProgress` events; if a snapshot already exists it is replayed
 * synchronously before this function returns.
 */
export async function ensureModelLoaded(onProgress?: ProgressListener): Promise<void> {
  if (onProgress) {
    progressListeners.add(onProgress);
    if (lastProgress) onProgress(lastProgress);
  }
  if (!modelLoadPromise) {
    modelLoadStartedAt = nowMs();
    phaseStartedAt = modelLoadStartedAt;
    activeProgressPhase = null;
    lastProgressLogAt = 0;
    lastProgressLogPercent = null;
    recordCogentDiagnostic("model:ensure:start", getBrowserDiagnostics());
    modelLoadPromise = (async () => {
      try {
        const engine = await getCogentEngine();
        const current = engine.models.current();
        recordCogentDiagnostic("model:current", {
          model: summarizeModelInfo(current),
          elapsedMs: elapsedSince(modelLoadStartedAt),
        });
        if (!current) {
          recordCogentDiagnostic("model:load:start", {
            modelUrlHost: new URL(MODEL_URL).host,
            elapsedMs: elapsedSince(modelLoadStartedAt),
          });
          await ensureRemoteModelRegistered();
          await engine.models.load(MODEL_URL, { onProgress: broadcastProgress });
          recordCogentDiagnostic("model:load:done", {
            model: summarizeModelInfo(engine.models.current()),
            elapsedMs: elapsedSince(modelLoadStartedAt),
          });
        }
      } catch (err) {
        modelLoadPromise = null;
        recordCogentDiagnostic("model:load:error", {
          elapsedMs: elapsedSince(modelLoadStartedAt),
          phase: activeProgressPhase,
          phaseElapsedMs: elapsedSince(phaseStartedAt),
          message: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : undefined,
        });
        throw err;
      }
    })();
  } else {
    recordCogentDiagnostic("model:ensure:reuse", {
      lastPhase: activeProgressPhase,
      elapsedMs: elapsedSince(modelLoadStartedAt),
    });
  }
  return modelLoadPromise;
}

/** Detach a progress listener previously passed to `ensureModelLoaded`. */
export function unsubscribeModelProgress(listener: ProgressListener): void {
  progressListeners.delete(listener);
}

/**
 * Streams a spell generation through the multi-call pipeline. Resolves with
 * the final balanced spell. Throws `SpellGenerationError` on any failure;
 * the caller is expected to surface diagnostics and offer a Repair retry.
 */
export async function generateSpellFromPrompt(
  prompt: string,
  onProgress?: (progress: SpellGenerationProgress) => void,
  signal?: AbortSignal,
): Promise<SpellGenerationResult> {
  await ensureModelLoaded();
  const engine = await getCogentEngine();

  spellLog.info("concept", "pipeline begin", { promptLen: prompt.trim().length });

  try {
    const { spell, reasoning } = await runSpellPipeline({
      engine,
      prompt,
      signal,
      onProgress: (progress) => {
        onProgress?.({
          reasoning: progress.reasoning,
          phase: progress.phase,
          stage: progress.stage,
          tokenDelta: progress.tokenDelta,
          segmentStart: progress.segmentStart,
          outputs: progress.outputs,
        });
      },
    });
    return { spell, reasoning };
  } catch (err) {
    if (err instanceof SpellGenerationError) {
      throw err;
    }
    // Anything that escapes the pipeline as a non-typed error (abort, runtime
    // crash, etc.) gets wrapped so the UI has a uniform contract.
    spellLog.failure({
      stage: "concept",
      message: "uncaught pipeline error",
      cause: (err as Error)?.message,
    });
    throw new SpellGenerationError({
      stage: "concept",
      message: (err as Error)?.message ?? "unknown error",
      cause: err,
      canRepair: false,
    });
  }
}
