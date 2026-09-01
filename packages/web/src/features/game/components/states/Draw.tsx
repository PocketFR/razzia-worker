import type { CommonStatusDataMap } from "@razzia/common/types/game/status"
import CarteRougeNoir from "@razzia/web/features/questions/paris/components/CarteRougeNoir"
import CoursePmu from "@razzia/web/features/questions/paris/components/CoursePmu"
import { HABILLAGES } from "@razzia/web/features/questions/paris/types"
import { useTranslation } from "react-i18next"

interface Props {
  data: CommonStatusDataMap["SHOW_DRAW"]
}

// Le tirage, une fois les mises closes.
//
// L'écran est le même pour tout le monde, animateur comme joueurs : c'est le
// moment du spectacle, et l'intérêt d'un interlude est justement que chacun
// regarde la même chose au même instant.
const Draw = ({ data: { pari, duree, endsAt, noms, largeurEcran } }: Props) => {
  const { t } = useTranslation()
  const dureeMs = duree * 1000

  return (
    // La course prend toute la largeur — c'est la distance parcourue qui
    // porte le suspense —, la carte reste centrée dans une colonne lisible.
    <section
      className={`flex h-full w-full flex-1 flex-col items-center justify-center gap-6 ${
        pari.type === "pmu" ? "" : "mx-auto max-w-7xl px-4"
      }`}
    >
      <h2 className="text-center text-2xl font-bold text-white drop-shadow-lg md:text-3xl">
        {t(HABILLAGES[pari.type].consigneKey)}
      </h2>

      {pari.type === "pmu" ? (
        <CoursePmu
          gagnant={pari.gagnant}
          choix={pari.choix}
          graine={pari.graine}
          finAt={endsAt}
          dureeMs={dureeMs}
          noms={noms}
          largeurEcran={largeurEcran}
        />
      ) : (
        <CarteRougeNoir
          gagnant={pari.gagnant}
          graine={pari.graine}
          finAt={endsAt}
          dureeMs={dureeMs}
        />
      )}
    </section>
  )
}

export default Draw
