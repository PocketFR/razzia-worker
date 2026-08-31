// La fin d'un interlude : qui reste debout.
//
// UNE LISTE, PAS UN PODIUM. Le nombre de tours d'un interlude étant réglable,
// le nombre de survivants va d'un seul à presque tout le monde — un unique
// tour de « rouge ou noir » sur trente joueurs en laisse quinze. Un podium à
// trois marches ne sait pas afficher ça.
//
// La taille du texte suit donc le nombre de noms : un vainqueur remplit
// l'écran, vingt tiennent en colonnes. Dans les deux cas ça se lit depuis
// l'autre bout de la pièce, ce qui est le seul usage de cet écran — on y
// remet un prix à la main.
//
// Les survivants sont à égalité par construction : ils ont traversé les mêmes
// tours, et le pot se partage à parts égales. Il n'y a donc rien à classer.

import type { ManagerStatusDataMap } from "@razzia/common/types/game/status"
import { useTranslation } from "react-i18next"

interface Props {
  data: ManagerStatusDataMap["SHOW_SURVIVORS"]
}

/* Trois paliers plutôt qu'un calcul continu : les tailles restent choisies. */
const taille = (nombre: number) => {
  if (nombre <= 1) {
    return "text-5xl md:text-8xl"
  }

  if (nombre <= 6) {
    return "text-3xl md:text-6xl"
  }

  return "text-xl md:text-3xl"
}

const Survivors = ({ data: { titre, survivants, points } }: Props) => {
  const { t } = useTranslation()

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col items-center justify-center gap-8 px-4">
      <p className="text-center text-xl font-bold text-white/80 drop-shadow md:text-3xl">
        {titre ?? t("game:interlude.title")}
      </p>

      {survivants.length === 0 ? (
        <p className="text-center text-3xl font-bold text-white drop-shadow-lg md:text-5xl">
          {t("game:interlude.nobody")}
        </p>
      ) : (
        <>
          <p className="text-center text-lg font-semibold text-white/70 md:text-xl">
            {t("game:interlude.survivors", { count: survivants.length })}
          </p>

          <div
            className={`flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-center font-bold text-white drop-shadow-lg ${taille(survivants.length)}`}
          >
            {survivants.map((nom) => (
              <span key={nom}>{nom}</span>
            ))}
          </div>

          {points ? (
            <p className="rounded-xl bg-black/45 px-5 py-2 text-center text-xl font-bold text-white backdrop-blur-sm md:text-3xl">
              {t("game:interlude.points", { count: points })}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

export default Survivors
