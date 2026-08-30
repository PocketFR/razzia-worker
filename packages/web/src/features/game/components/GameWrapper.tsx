import { EVENTS } from "@razzia/common/constants"
import type { Status } from "@razzia/common/types/game/status"
import Button from "@razzia/web/components/Button"
import GameBackground from "@razzia/web/components/GameBackground"
import Loader from "@razzia/web/components/Loader"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"
import { useQuestionStore } from "@razzia/web/features/game/stores/question"
import { MANAGER_SKIP_BTN } from "@razzia/web/features/game/utils/constants"
import clsx from "clsx"
import { type PropsWithChildren, useEffect, useState } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

type Props = PropsWithChildren & {
  statusName: Status | undefined
  onNext?: () => void
  /* Case d'enchaînement automatique, côté animateur uniquement. */
  auto?: { actif: boolean; basculer: (_v: boolean) => void }
  onBack?: () => void
  manager?: boolean
}

const GameWrapper = ({
  children,
  statusName,
  onNext,
  auto,
  onBack,
  manager,
}: Props) => {
  const { isConnected } = useSocket()
  const { player } = usePlayerStore()
  const { questionStates, setQuestionStates } = useQuestionStore()
  const { t } = useTranslation()
  const [isDisabled, setIsDisabled] = useState(false)
  const next = statusName ? MANAGER_SKIP_BTN[statusName] : null

  useEvent(EVENTS.GAME.UPDATE_QUESTION, (etat) => {
    // Null efface le compteur : la salle est revenue en attente entre deux
    // quiz, et l'avancement du précédent n'a plus cours.
    if (!etat) {
      setQuestionStates(null)

      return
    }

    const { current, total } = etat

    setQuestionStates({
      current,
      total,
    })
  })

  useEvent(EVENTS.GAME.ERROR_MESSAGE, (message) => {
    toast.error(t(message))
    console.log(t(message))
    setIsDisabled(false)
  })

  useEffect(() => {
    setIsDisabled(false)
  }, [statusName])

  const handleNext = () => {
    setIsDisabled(true)
    onNext?.()
  }

  return (
    <section className="relative flex min-h-dvh">
      <GameBackground />

      <div className="z-10 flex w-full flex-1 flex-col justify-between">
        {!isConnected && !statusName ? (
          <div className="flex h-full w-full flex-1 flex-col items-center justify-center">
            <Loader className="h-30" />
            <h1 className="text-4xl font-bold text-white">
              {t("common:connecting")}
            </h1>
          </div>
        ) : (
          <>
            <div className="flex w-full justify-between p-4">
              {questionStates && (
                <div className="flex items-center rounded-md bg-white p-2 px-4 text-lg font-bold text-black">
                  {`${questionStates.current} / ${questionStates.total}`}
                </div>
              )}

              {/* La case est solidaire du bouton « Passer », comme la
                  surcouche qui la greffait dessus : hors partie il n'y a rien
                  à enchaîner, et elle n'a donc pas lieu d'être affichée.
                  Pas de ml-auto ici : le justify-between du conteneur place
                  déjà ce groupe à gauche quand le compteur est absent, et le
                  forcer à droite collait le tout contre « Quitter ». */}
              {manager && next && (
                <div className="flex items-center gap-3">
                  {auto && (
                    <label className="flex cursor-pointer items-center gap-2 rounded-md bg-white/90 px-3 py-2 text-sm font-semibold text-black">
                      <input
                        type="checkbox"
                        checked={auto.actif}
                        onChange={(e) => auto.basculer(e.target.checked)}
                      />
                      {t("game:auto")}
                    </label>
                  )}

                  <Button
                    className={clsx("hover:bg-accent bg-white px-4 text-black", {
                      "pointer-events-none": isDisabled,
                    })}
                    onClick={handleNext}
                  >
                    {t(next)}
                  </Button>
                </div>
              )}

              {manager && onBack && (
                <Button
                  onClick={onBack}
                  className="hover:bg-accent bg-white px-4 text-black"
                >
                  {t("common:exit")}
                </Button>
              )}
            </div>

            {children}

            {!manager && (
              <div className="z-50 flex items-center justify-between bg-white px-4 py-2 text-lg font-bold text-white">
                <p className="text-gray-800">{player?.username}</p>
                <div className="rounded-lg bg-gray-800 px-3 py-1 text-lg">
                  {player?.points}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export default GameWrapper
