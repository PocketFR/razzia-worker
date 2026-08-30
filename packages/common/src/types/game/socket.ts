import { EVENTS } from "@razzia/common/constants"
import type {
  GameResult,
  GameUpdateQuestion,
  Player,
  QuizzWithId,
} from "@razzia/common/types/game"
import type { Status, StatusDataMap } from "@razzia/common/types/game/status"
import type { ManagerConfig } from "@razzia/common/types/manager"
import type { Server as ServerIO, Socket as SocketIO } from "socket.io"

export type Server = ServerIO<ClientToServerEvents, ServerToClientEvents>

export type Socket = SocketIO<ClientToServerEvents, ServerToClientEvents>

export interface Message<K extends keyof StatusDataMap = keyof StatusDataMap> {
  gameId?: string
  status: K
  data: StatusDataMap[K]
}

export interface MessageWithoutStatus<T = unknown> {
  gameId?: string
  data: T
}

export interface MessageGameId {
  gameId?: string
}

export interface ServerToClientEvents {
  connect: () => void

  // Game events
  /* seq croît strictement à chaque statut émis. Il sert au client à écarter
     ce qui est déjà dépassé : une connexion qui se débloque délivre d'un
     coup tout ce qu'elle retenait, et rejouer ces écrans les uns après les
     autres donnait une cascade illisible. */
  [EVENTS.GAME.STATUS]: (_data: {
    name: Status
    data: StatusDataMap[Status]
    seq?: number
  }) => void
  [EVENTS.GAME.SUCCESS_ROOM]: (_data: string) => void
  [EVENTS.GAME.SUCCESS_JOIN]: (_gameId: string) => void
  [EVENTS.GAME.TOTAL_PLAYERS]: (_count: number) => void
  [EVENTS.GAME.ERROR_MESSAGE]: (_message: string) => void
  [EVENTS.GAME.START_COOLDOWN]: (_data: { endsAt: number }) => void
  [EVENTS.GAME.AUDIO_CUE]: (_data: { id: string; depart: number }) => void
  [EVENTS.GAME.COOLDOWN]: (_count: number) => void
  [EVENTS.GAME.RESET]: (_message: string) => void
  /* Null remet le compteur à néant : c'est ce qui se passe quand la salle
     revient en attente entre deux quiz, l'avancement du précédent n'ayant
     plus aucun sens. */
  [EVENTS.GAME.UPDATE_QUESTION]: (_data: null | {
    current: number
    total: number
  }) => void
  [EVENTS.GAME.PLAYER_ANSWER]: (_count: number) => void

  // Player events
  [EVENTS.PLAYER.CHECK_PIN_RESULT]: (_data: { valid: boolean }) => void
  [EVENTS.PLAYER.SUCCESS_RECONNECT]: (_data: {
    gameId: string
    status: { name: Status; data: StatusDataMap[Status] }
    player: { username: string; points: number }
    /* Null tant que la manche n'a pas démarré : le salon d'attente ne doit
       pas afficher « 1 / 20 », il n'y a pas encore de question en cours. */
    currentQuestion: GameUpdateQuestion | null
  }) => void
  [EVENTS.PLAYER.UPDATE_LEADERBOARD]: (_data: { leaderboard: Player[] }) => void

  // Manager events
  [EVENTS.MANAGER.SUCCESS_RECONNECT]: (_data: {
    gameId: string
    status: { name: Status; data: StatusDataMap[Status] }
    players: Player[]
    currentQuestion: GameUpdateQuestion | null
  }) => void
  [EVENTS.MANAGER.CONFIG]: (_config: ManagerConfig) => void
  [EVENTS.QUIZZ.DATA]: (_quizz: QuizzWithId) => void
  [EVENTS.MANAGER.GAME_CREATED]: (_data: {
    gameId: string
    inviteCode: string
  }) => void
  [EVENTS.MANAGER.STATUS_UPDATE]: (_data: {
    status: Status
    data: StatusDataMap[Status]
  }) => void
  [EVENTS.MANAGER.NEW_PLAYER]: (_player: Player) => void
  [EVENTS.MANAGER.REMOVE_PLAYER]: (_playerId: string) => void
  [EVENTS.MANAGER.ERROR_MESSAGE]: (_message: string) => void
  [EVENTS.MANAGER.PLAYER_KICKED]: (_playerId: string) => void
  [EVENTS.MANAGER.UNAUTHORIZED]: () => void
  [EVENTS.SETTINGS.DATA]: (_data: { keys: CleApi[] }) => void
  [EVENTS.SETTINGS.ERROR]: (_message: string) => void
  [EVENTS.SETTINGS.PASSWORD_OK]: () => void

  // Quizz events
  [EVENTS.QUIZZ.SAVE_SUCCESS]: (_data: { id: string }) => void
  [EVENTS.QUIZZ.UPDATE_SUCCESS]: (_data: { id: string }) => void
  [EVENTS.QUIZZ.ERROR]: (_message: string) => void

  // Results events
  [EVENTS.RESULTS.DATA]: (_result: GameResult) => void
}

export interface CleApi {
  nom: string
  secrete: boolean
  definie: boolean
  origine: "base" | "liaison" | "absente"
  modifiee: number | null
  /* Absente pour un secret : une valeur scellée ne ressort jamais. */
  valeur?: string
}

export interface ClientToServerEvents {
  // Manager actions
  [EVENTS.GAME.CREATE]: (_quizzId: string) => void
  [EVENTS.MANAGER.AUTH]: (_password: string) => void
  [EVENTS.MANAGER.RECONNECT]: (_message: { gameId: string }) => void
  [EVENTS.MANAGER.LEAVE]: (_message: { gameId: string }) => void
  [EVENTS.MANAGER.KICK_PLAYER]: (_message: {
    gameId: string
    playerId: string
  }) => void
  [EVENTS.MANAGER.START_GAME]: (_message: MessageGameId) => void
  [EVENTS.MANAGER.ABORT_QUIZ]: (_message: MessageGameId) => void
  [EVENTS.MANAGER.NEXT_QUESTION]: (_message: MessageGameId) => void
  /* Enchaîne un autre quiz dans la MÊME salle : le PIN, le QR et les joueurs
     connectés sont conservés. resetScores décide si le classement repart de
     zéro ou se cumule sur la soirée. */
  [EVENTS.MANAGER.NEW_QUIZZ]: (
    _message: MessageWithoutStatus<{ quizzId: string; resetScores: boolean }>,
  ) => void
  [EVENTS.MANAGER.SHOW_LEADERBOARD]: (_message: MessageGameId) => void
  [EVENTS.MANAGER.GET_CONFIG]: () => void
  [EVENTS.MANAGER.LOGOUT]: () => void
  [EVENTS.SETTINGS.GET]: () => void
  [EVENTS.SETTINGS.SAVE]: (_valeurs: Record<string, string>) => void
  [EVENTS.SETTINGS.PASSWORD]: (_data: {
    actuel: string
    nouveau: string
  }) => void

  // Quizz actions
  [EVENTS.QUIZZ.GET]: (_id: string) => void
  [EVENTS.QUIZZ.SAVE]: (_quizz: unknown) => void
  [EVENTS.QUIZZ.UPDATE]: (_data: QuizzWithId) => void
  [EVENTS.QUIZZ.DELETE]: (_id: string) => void

  // Player actions
  [EVENTS.PLAYER.CHECK_PIN]: (_inviteCode: string) => void
  [EVENTS.PLAYER.JOIN]: (_inviteCode: string) => void
  [EVENTS.PLAYER.LOGIN]: (
    _message: MessageWithoutStatus<{ username: string }>,
  ) => void
  [EVENTS.PLAYER.RECONNECT]: (_message: { gameId: string }) => void
  [EVENTS.PLAYER.LEAVE]: (_message: { gameId: string }) => void
  [EVENTS.PLAYER.SELECTED_ANSWER]: (
    _message: MessageWithoutStatus<{ answerKeys: number[] }>,
  ) => void

  // Results actions
  [EVENTS.RESULTS.GET]: (_id: string) => void
  [EVENTS.RESULTS.DELETE]: (_id: string) => void

  // Common
  disconnect: () => void
}
