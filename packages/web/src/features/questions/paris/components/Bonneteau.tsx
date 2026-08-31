import {
  applique,
  CASE_DU_CHOIX,
  construire,
  departPour,
  fenetresDuMelange,
  geometrie,
  nombreDEchanges,
  placeApres,
  placesInitiales,
} from "@razzia/web/features/questions/paris/melange"
import {
  adoucir,
  fenetre,
  useHorloge,
} from "@razzia/web/features/questions/paris/horloge"

// Le bonneteau : la dame est montrée, puis mélangée sous les yeux.
//
// C'est le seul des trois paris qui se joue AVANT la réponse — le jeu consiste
// à suivre la carte du regard. Sa position finale part donc au client dès
// l'énoncé ; on peut la lire dans les trames, et c'est sans importance : celui
// qui en est là ne joue plus au bonneteau.
//
// La construction du mélange vit dans melange.ts, sous test : que la dame
// finisse bien sur la case tirée ne se vérifie pas à l'œil.
interface Props {
  gagnant: number
  choix: number
  graine: number
  finAt: number
  dureeMs: number
}

const Bonneteau = ({ gagnant, choix, graine, finAt, dureeMs }: Props) => {
  const t = useHorloge(finAt, dureeMs)

  const { revelation, repos } = fenetresDuMelange(dureeMs)
  const suite = construire(
    graine,
    choix,
    nombreDEchanges((repos - revelation) * dureeMs),
  )
  // `gagnant` est l'indice du BOUTON tiré ; le mélange, lui, raisonne en
  // cases du tapis.
  const depart = departPour(suite, CASE_DU_CHOIX[gagnant] ?? gagnant)

  // Où en est le mélange, et quelle carte bouge en ce moment.
  const melange = fenetre(t, revelation, repos)
  const curseur = melange * suite.length
  const fait = Math.min(suite.length, Math.floor(curseur))
  const encours = melange < 1 && melange > 0 ? suite[fait] : null
  const avancement = adoucir(curseur - fait)

  // La place de chaque carte une fois les échanges accomplis joués. Les trois
  // partent d'une PERMUTATION des cases, jamais de leur propre indice — sans
  // quoi la dame se retrouve sous une autre carte.
  const placeDe = placesInitiales(depart, choix).map((debut) =>
    placeApres(suite, debut, fait),
  )

  const decouverte = t < revelation
  const { largeur, centre, largeurDuTapis, hauteurDuTapis } = geometrie(choix)

  return (
    <div
      className="relative mx-auto shrink-0"
      style={{ width: largeurDuTapis, height: hauteurDuTapis }}
    >
      {placeDe.map((place, carte) => {
        const bouge =
          encours && (place === encours.a || place === encours.b)
            ? applique(encours, place)
            : place
        const x = place + (bouge - place) * avancement
        // L'une passe par-dessus, l'autre par-dessous : sans cela les deux
        // cartes se traversent et le mélange perd tout son sens.
        const dessus = encours ? place === encours.a : false
        const saut = encours
          ? Math.sin(Math.PI * avancement) * (dessus ? -1 : 1) * 28
          : 0

        return (
          <div
            key={carte}
            className="absolute top-0 rounded-xl border-4 border-white shadow-2xl"
            style={{
              // Proportions d'une vraie carte à jouer — 63 × 88 mm.
              width: `${largeur}%`,
              aspectRatio: "63 / 88",
              // Chaque carte est posée sur le centre de sa case, ce qui la
              // rend indépendante de sa largeur.
              left: `${centre(x)}%`,
              transform: `translate(-50%, ${saut}px)`,
              zIndex: dessus ? 3 : 1,
              background:
                decouverte && carte === 0
                  ? "#fff"
                  : "repeating-linear-gradient(45deg,#1b5e20 0 10px,#2e7d32 10px 20px)",
            }}
          >
            {decouverte && carte === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-[#c62828]">
                <span className="text-5xl font-black md:text-7xl">Q</span>
                <span className="text-6xl leading-none md:text-8xl">♥</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default Bonneteau
