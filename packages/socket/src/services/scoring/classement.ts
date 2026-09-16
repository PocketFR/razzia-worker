import { QUESTION_TYPES, SCORING_MODES } from "@razzia/common/constants"
import {
  estClassementComplet,
  pairesDuClassement,
} from "@razzia/common/classement"
import type { Question } from "@razzia/common/types/game"
import type { ScoringFn } from "@razzia/socket/services/scoring"

export const type = QUESTION_TYPES.CLASSEMENT

// Les trois modes des questions à choix multiple, transposés aux paires.
//
// La paire est l'unité de mesure d'un classement : deux éléments sont dans le
// bon ordre l'un par rapport à l'autre, ou non. Compter les PLACES aurait
// donné zéro à qui tourne sa liste d'un cran, alors qu'il tenait tout
// l'enchaînement ; compter les paires lui en laisse la moitié, et ne fait
// payer qu'une paire sur six à qui échange deux voisins.
//
// Les formules sont exactement celles de `multi`, pour que les trois réglages
// veuillent dire la même chose d'un type à l'autre : tout ou rien, les bonnes
// moins les mauvaises, les bonnes seules.
const SCORING_BY_MODE = [
  {
    mode: SCORING_MODES.STRICT,
    compute: (_bien: number, mal: number, total: number) =>
      total > 0 && mal === 0 ? 1 : 0,
  },
  {
    mode: SCORING_MODES.BALANCED,
    compute: (bien: number, mal: number, total: number) =>
      total === 0 ? 0 : Math.max((bien - mal) / total, 0),
  },
  {
    mode: SCORING_MODES.LENIENT,
    compute: (bien: number, _mal: number, total: number) =>
      total === 0 ? 0 : bien / total,
  },
]

export const scoring: ScoringFn = (
  question: Question,
  answerIds: number[],
): number => {
  // UNE PROPOSITION INCOMPLÈTE NE VAUT RIEN. Le barème compare deux listes des
  // mêmes éléments ; une trame fabriquée à la main qui répète un indice ou en
  // oublie un n'en est pas une, et lui accorder des paires bien ordonnées
  // reviendrait à payer n'importe quoi.
  if (!estClassementComplet(answerIds, question.solutions)) {
    return 0
  }

  const { bien, mal, total } = pairesDuClassement(answerIds, question.solutions)
  const mode = question.options?.scoringMode ?? SCORING_MODES.BALANCED
  const entry = SCORING_BY_MODE.find((s) => s.mode === mode)

  return entry ? entry.compute(bien, mal, total) : 0
}
