import { SCORING_MODES } from "@razzia/common/constants"
import type {
  MultiQuestionOptions,
  ScoringMode,
} from "@razzia/common/types/game"

export { default as AnswerComponent } from "@razzia/web/features/questions/classement/components/ClassementAnswers"

export { default as AnswersEditor } from "@razzia/web/features/questions/classement/components/ClassementEditor"

export { default as ResultsComponent } from "@razzia/web/features/questions/classement/components/ClassementResults"

export { default as ConfigComponent } from "@razzia/web/features/questions/multi/components/MultiConfig"

// Rien à cocher : la bonne réponse est l'ordre de saisie, et c'est la colonne
// de l'éditeur qui la porte. Le registre attend l'entrée, la grille ordinaire
// ne s'affiche jamais pour ce type.
export const SolutionPicker = () => null

export const labelKey = "quizz:questionType.classement"

export const defaultOptions: MultiQuestionOptions = {
  scoringMode: SCORING_MODES.BALANCED,
}

// Les trois mêmes réglages que le choix multiple, et ils veulent dire la même
// chose : tout ou rien, les bonnes moins les mauvaises, les bonnes seules —
// appliqués aux paires d'éléments plutôt qu'aux cases cochées. Voir
// `packages/socket/src/services/scoring/classement.ts`.
export const scoringModes: ScoringMode[] = [
  SCORING_MODES.STRICT,
  SCORING_MODES.BALANCED,
  SCORING_MODES.LENIENT,
]
