"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group, Mesh } from "three";
import { useShallow } from "zustand/react/shallow";
import { useGameStore } from "@/game/state/gameStore";
import { projectileMotion, type ProjectileMotion } from "@/game/state/projectileMotion";
import { SceneNodeRenderer } from "@/components/game/scene/SceneNodeRenderer";
import { SpellShaderMaterial } from "@/components/game/scene/SpellShaderMaterial";
import type { AreaSpellState, Vec3 } from "@/game/types";
import type { SpellImpactShape } from "@/game/spells/modules/spellIds";

/**
 * SpellEntities renders both projectiles (motion-driven) and area spells
 * (static-position-with-radius) using the SceneNode DSL via SceneNodeRenderer.
 *
 * Each spell carries cast, travel, and impact scenes. Cast VFX render briefly
 * at the caster, projectiles render the travel scene, and areas render impact.
 */

export function SpellEntities() {
  const castVfxIds = useGameStore(useShallow((state) => state.castVfx.map((item) => item.id)));
  const projectileIds = useGameStore(useShallow((state) => state.projectileIds));
  const areaIds = useGameStore(useShallow((state) => state.areas.map((a) => a.id)));

  return (
    <group>
      {castVfxIds.map((id) => (
        <CastVfx key={id} id={id} />
      ))}
      {projectileIds.map((id) => (
        <Projectile key={id} id={id} />
      ))}
      {areaIds.map((id) => (
        <AreaSpell key={id} areaId={id} />
      ))}
    </group>
  );
}

function CastVfx({ id }: { id: string }) {
  const cast = useGameStore((state) => state.castVfx.find((item) => item.id === id));
  if (!cast) return null;
  const yaw = Math.atan2(cast.forward[0], cast.forward[2]);
  const pitch = -Math.asin(Math.max(-1, Math.min(1, cast.forward[1])));
  return (
    <group position={cast.position} rotation={[pitch, yaw, 0]}>
      <SceneNodeRenderer
        scene={cast.spell.scenes.cast}
        spellId={cast.id}
        spawnedAt={cast.createdAt}
        lifetimeSeconds={Math.max(0.2, (cast.expiresAt - cast.createdAt) / 1000)}
        variant="cast"
      />
    </group>
  );
}

function Projectile({ id }: { id: string }) {
  const groupRef = useRef<Group>(null);
  const [motionSnapshot] = useState(() => projectileMotion.get(id));

  useFrame(() => {
    const m = projectileMotion.get(id);
    if (!groupRef.current || !m) return;
    groupRef.current.position.set(m.position[0], m.position[1], m.position[2]);
    const yaw = Math.atan2(m.direction[0], m.direction[2]);
    const pitch = -Math.asin(Math.max(-1, Math.min(1, m.direction[1])));
    groupRef.current.rotation.set(pitch, yaw, 0);
  });

  if (!motionSnapshot) return null;
  const { spell, createdAt } = motionSnapshot;
  const travelLifetimeSeconds = Math.max(0.16, (motionSnapshot.travelEndsAt - createdAt) / 1000);

  if (motionSnapshot.mode === "hitscan_visual") {
    return <HitscanBeam motion={motionSnapshot} />;
  }

  return (
    <>
      {motionSnapshot.mode === "skyfall" && <SkyfallTelegraph motion={motionSnapshot} />}
      <group ref={groupRef} position={motionSnapshot.position}>
        <SceneNodeRenderer
          scene={spell.scenes.travel}
          spellId={id}
          spawnedAt={createdAt}
          lifetimeSeconds={travelLifetimeSeconds}
          variant="travel"
        />
      </group>
    </>
  );
}

/**
 * HitscanBeam renders a stretched copy of the travel scene between the
 * caster's spawn origin and the resolved hit point.
 *
 * Convention: the `bar` shape is authored along local +Y (the renderer
 * builds it as a tall thin box of height `size * 2.4`). We orient the beam
 * group so local +Y points from origin → target, and scale Y so the bar's
 * authored length (2.4 × thickness) maps exactly onto beam length.
 */
function HitscanBeam({ motion }: { motion: ProjectileMotion }) {
  const groupRef = useRef<Group>(null);
  const stretchRef = useRef<Group>(null);

  useFrame(() => {
    if (!groupRef.current || !stretchRef.current) return;
    const ox = motion.origin[0];
    const oy = motion.origin[1];
    const oz = motion.origin[2];
    const tx = motion.targetPoint[0];
    const ty = motion.targetPoint[1];
    const tz = motion.targetPoint[2];
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    const length = Math.max(0.1, Math.hypot(dx, dy, dz));
    // Aim local +Y along origin → target. yaw rotates around Y, pitch around X.
    // Starting from local +Y up, we need to tip it onto the (dx, dy, dz) axis.
    const yaw = Math.atan2(dx, dz);
    const horizontal = Math.hypot(dx, dz);
    const pitch = Math.atan2(horizontal, dy);
    groupRef.current.position.set(ox + dx * 0.5, oy + dy * 0.5, oz + dz * 0.5);
    groupRef.current.rotation.set(pitch, yaw, 0);
    // The renderer draws `bar` as a 2.4-tall box; divide so scale.y * 2.4 = length.
    stretchRef.current.scale.set(1, length / 2.4, 1);
  });

  const lifetimeSeconds = Math.max(0.12, (motion.expiresAt - motion.createdAt) / 1000);

  return (
    <group ref={groupRef}>
      <group ref={stretchRef}>
        <SceneNodeRenderer
          scene={motion.spell.scenes.travel}
          spellId={motion.id}
          spawnedAt={motion.createdAt}
          lifetimeSeconds={lifetimeSeconds}
          variant="travel"
        />
      </group>
    </group>
  );
}

function SkyfallTelegraph({ motion }: { motion: ProjectileMotion }) {
  const targetRef = useRef<Group>(null);
  const beamRef = useRef<Mesh>(null);

  useFrame(() => {
    const travelMs = Math.max(1, motion.travelEndsAt - motion.createdAt);
    const progress = Math.max(0, Math.min(1, (Date.now() - motion.createdAt) / travelMs));
    const pulse = 1 + Math.sin(progress * Math.PI * 10) * 0.06;
    const radius = Math.max(0.9, motion.spell.radius) * (0.72 + progress * 0.38) * pulse;
    if (targetRef.current) {
      targetRef.current.position.set(0, 0.07, 0);
      targetRef.current.scale.set(radius, radius, radius);
    }
    if (beamRef.current) {
      const height = Math.max(0.4, motion.position[1] - motion.targetPoint[1]);
      const width = 0.08 + progress * 0.08;
      beamRef.current.position.set(0, height * 0.5, 0);
      beamRef.current.scale.set(width, height, width);
    }
  });

  return (
    <group position={motion.targetPoint}>
      <mesh ref={beamRef}>
        <boxGeometry args={[1, 1, 1]} />
        <SpellShaderMaterial shaderId={motion.spell.buildSpec.vfx.shaders.trail} opacityMultiplier={0.32} />
      </mesh>
      <group ref={targetRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.72, 1, 64]} />
          <SpellShaderMaterial shaderId={motion.spell.buildSpec.vfx.shaders.decal} opacityMultiplier={0.72} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.62, 64]} />
          <SpellShaderMaterial shaderId={motion.spell.buildSpec.vfx.shaders.impact} opacityMultiplier={0.18} />
        </mesh>
      </group>
    </group>
  );
}

function AreaSpell({ areaId }: { areaId: string }) {
  const groupRef = useRef<Group>(null);
  const area = useGameStore((state) => state.areas.find((item) => item.id === areaId));
  // Lightweight tick so the billboard label re-evaluates if the spell expires
  // mid-frame. The renderer drives its own per-frame motion via useFrame.
  const [, setTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => setTick((n) => (n + 1) & 0xffff), 250);
    return () => clearInterval(handle);
  }, []);

  useFrame(() => {
    if (!groupRef.current || !area?.attachedToId) return;
    const attached = useGameStore.getState().players[area.attachedToId];
    if (!attached) return;
    groupRef.current.position.set(attached.position[0], attached.position[1], attached.position[2]);
  });

  if (!area) return null;

  const rotation = orientationFor(area);

  return (
    <group ref={groupRef} position={area.position} rotation-y={rotation}>
      <AreaFootprint area={area} />
      <SceneNodeRenderer
        scene={area.spell.scenes.impact}
        spellId={area.spell.id}
        spawnedAt={area.createdAt}
        lifetimeSeconds={Math.max(0.6, (area.expiresAt - area.createdAt) / 1000)}
        variant="impact"
      />
      <Billboard position={[0, 0.18, 0]}>
        <Text fontSize={0.32} color={area.spell.color} anchorX="center" anchorY="middle">
          {area.spell.name}
        </Text>
      </Billboard>
    </group>
  );
}

function AreaFootprint({ area }: { area: AreaSpellState }) {
  const radius = Math.max(0.1, area.spell.radius);
  const opacity = area.spell.impactShape === "aura" ? 0.18 : 0.28;
  const shaderId = area.spell.buildSpec.vfx.shaders.decal;

  if (area.spell.impactShape === "line") {
    return (
      <mesh position={[0, 0.035, radius * 1.75]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.max(0.8, radius * 0.84), radius * 3.5]} />
        <SpellShaderMaterial shaderId={shaderId} opacityMultiplier={opacity} />
      </mesh>
    );
  }

  if (area.spell.impactShape === "wall") {
    return (
      <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[Math.max(0.6, radius), radius * 5.2]} />
        <SpellShaderMaterial shaderId={shaderId} opacityMultiplier={opacity} />
      </mesh>
    );
  }

  return (
    <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius * 0.92, radius, 72]} />
      <SpellShaderMaterial shaderId={shaderId} opacityMultiplier={opacity} />
    </mesh>
  );
}

/**
 * Choose a Y-axis rotation for the area's geometry. Walls and beams should
 * face perpendicular to / along the cast direction so they actually feel
 * like a barrier or a line of force. Other impacts get a stable random
 * rotation so identical spells don't all line up the same way.
 */
function orientationFor(area: { id: string; forward: Vec3; spell: { impactShape: SpellImpactShape } }): number {
  const impact = area.spell.impactShape;
  const f = area.forward;
  const fwLen = Math.hypot(f[0], f[2]);
  if (fwLen > 1e-3 && impact === "wall") {
    // Walls should BLOCK the cast direction: their long axis (segments laid
    // along local +X by arrange='line') runs perpendicular to forward, so
    // the broad face faces the caster. atan2(forward.x, forward.z) yaws so
    // local +Z aligns with forward; offsetting by +π/2 puts local +X
    // perpendicular to forward — exactly what we want.
    return Math.atan2(f[0], f[2]) + Math.PI / 2;
  }
  if (fwLen > 1e-3 && impact === "line") {
    // Line impacts align with cast direction.
    return Math.atan2(f[0], f[2]);
  }
  return deterministicRotation(area.id);
}

function deterministicRotation(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 997;
  }
  return (hash / 997) * Math.PI;
}
