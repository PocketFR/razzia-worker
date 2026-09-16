// La révélation, sur le grand écran : le bon ordre.
//
// LES BARRES N'ONT RIEN À DIRE ICI. L'écran des réponses compte, pour chaque
// réponse, combien de joueurs l'ont choisie — sur un classement, chacune est
// choisie exactement une fois par joueur : quatre barres égales, qui
// n'apprennent rien à personne. Ce que la salle attend, c'est l'ordre.

import type { ResultsComponentProps } from "@razzia/web/features/questions/types"
import { useTranslation } from "react-i18next"

const ClassementResults = ({
  answers,
  solutions,
  sansFaute,
  repondants,
}: ResultsComponentProps) => {
  const { t } = useTranslation()

  // `solutions` porte l'ordre attendu — les indices des réponses, du premier
  // au dernier. Une question enregistrée avant ce type, ou amputée à l'import,
  // pourrait n'en citer aucune : on retombe alors sur l'ordre du quiz, qui
  // est justement le bon.
  const ordre =
    solutions.length === answers.length
      ? solutions
      : answers.map((_, index) => index)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-2">
      <p className="text-center text-lg font-bold text-white drop-shadow md:text-xl">
        {t("game:classement.bonOrdre")}
      </p>

      {/* « Zéro joueur sur sept » se dit mal : quand personne n'a trouvé, on
          le dit en toutes lettres. C'est la phrase que l'animateur lit à voix
          haute. */}
      <p className="rounded-lg bg-black/40 px-3 py-1.5 text-center text-base font-semibold text-white md:text-lg">
        {sansFaute === 0
          ? t("game:classement.personne")
          : t("game:classement.exacts", {
              count: sansFaute,
              total: repondants,
            })}
      </p>

      <ul className="flex flex-col gap-2">
        {ordre.map((indice, place) => (
          <li
            key={indice}
            className="flex items-center gap-3 rounded-2xl bg-black/50 px-3 py-2 text-white shadow-lg backdrop-blur-sm"
          >
            <span className="bg-primary flex size-8 shrink-0 items-center justify-center rounded-lg text-base font-bold md:size-9 md:text-lg">
              {place + 1}
            </span>
            <p className="min-w-0 flex-1 text-left text-base font-semibold break-words md:text-2xl">
              {answers[indice]}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ClassementResults
