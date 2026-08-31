import { QUESTION_TYPES } from "@razzia/common/constants"
import type { Question, QuestionType } from "@razzia/common/types/game"
import * as multi from "./multi"
import * as single from "./single"

export type ScoringFn = (_question: Question, _answerIds: number[]) => number

export const QUESTION_SCORING: Record<QuestionType, ScoringFn> = {
  [single.type]: single.scoring,
  [multi.type]: multi.scoring,
  // Un pari se note comme un choix unique. Sa bonne réponse n'est pas dans le
  // quiz — le serveur la tire au moment de jouer, et substitue `solutions`
  // avant d'appeler le barème. Rien à écrire de plus ici.
  [QUESTION_TYPES.ROUGE_NOIR]: single.scoring,
  [QUESTION_TYPES.BONNETEAU]: single.scoring,
  [QUESTION_TYPES.PMU]: single.scoring,
}
