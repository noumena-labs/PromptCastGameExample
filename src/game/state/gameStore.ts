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
  CrystalState,
  DummyTarget,
  GeneratedSpell,
  LobbyPlayer,
  ManaMoteState,
  MatchMode,
  PlayerState,
  SequencedCastPayload,
  SequencedCrystalPayload,
  Vec3,
} from "@/game/types";
import { projectileMotion } from "@/game/state/projectileMotion";

const now = () => Date.now();

const createLocalPlayer = (): PlayerState => ({
  id: LOCAL_PLAYER_ID,
  name: "You",
  color: "#74f7d0",
  position: PLAYER_SPAWN_POINTS[0],
  rotationY: 0,
  velocity: [0, 0, 0],
  health: PLAYER_MAX_HEALTH,
  mana: PLAYER_MAX_MANA,
  aura: 0,
  score: 0,
  status: "alive",
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
  areas: AreaSpellState[];
  dummyTargets: DummyTarget[];
  promptOpen: boolean;
  selectedSlot: number;
  sanctuaryEndsAt: number | null;
  lastGenerationSource: "cogentlm" | "fallback" | null;
  networkSequence: number;
  lastLocalCast: SequencedCastPayload | null;
  lastCrystalCollect: SequencedCrystalPayload | null;
  log: string[];
  setMode: (mode: MatchMode, roomCode?: string | null) => void;
  setLocalIdentity: (id: string, name: string, color: string) => void;
  setLocalPlayerProfile: (name: string, color: string) => void;
  setLobbyPlayers: (players: LobbyPlayer[]) => void;
  addLog: (message: string) => void;
  updateLocalTransform: (position: Vec3, rotationY: number, velocity: Vec3) => void;
  upsertRemotePlayer: (player: Partial<PlayerState> & Pick<PlayerState, "id" | "name" | "color">) => void;
  removePlayer: (playerId: string) => void;
  regenerateMana: (delta: number) => void;
  collectCrystal: (crystalId: string) => void;
  collectCrystalForPlayer: (crystalId: string, playerId: string) => void;
  applyCrystalState: (crystals: CrystalState[]) => void;
  respawnCrystals: () => void;
  collectManaMote: (moteId: string) => void;
  applyManaMoteState: (manaMotes: ManaMoteState[]) => void;
  respawnManaMotes: () => void;
  dropManaMotesAt: (position: Vec3, count?: number) => void;
  enterSanctuary: () => boolean;
  exitSanctuary: () => void;
  setSelectedSlot: (slot: number) => void;
  saveGeneratedSpell: (spell: GeneratedSpell, source: "cogentlm" | "fallback") => void;
  castSpell: (spell: GeneratedSpell, origin: Vec3, direction: Vec3, ownerId?: string) => boolean;
  castSlot: (slot: number, origin: Vec3, direction: Vec3) => boolean;
  tickCooldowns: () => void;
  removeProjectile: (projectileId: string) => void;
  damageDummy: (dummyId: string, amount: number, ownerId: string) => void;
  damagePlayer: (playerId: string, amount: number, ownerId: string) => void;
  tickRespawns: () => void;
  tickAreas: () => void;
  resetMatch: () => void;
};

const moteRespawnDelay = () =>
  MANA_MOTE_RESPAWN_MIN_MS + Math.random() * (MANA_MOTE_RESPAWN_MAX_MS - MANA_MOTE_RESPAWN_MIN_MS);

export const useGameStore = create<GameStore>((set, get) => ({
  mode: "solo",
  roomCode: null,
  localPlayerId: LOCAL_PLAYER_ID,
  players: { [LOCAL_PLAYER_ID]: createLocalPlayer() },
  lobbyPlayers: [],
  crystals: INITIAL_CRYSTALS,
  manaMotes: INITIAL_MANA_MOTES,
  projectileIds: [],
  areas: [],
  dummyTargets: DUMMY_TARGETS,
  promptOpen: false,
  selectedSlot: 0,
  sanctuaryEndsAt: null,
  lastGenerationSource: null,
  networkSequence: 0,
  lastLocalCast: null,
  lastCrystalCollect: null,
  log: ["PromptCast prototype initialized."],

  setMode: (mode, roomCode = null) => set({ mode, roomCode }),

  setLocalIdentity: (id, name, color) =>
    set((state) => {
      const current = state.players[state.localPlayerId] ?? createLocalPlayer();
      const players = { ...state.players };
      delete players[state.localPlayerId];
      players[id] = { ...current, id, name, color };
      return { localPlayerId: id, players };
    }),

  setLocalPlayerProfile: (name, color) =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      if (!player) return state;
      return { players: { ...state.players, [player.id]: { ...player, name, color } } };
    }),

  setLobbyPlayers: (lobbyPlayers) => set({ lobbyPlayers }),

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
            spellSlots: incoming.spellSlots ?? existing?.spellSlots ?? [null, null, null, null],
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

  respawnCrystals: () =>
    set((state) => ({
      crystals: state.crystals.map((crystal) =>
        !crystal.active && crystal.respawnAt && crystal.respawnAt <= now() ? { ...crystal, active: true, respawnAt: null } : crystal,
      ),
    })),

  collectManaMote: (moteId) =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      const mote = state.manaMotes.find((item) => item.id === moteId);
      if (!player || !mote?.active || player.status === "dead") return state;
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
    set({
      promptOpen: true,
      sanctuaryEndsAt: now() + SANCTUARY_DURATION_MS,
      players: {
        ...state.players,
        [player.id]: { ...player, aura: player.aura - AURA_THRESHOLD, status: "sanctuary", isShielded: true, velocity: [0, 0, 0] },
      },
      log: ["Sanctuary opened. Inscribe a Nam-shub.", ...state.log].slice(0, 5),
    });
    return true;
  },

  exitSanctuary: () =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      if (!player) return { promptOpen: false, sanctuaryEndsAt: null };
      return {
        promptOpen: false,
        sanctuaryEndsAt: null,
        players: {
          ...state.players,
          [player.id]: { ...player, status: player.health > 0 ? "alive" : "dead", isShielded: false },
        },
      };
    }),

  setSelectedSlot: (selectedSlot) => set({ selectedSlot: Math.max(0, Math.min(3, selectedSlot)) }),

  saveGeneratedSpell: (spell, source) =>
    set((state) => {
      const player = state.players[state.localPlayerId];
      if (!player) return state;
      const slots = [...player.spellSlots];
      slots[state.selectedSlot] = spell;
      return {
        promptOpen: false,
        sanctuaryEndsAt: null,
        lastGenerationSource: source,
        players: {
          ...state.players,
          [player.id]: { ...player, status: "alive", isShielded: false, spellSlots: slots },
        },
        log: [`Bound ${spell.name} to runestone ${state.selectedSlot + 1} (${source}).`, ...state.log].slice(0, 5),
      };
    }),

  castSpell: (spell, origin, direction, ownerId = get().localPlayerId) => {
    const state = get();
    const player = state.players[ownerId];
    const timestamp = now();
    if (!player || player.status === "dead") return false;
    if (ownerId === state.localPlayerId && player.status === "sanctuary") return false;
    if (ownerId === state.localPlayerId && (player.cooldowns[spell.id] ?? 0) > timestamp) return false;
    if (ownerId === state.localPlayerId && player.mana < spell.manaCost) return false;

    const cooldowns = ownerId === state.localPlayerId ? { ...player.cooldowns, [spell.id]: timestamp + spell.cooldownMs } : player.cooldowns;
    const nextPlayer = ownerId === state.localPlayerId ? { ...player, mana: Math.max(0, player.mana - spell.manaCost), cooldowns } : player;
    const common = {
      id: `${spell.id}-${timestamp}-${Math.random().toString(16).slice(2)}`,
      ownerId,
      spell,
      position: origin,
      createdAt: timestamp,
      expiresAt: timestamp + spell.durationMs,
    };

    if (spell.shape === "aoe" || spell.shape === "vortex" || spell.shape === "burst" || spell.shape === "wall" || spell.shape === "trap") {
      const sequence = ownerId === state.localPlayerId ? state.networkSequence + 1 : state.networkSequence;
      const localNetworkUpdate =
        ownerId === state.localPlayerId ? { networkSequence: sequence, lastLocalCast: { sequence, playerId: ownerId, spell, origin, direction } } : {};

      set({
        ...localNetworkUpdate,
        players: { ...state.players, [ownerId]: nextPlayer },
        areas: [...state.areas, { ...common, tickedAt: {} }],
      });
      return true;
    }

    const sequence = ownerId === state.localPlayerId ? state.networkSequence + 1 : state.networkSequence;
    const localNetworkUpdate =
      ownerId === state.localPlayerId ? { networkSequence: sequence, lastLocalCast: { sequence, playerId: ownerId, spell, origin, direction } } : {};

    projectileMotion.register({
      id: common.id,
      ownerId,
      spell,
      position: origin,
      direction,
      createdAt: timestamp,
      expiresAt: common.expiresAt,
    });

    set({
      ...localNetworkUpdate,
      players: { ...state.players, [ownerId]: nextPlayer },
      projectileIds: [...state.projectileIds, common.id],
    });
    return true;
  },

  castSlot: (slot, origin, direction) => {
    const player = get().players[get().localPlayerId];
    const spell = player?.spellSlots[slot];
    if (!spell) return false;
    return get().castSpell(spell, origin, direction);
  },

  tickCooldowns: () => set((state) => ({ players: { ...state.players } })),

  removeProjectile: (projectileId) => {
    projectileMotion.unregister(projectileId);
    set((state) => ({ projectileIds: state.projectileIds.filter((id) => id !== projectileId) }));
  },

  damageDummy: (dummyId, amount, ownerId) => {
    let scoredPosition: Vec3 | null = null;
    set((state) => {
      const dummyTargets = state.dummyTargets.map((dummy) => {
        if (dummy.id !== dummyId || dummy.respawnAt) return dummy;
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
    if (scoredPosition) get().dropManaMotesAt(scoredPosition);
  },

  damagePlayer: (playerId, amount, ownerId) => {
    let killPosition: Vec3 | null = null;
    set((state) => {
      const player = state.players[playerId];
      if (!player || player.isShielded || player.status === "dead") return state;
      const health = Math.max(0, player.health - amount);
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
    if (killPosition) get().dropManaMotesAt(killPosition);
  },

  tickRespawns: () =>
    set((state) => {
      const timestamp = now();
      const players = { ...state.players };
      Object.values(players).forEach((player, index) => {
        if (player.status === "dead" && player.respawnAt && player.respawnAt <= timestamp) {
          players[player.id] = {
            ...player,
            position: PLAYER_SPAWN_POINTS[index % PLAYER_SPAWN_POINTS.length],
            health: PLAYER_MAX_HEALTH,
            mana: PLAYER_MAX_MANA,
            status: "alive",
            respawnAt: null,
          };
        }
      });
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
    set({
      players: { [LOCAL_PLAYER_ID]: createLocalPlayer() },
      crystals: INITIAL_CRYSTALS.map((crystal) => ({ ...crystal })),
      manaMotes: INITIAL_MANA_MOTES.map((mote) => ({ ...mote })),
      projectileIds: [],
      areas: [],
      dummyTargets: DUMMY_TARGETS.map((dummy) => ({ ...dummy })),
      promptOpen: false,
      selectedSlot: 0,
      sanctuaryEndsAt: null,
      log: ["Match reset."],
    });
  },
}));

export { MAGIC_MISSILE };
