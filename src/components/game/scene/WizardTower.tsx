"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CuboidCollider, CylinderCollider, RigidBody } from "@react-three/rapier";
import type { Mesh } from "three";
import { ENVIRONMENT_GROUPS } from "@/game/physics/collisionGroups";

type Vec3Tuple = [number, number, number];
type RotationTuple = [number, number, number];

// --- Palette ---------------------------------------------------------------
const stoneBody = "#3a3942";
const stoneShadow = "#2a2930";
const stoneHighlight = "#525158";
const stoneTrim = "#5b5664";
const stoneEmissive = "#25212e";
const roof = "#1f1d24";
const roofShadow = "#161419";
const buttressColor = "#46444c";
const treadColor = "#4a4850";
const treadEdge = "#5b5664";
const accent = "#b07cff";

// --- Geometry constants ----------------------------------------------------
const BASE_TOP_Y = 0.5;
const LEVEL_ONE_Y = 9.2;
const LEVEL_TWO_Y = 20;

const LOWER_DRUM_R = 6.0;
const LOWER_DRUM_H = 16;
const LOWER_DRUM_Y = LOWER_DRUM_H / 2; // 8

const UPPER_DRUM_R = 4.6;
const UPPER_DRUM_H = 7;
const UPPER_DRUM_Y = 16.5 + UPPER_DRUM_H / 2; // 20

const UPPER_DECK_Y = 23.5;

const CROWN_DRUM_R = 4.4;
const CROWN_DRUM_H = 2.5;
const CROWN_DRUM_Y = UPPER_DECK_Y + CROWN_DRUM_H / 2; // 24.75

const HAT_BASE_Y = UPPER_DECK_Y + CROWN_DRUM_H; // 26.0
const HAT_H = 6;
const HAT_TIP_Y = HAT_BASE_Y + HAT_H; // 32.0

const SPIRE_BASE_Y = HAT_TIP_Y - 1.75; // overlap into hat for clean join
const SPIRE_H = 14;
const SPIRE_TIP_Y = SPIRE_BASE_Y + SPIRE_H;

const RAMP_RADIUS = 14.4;
const RAMP_WIDTH = 3.4;
const RAMP_THICKNESS = 0.34;
const RAMP_SEGMENTS = 28;

type RampPiece = {
  key: string;
  position: Vec3Tuple;
  rotation: RotationTuple;
  length: number;
  width: number;
  thickness: number;
};

type WindowPiece = {
  key: string;
  position: Vec3Tuple;
  rotationY: number;
  height: number;
};

const rampPieces = [
  ...buildSpiralRamp("lower-ramp", BASE_TOP_Y, LEVEL_ONE_Y, 0),
  ...buildSpiralRamp("upper-ramp", LEVEL_ONE_Y, LEVEL_TWO_Y, Math.PI * 2),
];

const windows = [
  ...buildWindowBand("low-window", LOWER_DRUM_R + 0.05, 5.2, 4, 2.4, Math.PI / 6),
  ...buildWindowBand("high-window", UPPER_DRUM_R + 0.05, 18.6, 4, 2.6, Math.PI / 5),
];

export function WizardTower() {
  return (
    <group>
      <TowerCore />
      <TowerButtresses />
      <EntryRamp />
      {rampPieces.map((piece) => (
        <RampSegment key={piece.key} piece={piece} />
      ))}
      <TowerDeck levelY={LEVEL_ONE_Y} radius={12.3} keyPrefix="mid" hasGap />
      <TowerDeck levelY={LEVEL_TWO_Y} radius={11.6} keyPrefix="upper" hasGap />
      <CrenellatedParapet levelY={LEVEL_ONE_Y} radius={12.3} count={20} gapAngle={0} />
      <CrenellatedParapet levelY={LEVEL_TWO_Y} radius={11.6} count={18} gapAngle={Math.PI} />
      <UpperDeckParapet />
      {windows.map((w) => (
        <TowerWindow key={w.key} window={w} />
      ))}
      <WitchHatRoof />
      <MainSpire />
      <TurretSpires />
      <Finial />
      <RuneRing />
      <HatSlitWindow />
      <FloatingLantern />
      <DeckEdgeTrim y={LEVEL_ONE_Y + 0.05} radius={12.3} />
      <DeckEdgeTrim y={LEVEL_TWO_Y + 0.05} radius={11.6} />
    </group>
  );
}

function TowerCore() {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
      {/* Foundation */}
      <mesh receiveShadow castShadow position={[0, 0.18, 0]}>
        <cylinderGeometry args={[17.2, 17.8, 0.36, 24]} />
        <meshStandardMaterial color={stoneShadow} roughness={0.96} />
      </mesh>
      <mesh receiveShadow castShadow position={[0, 0.42, 0]}>
        <cylinderGeometry args={[14.4, 15.2, 0.28, 24]} />
        <meshStandardMaterial color={stoneHighlight} roughness={0.95} />
      </mesh>
      {/* Lower drum */}
      <mesh receiveShadow castShadow position={[0, LOWER_DRUM_Y, 0]}>
        <cylinderGeometry args={[LOWER_DRUM_R, LOWER_DRUM_R + 0.4, LOWER_DRUM_H, 24]} />
        <meshStandardMaterial
          color={stoneBody}
          roughness={0.92}
          emissive={stoneEmissive}
          emissiveIntensity={0.05}
        />
      </mesh>
      {/* Mid deck collar */}
      <mesh receiveShadow castShadow position={[0, LEVEL_ONE_Y - 0.2, 0]}>
        <cylinderGeometry args={[6.6, 6.4, 0.5, 24]} />
        <meshStandardMaterial color={stoneTrim} roughness={0.9} />
      </mesh>
      {/* Upper drum */}
      <mesh receiveShadow castShadow position={[0, UPPER_DRUM_Y, 0]}>
        <cylinderGeometry args={[UPPER_DRUM_R, UPPER_DRUM_R + 0.25, UPPER_DRUM_H, 22]} />
        <meshStandardMaterial
          color={stoneBody}
          roughness={0.92}
          emissive={stoneEmissive}
          emissiveIntensity={0.05}
        />
      </mesh>
      {/* Upper deck collar */}
      <mesh receiveShadow castShadow position={[0, UPPER_DECK_Y - 0.2, 0]}>
        <cylinderGeometry args={[5.0, 4.8, 0.5, 22]} />
        <meshStandardMaterial color={stoneTrim} roughness={0.9} />
      </mesh>
      {/* Crown drum (under hat) */}
      <mesh receiveShadow castShadow position={[0, CROWN_DRUM_Y, 0]}>
        <cylinderGeometry args={[CROWN_DRUM_R, CROWN_DRUM_R, CROWN_DRUM_H, 22]} />
        <meshStandardMaterial color={stoneShadow} roughness={0.93} />
      </mesh>
      {/* Colliders: base + tall core */}
      <CylinderCollider
        args={[0.25, 17.2]}
        position={[0, 0.25, 0]}
        collisionGroups={ENVIRONMENT_GROUPS}
      />
      <CylinderCollider
        args={[LOWER_DRUM_H / 2, LOWER_DRUM_R]}
        position={[0, LOWER_DRUM_Y, 0]}
        collisionGroups={ENVIRONMENT_GROUPS}
      />
      <CylinderCollider
        args={[(UPPER_DRUM_H + CROWN_DRUM_H + 0.5) / 2, UPPER_DRUM_R]}
        position={[0, (16.5 + CROWN_DRUM_Y + CROWN_DRUM_H / 2) / 2, 0]}
        collisionGroups={ENVIRONMENT_GROUPS}
      />
    </RigidBody>
  );
}

function TowerDeck({
  levelY,
  radius,
  keyPrefix,
  hasGap,
}: {
  levelY: number;
  radius: number;
  keyPrefix: string;
  hasGap?: boolean;
}) {
  void hasGap;
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, levelY - 0.26, 0]}>
        <mesh receiveShadow castShadow>
          <cylinderGeometry args={[radius, radius + 0.45, 0.52, 24]} />
          <meshStandardMaterial color={stoneHighlight} roughness={0.95} />
        </mesh>
        <CylinderCollider args={[0.26, radius]} collisionGroups={ENVIRONMENT_GROUPS} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[14.3, levelY - 0.24, 0]}>
        <mesh receiveShadow castShadow>
          <boxGeometry args={[5.8, 0.48, 5.2]} />
          <meshStandardMaterial color={stoneHighlight} roughness={0.94} />
        </mesh>
        <CuboidCollider args={[2.9, 0.24, 2.6]} collisionGroups={ENVIRONMENT_GROUPS} />
      </RigidBody>
      <mesh position={[0, levelY + 0.035, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[keyPrefix === "mid" ? 6.65 : 5.05, radius - 0.8, 48]} />
        <meshStandardMaterial color={stoneShadow} roughness={0.98} />
      </mesh>
    </>
  );
}

function UpperDeckParapet() {
  // Solid platform around the crown drum, upper deck top surface
  return (
    <RigidBody type="fixed" colliders={false} position={[0, UPPER_DECK_Y - 0.26, 0]}>
      <mesh receiveShadow castShadow>
        <cylinderGeometry args={[5.0, 5.2, 0.52, 22]} />
        <meshStandardMaterial color={stoneHighlight} roughness={0.95} />
      </mesh>
      <CylinderCollider args={[0.26, 5.0]} collisionGroups={ENVIRONMENT_GROUPS} />
    </RigidBody>
  );
}

function TowerButtresses() {
  const COUNT = 6;
  return (
    <group>
      {Array.from({ length: COUNT }, (_, index) => {
        const angle = (index / COUNT) * Math.PI * 2 + Math.PI / COUNT;
        const innerR = 6.0;
        const outerR = 7.4;
        const midR = (innerR + outerR) / 2;
        const x = Math.cos(angle) * midR;
        const z = Math.sin(angle) * midR;
        // Buttress spans y 0..9 (stops at mid deck), flared base
        return (
          <RigidBody
            key={`buttress-${index}`}
            type="fixed"
            colliders={false}
            position={[x, 4.5, z]}
            rotation={[0, Math.PI / 2 - angle, 0]}
          >
            {/* Flared base block */}
            <mesh receiveShadow castShadow position={[0, -3.0, 0]}>
              <boxGeometry args={[1.6, 3.0, 2.0]} />
              <meshStandardMaterial color={buttressColor} roughness={0.95} />
            </mesh>
            {/* Mid taper */}
            <mesh receiveShadow castShadow position={[0, 0.0, 0]}>
              <boxGeometry args={[1.15, 3.0, 1.7]} />
              <meshStandardMaterial color={buttressColor} roughness={0.95} />
            </mesh>
            {/* Upper rib */}
            <mesh receiveShadow castShadow position={[0, 2.6, 0]}>
              <boxGeometry args={[0.85, 2.2, 1.4]} />
              <meshStandardMaterial color={buttressColor} roughness={0.95} />
            </mesh>
            <CuboidCollider
              args={[0.8, 1.5, 1.0]}
              position={[0, -3.0, 0]}
              collisionGroups={ENVIRONMENT_GROUPS}
            />
            <CuboidCollider
              args={[0.6, 1.5, 0.85]}
              position={[0, 0.0, 0]}
              collisionGroups={ENVIRONMENT_GROUPS}
            />
            <CuboidCollider
              args={[0.43, 1.1, 0.7]}
              position={[0, 2.6, 0]}
              collisionGroups={ENVIRONMENT_GROUPS}
            />
          </RigidBody>
        );
      })}
    </group>
  );
}

function RampSegment({ piece }: { piece: RampPiece }) {
  const treadZ = [-0.34, 0, 0.34].map((t) => t * piece.length);
  return (
    <RigidBody type="fixed" colliders={false} position={piece.position} rotation={piece.rotation}>
      <mesh receiveShadow castShadow>
        <boxGeometry args={[piece.width, piece.thickness, piece.length]} />
        <meshStandardMaterial color={treadColor} roughness={0.96} />
      </mesh>
      {treadZ.map((z, index) => (
        <mesh
          key={`${piece.key}-tread-${index}`}
          receiveShadow
          castShadow
          position={[0, piece.thickness / 2 + 0.035, z]}
        >
          <boxGeometry args={[piece.width + 0.16, 0.055, 0.16]} />
          <meshStandardMaterial color={index % 2 === 0 ? treadEdge : stoneHighlight} roughness={0.95} />
        </mesh>
      ))}
      <CuboidCollider
        args={[piece.width / 2, piece.thickness / 2, piece.length / 2]}
        collisionGroups={ENVIRONMENT_GROUPS}
      />
    </RigidBody>
  );
}

function EntryRamp() {
  const length = 5.8;
  const width = RAMP_WIDTH + 0.9;
  const thickness = 0.32;
  const pitch = Math.atan2(BASE_TOP_Y, length);
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[17.9, 0.28, 0]}
      rotation={[pitch, Math.PI / 2, 0]}
    >
      <mesh receiveShadow castShadow>
        <boxGeometry args={[width, thickness, length]} />
        <meshStandardMaterial color={treadColor} roughness={0.96} />
      </mesh>
      {[-1.9, -0.95, 0, 0.95, 1.9].map((z, index) => (
        <mesh
          key={`entry-tread-${index}`}
          receiveShadow
          castShadow
          position={[0, thickness / 2 + 0.035, z]}
        >
          <boxGeometry args={[width + 0.12, 0.055, 0.14]} />
          <meshStandardMaterial color={index % 2 === 0 ? treadEdge : stoneHighlight} roughness={0.95} />
        </mesh>
      ))}
      <CuboidCollider
        args={[width / 2, thickness / 2, length / 2]}
        collisionGroups={ENVIRONMENT_GROUPS}
      />
    </RigidBody>
  );
}

function CrenellatedParapet({
  levelY,
  radius,
  count,
  gapAngle,
}: {
  levelY: number;
  radius: number;
  count: number;
  gapAngle: number;
}) {
  // Continuous low wall ring with merlons; gap aligned to ramp landing
  return (
    <group>
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        if (angularDistance(angle, gapAngle) < 0.4) return null;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const arcWidth = ((Math.PI * 2 * radius) / count) * 0.55;
        return (
          <RigidBody
            key={`merlon-${levelY}-${index}`}
            type="fixed"
            colliders={false}
            position={[x, levelY + 0.5, z]}
            rotation={[0, Math.PI / 2 - angle, 0]}
          >
            <mesh receiveShadow castShadow>
              <boxGeometry args={[arcWidth, 1.0, 0.5]} />
              <meshStandardMaterial color={stoneShadow} roughness={0.97} />
            </mesh>
            <CuboidCollider
              args={[arcWidth / 2, 0.5, 0.25]}
              collisionGroups={ENVIRONMENT_GROUPS}
            />
          </RigidBody>
        );
      })}
      {/* Low connecting wall band */}
      <mesh position={[0, levelY + 0.18, 0]} receiveShadow>
        <torusGeometry args={[radius, 0.12, 8, 64]} />
        <meshStandardMaterial color={stoneTrim} roughness={0.9} />
      </mesh>
    </group>
  );
}

function TowerWindow({ window: w }: { window: WindowPiece }) {
  return (
    <mesh position={w.position} rotation-y={w.rotationY}>
      <boxGeometry args={[0.36, w.height, 0.06]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.9} roughness={0.35} />
    </mesh>
  );
}

function WitchHatRoof() {
  return (
    <mesh
      castShadow
      position={[0, HAT_BASE_Y + HAT_H / 2, 0]}
    >
      <coneGeometry args={[6.0, HAT_H, 24]} />
      <meshStandardMaterial color={roof} roughness={0.88} flatShading />
    </mesh>
  );
}

function MainSpire() {
  return (
    <mesh
      castShadow
      position={[0, SPIRE_BASE_Y + SPIRE_H / 2, 0]}
    >
      <coneGeometry args={[1.1, SPIRE_H, 24]} />
      <meshStandardMaterial color={roofShadow} roughness={0.9} flatShading />
    </mesh>
  );
}

function TurretSpires() {
  const COUNT = 4;
  const ringR = 4.0;
  const baseY = HAT_BASE_Y + 0.6; // slightly inside hat base
  return (
    <group>
      {Array.from({ length: COUNT }, (_, index) => {
        const angle = (index / COUNT) * Math.PI * 2 + Math.PI / 4;
        const x = Math.cos(angle) * ringR;
        const z = Math.sin(angle) * ringR;
        return (
          <group key={`turret-${index}`} position={[x, baseY, z]}>
            <mesh castShadow position={[0, 1.5, 0]}>
              <cylinderGeometry args={[0.55, 0.55, 3.0, 12]} />
              <meshStandardMaterial color={stoneBody} roughness={0.92} />
            </mesh>
            <mesh castShadow position={[0, 3.0 + 1.25, 0]}>
              <coneGeometry args={[0.6, 2.5, 12]} />
              <meshStandardMaterial color={roof} roughness={0.88} flatShading />
            </mesh>
            {/* tiny accent at turret tip */}
            <mesh position={[0, 3.0 + 2.5, 0]}>
              <sphereGeometry args={[0.09, 8, 6]} />
              <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.6} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Finial() {
  return (
    <mesh position={[0, SPIRE_TIP_Y, 0]}>
      <sphereGeometry args={[0.35, 14, 10]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={2.0} roughness={0.3} />
    </mesh>
  );
}

function RuneRing() {
  return (
    <mesh position={[0, HAT_BASE_Y - 0.05, 0]} rotation-x={Math.PI / 2}>
      <torusGeometry args={[CROWN_DRUM_R + 0.1, 0.05, 8, 64]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.2} roughness={0.4} />
    </mesh>
  );
}

function HatSlitWindow() {
  // Tall narrow emissive slit on the front face of the witch-hat
  const y = HAT_BASE_Y + HAT_H * 0.32;
  // Push slightly outside the cone surface at this height
  // cone radius at height h above base: r * (1 - h/H)
  const localR = 6.0 * (1 - (HAT_H * 0.32) / HAT_H);
  const x = localR * 0.96; // facing +X (toward entry ramp)
  return (
    <mesh position={[x, y, 0]} rotation-y={0}>
      <boxGeometry args={[0.06, 1.6, 0.32]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={2.2} roughness={0.3} />
    </mesh>
  );
}

function FloatingLantern() {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.getElapsedTime();
    ref.current.position.y = CROWN_DRUM_Y - 0.2 + Math.sin(t * 1.4) * 0.18;
    ref.current.rotation.y = t * 0.4;
    ref.current.rotation.x = Math.sin(t * 0.7) * 0.15;
  });
  return (
    <mesh ref={ref} position={[0, CROWN_DRUM_Y - 0.2, 0]}>
      <octahedronGeometry args={[0.35, 0]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.8} roughness={0.25} />
    </mesh>
  );
}

function DeckEdgeTrim({ y, radius }: { y: number; radius: number }) {
  return (
    <mesh position={[0, y, 0]} rotation-x={Math.PI / 2}>
      <torusGeometry args={[radius - 0.05, 0.04, 6, 64]} />
      <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.4} roughness={0.5} />
    </mesh>
  );
}

function buildSpiralRamp(prefix: string, startY: number, endY: number, startAngle: number): RampPiece[] {
  const endAngle = startAngle + Math.PI * 2;
  const angleStep = (endAngle - startAngle) / RAMP_SEGMENTS;
  const segmentRise = (endY - startY) / RAMP_SEGMENTS;
  const arcLength = RAMP_RADIUS * angleStep;
  const length = arcLength * 1.08;
  const pitch = -Math.atan2(segmentRise, arcLength);

  return Array.from({ length: RAMP_SEGMENTS }, (_, index) => {
    const a0 = startAngle + index * angleStep;
    const a1 = a0 + angleStep;
    const mid = (a0 + a1) * 0.5;
    const surfaceY = startY + (index + 0.5) * segmentRise;
    return {
      key: `${prefix}-${index}`,
      position: [Math.cos(mid) * RAMP_RADIUS, surfaceY - RAMP_THICKNESS / 2, Math.sin(mid) * RAMP_RADIUS],
      rotation: [pitch, -mid, 0],
      length,
      width: RAMP_WIDTH,
      thickness: RAMP_THICKNESS,
    };
  });
}

function buildWindowBand(
  prefix: string,
  radius: number,
  y: number,
  count: number,
  height: number,
  offset: number,
): WindowPiece[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = offset + (index / count) * Math.PI * 2;
    return {
      key: `${prefix}-${index}`,
      position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
      rotationY: Math.PI / 2 - angle,
      height,
    };
  });
}

function angularDistance(a: number, b: number) {
  const delta = Math.abs(((((a - b + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI);
  return delta;
}
