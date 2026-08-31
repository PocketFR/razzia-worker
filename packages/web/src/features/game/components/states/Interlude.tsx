// L'annonce d'un interlude, avant sa première question.
//
// Tout le monde la voit — joueurs comme animateur : c'est le moment où l'on
// comprend que les règles changent, et se tromper va coûter sa place et non
// quelques points. Elle s'efface seule après cinq secondes.

import type { CommonStatusDataMap } from "@razzia/common/types/game/status"
import { useTranslation } from "react-i18next"

interface Props {
  data: CommonStatusDataMap["SHOW_INTERLUDE"]
}

const Interlude = ({ data: { titre, points, questions } }: Props) => {
  const { t } = useTranslation()

  return (
    <div className="anim-show mx-auto flex h-full w-full max-w-4xl flex-col items-center justify-center gap-6 px-4 text-center">
      <p className="text-2xl font-bold text-white drop-shadow-lg md:text-5xl">
        {titre ?? t("game:interlude.title")}
      </p>

      <p className="text-primary text-4xl font-black tracking-wide uppercase drop-shadow-lg md:text-7xl">
        {t("game:interlude.suddenDeath")}
      </p>

      <p className="text-lg font-semibold text-white/80 md:text-2xl">
        {t("game:interlude.rule", { count: questions })}
      </p>

      {points ? (
        <p className="rounded-xl bg-black/45 px-6 py-3 text-2xl font-bold text-white backdrop-blur-sm md:text-4xl">
          {t("game:interlude.toWin", { count: points })}
        </p>
      ) : null}
    </div>
  )
}

export default Interlude
