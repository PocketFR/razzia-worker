// Enchaîner un quiz sans défaire la salle.
//
// Affiché sous le podium, côté animateur. Le PIN, le QR et les joueurs
// connectés survivent au changement : c'est tout l'intérêt, et c'est ce que
// l'ancienne pile ne permettait pas — il fallait recréer une partie, donc
// refaire scanner tout le monde entre deux manches.
//
// La liste des quiz arrive déjà par manager:config, il n'y a rien à charger.

import { EVENTS } from "@razzia/common/constants"
import { useSocket } from "@razzia/web/features/game/contexts/socket-context"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import clsx from "clsx"
import { useState } from "react"
import { useTranslation } from "react-i18next"

const NextQuizz = () => {
  const { socket } = useSocket()
  const { config, gameId } = useManagerStore()
  const { t } = useTranslation("game")

  const [quizzId, setQuizzId] = useState("")
  const [conserverScores, setConserverScores] = useState(true)

  const quizz = config?.quizz ?? []

  if (!gameId || quizz.length === 0) {
    return null
  }

  const lancer = () => {
    if (!quizzId) {
      return
    }

    socket.emit(EVENTS.MANAGER.NEW_QUIZZ, {
      gameId,
      data: { quizzId, resetScores: !conserverScores },
    })
  }

  return (
    <section className="mx-auto mt-6 w-full max-w-2xl rounded-xl bg-black/40 p-5 text-white backdrop-blur-sm">
      <h3 className="text-lg font-bold">{t("nextQuizz.title")}</h3>
      <p className="mb-4 text-sm opacity-70">{t("nextQuizz.subtitle")}</p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          aria-label={t("nextQuizz.choose")}
          className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-white"
          value={quizzId}
          onChange={(e) => setQuizzId(e.target.value)}
        >
          <option value="">{t("nextQuizz.choose")}</option>
          {quizz.map((q) => (
            <option key={q.id} value={q.id} className="text-black">
              {q.subject}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={!quizzId}
          onClick={lancer}
          className={clsx(
            "rounded-lg px-5 py-2 font-semibold transition",
            quizzId
              ? "bg-primary hover:brightness-110"
              : "cursor-not-allowed bg-white/10 opacity-50",
          )}
        >
          {t("nextQuizz.start")}
        </button>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={conserverScores}
          onChange={(e) => setConserverScores(e.target.checked)}
        />
        <span>
          {t("nextQuizz.keepScores")}
          <span className="block opacity-60">
            {conserverScores
              ? t("nextQuizz.keepScoresHint")
              : t("nextQuizz.resetScores")}
          </span>
        </span>
      </label>
    </section>
  )
}

export default NextQuizz
