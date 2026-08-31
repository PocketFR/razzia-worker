import {
  ANSWERS_COLORS,
  ANSWERS_LABELS,
} from "@razzia/web/features/game/utils/reponses"
import { QUESTION_REGISTRY } from "@razzia/web/features/questions"
import { useQuestionEditee } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import clsx from "clsx"
import { Minus, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

const QuestionEditorAnswers = () => {
  const { currentQuestion, currentId, updateQuestion } = useQuestionEditee()
  const { t } = useTranslation()

  const questionType = currentQuestion.type
  const { SolutionPicker, AnswersEditor, nombreDeReponsesFige } =
    QUESTION_REGISTRY[questionType]

  const updateAnswer = (index: number, value: string) => {
    const next = [...currentQuestion.answers]
    next[index] = value
    updateQuestion(currentId, { answers: next })
  }

  const addAnswer = () => {
    if (nombreDeReponsesFige || currentQuestion.answers.length >= 4) {
      return
    }

    updateQuestion(currentId, { answers: [...currentQuestion.answers, ""] })
  }

  const removeAnswer = () => {
    if (nombreDeReponsesFige || currentQuestion.answers.length <= 2) {
      return
    }

    const next = currentQuestion.answers.slice(0, -1)
    const maxIndex = next.length - 1
    const nextSolution = currentQuestion.solutions.filter((s) => s <= maxIndex)

    updateQuestion(currentId, {
      answers: next,
      solutions: nextSolution.length > 0 ? nextSolution : [0],
    })
  }

  // Un type peut imposer ses choix — les paris. Il n'y a alors ni texte à
  // saisir, ni nombre de réponses à régler, ni solution à cocher.
  if (AnswersEditor) {
    return <AnswersEditor />
  }

  return (
    <div className="z-10 flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <div className="text-muted-foreground bg-background rounded-lg px-2 py-1 text-sm font-semibold">
          {currentQuestion.answers.length}
          {t("quizz:answersCountSuffix")}
        </div>
        <div className="flex gap-2">
          <button
            onClick={removeAnswer}
            aria-label={t("quizz:removeAnswer")}
            disabled={
              Boolean(nombreDeReponsesFige) ||
              currentQuestion.answers.length <= 2
            }
            className="bg-accent text-accent-foreground hover:bg-accent flex size-7 items-center justify-center rounded-lg disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <button
            onClick={addAnswer}
            aria-label={t("quizz:addAnswer")}
            disabled={
              Boolean(nombreDeReponsesFige) ||
              currentQuestion.answers.length >= 4
            }
            className="bg-accent text-accent-foreground hover:bg-accent flex size-7 items-center justify-center rounded-lg disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {currentQuestion.answers.map((answer, i) => {
          const isSelected = currentQuestion.solutions.includes(i)

          return (
            <div
              key={i}
              className={clsx(
                "flex items-center gap-3 rounded-2xl px-4 py-6",
                ANSWERS_COLORS[i],
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-black/20 text-sm font-bold text-white md:size-8 md:text-base">
                {ANSWERS_LABELS[i]}
              </span>
              <div className="flex flex-1 items-center justify-between gap-1.5 drop-shadow-md">
                <input
                  className="w-full bg-transparent font-semibold text-white placeholder-white/70 outline-none"
                  placeholder={t("quizz:addAnswerPlaceholder")}
                  value={answer}
                  onChange={(e) => updateAnswer(i, e.target.value)}
                />
                <SolutionPicker index={i} isSelected={isSelected} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default QuestionEditorAnswers
