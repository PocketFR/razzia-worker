// La diapo dans le registre des types.
//
// Elle n'a ni réponses, ni solution, ni barème : chaque composant attendu par
// le registre y est donc soit une explication, soit rien. Le registre est
// exhaustif sur les types, c'est ce qui garantit qu'un type nouveau ne peut
// pas être oublié dans l'éditeur.

import ConfigField from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig/ConfigField"
import { Presentation } from "lucide-react"
import { useTranslation } from "react-i18next"

export const labelKey = "quizz:questionType.diapo"

// Zéro réponse, et figé : la grille ne propose ni ajout ni retrait.
export const nombreDeReponsesFige = 0

// Jamais affiché : une diapo ne passe pas par l'écran de réponses.
export const AnswerComponent = () => null

export const SolutionPicker = () => null

/** À la place de la grille de réponses : ce qui se passera en partie. */
export const AnswersEditor = () => {
  const { t } = useTranslation()

  return (
    <div className="bg-background/90 text-muted-foreground z-10 mx-auto flex max-w-xl items-center gap-3 rounded-xl p-4 text-sm shadow-sm">
      <Presentation className="size-6 shrink-0" />
      <p>{t("quizz:diapo.aide")}</p>
    </div>
  )
}

/**
 * Les réglages d'une diapo : aucun. Ni temps, ni points, ni pénalité — elle
 * attend l'animateur. On le dit plutôt que de laisser un panneau vide.
 */
export const ConfigComponent = () => {
  const { t } = useTranslation()

  return (
    <ConfigField>
      <p className="text-muted-foreground text-sm">
        {t("quizz:diapo.reglages")}
      </p>
    </ConfigField>
  )
}
