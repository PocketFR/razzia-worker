// La saisie d'un classement : une colonne, dans le bon ordre.
//
// À LA PLACE DE LA GRILLE ORDINAIRE, et pas seulement par goût : la grille
// tient deux colonnes de quatre cases colorées, avec une case à cocher par
// réponse. Un classement n'a rien à cocher — la bonne réponse est l'ordre —
// et accepte jusqu'à huit éléments, qui ne se lisent qu'en colonne.
//
// LES SOLUTIONS SONT RÉÉCRITES À CHAQUE CHANGEMENT. Le validateur les déduit
// lui aussi de l'ordre à l'enregistrement ; les tenir à jour ici évite que
// l'éditeur montre autre chose que ce qui sera enregistré — et qu'un quiz
// venu d'un import garde des solutions d'un autre âge.

import { MAX_REPONSES_CLASSEMENT } from "@razzia/common/constants"
import {
  ColonneOrdonnable,
  LigneOrdonnable,
} from "@razzia/web/features/questions/classement/components/ColonneOrdonnable"
import { useQuestionEditee } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { ListOrdered, Minus, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

const MINIMUM = 2

const ClassementEditor = () => {
  const { currentQuestion, currentId, updateQuestion } = useQuestionEditee()
  const { t } = useTranslation()

  const { answers } = currentQuestion

  // Un seul point d'écriture : les réponses ET leurs solutions, qui ne sont
  // que leurs rangs.
  const poser = (suivantes: string[]) =>
    updateQuestion(currentId, {
      answers: suivantes,
      solutions: suivantes.map((_, index) => index),
    })

  const modifier = (index: number, valeur: string) => {
    const suivantes = [...answers]

    suivantes[index] = valeur
    poser(suivantes)
  }

  const ajouter = () => {
    if (answers.length >= MAX_REPONSES_CLASSEMENT) {
      return
    }

    poser([...answers, ""])
  }

  const retirer = () => {
    if (answers.length <= MINIMUM) {
      return
    }

    poser(answers.slice(0, -1))
  }

  // Les identifiants sont les rangs : c'est la PLACE qui se déplace, et le
  // texte avec elle. Deux réponses au même libellé — ou vides, ce qui est
  // l'état de départ — resteraient sinon impossibles à distinguer.
  const ids = answers.map((_, index) => String(index))

  const reordonner = (suivant: string[]) =>
    poser(suivant.map((place) => answers[Number(place)]))

  return (
    <div className="z-10 flex flex-col gap-3">
      <div className="bg-background/90 text-muted-foreground flex items-center gap-3 rounded-xl p-3 text-sm shadow-sm">
        <ListOrdered className="size-6 shrink-0" />
        <p>{t("quizz:classement.aide")}</p>
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="text-muted-foreground bg-background rounded-lg px-2 py-1 text-sm font-semibold">
          {answers.length}
          {t("quizz:answersCountSuffix")}
        </div>
        <div className="flex gap-2">
          <button
            onClick={retirer}
            aria-label={t("quizz:removeAnswer")}
            disabled={answers.length <= MINIMUM}
            className="bg-accent text-accent-foreground hover:bg-accent flex size-7 items-center justify-center rounded-lg disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <button
            onClick={ajouter}
            aria-label={t("quizz:addAnswer")}
            disabled={answers.length >= MAX_REPONSES_CLASSEMENT}
            className="bg-accent text-accent-foreground hover:bg-accent flex size-7 items-center justify-center rounded-lg disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <ColonneOrdonnable ids={ids} onOrdre={reordonner}>
        {answers.map((answer, index) => (
          <LigneOrdonnable key={index} id={String(index)} rang={index + 1}>
            <input
              className="w-full bg-transparent font-semibold text-white placeholder-white/70 outline-none"
              placeholder={t("quizz:addAnswerPlaceholder")}
              value={answer}
              onChange={(e) => modifier(index, e.target.value)}
            />
          </LigneOrdonnable>
        ))}
      </ColonneOrdonnable>
    </div>
  )
}

export default ClassementEditor
