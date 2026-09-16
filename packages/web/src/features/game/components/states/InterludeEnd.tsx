// Le verdict personnel à la fin d'un interlude.
//
// Il remplace le résultat de la dernière question : ce qui compte alors n'est
// pas d'avoir eu juste au dernier tour, mais d'être encore là. Le vocabulaire
// visuel est celui de l'écran de résultat — même coche, même croix — pour
// qu'on le lise sans réapprendre.
//
// L'écran attend : c'est l'animateur, ou l'enchaînement automatique, qui fait
// passer tout le monde à la suite.

import Cartouche from "@razzia/web/components/Cartouche"
import CricleCheck from "@razzia/web/features/game/components/icons/CricleCheck"
import CricleXmark from "@razzia/web/features/game/components/icons/CricleXmark"
import type { CommonStatusDataMap } from "@razzia/common/types/game/status"
import { useTranslation } from "react-i18next"

interface Props {
  data: CommonStatusDataMap["SHOW_INTERLUDE_END"]
}

const InterludeEnd = ({ data: { titre, survecu, points } }: Props) => {
  const { t } = useTranslation()

  return (
    <section className="anim-show relative mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center">
      {survecu ? (
        <CricleCheck className="aspect-square max-h-60 w-full" />
      ) : (
        <CricleXmark className="aspect-square max-h-60 w-full" />
      )}

      <Cartouche className="mt-1 flex flex-col items-center gap-1 text-center">
        <h2 className="text-3xl font-bold text-balance md:text-4xl">
          {survecu ? t("game:interlude.survived") : t("game:interlude.out")}
        </h2>

        <p className="text-lg font-semibold text-white/70">
          {titre ?? t("game:interlude.title")}
        </p>
      </Cartouche>

      {survecu && points ? (
        <span className="mt-3 rounded-lg bg-black/40 px-4 py-2 text-2xl font-bold text-white drop-shadow-lg">
          +{points}
        </span>
      ) : null}
    </section>
  )
}

export default InterludeEnd
