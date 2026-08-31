import {
  TYPE_GROUPE,
  type MEDIA_TYPES,
  type QUESTION_TYPES,
  type SCORING_MODES,
} from "@razzia/common/constants"

export type QuestionType = (typeof QUESTION_TYPES)[keyof typeof QUESTION_TYPES]

export type ScoringMode = (typeof SCORING_MODES)[keyof typeof SCORING_MODES]

export interface MultiQuestionOptions {
  scoringMode: ScoringMode
}

export type QuestionOptions = MultiQuestionOptions

export interface Player {
  id: string
  clientId: string
  connected: boolean
  username: string
  points: number
  streak: number
}

export interface Answer {
  playerId: string
  answerIds: number[]
  points: number
}

export type QuestionMediaType =
  | (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES]
  | undefined

export interface QuestionMedia {
  type?: QuestionMediaType
  url: string
}

export interface Question {
  type: QuestionType
  question: string
  media?: QuestionMedia
  answers: string[]
  solutions: number[]
  cooldown: number
  time: number
  maxPoints?: number
  penalty?: number
  options?: QuestionOptions
}

// Un groupe de questions à élimination — un « interlude ».
//
// Ses questions s'enchaînent comme les autres, mais qui se trompe est écarté
// du reste du groupe. Il s'arrête quand ses questions sont épuisées ou qu'il
// reste moins de deux joueurs en lice. Le pot, s'il y en a un, se partage
// entre les survivants — rien du tout s'il n'en reste aucun.
//
// `questions` est un tableau de Question et NON de BlocQuizz : c'est ainsi
// qu'un groupe dans un groupe devient impossible à écrire, plutôt qu'une règle
// à vérifier. Une élimination dans une élimination n'aurait aucun sens.
export interface Groupe {
  type: typeof TYPE_GROUPE
  titre?: string
  points?: number
  questions: Question[]
}

/** Ce que contient un quiz : des questions, et des groupes de questions. */
export type BlocQuizz = Question | Groupe

export const estGroupe = (bloc: BlocQuizz): bloc is Groupe =>
  bloc.type === TYPE_GROUPE

export interface Quizz {
  subject: string
  questions: BlocQuizz[]
}

export type QuizzWithId = Quizz & { id: string }

export interface QuizzMeta {
  id: string
  subject: string
}

export interface GameUpdateQuestion {
  current: number
  total: number
}

export interface PlayerAnswerRecord {
  playerName: string
  answerIds: number[] | null
}

export type QuestionResult = Question & {
  playerAnswers: PlayerAnswerRecord[]
}

export interface GameResultPlayer {
  username: string
  points: number
  rank: number
}

export interface GameResult {
  id: string
  subject: string
  date: string
  players: GameResultPlayer[]
  questions: QuestionResult[]
}

export interface GameResultMeta {
  id: string
  subject: string
  date: string
  playerCount: number
}
