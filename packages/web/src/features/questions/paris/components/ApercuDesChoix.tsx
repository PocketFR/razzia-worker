import type { TypePari } from "@razzia/common/paris"
import { ANSWERS_LABELS } from "@razzia/web/features/game/utils/reponses"
import {
  couleursDuPari,
  HABILLAGES,
} from "@razzia/web/features/questions/paris/types"
import { useTranslation } from "react-i18next"

// Ce que l'éditeur montre à la place des réponses, pour les paris dont les
// choix ne se nomment pas.
//
// Il n'y a rien à saisir : les libellés sont le jeu lui-même, et la bonne
// réponse est tirée au moment de jouer. Plutôt qu'une grille de champs vides
// et un sélecteur de solution sans objet, on montre le tapis tel qu'il
// s'affichera, et on dit la règle.
export const creerApercuDesChoix = (type: TypePari) => {
  const { choix } = HABILLAGES[type]

  const ApercuDesChoix = () => {
    const { t } = useTranslation()
    // Lues au rendu, pas à la fabrique — voir MiseBoutons.
    const couleurs = couleursDuPari(type)

    return (
      <div className="z-10 flex flex-col gap-3">
        <p className="bg-background text-muted-foreground rounded-lg px-3 py-2 text-sm">
          {t("quizz:paris.explain")}
        </p>

        <div className="grid grid-cols-2 gap-3">
          {choix.map((cle, index) => (
            <div
              key={cle}
              className={`flex items-center gap-3 rounded-2xl px-4 py-6 font-semibold ${couleurs[index]}`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-black/20 text-sm font-bold text-white md:size-8 md:text-base">
                {ANSWERS_LABELS[index]}
              </span>
              {t(cle)}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return ApercuDesChoix
}
