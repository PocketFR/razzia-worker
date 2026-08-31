import type { Tirage } from "@razzia/common/paris"
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
  // Le tirage d'un pari, joué après la fermeture des mises.
  SHOW_DRAW: "SHOW_DRAW",
  SHOW_RESULT: "SHOW_RESULT",
  SHOW_RESPONSES: "SHOW_RESPONSES",
  SHOW_LEADERBOARD: "SHOW_LEADERBOARD",
  // Annonce d'un interlude, avant sa première question.
  SHOW_INTERLUDE: "SHOW_INTERLUDE",
  // Fin d'un interlude, côté joueur : survécu ou éliminé.
  SHOW_INTERLUDE_END: "SHOW_INTERLUDE_END",
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
    // Présent pour un pari qui se joue AVANT les mises — le bonneteau. Le
    // mélange occupe alors la durée du `cooldown`, et le client le rejoue à
    // partir de la graine.
    pari?: Tirage
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
  // Le tirage d'un pari joué après les mises : rouge ou noir, PMU. Les mises
  // sont closes, l'animation peut donc porter le résultat sans rien divulguer
  // d'avance.
  SHOW_DRAW: {
    pari: Tirage
    duree: number
    endsAt: number
    // Les libellés du quiz. Ils ne servent qu'aux paris dont les choix se
    // nomment — les chevaux du PMU ; les autres tirent leurs libellés de leur
    // habillage, et restent donc traduits.
    noms: string[]
  }
  // L'annonce d'un interlude. Tout le monde la voit — c'est le moment où
  // l'on comprend que les règles changent.
  SHOW_INTERLUDE: {
    titre?: string
    points?: number
    questions: number
  }
  // Ce que chaque joueur apprend à la fin d'un interlude. `points` n'est
  // présent que pour un survivant d'un groupe qui en attribuait.
  SHOW_INTERLUDE_END: {
    titre?: string
    survecu: boolean
    points?: number
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
    // Le type sert à l'affichage : un pari dont les choix ne se nomment pas
    // tire ses libellés de son habillage, traduit, et non du quiz.
    questionType: QuestionType
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
