import { ANSWERS_COLORS } from "@razzia/web/features/game/utils/reponses"
import {
  cadrage,
  calageDuGazon,
  FIN_DE_COURSE,
  hauteurCouloir,
  positionA,
  profils,
  RATIO_HERBE,
} from "@razzia/web/features/questions/paris/course"
import {
  fenetre,
  useHorloge,
} from "@razzia/web/features/questions/paris/horloge"
import { HABILLAGES } from "@razzia/web/features/questions/paris/types"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

// Le PMU : quatre chevaux, une ligne droite, un vainqueur décidé d'avance.
//
// Les profils de vitesse vivent dans course.ts, sous test : que le cheval
// désigné franchisse bien la ligne le premier est justement ce qu'on ne peut
// pas constater en relisant.
//
// La piste est en GAZON, comme un hippodrome, et le gazon défile avec elle :
// c'est lui qui donne la vitesse. Sur une piste unie, l'œil n'a rien à quoi
// rattacher le mouvement.
//
// La piste est dessinée à l'ÉCHELLE DE L'ÉCRAN DE L'ANIMATEUR, pas à celle de
// l'appareil qui regarde. Un téléphone n'écrase donc pas la course dans sa
// largeur : il en montre une fenêtre, qui suit le peloton. L'écart entre deux
// chevaux y occupe le même nombre de pixels que sur la télévision — et c'est
// cet écart, seul, qui dit qui est en train de gagner.

/** Mesure la largeur d'un élément, et la suit. */
const useLargeur = () => {
  const cible = useRef<HTMLDivElement>(null)
  const [largeur, setLargeur] = useState(0)

  useEffect(() => {
    const element = cible.current

    if (!element) {
      return
    }

    const observateur = new ResizeObserver(([entree]) => {
      setLargeur(entree.contentRect.width)
    })

    observateur.observe(element)

    return () => observateur.disconnect()
  }, [])

  return { cible, largeur }
}

interface Props {
  gagnant: number
  choix: number
  graine: number
  finAt: number
  dureeMs: number
  // Les noms donnés aux chevaux dans le quiz. Vides, on retombe sur
  // « Cheval 1 », « Cheval 2 »…
  noms: string[]
  // La largeur de l'écran de l'animateur, en pixels. Absente — il n'a rien
  // annoncé — la piste tient dans l'écran local, comme avant.
  largeurEcran?: number
}

const CoursePmu = ({
  gagnant,
  choix,
  graine,
  finAt,
  dureeMs,
  noms,
  largeurEcran,
}: Props) => {
  const t = useHorloge(finAt, dureeMs)
  const { t: trad } = useTranslation()
  const { cible, largeur } = useLargeur()

  const coureurs = profils(graine, choix, gagnant)
  const defauts = HABILLAGES.pmu.choix
  const nommer = (cheval: number) =>
    noms[cheval]?.trim() ? noms[cheval] : trad(defauts[cheval])
  const fini = t >= FIN_DE_COURSE

  const positions = coureurs.map((coureur) => positionA(coureur, t))
  const vue = cadrage(largeur, largeurEcran, positions)
  // Le couloir suit l'échelle commune, comme le cheval : la tuile de gazon en
  // découle, et avec elle la période des décalages.
  const couloir = hauteurCouloir(vue.cheval)
  const gazon = calageDuGazon(graine, choix, couloir * RATIO_HERBE)

  return (
    <div className="flex w-full flex-1 flex-col justify-center" ref={cible}>
      {coureurs.map((coureur, cheval) => {
        const x = positions[cheval]
        // Le galop : un balancement dont la cadence suit la vitesse.
        const galop = t < coureur.arrivee ? Math.sin(t * 34 + cheval) * 4 : 0

        return (
          <div
            key={cheval}
            // Les lices, comme sur un vrai hippodrome : sans elles, quatre
            // couloirs de gazon n'en font plus qu'un.
            className={`relative overflow-hidden border-white/50 ${
              cheval === 0 ? "border-y-2" : "border-b-2"
            }`}
            style={{ height: `${couloir}px` }}
          >
            {/* Le nom reste sur place : il désigne le couloir, pas un point
                  du paysage, et défilerait sinon hors de l'écran. Sur fond de
                  gazon clair, il lui faut sa propre assise. */}
            <span className="absolute top-1 left-2 z-20 rounded bg-black/50 px-1.5 text-sm font-bold text-white md:text-base">
              {nommer(cheval)}
            </span>

            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${vue.piste}px`,
                transform: `translateX(${-vue.decalage}px)`,
                backgroundImage: "url(/herbe.png)",
                // L'image entière, calée en bas : sa frange transparente
                // reste donc visible en haut du couloir, où la couleur de fond
                // apparaît derrière la silhouette des brins.
                backgroundSize: "auto 100%",
                backgroundRepeat: "repeat-x",
                // Chaque couloir cale son gazon ailleurs : sans cela, les
                // répétitions de la texture s'alignent verticalement.
                backgroundPosition: `${gazon[cheval]}px bottom`,
                backgroundColor: "#2b6230",
              }}
            >
              {/* La ligne d'arrivée, en damier. */}
              <div
                className="absolute top-0 right-0 h-full"
                style={{
                  width: `${vue.damier}px`,
                  backgroundImage:
                    "linear-gradient(45deg,#fff 25%,transparent 25%,transparent 75%,#fff 75%),linear-gradient(45deg,#fff 25%,transparent 25%,transparent 75%,#fff 75%)",
                  backgroundColor: "#111",
                  backgroundSize: "0.75rem 0.75rem",
                  backgroundPosition: "0 0, 0.375rem 0.375rem",
                }}
              />

              <div
                className={`absolute bottom-1 z-10 flex items-center justify-center rounded-full ${ANSWERS_COLORS[cheval]}`}
                style={{
                  width: `${vue.cheval}px`,
                  height: `${vue.cheval}px`,
                  fontSize: `${Math.round(vue.cheval * 0.6)}px`,
                  left: `${vue.abscisse(x)}px`,
                  transform: `translateX(-50%) translateY(${galop}px) rotate(${galop / 3}deg)`,
                }}
              >
                {/* Le cheval de la police regarde à gauche : sans miroir,
                      il court à reculons. */}
                <span className="block" style={{ transform: "scaleX(-1)" }}>
                  🐎
                </span>
              </div>
            </div>
          </div>
        )
      })}

      <p
        className="mt-3 text-center text-3xl font-black text-white drop-shadow-lg md:text-5xl"
        style={{ opacity: fenetre(t, FIN_DE_COURSE, FIN_DE_COURSE + 0.06) }}
      >
        {fini ? trad("game:paris.pmu.vainqueur", { nom: nommer(gagnant) }) : ""}
      </p>
    </div>
  )
}

export default CoursePmu
