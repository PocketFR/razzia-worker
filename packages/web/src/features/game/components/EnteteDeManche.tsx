// La barre du haut d'une manche : le compteur, les commandes, la sortie.
//
// TROIS EMPLACEMENTS FIXES, ET C'EST TOUT L'INTÉRÊT. Avec un simple
// `justify-between`, les trois éléments se répartissent l'espace disponible :
// le compteur disparaissant sur une diapo, le bouton « Suivant » et la case
// d'enchaînement automatique glissaient vers la gauche à chaque diapo, puis
// revenaient à la question suivante. L'animateur visait un bouton qui avait
// bougé.
//
// La grille garde les trois emplacements, occupés ou non : le compteur à
// gauche, les commandes au centre, la sortie à droite. La colonne du milieu
// est dimensionnée par son contenu, les deux autres se partagent le reste à
// parts égales — c'est ce qui centre les commandes quel que soit ce qui les
// entoure.

import type { ReactNode } from "react"

interface Props {
  /** « 3 / 20 ». Null sur une diapo, et hors question : la place reste. */
  compteur: string | null
  /** La case d'enchaînement et le bouton « Suivant », côté animateur. */
  commandes?: ReactNode
  /** Le bouton « Quitter », côté animateur. */
  sortie?: ReactNode
}

const EnteteDeManche = ({ compteur, commandes, sortie }: Props) => (
  <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3 p-4">
    <div className="justify-self-start">
      {compteur !== null && (
        <div className="flex items-center rounded-md bg-white p-2 px-4 text-lg font-bold text-black">
          {compteur}
        </div>
      )}
    </div>

    <div className="justify-self-center">{commandes}</div>

    <div className="justify-self-end">{sortie}</div>
  </div>
)

export default EnteteDeManche
