import { estPari } from "@razzia/common/paris"
import type { ManagerStatusDataMap } from "@razzia/common/types/game/status"
import AnswerButton from "@razzia/web/features/game/components/AnswerButton"
import {
  ANSWERS_COLORS,
  ANSWERS_LABELS,
} from "@razzia/web/features/game/utils/reponses"
import { SFX } from "@razzia/web/features/game/utils/constants"
import { calculatePercentages } from "@razzia/web/features/game/utils/score"
import CartePiste from "@razzia/web/features/musique/components/CartePiste"
import {
  couleursDuPari,
  HABILLAGES,
} from "@razzia/web/features/questions/paris/types"
import { lireUriMusique } from "@razzia/common/musique"
import clsx from "clsx"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import useSound from "use-sound"

interface Props {
  data: ManagerStatusDataMap["SHOW_RESPONSES"]
}

const Responses = ({
  data: { question, answers, responses, solutions, media, questionType },
}: Props) => {
  const piste = lireUriMusique(media?.url)
  const { t } = useTranslation()

  // Les libellés d'un pari dont les choix ne se nomment pas viennent de son
  // habillage, jamais du quiz.
  //
  // Le quiz garde ceux écrits le jour de la création : réordonner les boutons
  // du bonneteau — gauche, droite, milieu — avait donc changé les boutons de
  // mise sans changer cet écran-ci, qui appelait « Milieu » ce que le joueur
  // venait de cliquer comme « Droite ». Les libellés vivent d'un seul côté.
  const libelles =
    estPari(questionType) && !HABILLAGES[questionType].nommables
      ? HABILLAGES[questionType].choix.map((cle) => t(cle))
      : answers

  // Le code couleur doit être le même qu'au moment de miser : la salle vient
  // de cliquer sur un bouton rouge, elle doit retrouver le rouge ici.
  const couleurs = estPari(questionType)
    ? couleursDuPari(questionType)
    : ANSWERS_COLORS

  const [percentages, setPercentages] = useState<Record<string, string>>({})

  const [sfxResults] = useSound(SFX.RESULTS_SOUND, {
    volume: 0.2,
  })

  // La musique d'attente est partie d'ici, et pas seulement rendue
  // facultative.
  //
  // Trois effets la pilotaient : le premier l'arrêtait, le deuxième la
  // lançait, le troisième l'arrêtait encore. Les effets s'exécutant dans
  // l'ordre au montage, le dernier avait le dernier mot : elle démarrait pour
  // être coupée dans la foulée. Le résultat audible était un couac, jamais un
  // fond sonore — pour 1,2 Mo téléchargés sur chaque appareil.
  //
  // Reste ce que cet écran veut réellement faire entendre : le jingle de
  // résultat.
  useEffect(() => {
    sfxResults()

    setPercentages(calculatePercentages(responses))
  }, [responses, sfxResults])

  return (
    <div className="flex h-full flex-1 flex-col justify-between">
      <div className="mx-auto inline-flex h-full w-full max-w-7xl flex-1 flex-col items-center justify-center gap-5">
        <h2 className="text-center text-2xl font-bold text-white drop-shadow-lg md:text-4xl lg:text-5xl">
          {question}
        </h2>

        {piste?.id && <CartePiste uri={media?.url ?? ""} />}

        <div
          className={`mt-8 grid h-40 w-full max-w-3xl gap-4 px-2`}
          style={{ gridTemplateColumns: `repeat(${answers.length}, 1fr)` }}
        >
          {libelles.map((_, key) => (
            <div
              key={key}
              className={clsx(
                "flex flex-col justify-end self-end overflow-hidden rounded-md",
                couleurs[key],
              )}
              style={{ height: percentages[key] }}
            >
              <span className="w-full bg-black/10 text-center text-lg font-bold text-white drop-shadow-md">
                {responses[key] || 0}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mx-auto mb-4 grid w-full max-w-7xl grid-cols-2 gap-1 rounded-full px-2 text-lg font-bold text-white md:text-xl">
          {libelles.map((answer, key) => (
            <AnswerButton
              key={key}
              className={clsx(couleurs[key], {
                // oxlint-disable-next-line typescript/no-unnecessary-condition
                "opacity-65": responses && !solutions.includes(key),
              })}
              label={ANSWERS_LABELS[key]}
              correct={solutions.includes(key)}
            >
              {answer}
            </AnswerButton>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Responses
