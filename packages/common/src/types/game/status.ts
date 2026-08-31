import type {
  Player,
  QuestionMedia,
  QuestionOptions,
  QuestionType,
} from "@razzia/common/types/game"

export const STATUS = {
  SHOW_ROOM: "SHOW_ROOM",
  SHOW_START: "SHOW_START",
  SHOW_PREPARED: "SHOW_PREPARED",
  SHOW_QUESTION: "SHOW_QUESTION",
  SELECT_ANSWER: "SELECT_ANSWER",
  SHOW_RESULT: "SHOW_RESULT",
  SHOW_RESPONSES: "SHOW_RESPONSES",
  SHOW_LEADERBOARD: "SHOW_LEADERBOARD",
  /* Fin d'un interlude : la liste de ceux qui restaient debout. */
  SHOW_SURVIVORS: "SHOW_SURVIVORS",
  FINISHED: "FINISHED",
  WAIT: "WAIT",
} as const

export type Status = (typeof STATUS)[keyof typeof STATUS]

export interface CommonStatusDataMap {
  SHOW_START: { time: number; subject: string }
  SHOW_PREPARED: { totalAnswers: number; questionNumber: number }
  SHOW_QUESTION: {
    question: string
    media?: QuestionMedia
    cooldown: number
    // Date de fin de phase, en ms epoch. Le serveur n'égrène plus le
    // décompte : il annonce l'échéance, le client la rend.
    endsAt: number
  }
  SELECT_ANSWER: {
    question: string
    answers: string[]
    media?: QuestionMedia
    time: number
    // Null quand la question est sans limite de temps : il n'y a alors
    // aucune échéance à afficher, et aucune alarme côté serveur.
    endsAt: number | null
    totalPlayer: number
    questionType: QuestionType
    options?: QuestionOptions
    // Vrai pour un joueur écarté d'un interlude. Il voit le même écran que
    // les autres — la question, le décompte, le média — mais ses boutons sont
    // inertes. Le champ n'est posé que sur le statut PERSONNEL des éliminés,
    // jamais sur la diffusion générale.
    elimine?: boolean
  }
  SHOW_RESULT: {
    correct: boolean
    message: string
    points: number
    myPoints: number
    rank: number
    aheadOfMe: string | null
  }
  WAIT: { text: string }
  FINISHED: { subject: string; top: Player[]; rank?: number }
}

interface ManagerExtraStatus {
  SHOW_ROOM: { text: string; inviteCode?: string }
  SHOW_RESPONSES: {
    question: string
    responses: Record<number, number>
    solutions: number[]
    answers: string[]
    media?: QuestionMedia
  }
  SHOW_LEADERBOARD: { oldLeaderboard: Player[]; leaderboard: Player[] }
  // Fin d'un interlude. `survivants` est vide quand tout le monde s'est
  // trompé au même tour : personne ne gagne, et l'écran le dit.
  //
  // `points` est ce que chacun ramasse, le pot divisé par le nombre de
  // survivants — absent quand le groupe n'attribue rien.
  SHOW_SURVIVORS: {
    titre?: string
    survivants: string[]
    points?: number
  }
}

export type PlayerStatusDataMap = CommonStatusDataMap

export type ManagerStatusDataMap = CommonStatusDataMap & ManagerExtraStatus

export type StatusDataMap = PlayerStatusDataMap & ManagerStatusDataMap
