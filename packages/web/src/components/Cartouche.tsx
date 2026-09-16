// Le cadre des textes posés sur le fond d'écran.
//
// UN TEXTE BLANC SUR UNE IMAGE QUELCONQUE N'EST PAS LISIBLE. Tant que le fond
// était sombre — le décor, ou l'image livrée avec l'application — une ombre
// portée suffisait. Depuis qu'un animateur téléverse le fond de son choix,
// question par question, l'énoncé peut se retrouver sur un ciel clair : il
// disparaît, et personne ne peut répondre.
//
// Le cadre règle le cas une fois pour toutes, parce qu'il ne dépend pas de ce
// qu'il y a derrière : un fond noir à demi transparent, flouté, qui garde
// l'image visible sans lui laisser le texte. C'est celui de la carte du
// morceau, qui tenait déjà ce rôle sur l'écran des réponses ; il est ici pour
// que les deux ne divergent plus.

import type { PropsWithChildren } from "react"
import { twMerge } from "tailwind-merge"

type Props = PropsWithChildren<{ className?: string }>

const Cartouche = ({ children, className }: Props) => (
  <div
    className={twMerge(
      // `max-w-full` : un long énoncé revient à la ligne dans le cadre au lieu
      // de le faire déborder de l'écran.
      "max-w-full rounded-2xl bg-black/50 px-5 py-3 text-white shadow-xl backdrop-blur-sm md:px-8 md:py-4",
      className,
    )}
  >
    {children}
  </div>
)

export default Cartouche
