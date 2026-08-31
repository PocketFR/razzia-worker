import {
  adoucir,
  fenetre,
  useHorloge,
} from "@razzia/web/features/questions/paris/horloge"
import { alea } from "@razzia/web/features/questions/paris/alea"
import { useTranslation } from "react-i18next"

// Rouge ou noir : une carte tirée du sabot, retournée après les mises.
//
// Le découpage tient en quatre temps — elle sort, elle hésite, elle se
// retourne, on la garde sous les yeux. L'hésitation n'est pas un ornement :
// sans elle le retournement arrive avant que la salle ait fini de regarder.
const SORTIE = [0, 0.18] as const
const SUSPENSE = [0.18, 0.5] as const
const RETOURNEMENT = [0.5, 0.66] as const

// Les enseignes, pour que la carte soit une carte et non un rectangle coloré.
const ENSEIGNES = [
  ["♥", "♦"],
  ["♠", "♣"],
]

interface Props {
  gagnant: number
  graine: number
  finAt: number
  dureeMs: number
}

const CarteRougeNoir = ({ gagnant, graine, finAt, dureeMs }: Props) => {
  const t = useHorloge(finAt, dureeMs)
  const { t: trad } = useTranslation()

  const dé = alea(graine)
  const enseigne = ENSEIGNES[gagnant][dé() < 0.5 ? 0 : 1]
  const valeur = ["A", "K", "Q", "J", "10", "9", "8", "7"][Math.floor(dé() * 8)]

  const sortie = adoucir(fenetre(t, ...SORTIE))
  const suspense = fenetre(t, ...SUSPENSE)
  const retourne = adoucir(fenetre(t, ...RETOURNEMENT))

  // Le tremblement du suspense s'éteint à mesure qu'on approche du
  // retournement : une carte qui vibre encore pendant qu'elle bascule fait
  // désordre.
  const tremble =
    suspense > 0 && retourne === 0
      ? Math.sin(suspense * 34) * 4 * (1 - suspense)
      : 0

  const rouge = gagnant === 0
  const couleur = rouge ? "#c62828" : "#1c1c1c"

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8">
      <div
        style={{ perspective: "1200px" }}
        className="h-64 w-44 md:h-96 md:w-64"
      >
        <div
          className="relative h-full w-full transition-none"
          style={{
            transformStyle: "preserve-3d",
            transform: `translateY(${(1 - sortie) * -140}%) rotate(${tremble}deg) rotateY(${retourne * 180}deg) scale(${0.9 + sortie * 0.1})`,
            opacity: sortie,
          }}
        >
          {/* Le dos */}
          <div
            className="absolute inset-0 rounded-2xl border-4 border-white/80 shadow-2xl"
            style={{
              backfaceVisibility: "hidden",
              background:
                "repeating-linear-gradient(45deg,#1a237e 0 10px,#283593 10px 20px)",
            }}
          />
          {/* La face */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border-4 border-white bg-white shadow-2xl"
            style={{
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              color: couleur,
            }}
          >
            <span className="text-6xl font-black md:text-8xl">{valeur}</span>
            <span className="text-7xl leading-none md:text-9xl">
              {enseigne}
            </span>
          </div>
        </div>
      </div>

      <p
        className="text-4xl font-black tracking-wide text-white drop-shadow-lg md:text-6xl"
        style={{ opacity: fenetre(t, 0.66, 0.76) }}
      >
        {trad(
          rouge ? "game:paris.rougeNoir.rouge" : "game:paris.rougeNoir.noir",
        )}
      </p>
    </div>
  )
}

export default CarteRougeNoir
