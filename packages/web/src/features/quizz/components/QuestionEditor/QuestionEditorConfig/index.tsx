import { NO_TIME_LIMIT } from "@razzia/common/constants"
import type { QuestionType } from "@razzia/common/types/game"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@razzia/web/components/Select"
import {
  QUESTION_REGISTRY,
  QUESTION_TYPE_LIST,
} from "@razzia/web/features/questions"
import ConfigField from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig/ConfigField"
import { useQuestionEditee } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { LayoutList } from "lucide-react"
import { useTranslation } from "react-i18next"

/** Le temps de mise imposé quand on bascule une question sans limite en pari. */
const DUREE_DE_PARI = 15

const QuestionEditorConfig = () => {
  const { currentQuestion, currentId, updateQuestion } = useQuestionEditee()
  const { t } = useTranslation()
  const questionType = currentQuestion.type

  const handleTypeChange = (nextType: QuestionType) => {
    const { defaultOptions, choixFiges } = QUESTION_REGISTRY[nextType]

    // Un pari impose ses choix — « Rouge », « Noir » — et n'a pas de solution
    // à désigner : le serveur la tire au moment de jouer. On les installe au
    // changement de type plutôt que de laisser des champs vides.
    //
    // Il refuse aussi l'absence de limite de temps : sans échéance, les mises
    // ne se ferment jamais et le tirage n'a pas lieu.
    updateQuestion(currentId, {
      type: nextType,
      options: defaultOptions,
      ...(choixFiges
        ? {
            answers: choixFiges.map((_, index) => t(choixFiges[index])),
            solutions: [],
            time:
              currentQuestion.time === NO_TIME_LIMIT
                ? DUREE_DE_PARI
                : currentQuestion.time,
          }
        : {}),
    })
  }

  const { ConfigComponent } = QUESTION_REGISTRY[questionType]

  const typeOptions = QUESTION_TYPE_LIST.map((type) => ({
    value: type,
    label: t(QUESTION_REGISTRY[type].labelKey),
  }))

  return (
    <aside className="bg-background z-10 m-3 flex max-h-[calc(100%-1.5rem)] w-68 shrink-0 flex-col gap-3 self-start overflow-y-auto rounded-xl p-4 shadow-sm">
      <ConfigField>
        <ConfigField.Label
          icon={<LayoutList className="size-4" />}
          label={t("quizz:question.config.answerMode")}
        />
        <Select value={questionType} onValueChange={handleTypeChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ConfigField>

      <ConfigComponent />
    </aside>
  )
}

export default QuestionEditorConfig
