import { EVENTS, MEDIA_TYPES, NO_TIME_LIMIT } from "@razzia/common/constants"
import type { QuestionMediaType } from "@razzia/common/types/game"
import type { CommonStatusDataMap } from "@razzia/common/types/game/status"
import { musiqueDesReponsesActive } from "@razzia/web/branding"
import QuestionMedia from "@razzia/web/components/QuestionMedia"
import MusiqueDesReponses from "@razzia/web/features/game/components/MusiqueDesReponses"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"
import { SFX } from "@razzia/web/features/game/utils/constants"
import { QUESTION_REGISTRY } from "@razzia/web/features/questions"
import { useState } from "react"
import { useDecompte } from "@razzia/web/features/game/hooks/use-decompte"
import { useTranslation } from "react-i18next"
import useSound from "use-sound"

interface Props {
  data: CommonStatusDataMap["SELECT_ANSWER"]
}

const Answers = ({
  data: {
    question,
    answers,
    media,
    time,
    endsAt,
    totalPlayer,
    questionType,
    options,
    elimine,
  },
}: Props) => {
  const { socket } = useSocket()
  const { player, gameId } = usePlayerStore()

  const cooldown = useDecompte(endsAt, time)
  const [totalAnswer, setTotalAnswer] = useState(0)
  const { t } = useTranslation()

  const [sfxPop] = useSound(SFX.ANSWERS.SOUND, {
    volume: 0.1,
  })

  const handleSubmit = (answerKeys: number[]) => {
    if (!player || !gameId) {
      return
    }

    socket.emit(EVENTS.PLAYER.SELECTED_ANSWER, {
      gameId,
      data: {
        answerKeys,
      },
    })
    sfxPop()
  }

  // Elle ne se superpose jamais au média de la question : un blind test
  // Spotify est de type « audio », et se passe très bien d'un fond sonore
  // par-dessus. C'était déjà la règle en amont, elle ne change pas.
  const mediaSonore: QuestionMediaType[] = [
    MEDIA_TYPES.AUDIO,
    MEDIA_TYPES.VIDEO,
  ]
  const avecMusique =
    musiqueDesReponsesActive() && !mediaSonore.includes(media?.type)

  useEvent(EVENTS.GAME.PLAYER_ANSWER, (count) => {
    setTotalAnswer(count)
    sfxPop()
  })

  const { AnswerComponent } = QUESTION_REGISTRY[questionType]

  return (
    <div className="flex h-full flex-1 flex-col justify-between">
      {avecMusique && <MusiqueDesReponses />}

      <div className="mx-auto inline-flex h-full w-full max-w-7xl flex-1 flex-col items-center justify-center gap-5">
        <h2 className="text-center text-2xl font-bold text-white drop-shadow-lg md:text-4xl lg:text-5xl">
          {question}
        </h2>

        <QuestionMedia media={media} alt={question} />
      </div>

      <div>
        <div className="mx-auto mb-4 flex w-full max-w-7xl justify-between gap-1 px-2 text-lg font-bold text-white md:text-xl">
          {time !== NO_TIME_LIMIT && (
            <div className="flex flex-col items-center rounded-lg bg-black/40 px-4 text-lg font-bold">
              <span className="translate-y-1 text-sm">
                {t("game:hud.time")}
              </span>
              <span>{cooldown}</span>
            </div>
          )}
          <div className="flex flex-col items-center rounded-lg bg-black/40 px-4 text-lg font-bold">
            <span className="translate-y-1 text-sm">
              {t("game:hud.answers")}
            </span>
            <span>
              {totalAnswer}/{totalPlayer}
            </span>
          </div>
        </div>

        {elimine && (
          <p className="mx-auto mb-3 rounded-lg bg-black/50 px-4 py-2 text-center text-lg font-bold text-white md:text-xl">
            {t("game:eliminated")}
          </p>
        )}

        <AnswerComponent
          answers={answers}
          options={options}
          onSubmit={handleSubmit}
          readOnly={!player || Boolean(elimine)}
        />
      </div>
    </div>
  )
}

export default Answers
