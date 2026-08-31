import { MEDIA_TYPES } from "@razzia/common/constants"
import type { CommonStatusDataMap } from "@razzia/common/types/game/status"
import { SFX } from "@razzia/web/features/game/utils/constants"
import Bonneteau from "@razzia/web/features/questions/paris/components/Bonneteau"
import { useEffect } from "react"
import useSound from "use-sound"

interface Props {
  data: CommonStatusDataMap["SHOW_QUESTION"]
}

const Question = ({
  data: { question, media, cooldown, endsAt, pari },
}: Props) => {
  const [sfxShow] = useSound(SFX.SHOW_SOUND, { volume: 0.5 })

  useEffect(() => {
    sfxShow()
  }, [sfxShow])

  return (
    // Le mélange du bonneteau prend toute la largeur : c'est elle qui donne
    // aux cartes leur taille, et des cartes trop petites ne se suivent pas.
    <section
      className={`relative mx-auto flex h-full w-full flex-1 flex-col items-center ${
        pari ? "" : "max-w-7xl px-4"
      }`}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <h2 className="anim-show text-center text-3xl font-bold text-white drop-shadow-lg md:text-4xl lg:text-5xl">
          {question}
        </h2>

        {/* Le mélange du bonneteau occupe l'énoncé : c'est là qu'il faut
            suivre la dame, avant que les mises n'ouvrent. */}
        {pari ? (
          <Bonneteau
            gagnant={pari.gagnant}
            choix={pari.choix}
            graine={pari.graine}
            finAt={endsAt}
            dureeMs={cooldown * 1000}
          />
        ) : (
          media?.type === MEDIA_TYPES.IMAGE && (
            <img
              alt={question}
              src={media.url}
              className="max-h-60 w-auto rounded-md sm:max-h-100"
            />
          )
        )}
      </div>
      <div
        className="bg-primary mb-20 h-4 self-start justify-self-end rounded-full"
        style={{ animation: `progressBar ${cooldown}s linear forwards` }}
      ></div>
    </section>
  )
}

export default Question
