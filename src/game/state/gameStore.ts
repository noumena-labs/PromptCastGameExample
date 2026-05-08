import { create } from "zustand";
import {
  AURA_THRESHOLD,
  DUMMY_TARGETS,
  INITIAL_CRYSTALS,
  INITIAL_MANA_MOTES,
  LOCAL_PLAYER_ID,
  MAGIC_MISSILE,
  MANA_MOTE_DROP_COUNT,
  MANA_MOTE_DROP_DECAY_MS,
  MANA_MOTE_RESPAWN_MAX_MS,
  MANA_MOTE_RESPAWN_MIN_MS,
  MANA_MOTE_VALUE,
  MANA_REGEN_PER_SECOND,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_MANA,
  PLAYER_SPAWN_POINTS,
  SANCTUARY_DURATION_MS,
} from "@/game/config/gameConfig";
import type {
  AreaSpellState,
  CastVfxState,
  CrystalState,
  DummyTarget,
  GeneratedSpell,
  HostStateSnapshot,
  LobbyPlayer,
  ManaMoteState,
  MatchMode,
  PlayerState,
  AppliedHostSnapshotInfo,
  SpellStatusEffectId,
  SequencedCastPayload,
  SequencedCrystalPayload,
  SequencedManaMotePayload,
  SequencedSanctuaryPayload,
  SequencedSpellBoundPayload,
  Vec3,
} from "@/game/types";
import { projectileMotion } from "@/game/state/projectileMotion";
import { colliderRegistry } from "@/game/state/colliderRegistry";
import { rotateAroundY } from "@/game/math/vector";
import { getGroundHeight } from "@/game/arena/terrain";
import { getDeliveryVehicle } from "@/game/spells/modules/deliveryVehicles";
import { deliveryAudioCue, spellAudioCue } from "@/game/audio/audioCatalog";
import { audioRuntime } from "@/game/audio/audioRuntime";

const now = () => Date.now();

function groundedSpawn(position: Vec3): Vec3 {
  return [position[0], getGroundHeight(position[0], position[2]), position[2]];
}

function spawnForPlayerId(playerId: string): Vec3 {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  const angle = (hash / 0xffffffff) * Math.PI * 2;
  const radius = 12 + ((hash >>> 8) % 18);
  return groundedSpawn([Math.cos(angle) * radius, 0, Math.sin(angle) * radius]);
}

function randomRespawnPoint(): Vec3 {
  const base = PLAYER_SPAWN_POINTS[Math.floor(Math.random() * PLAYER_SPAWN_POINTS.length)];
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * 4;
  return groundedSpawn([base[0] + Math.cos(angle) * radius, 0, base[2] + Math.sin(angle) * radius]);
}

const createLocalPlayer = (): PlayerState => ({
  id: LOCAL_PLAYER_ID,
  name: "You",
  color: "#74f7d0",
  position: groundedSpawn(PLAYER_SPAWN_POINTS[0]),
  rotationY: 0,
  velocity: [0, 0, 0],
  health: PLAYER_MAX_HEALTH,
  mana: PLAYER_MAX_MANA,
  aura: 0,
  score: 0,
  status: "alive",
  statusEffects: [],
  isShielded: false,
  spellSlots: [null, null, null, null],
  cooldowns: {},
  respawnAt: null,
});

export type GameStore = {
  mode: MatchMode;
  roomCode: string | null;
  localPlayerId: string;
  players: Record<string, PlayerState>;
  lobbyPlayers: LobbyPlayer[];
  crystals: CrystalState[];
  manaMotes: ManaMoteState[];
  projectileIds: string[];
  castVfx: CastVfxState[];
  areas: AreaSpellState[];
  dummyTargets: DummyTarget[];
  promptOpen: boolean;
  selectedSlot: number;
  sanctuaryEndsAt: number | null;
  sanctuaryPausedRemainingMs: number | null;
  networkSequence: number;
  lastLocalCast: SequencedCastPayload | null;
  lastCrystalCollect: SequencedCrystalPayload | null;
  lastManaMoteCollect: SequencedManaMotePayload | null;
  lastSanctuaryEvent: SequencedSanctuaryPayload | null;
  lastSpellBound: SequencedSpellBoundPayload | null;
  hostSnapshotSequence: number;
  lastHostSnapshot: AppliedHostSnapshotInfo | null;
  log: string[];
  setMode: (mode: MatchMode, roomCode?: string | null) => void;
  setLocalIdentity: (id: string, name: string, color: string) => void;
  setLocalPlayerProfile: (name: string, color: string) => void;
  setLobbyPlayers: (players: LobbyPlayer[], pruneMissing?: boolean) => void;
  addLog: (message: string) => void;
  updateLocalTransform: (position: Vec3, rotationY: number, velocity: Vec3) => void;
  upsertRemotePlayer: (player: Partial<PlayerState> & Pick<PlayerState, "id" | "name" | "color">) => void;
  removePlayer: (playerId: string) => void;
  regenerateMana: (delta: number) => void;
  collectCrystal: (crystalId: string) => void;
  collectCrystalForPlayer: (crystalId: string, playerId: string) => void;
  applyCrystalState: (crystals: CrystalState[]) => void;
  applyHostSnapshot: (snapshot: HostStateSnapshot) => void;
  respawnCrystals: () => void;
  collectManaMote: (moteId: string) => void;
  collectManaMoteForPlayer: (moteId: string, playerId: string) => void;
  applyManaMoteState: (manaMotes: ManaMoteState[]) => void;
  respawnManaMotes: () => void;
  dropManaMotesAt: (position: Vec3, count?: number) => void;
  enterSanctuary: () => boolean;
  pauseSanctuaryTimer: () => void;
  resumeSanctuaryTimer: () => void;
  exitSanctuary: () => void;
  enterSanctuaryForPlayer: (playerId: string) => void;
  exitSanctuaryForPlayer: (playerId: string) => void;
  setSelectedSlot: (slot: number) => void;
  saveGeneratedSpell: (spell: GeneratedSpell) => void;
  saveGeneratedSpellForPlayer: (playerId: string, slot: number, spell: GeneratedSpell) => void;
  castSpell: (spell: GeneratedSpell, origin: Vec3, direction: Vec3, targetPoint: Vec3, ownerId?: string) => boolean;
  castSlot: (slot: number, origin: Vec3, direction: Vec3, targetPoint: Vec3) => boolean;
  tickCooldowns: () => void;
  tickCastVfx: () => void;
  removeProjectile: (projectileId: string) => void;
  damageDummy: (dummyId: string, amount: number, ownerId: string) => void;
  damagePlayer: (playerId: string, amount: number, ownerId: string) => void;
  applyStatusEffect: (playerId: string, effect: SpellStatusEffectId, ownerId: string, sourceSpellId: string, durationMs: number, strength: number) => void;
  tickStatusEffects: () => void;
  tickRespawns: () => void;
  tickAreas: () => void;
  resetMatch: () => void;
};

const moteRespawnDelay = () =>
  MANA_MOTE_RESPAWN_MIN_MS + Math.random() * (MANA_MOTE_RESPAWN_MAX_MS - MANA_MOTE_RESPAWN_MIN_MS);

function resolvePlacementPoint(
  spell: GeneratedSpell,
  casterPosition: Vec3,
  targetPoint: Vec3,
): Vec3 {
  if (spell.deliveryVehicle === "aura_orbit") {
    return [casterPosition[0], casterPosition[1] + 0.05, casterPosition[2]];
  }
  return targetPoint;
}

function normalizeDirection(direction: Vec3): Vec3 {
  const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  return [direction[0] / len, direction[1] / len, direction[2] / len];
}

function impactAreaRadius(spell: GeneratedSpell): number {
  return hasLingeringImpact(spell) ? spell.radius : Math.max(0.7, spell.radius * 1.35);
}

function areaDuration(spell: GeneratedSpell): number {
  return spell.impactDurationMs > 0 ? spell.impactDurationMs : spell.durationMs;
}

function castVfxDuration(spell: GeneratedSpell): number {
  if (spell.deliveryVehicle === "skyfall") return 420;
  if (spell.deliveryVehicle === "ground_eruption" || spell.deliveryVehicle === "aura_orbit") return 520;
  return 260;
}

function hasLingeringImpact(spell: GeneratedSpell): boolean {
  return (
    spell.deliveryVehicle === "aura_orbit" ||
    spell.buildSpec.vfx.impact.includes("lingering_cloud") ||
    spell.buildSpec.vfx.impact.includes("ground_decal")
  );
}

export const useGameStore = create<GameStore>((set, get) => ({
  mode: "solo",
  roomCode: null,
  localPlayerId: LOCAL_PLAYER_ID,
  players: { [LOCAL_PLAYER_ID]: createLocalPlayer() },
  lobbyPlayers: [],
  crystals: INITIAL_CRYSTALS,
  manaMotes: INITIAL_MANA_MOTES,
  projectileIds: [],
  castVfx: [],
  areas: [],
  dummyTargets: DUMMY_TARGETS,
  promptOpen: false,
  selectedSlot: 0,
  sanctuaryEndsAt: null,
  sanctuaryPausedRemainingMs: null,
  networkSequence: 0,
  lastLocalCast: null,
  lastCrystalCollect: null,
  lastManaMoteCollect: null,
  lastSanctuaryEvent: null,
  lastSpellBound: null,
  hostSnapshotSequence: 0,
  lastHostSnapshot: null,
  log: ["PromptCast prototype initialized."],

  setMode: (mode, roomCode = null) =>
    set((state) => {
      const changedSession = state.mode !== mode || state.roomCode !== roomCode;
      return {
        mode,
        roomCode,
        ...(mode === "client" && changedSession ? { hostSnapshotSequence: 0, lastHostSnapshot: null } : {}),
      };
    }),

  setLocalIdentity: (id, name, color) =>
    set((state) => {
      const current = state.players[state.localPlayerId] ?? createLocalPlayer();
      const players = { ...state.players };
      delete players[state.localPlayerId];
      players[id] = { ...current, id, name, color, position: spawnForPlayerId(id) };
      return { localPlayerId: id, players };
    }),

  setLocalPlayerProfile: (name, color) =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      if (!player) return state;
      return { players: { ...state.players, [player.id]: { ...player, name, color } } };
    }),

  setLobbyPlayers: (lobbyPlayers, pruneMissing = false) =>
    set((state) => {
      if (!pruneMissing) return { lobbyPlayers };
      const knownIds = new Set(lobbyPlayers.map((player) => player.id));
      const players = { ...state.players };
      for (const id of Object.keys(players)) {
        if (id !== state.localPlayerId && !knownIds.has(id)) delete players[id];
      }
      return { lobbyPlayers, players };
    }),

  addLog: (message) => set((state) => ({ log: [message, ...state.log].slice(0, 5) })),

  updateLocalTransform: (position, rotationY, velocity) =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      if (!player) return state;
      return {
        players: {
          ...state.players,
          [state.localPlayerId]: { ...player, position, rotationY, velocity },
        },
      };
    }),

  upsertRemotePlayer: (incoming) =>
    set((state) => {
      const existing = state.players[incoming.id];
      return {
        players: {
          ...state.players,
          [incoming.id]: {
            ...createLocalPlayer(),
            ...existing,
            ...incoming,
            position: incoming.position ?? existing?.position ?? spawnForPlayerId(incoming.id),
            spellSlots: incoming.spellSlots ?? existing?.spellSlots ?? [null, null, null, null],
            statusEffects: incoming.statusEffects ?? existing?.statusEffects ?? [],
            cooldowns: incoming.cooldowns ?? existing?.cooldowns ?? {},
          },
        },
      };
    }),

  removePlayer: (playerId) =>
    set((state) => {
      const players = { ...state.players };
      delete players[playerId];
      return { players };
    }),

  regenerateMana: (delta) => {
    if (MANA_REGEN_PER_SECOND <= 0) return;
    set((state) => {
      const player = state.players[state.localPlayerId];
      if (!player || player.status === "dead") return state;
      return {
        players: {
          ...state.players,
          [player.id]: { ...player, mana: Math.min(PLAYER_MAX_MANA, player.mana + MANA_REGEN_PER_SECOND * delta) },
        },
      };
    });
  },

  collectCrystal: (crystalId) =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      const crystal = state.crystals.find((item) => item.id === crystalId);
      if (!player || !crystal?.active) return state;
      const sequence = state.networkSequence + 1;
      const nextAura = Math.min(AURA_THRESHOLD, player.aura + 1);
      audioRuntime.play("world_crystal_collect", { position: crystal.position, listener: player.position });
      return {
        networkSequence: sequence,
        lastCrystalCollect: { sequence, playerId: player.id, crystalId },
        crystals: state.crystals.map((item) =>
          item.id === crystalId ? { ...item, active: false, respawnAt: now() + 18000 + Math.random() * 9000 } : item,
        ),
        players: {
          ...state.players,
          [player.id]: { ...player, aura: nextAura },
        },
        log: [`Aura Crystal claimed (${nextAura}/${AURA_THRESHOLD}). Sacred Nam-shub awaits.`, ...state.log].slice(0, 5),
      };
    }),

  collectCrystalForPlayer: (crystalId, playerId) =>
    set((state) => {
      const player = state.players[playerId];
      const crystal = state.crystals.find((item) => item.id === crystalId);
      if (!player || !crystal?.active) return state;
      audioRuntime.play("world_crystal_collect", { position: crystal.position, listener: state.players[state.localPlayerId]?.position });
      return {
        crystals: state.crystals.map((item) =>
          item.id === crystalId ? { ...item, active: false, respawnAt: now() + 18000 + Math.random() * 9000 } : item,
        ),
        players: {
          ...state.players,
          [player.id]: { ...player, aura: Math.min(AURA_THRESHOLD, player.aura + 1) },
        },
      };
    }),

  applyCrystalState: (crystals) => set({ crystals }),

  applyHostSnapshot: (snapshot) =>
    set((state) => {
      if (snapshot.sequence <= state.hostSnapshotSequence) return state;
      const players: Record<string, PlayerState> = {};
      for (const player of snapshot.players) {
        const current = state.players[player.id];
        const isLocal = player.id === state.localPlayerId;
        players[player.id] = {
          ...player,
          spellSlots: isLocal ? current?.spellSlots ?? player.spellSlots : player.spellSlots ?? current?.spellSlots ?? [null, null, null, null],
          statusEffects: player.statusEffects ?? current?.statusEffects ?? [],
          cooldowns: player.cooldowns ?? current?.cooldowns ?? {},
        };
      }

      const localPlayer = players[state.localPlayerId] ?? state.players[state.localPlayerId];
      if (localPlayer && !players[state.localPlayerId]) players[state.localPlayerId] = localPlayer;

      return {
        players,
        crystals: snapshot.crystals,
        manaMotes: snapshot.manaMotes,
        dummyTargets: snapshot.dummyTargets,
        hostSnapshotSequence: snapshot.sequence,
        lastHostSnapshot: {
          sequence: snapshot.sequence,
          serverTime: snapshot.serverTime,
          receivedAt: now(),
        },
      };
    }),

  respawnCrystals: () =>
    set((state) => {
      if (state.mode === "client") return state;
      return {
        crystals: state.crystals.map((crystal) =>
          !crystal.active && crystal.respawnAt && crystal.respawnAt <= now() ? { ...crystal, active: true, respawnAt: null } : crystal,
        ),
      };
    }),

  collectManaMote: (moteId) =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      const mote = state.manaMotes.find((item) => item.id === moteId);
      if (!player || !mote?.active || player.status === "dead") return state;
      const sequence = state.networkSequence + 1;
      const nextMana = Math.min(PLAYER_MAX_MANA, player.mana + mote.amount);
      audioRuntime.play("world_mana_collect", { position: mote.position, listener: player.position });
      const motes = mote.ephemeral
        ? state.manaMotes.filter((item) => item.id !== moteId)
        : state.manaMotes.map((item) =>
            item.id === moteId ? { ...item, active: false, respawnAt: now() + moteRespawnDelay() } : item,
          );
      return {
        networkSequence: sequence,
        lastManaMoteCollect: { sequence, playerId: player.id, moteId },
        manaMotes: motes,
        players: {
          ...state.players,
          [player.id]: { ...player, mana: nextMana },
        },
      };
    }),

  collectManaMoteForPlayer: (moteId, playerId) =>
    set((state) => {
      const player = state.players[playerId];
      const mote = state.manaMotes.find((item) => item.id === moteId);
      if (!player || !mote?.active || player.status === "dead") return state;
      audioRuntime.play("world_mana_collect", { position: mote.position, listener: state.players[state.localPlayerId]?.position });
      const nextMana = Math.min(PLAYER_MAX_MANA, player.mana + mote.amount);
      const motes = mote.ephemeral
        ? state.manaMotes.filter((item) => item.id !== moteId)
        : state.manaMotes.map((item) =>
            item.id === moteId ? { ...item, active: false, respawnAt: now() + moteRespawnDelay() } : item,
          );
      return {
        manaMotes: motes,
        players: {
          ...state.players,
          [player.id]: { ...player, mana: nextMana },
        },
      };
    }),

  applyManaMoteState: (manaMotes) => set({ manaMotes }),

  respawnManaMotes: () =>
    set((state) => {
      if (state.mode === "client") return state;
      const timestamp = now();
      const next: ManaMoteState[] = [];
      for (const mote of state.manaMotes) {
        // Prune expired ephemeral drops.
        if (mote.ephemeral && mote.decayAt && mote.decayAt <= timestamp) continue;
        if (!mote.active && mote.respawnAt && mote.respawnAt <= timestamp) {
          next.push({ ...mote, active: true, respawnAt: null });
        } else {
          next.push(mote);
        }
      }
      return { manaMotes: next };
    }),

  dropManaMotesAt: (position, count = MANA_MOTE_DROP_COUNT) =>
    set((state) => {
      const timestamp = now();
      const drops: ManaMoteState[] = [];
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.6 + Math.random() * 1.4;
        drops.push({
          id: `mote-drop-${timestamp}-${i}-${Math.floor(Math.random() * 1000)}`,
          position: [position[0] + Math.cos(angle) * radius, position[1] + 0.9, position[2] + Math.sin(angle) * radius],
          active: true,
          respawnAt: null,
          decayAt: timestamp + MANA_MOTE_DROP_DECAY_MS,
          amount: MANA_MOTE_VALUE,
          ephemeral: true,
        });
      }
      return { manaMotes: [...state.manaMotes, ...drops] };
    }),

  enterSanctuary: () => {
    const state = get();
    const player = state.players[state.localPlayerId];
    if (!player || player.aura < AURA_THRESHOLD || player.status !== "alive") return false;
    const sequence = state.networkSequence + 1;
    set({
      networkSequence: sequence,
      lastSanctuaryEvent: { sequence, playerId: player.id, action: "enter" },
      promptOpen: true,
      sanctuaryEndsAt: now() + SANCTUARY_DURATION_MS,
      sanctuaryPausedRemainingMs: null,
      players: {
        ...state.players,
        [player.id]: { ...player, aura: player.aura - AURA_THRESHOLD, status: "sanctuary", isShielded: true, velocity: [0, 0, 0] },
      },
      log: ["Sanctuary opened. Inscribe a Nam-shub.", ...state.log].slice(0, 5),
    });
    audioRuntime.play("world_sanctuary_enter", { position: player.position, listener: player.position });
    return true;
  },

  pauseSanctuaryTimer: () =>
    set((state) => {
      if (state.sanctuaryEndsAt === null) return state;
      return {
        sanctuaryEndsAt: null,
        sanctuaryPausedRemainingMs: Math.max(0, state.sanctuaryEndsAt - now()),
      };
    }),

  resumeSanctuaryTimer: () =>
    set((state) => {
      if (state.sanctuaryPausedRemainingMs === null) return state;
      return {
        sanctuaryEndsAt: now() + state.sanctuaryPausedRemainingMs,
        sanctuaryPausedRemainingMs: null,
      };
    }),

  exitSanctuary: () =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      if (!player) return { promptOpen: false, sanctuaryEndsAt: null, sanctuaryPausedRemainingMs: null };
      const sequence = state.networkSequence + 1;
      audioRuntime.play("world_sanctuary_exit", { position: player.position, listener: player.position });
      return {
        networkSequence: sequence,
        lastSanctuaryEvent: { sequence, playerId: player.id, action: "exit" },
        promptOpen: false,
        sanctuaryEndsAt: null,
        sanctuaryPausedRemainingMs: null,
        players: {
          ...state.players,
          [player.id]: { ...player, status: player.health > 0 ? "alive" : "dead", isShielded: false },
        },
      };
    }),

  enterSanctuaryForPlayer: (playerId) =>
    set((state) => {
      const player = state.players[playerId];
      if (!player || player.status === "dead") return state;
      const aura = Math.max(0, player.aura - (player.aura >= AURA_THRESHOLD ? AURA_THRESHOLD : 0));
      audioRuntime.play("world_sanctuary_enter", { position: player.position, listener: state.players[state.localPlayerId]?.position });
      return {
        players: {
          ...state.players,
          [playerId]: { ...player, aura, status: "sanctuary", isShielded: true, velocity: [0, 0, 0] },
        },
      };
    }),

  exitSanctuaryForPlayer: (playerId) =>
    set((state) => {
      const player = state.players[playerId];
      if (!player) return state;
      audioRuntime.play("world_sanctuary_exit", { position: player.position, listener: state.players[state.localPlayerId]?.position });
      return {
        players: {
          ...state.players,
          [playerId]: { ...player, status: player.health > 0 ? "alive" : "dead", isShielded: false },
        },
      };
    }),

  setSelectedSlot: (selectedSlot) => set({ selectedSlot: Math.max(0, Math.min(3, selectedSlot)) }),

  saveGeneratedSpell: (spell) =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      if (!player) return state;
      const sequence = state.networkSequence + 1;
      const slots = [...player.spellSlots];
      slots[state.selectedSlot] = spell;
      audioRuntime.play("ui_spell_bind");
      return {
        networkSequence: sequence,
        lastSpellBound: { sequence, playerId: player.id, slot: state.selectedSlot, spell },
        promptOpen: false,
        sanctuaryEndsAt: null,
        sanctuaryPausedRemainingMs: null,
        players: {
          ...state.players,
          [player.id]: { ...player, status: "alive", isShielded: false, spellSlots: slots },
        },
        log: [`Bound ${spell.name} to runestone ${state.selectedSlot + 1}.`, ...state.log].slice(0, 5),
      };
    }),

  saveGeneratedSpellForPlayer: (playerId, slot, spell) =>
    set((state) => {
      const player = state.players[playerId];
      if (!player) return state;
      const slots = [...player.spellSlots];
      slots[Math.max(0, Math.min(3, slot))] = spell;
      return {
        players: {
          ...state.players,
          [playerId]: { ...player, status: player.health > 0 ? "alive" : "dead", isShielded: false, spellSlots: slots },
        },
      };
    }),

  castSpell: (spell, origin, direction, targetPoint, ownerId = get().localPlayerId) => {
    const state = get();
    const player = state.players[ownerId];
    const timestamp = now();
    const listener = state.players[state.localPlayerId]?.position;
    if (!player || player.status === "dead") return false;
    if (ownerId === state.localPlayerId && player.status === "sanctuary") {
      audioRuntime.play("wizard_cast_fail", { position: player.position, listener });
      return false;
    }
    if (ownerId === state.localPlayerId && (player.cooldowns[spell.id] ?? 0) > timestamp) {
      audioRuntime.play("wizard_cast_fail", { position: player.position, listener });
      return false;
    }
    if (ownerId === state.localPlayerId && player.mana < spell.manaCost) {
      audioRuntime.play("wizard_cast_fail", { position: player.position, listener });
      return false;
    }

    const cooldowns = ownerId === state.localPlayerId ? { ...player.cooldowns, [spell.id]: timestamp + spell.cooldownMs } : player.cooldowns;
    const nextPlayer = ownerId === state.localPlayerId ? { ...player, mana: Math.max(0, player.mana - spell.manaCost), cooldowns } : player;

    const isLocal = ownerId === state.localPlayerId;
    const sequence = isLocal ? state.networkSequence + 1 : state.networkSequence;
    const networkUpdate = isLocal
      ? { networkSequence: sequence, lastLocalCast: { sequence, playerId: ownerId, spell, origin, direction, targetPoint } }
      : {};

    const baseId = `${spell.id}-${timestamp}-${Math.random().toString(16).slice(2)}`;
    const resolvedPoint = resolvePlacementPoint(spell, player.position, targetPoint);
    const castVfx: CastVfxState = {
      id: `${baseId}-cast`,
      ownerId,
      spell,
      position: origin,
      forward: normalizeDirection(direction),
      createdAt: timestamp,
      expiresAt: timestamp + castVfxDuration(spell),
    };
    // Resolve the caster's Rapier collider handle once per cast. Used by the
    // projectile raycast to exclude the wizard's own capsule so the projectile
    // doesn't self-collide on spawn.
    const ownerColliderHandle = colliderRegistry.findWizardHandle(ownerId);

    const delivery = getDeliveryVehicle(spell.deliveryVehicle);
    audioRuntime.play("wizard_cast_release", { position: origin, listener });
    audioRuntime.play(spellAudioCue(spell.alignment, "cast"), { position: origin, listener });
    audioRuntime.play(spellAudioCue(spell.alignment, "travel_loop"), { position: origin, listener, volume: 0.42 });
    audioRuntime.play(deliveryAudioCue(spell.deliveryVehicle), { position: origin, listener, volume: 0.72 });

    if (spell.deliveryVehicle === "ground_eruption" || spell.deliveryVehicle === "aura_orbit") {
      const forward = normalizeDirection(direction);
      const areaDurationMs = areaDuration(spell);
      const areaRadius = impactAreaRadius(spell);
      audioRuntime.play(spellAudioCue(spell.alignment, "impact"), { position: resolvedPoint, listener });
      audioRuntime.play(spellAudioCue(spell.alignment, "linger_loop"), { position: resolvedPoint, listener, volume: 0.72 });
      set({
        ...networkUpdate,
        players: { ...state.players, [ownerId]: nextPlayer },
        castVfx: [...state.castVfx, castVfx],
        areas: [
          ...state.areas,
          {
            id: baseId,
            ownerId,
            spell: { ...spell, radius: areaRadius },
            position: resolvedPoint,
            forward,
            attachedToId: delivery.attachesToCaster ? ownerId : null,
            createdAt: timestamp,
            expiresAt: timestamp + areaDurationMs,
            tickedAt: {},
          },
        ],
      });
      return true;
    }

    if (spell.deliveryVehicle === "skyfall") {
      const newMotions: string[] = [];
      const skyHeight = skyfallHeight(spell);
      const skyTravelMs = skyfallTravelMs(spell);
      for (let i = 0; i < spell.count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = i === 0 ? 0 : Math.random() * Math.max(1.5, spell.radius);
        const tx = resolvedPoint[0] + Math.cos(angle) * radius;
        const tz = resolvedPoint[2] + Math.sin(angle) * radius;
        const ty = getGroundHeight(tx, tz) + 0.05;
        const id = `${baseId}-${i}`;
        const meteorTarget: Vec3 = [tx, ty, tz];
        const motionPosition: Vec3 = [tx, ty + skyHeight + i * 1.2, tz];
        const directionToTarget = normalizeDirection([meteorTarget[0] - motionPosition[0], meteorTarget[1] - motionPosition[1], meteorTarget[2] - motionPosition[2]]);
        const fallDistance = Math.hypot(meteorTarget[0] - motionPosition[0], meteorTarget[1] - motionPosition[1], meteorTarget[2] - motionPosition[2]);
        const fallSpeed = fallDistance / (skyTravelMs / 1000);
        projectileMotion.register({
          id,
          ownerId,
          ownerColliderHandle,
          spell,
          mode: "skyfall",
          origin: motionPosition,
          position: motionPosition,
          direction: directionToTarget,
          velocity: [directionToTarget[0] * fallSpeed, directionToTarget[1] * fallSpeed, directionToTarget[2] * fallSpeed],
          targetPoint: meteorTarget,
          createdAt: timestamp,
          travelEndsAt: timestamp + skyTravelMs,
          expiresAt: timestamp + skyTravelMs + 450,
          resolvedAt: null,
        });
        newMotions.push(id);
      }
      set({
        ...networkUpdate,
        players: { ...state.players, [ownerId]: nextPlayer },
        castVfx: [...state.castVfx, castVfx],
        projectileIds: [...state.projectileIds, ...newMotions],
      });
      return true;
    }

    // Projectile-like vehicles: linear bolts, arcing lobs, and brief hitscan tracers.
    const newMotions: string[] = [];
    const fanDeg = spell.count > 1 ? 6 : 0;
    const baseDir = direction;
    const targetDistance = Math.max(1, Math.hypot(
      resolvedPoint[0] - origin[0],
      resolvedPoint[1] - origin[1],
      resolvedPoint[2] - origin[2],
    ));
    const travelExpiresAt = timestamp + Math.max(
      spell.durationMs,
      Math.ceil((targetDistance / Math.max(1, spell.speed)) * 1000) + 500,
    );
    for (let i = 0; i < spell.count; i += 1) {
      const offsetDeg = spell.count === 1 ? 0 : (i - (spell.count - 1) / 2) * fanDeg;
      const rawDir = rotateAroundY(baseDir, (offsetDeg * Math.PI) / 180);
      const id = `${baseId}-${i}`;
      const directToTarget = normalizeDirection([resolvedPoint[0] - origin[0], resolvedPoint[1] - origin[1], resolvedPoint[2] - origin[2]]);
      const aimsAtResolvedPoint = spell.deliveryVehicle === "instant_hitscan" || spell.deliveryVehicle === "projectile_arcing";
      const dir = aimsAtResolvedPoint ? directToTarget : rawDir;
      const expiresAt = spell.deliveryVehicle === "instant_hitscan" ? timestamp + 120 : travelExpiresAt;
      const projectileTarget: Vec3 = [
        aimsAtResolvedPoint ? resolvedPoint[0] : origin[0] + dir[0] * targetDistance,
        aimsAtResolvedPoint ? resolvedPoint[1] : origin[1] + dir[1] * targetDistance,
        aimsAtResolvedPoint ? resolvedPoint[2] : origin[2] + dir[2] * targetDistance,
      ];
      projectileMotion.register({
        id,
        ownerId,
        ownerColliderHandle,
        spell,
        mode: spell.deliveryVehicle === "projectile_arcing" ? "arc" : spell.deliveryVehicle === "instant_hitscan" ? "hitscan_visual" : "linear",
        origin: [origin[0], origin[1], origin[2]],
        position: [origin[0], origin[1], origin[2]],
        direction: dir,
        velocity: initialVelocityFor(spell, origin, projectileTarget, dir),
        targetPoint: projectileTarget,
        createdAt: timestamp,
        travelEndsAt: expiresAt,
        expiresAt,
        resolvedAt: null,
      });
      newMotions.push(id);
    }

    set({
      ...networkUpdate,
      players: { ...state.players, [ownerId]: nextPlayer },
      castVfx: [...state.castVfx, castVfx],
      projectileIds: [...state.projectileIds, ...newMotions],
    });
    return true;
  },

  castSlot: (slot, origin, direction, targetPoint) => {
    const player = get().players[get().localPlayerId];
    const spell = player?.spellSlots[slot];
    if (!spell) return false;
    return get().castSpell(spell, origin, direction, targetPoint);
  },

  tickCooldowns: () => set((state) => ({ players: { ...state.players } })),

  tickCastVfx: () =>
    set((state) => {
      const timestamp = now();
      return { castVfx: state.castVfx.filter((item) => item.expiresAt > timestamp) };
    }),

  removeProjectile: (projectileId) => {
    projectileMotion.unregister(projectileId);
    set((state) => ({ projectileIds: state.projectileIds.filter((id) => id !== projectileId) }));
  },

  damageDummy: (dummyId, amount, ownerId) => {
    let scoredPosition: Vec3 | null = null;
    let hitPosition: Vec3 | null = null;
    set((state) => {
      if (state.mode === "client") return state;
      const dummyTargets = state.dummyTargets.map((dummy) => {
        if (dummy.id !== dummyId || dummy.respawnAt) return dummy;
        hitPosition = dummy.position;
        const health = Math.max(0, dummy.health - amount);
        if (health <= 0) {
          scoredPosition = dummy.position;
          return { ...dummy, health: 0, respawnAt: now() + 4500 };
        }
        return { ...dummy, health };
      });
      const owner = state.players[ownerId];
      return {
        dummyTargets,
        players: owner && scoredPosition ? { ...state.players, [ownerId]: { ...owner, score: owner.score + 1 } } : state.players,
      };
    });
    if (hitPosition) audioRuntime.play("world_dummy_hit", { position: hitPosition, listener: get().players[get().localPlayerId]?.position });
    if (scoredPosition) get().dropManaMotesAt(scoredPosition);
  },

  damagePlayer: (playerId, amount, ownerId) => {
    let killPosition: Vec3 | null = null;
    let hurtPosition: Vec3 | null = null;
    set((state) => {
      if (state.mode === "client") return state;
      const player = state.players[playerId];
      if (!player || player.isShielded || player.status === "dead") return state;
      const health = Math.max(0, player.health - amount);
      hurtPosition = player.position;
      const players = {
        ...state.players,
        [playerId]:
          health <= 0
            ? { ...player, health: 0, status: "dead" as const, respawnAt: now() + 5000 }
            : { ...player, health },
      };
      const owner = players[ownerId];
      if (health <= 0 && owner && ownerId !== playerId) {
        players[ownerId] = { ...owner, score: owner.score + 1 };
        killPosition = player.position;
      }
      return { players };
    });
    const listener = get().players[get().localPlayerId]?.position;
    if (killPosition) {
      audioRuntime.play("wizard_death", { position: killPosition, listener });
      get().dropManaMotesAt(killPosition);
    } else if (hurtPosition) {
      audioRuntime.play("wizard_hurt", { position: hurtPosition, listener, volume: 0.8 });
    }
  },

  applyStatusEffect: (playerId, effect, ownerId, sourceSpellId, durationMs, strength) =>
    set((state) => {
      if (state.mode === "client") return state;
      const player = state.players[playerId];
      if (!player || player.status === "dead" || player.isShielded) return state;
      const expiresAt = now() + durationMs;
      const owner = state.players[ownerId];
      const knockback = effect === "stagger" || effect === "crush";
      const dx = owner ? player.position[0] - owner.position[0] : 0;
      const dz = owner ? player.position[2] - owner.position[2] : 0;
      const len = Math.hypot(dx, dz) || 1;
      const distance = knockback ? Math.min(5, 1.4 + strength * 0.9) : 0;
      const px = player.position[0] + (dx / len) * distance;
      const pz = player.position[2] + (dz / len) * distance;
      const position: Vec3 = knockback ? [px, getGroundHeight(px, pz), pz] : player.position;
      const statusEffects = [
        ...player.statusEffects.filter((item) => item.effect !== effect || item.sourceSpellId !== sourceSpellId),
        { id: `${sourceSpellId}-${effect}-${expiresAt}`, effect, ownerId, sourceSpellId, expiresAt, strength, lastTickAt: 0 },
      ];
      return { players: { ...state.players, [playerId]: { ...player, position, statusEffects } } };
    }),

  tickStatusEffects: () =>
    set((state) => {
      if (state.mode === "client") return state;
      const timestamp = now();
      const players = { ...state.players };
      for (const player of Object.values(players)) {
        const statusEffects = player.statusEffects.filter((effect) => effect.expiresAt > timestamp);
        if (statusEffects.length !== player.statusEffects.length) {
          players[player.id] = { ...player, statusEffects };
        }
      }
      return { players };
    }),

  tickRespawns: () =>
    set((state) => {
      if (state.mode === "client") return state;
      const timestamp = now();
      const players = { ...state.players };
      const spawnedPositions: Vec3[] = [];
      Object.values(players).forEach((player) => {
        if (player.status === "dead" && player.respawnAt && player.respawnAt <= timestamp) {
          const position = randomRespawnPoint();
          players[player.id] = {
            ...player,
            position,
            health: PLAYER_MAX_HEALTH,
            mana: PLAYER_MAX_MANA,
            status: "alive",
            statusEffects: [],
            respawnAt: null,
          };
          spawnedPositions.push(position);
        }
      });
      const listener = state.players[state.localPlayerId]?.position;
      for (const position of spawnedPositions) audioRuntime.play("wizard_spawn", { position, listener });
      return {
        players,
        dummyTargets: state.dummyTargets.map((dummy) =>
          dummy.respawnAt && dummy.respawnAt <= timestamp ? { ...dummy, health: dummy.maxHealth, respawnAt: null } : dummy,
        ),
      };
    }),

  tickAreas: () =>
    set((state) => {
      const timestamp = now();
      return { areas: state.areas.filter((area) => area.expiresAt > timestamp) };
    }),

  resetMatch: () => {
    projectileMotion.clear();
    const state = get();
    if (state.mode === "client") {
      set({ projectileIds: [], castVfx: [], areas: [], log: ["Awaiting host snapshot.", ...state.log].slice(0, 5) });
      return;
    }
    const currentPlayer = state.players[state.localPlayerId] ?? createLocalPlayer();
    const localPlayer = {
      ...createLocalPlayer(),
      id: state.localPlayerId,
      name: currentPlayer.name,
      color: currentPlayer.color,
    };
    set({
      players: { [state.localPlayerId]: localPlayer },
      crystals: INITIAL_CRYSTALS.map((crystal) => ({ ...crystal })),
      manaMotes: INITIAL_MANA_MOTES.map((mote) => ({ ...mote })),
      projectileIds: [],
      castVfx: [],
      areas: [],
      dummyTargets: DUMMY_TARGETS.map((dummy) => ({ ...dummy })),
      hostSnapshotSequence: 0,
      lastHostSnapshot: null,
      lastLocalCast: null,
      lastCrystalCollect: null,
      lastManaMoteCollect: null,
      lastSanctuaryEvent: null,
      lastSpellBound: null,
      promptOpen: false,
      selectedSlot: 0,
      sanctuaryEndsAt: null,
      sanctuaryPausedRemainingMs: null,
      log: ["Match reset."],
    });
  },
}));

export { MAGIC_MISSILE };

function initialVelocityFor(spell: GeneratedSpell, origin: Vec3, target: Vec3, direction: Vec3): Vec3 {
  if (spell.deliveryVehicle !== "projectile_arcing") {
    return [direction[0] * spell.speed, direction[1] * spell.speed, direction[2] * spell.speed];
  }
  const dx = target[0] - origin[0];
  const dz = target[2] - origin[2];
  const horizontalDistance = Math.max(1, Math.hypot(dx, dz));
  const travelTime = Math.max(0.6, horizontalDistance / Math.max(6, spell.speed));
  const gravity = -18;
  return [
    dx / travelTime,
    (target[1] - origin[1] - 0.5 * gravity * travelTime * travelTime) / travelTime,
    dz / travelTime,
  ];
}

function skyfallHeight(spell: GeneratedSpell): number {
  return Math.max(34, Math.min(54, 34 + spell.powerTier * 3 + spell.buildSpec.modifiers.scale * 4));
}

function skyfallTravelMs(spell: GeneratedSpell): number {
  return Math.round(Math.max(1250, Math.min(2300, 1750 + spell.powerTier * 90 + (spell.buildSpec.modifiers.scale - 1) * 180)));
}
