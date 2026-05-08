"use client";

// QuarksEmitterNode
// -----------------------------------------------------------------------------
// Mounts a single ParticleSystem (built from a preset) into the scene:
//   - Constructs the system in useEffect from preset id + config.
//   - Adds the emitter Object3D as a child of this node's group, so the
//     emitter inherits position/rotation/scale from R3F transform props.
//   - Registers the system with the BatchedRenderer (for batched draw calls).
//   - Cleans up on unmount: removes from renderer + scene, disposes geometry/
//     material, and stops emission.
//   - Applies distance LOD: scales emissionOverTime down beyond LOD_FAR,
//     pauses entirely beyond LOD_CULL. Bursts are not throttled because they
//     are one-shot kinetics that the player only sees if they're nearby.
//
// One-shot vs. looping is controlled by the preset's `looping` default and the
// optional override in QuarksPresetConfig. For one-shot effects, the parent
// scene node is expected to unmount after `lifetimeMs` (existing SceneNode
// lifecycle handles this).
//
// Lint note: React 19's `react-hooks/immutability` rule treats values returned
// from hooks (useMemo/useState) as immutable. Because we mutate the
// ParticleSystem (.pause/.play/.emissionOverTime =) per frame for LOD, we own
// it via a useRef that is populated inside an effect — refs are explicitly
// allowed to be mutated by the rule.

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ConstantValue, type ParticleSystem } from "three.quarks";
import { useQuarksRuntime } from "./QuarksProviderRoot";
import {
  buildQuarksPreset,
  estimateQuarksPresetCost,
  type QuarksPresetConfig,
  type QuarksPresetId,
} from "./presets";

/** Beyond this distance from camera, emission is scaled down linearly. */
const LOD_FAR = 80;
/** Beyond this distance, the system is paused entirely. */
const LOD_CULL = 160;

export type QuarksEmitterNodeProps = {
  preset: QuarksPresetId;
  config?: QuarksPresetConfig;
  /** Local position relative to parent group. */
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  /** Dynamic multiplier for emissionOverTime without rebuilding the system. */
  emissionScale?: number;
};

export function QuarksEmitterNode({
  preset,
  config,
  position,
  rotation,
  scale,
  emissionScale = 1,
}: QuarksEmitterNodeProps) {
  const groupRef = useRef<THREE.Group>(null);
  const runtime = useQuarksRuntime();
  const emissionScaleRef = useRef(emissionScale);

  useEffect(() => {
    emissionScaleRef.current = emissionScale;
  }, [emissionScale]);

  // The ParticleSystem is owned imperatively via a ref. It is built in the
  // mount effect below and torn down on unmount. Storing it in a ref (instead
  // of useMemo/useState) lets us mutate it freely under React 19's strict
  // hook rules.
  const systemRef = useRef<ParticleSystem | null>(null);

  // Captured baseline emissionOverTime rate so distance LOD can scale it
  // without losing the preset's intended value.
  const baselineEmissionRef = useRef<number>(0);

  // Stable scratch vectors for the per-frame LOD distance check.
  const tmpA = useRef(new THREE.Vector3());
  const tmpB = useRef(new THREE.Vector3());

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const reservation = runtime.reserveBudget(estimateQuarksPresetCost(preset, config));
    if (reservation.scale <= 0) return;

    const system = buildQuarksPreset(preset, {
      ...config,
      intensity: Math.max(0.01, (config?.intensity ?? 1) * reservation.scale),
    });
    systemRef.current = system;

    group.add(system.emitter);
    runtime.renderer.addSystem(system);

    // Snapshot baseline rate. ConstantValue.genValue() returns its constant.
    const eot = system.emissionOverTime as unknown as
      | { genValue?: () => number }
      | undefined;
    baselineEmissionRef.current =
      typeof eot?.genValue === "function" ? eot.genValue() : 0;

    return () => {
      try {
        runtime.renderer.deleteSystem(system);
      } catch {
        // BatchedRenderer.deleteSystem throws if system was already removed;
        // safe to ignore.
      }
      if (system.emitter.parent) {
        system.emitter.parent.remove(system.emitter);
      }
      // Dispose particle-side resources we own.
      const mat = system.material as
        | THREE.Material
        | THREE.Material[]
        | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
      const settings = (
        system as unknown as {
          rendererEmitterSettings?: { geometry?: THREE.BufferGeometry };
        }
      ).rendererEmitterSettings;
      settings?.geometry?.dispose?.();
      systemRef.current = null;
      runtime.releaseBudget(reservation);
    };
    // We intentionally don't depend on `config` — composers pass fresh objects
    // each render; SceneNode lifecycle remounts on real changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, runtime]);

  // Per-frame distance-based LOD.
  useFrame((state) => {
    const group = groupRef.current;
    const system = systemRef.current;
    if (!group || !system) return;
    const baseline = baselineEmissionRef.current;
    if (baseline <= 0) return; // burst-only preset: nothing to scale.

    group.getWorldPosition(tmpA.current);
    state.camera.getWorldPosition(tmpB.current);
    const dist = tmpA.current.distanceTo(tmpB.current);

    if (dist > LOD_CULL) {
      if (!system.paused) system.pause();
      return;
    }
    if (system.paused) system.play();

    // Linear ramp: full rate at LOD_FAR, 0 at LOD_CULL.
    let scaleFactor = 1;
    if (dist > LOD_FAR) {
      scaleFactor = Math.max(
        0,
        1 - (dist - LOD_FAR) / (LOD_CULL - LOD_FAR),
      );
    }
    const target = baseline * scaleFactor * Math.max(0, emissionScaleRef.current);
    // Replace the generator only if the target meaningfully changed.
    const eot = system.emissionOverTime as unknown as
      | { genValue?: () => number }
      | undefined;
    const current =
      typeof eot?.genValue === "function" ? eot.genValue() : baseline;
    if (Math.abs(current - target) > 0.5) {
      system.emissionOverTime = new ConstantValue(target);
    }
  });

  // Apply transform props directly; we don't need to reach into the system.
  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation}
      scale={scale as THREE.Vector3Tuple | number}
    />
  );
}
