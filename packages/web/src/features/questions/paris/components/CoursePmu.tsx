import {
  FIN_DE_COURSE,
  positionA,
  profils,
} from "@razzia/web/features/questions/paris/course"
import {
  fenetre,
  useHorloge,
} from "@razzia/web/features/questions/paris/horloge"
import { ANSWERS_COLORS } from "@razzia/web/features/game/utils/reponses"
import { HABILLAGES } from "@razzia/web/features/questions/paris/types"
import { useTranslation } from "react-i18next"

// Le PMU : quatre chevaux, une ligne droite, un vainqueur décidé d'avance.
//
// Les profils de vitesse vivent dans course.ts, sous test : que le cheval
// désigné franchisse bien la ligne le premier est justement ce qu'on ne peut
// pas constater en relisant.

interface Props {
  gagnant: number
  choix: number
  graine: number
  finAt: number
  dureeMs: number
  // Les noms donnés aux chevaux dans le quiz. Vides, on retombe sur
  // « Cheval 1 », « Cheval 2 »…
  noms: string[]
}

const CoursePmu = ({ gagnant, choix, graine, finAt, dureeMs, noms }: Props) => {
  const t = useHorloge(finAt, dureeMs)
  const { t: trad } = useTranslation()

  const coureurs = profils(graine, choix, gagnant)
  const defauts = HABILLAGES.pmu.choix
  const nommer = (cheval: number) =>
    noms[cheval]?.trim() ? noms[cheval] : trad(defauts[cheval])
  const fini = t >= FIN_DE_COURSE

  return (
    // Toute la largeur, sans marge ni gouttière : plus la piste est longue,
    // plus l'écart entre deux chevaux se voit. C'est la seule dimension qui
    // porte l'information.
    <div className="flex w-full flex-1 flex-col justify-center gap-2">
      {coureurs.map((coureur, cheval) => {
        const x = positionA(coureur, t)
        // Le galop : un balancement dont la cadence suit la vitesse.
        const galop = t < coureur.arrivee ? Math.sin(t * 34 + cheval) * 4 : 0

        return (
          <div
            key={cheval}
            // Le couloir est plus haut que le cheval : le nom occupe la bande
            // du dessus, que la monture ne traverse jamais. Les deux tailles
            // sont des variables pour que la position d'arrivée ne puisse pas
            // dériver d'avec ce qu'elle mesure.
            className="relative h-24 overflow-hidden bg-black/30 [--cheval:2.75rem] [--damier:1.5rem] md:h-32 md:[--cheval:4rem] md:[--damier:2rem]"
          >
            <span className="absolute top-1 left-2 text-sm font-bold text-white/80 md:text-base">
              {nommer(cheval)}
            </span>

            {/* La ligne d'arrivée, en damier : deux colonnes décalées d'un
                carreau, comme un drapeau à damier. Une simple alternance
                verticale ne se lit pas comme une arrivée. */}
            <div
              className="absolute top-0 right-0 h-full"
              style={{
                width: "var(--damier)",
                backgroundImage:
                  "linear-gradient(45deg,#fff 25%,transparent 25%,transparent 75%,#fff 75%),linear-gradient(45deg,#fff 25%,transparent 25%,transparent 75%,#fff 75%)",
                backgroundColor: "#111",
                backgroundSize: "0.75rem 0.75rem",
                backgroundPosition: "0 0, 0.375rem 0.375rem",
              }}
            />

            <div
              className={`absolute bottom-1 z-10 flex items-center justify-center rounded-full text-2xl md:text-4xl ${ANSWERS_COLORS[cheval]}`}
              style={{
                width: "var(--cheval)",
                height: "var(--cheval)",
                // Le cheval est posé par son CENTRE, qui va d'un demi-cheval
                // du bord gauche à un demi-cheval du bord droit. À l'arrivée
                // il recouvre donc le damier au lieu de s'arrêter devant —
                // c'est la ligne qu'on franchit, pas un mur.
                left: `calc(${1 - x} * var(--cheval) / 2 + ${x} * (100% - var(--cheval) / 2))`,
                transform: `translateX(-50%) translateY(${galop}px) rotate(${galop / 3}deg)`,
              }}
            >
              {/* Le cheval de la police regarde à gauche : sans miroir, il
                  court à reculons. */}
              <span className="block" style={{ transform: "scaleX(-1)" }}>
                🐎
              </span>
            </div>
          </div>
        )
      })}

      <p
        className="mt-2 text-center text-3xl font-black text-white drop-shadow-lg md:text-5xl"
        style={{ opacity: fenetre(t, FIN_DE_COURSE, FIN_DE_COURSE + 0.06) }}
      >
        {fini
          ? trad("game:paris.pmu.vainqueur", { nom: trad(noms[gagnant]) })
          : ""}
      </p>
    </div>
  )
}

export default CoursePmu
