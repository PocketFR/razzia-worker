import type { GameResultMeta, QuizzMeta } from "@razzia/common/types/game"

export interface ManagerConfig {
  /* Public : le flux PKCE l'expose de toute façon au navigateur, qui en a
     besoin pour ouvrir la session Spotify. */
  spotifyClientId: string | null
  quizz: QuizzMeta[]
  results: GameResultMeta[]
}
