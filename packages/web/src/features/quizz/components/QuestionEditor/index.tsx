import GameBackground from "@razzia/web/components/GameBackground"
import GroupeEditor from "@razzia/web/features/quizz/components/GroupeEditor"
import QuestionEditorAnswers from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorAnswers"
import QuestionEditorConfig from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig"
import QuestionEditorMedia from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorMedia"
import QuestionEditorTitle from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorTitle"
import { useQuizzEditor } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { useTranslation } from "react-i18next"

// Le panneau change de nature selon la sélection : les réglages d'un groupe
// n'ont rien à voir avec ceux d'une question, et le composant qui édite une
// question exige d'ailleurs qu'il y en ait une.
const QuestionEditor = () => {
  const { currentGroupe, currentQuestion } = useQuizzEditor()
  const { t } = useTranslation()

  if (currentGroupe) {
    return <GroupeEditor />
  }

  // Ni question ni groupe : plutôt que de laisser `useQuestionEditee` lever et
  // emporter la page entière, on n'affiche rien. Une sélection vide est un
  // état transitoire ordinaire — elle ne mérite pas un écran blanc.
  if (!currentQuestion) {
    return (
      <div className="relative z-10 flex flex-1 items-center justify-center">
        <p className="bg-background text-muted-foreground rounded-xl p-4 shadow-sm">
          {t("quizz:noQuestionYet")}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <main className="mx-auto flex max-w-7xl flex-1 flex-col gap-4 overflow-y-auto p-6">
        <QuestionEditorTitle />
        <QuestionEditorMedia />
        <QuestionEditorAnswers />

        <GameBackground />
      </main>
      <QuestionEditorConfig />
    </div>
  )
}

export default QuestionEditor
