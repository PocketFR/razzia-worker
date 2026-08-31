import type { Player } from "@razzia/common/types/game"
import type { StatusDataMap } from "@razzia/common/types/game/status"
import type { ManagerConfig } from "@razzia/common/types/manager"
import {
  createStatus,
  type Status,
} from "@razzia/web/features/game/utils/createStatus"
import { create } from "zustand"

interface ManagerStore<T> {
  config: ManagerConfig | null

  gameId: string | null
  // Conservé à part du statut : l'écran d'accueil qui le porte disparaît dès
  // le lancement, or le QR incrusté doit rester disponible toute la partie.
  inviteCode: string | null
  status: Status<T> | null
  players: Player[]

  setConfig: (_config: ManagerConfig) => void
  setGameId: (_gameId: string | null) => void
  setInviteCode: (_code: string | null) => void
  setStatus: <K extends keyof T>(_name: K, _data: T[K]) => void
  resetStatus: () => void
  setPlayers: (_players: Player[]) => void

  reset: () => void
}

const initialState = {
  config: null,
  gameId: null,
  inviteCode: null,
  status: null,
  players: [],
}

export const useManagerStore = create<ManagerStore<StatusDataMap>>((set) => ({
  ...initialState,

  setConfig: (config) => set({ config }),

  setGameId: (gameId) => set({ gameId }),

  setInviteCode: (inviteCode) => set({ inviteCode }),

  setStatus: (name, data) => set({ status: createStatus(name, data) }),
  resetStatus: () => set({ status: null }),

  setPlayers: (players) => set({ players }),

  reset: () => set(initialState),
}))
