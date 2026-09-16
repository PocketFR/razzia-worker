import type { QuestionOptions } from "@razzia/common/types/game"

export interface AnswerComponentProps {
  answers: string[]
  options?: QuestionOptions
  onSubmit: (_answerKeys: number[]) => void
  readOnly?: boolean
  /**
   * La graine du mélange, pour les types dont l'ordre d'affichage ne doit pas
   * être celui du quiz — le classement, dont les réponses y sont écrites dans
   * le bon ordre. Absente ailleurs.
   */
  graine?: number
}

/**
 * L'écran des réponses, quand le dépouillement ordinaire n'a rien à dire.
 *
 * Les barres comptent les joueurs par réponse ; sur un classement, chacune
 * est choisie exactement une fois par joueur et les barres sont toutes
 * égales. Un type peut donc fournir sa propre révélation.
 */
export interface ResultsComponentProps {
  answers: string[]
  solutions: number[]
  /** Combien ont répondu sans la moindre faute, sur combien de réponses. */
  sansFaute: number
  repondants: number
}

export interface SolutionPickerProps {
  index: number
  isSelected: boolean
}
