import { QUESTION_TYPES } from "@razzia/common/constants"
import type {
  QuestionOptions,
  QuestionType,
  ScoringMode,
} from "@razzia/common/types/game"
import * as classement from "@razzia/web/features/questions/classement"
import * as diapo from "@razzia/web/features/questions/diapo"
import * as multi from "@razzia/web/features/questions/multi"
import { entreeDePari } from "@razzia/web/features/questions/paris"
import * as single from "@razzia/web/features/questions/single"
import type {
  AnswerComponentProps,
  PreparedComponentProps,
  ResultsComponentProps,
  SolutionPickerProps,
} from "@razzia/web/features/questions/types"
import type { ComponentType } from "react"

interface QuestionRegistryEntry {
  labelKey: string
  defaultOptions?: QuestionOptions
  scoringModes?: ScoringMode[]
  // Les libellés des choix quand ils sont imposés par le type — les paris.
  // L'éditeur les recopie dans `answers` au changement de type, et masque la
  // saisie : il n'y a rien à écrire sur un tapis de rouge ou noir.
  choixFiges?: string[]
  AnswerComponent: ComponentType<AnswerComponentProps>
  // Le nombre de réponses quand le type le fixe. La grille cesse alors d'en
  // proposer l'ajout et le retrait.
  nombreDeReponsesFige?: number
  // Remplace la grille de saisie des réponses quand le type l'impose. Absent,
  // c'est la grille ordinaire qui s'affiche.
  AnswersEditor?: ComponentType
  ConfigComponent: ComponentType
  SolutionPicker: ComponentType<SolutionPickerProps>
  // Remplace le dépouillement ordinaire — les barres par réponse — quand il
  // n'apprend rien. Absent, ce sont les barres qui s'affichent.
  ResultsComponent?: ComponentType<ResultsComponentProps>
  // Remplace l'aperçu de l'annonce « Question n » — la grille de cases
  // colorées — quand le type ne s'y reconnaît pas. Absent, c'est la grille.
  PreparedComponent?: ComponentType<PreparedComponentProps>
}

export const QUESTION_REGISTRY: Record<QuestionType, QuestionRegistryEntry> = {
  single,
  multi,
  [QUESTION_TYPES.ROUGE_NOIR]: entreeDePari(QUESTION_TYPES.ROUGE_NOIR),
  [QUESTION_TYPES.BONNETEAU]: entreeDePari(QUESTION_TYPES.BONNETEAU),
  [QUESTION_TYPES.PMU]: entreeDePari(QUESTION_TYPES.PMU),
  [QUESTION_TYPES.DIAPO]: diapo,
  [QUESTION_TYPES.CLASSEMENT]: classement,
}

export const QUESTION_TYPE_LIST = Object.keys(
  QUESTION_REGISTRY,
) as QuestionType[]
