// La barre du haut d'une manche : le compteur, les commandes, la sortie.
//
// LE COMPTEUR À GAUCHE, TOUT LE RESTE À DROITE. Avec un simple
// `justify-between`, les trois éléments se répartissaient l'espace disponible :
// le compteur disparaissant sur une diapo, le bouton « Suivant » et la case
// d'enchaînement automatique glissaient vers la gauche à chaque diapo, puis
// revenaient à la question suivante. L'animateur visait un bouton qui avait
// bougé.
//
// L'emplacement du compteur reste donc tenu, occupé ou non, et c'est LUI qui
// pousse les commandes et la sortie contre le bord droit — d'où leur place,
// insensible à ce que le compteur affiche.

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
  <div className="flex w-full items-center gap-3 p-4">
    <div className="mr-auto">
      {compteur !== null && (
        <div className="flex items-center rounded-md bg-white p-2 px-4 text-lg font-bold text-black">
          {compteur}
        </div>
      )}
    </div>

    <div>{commandes}</div>

    <div>{sortie}</div>
  </div>
)

export default EnteteDeManche
