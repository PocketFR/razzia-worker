// L'aperçu de l'annonce, deux secondes avant l'énoncé.
//
// LA GRILLE ORDINAIRE ANNONCE QUATRE BOUTONS COLORÉS, ce qu'un classement ne
// donnera jamais : jusqu'à huit lignes, sans couleur ni lettre, en une seule
// colonne. Les deux colonnes de cases carrées se remplissaient au-delà de
// quatre de cases grises et sans libellé — les couleurs et les lettres
// s'arrêtent à D — et n'annonçaient pas le bon nombre.
//
// Cet aperçu ne sert qu'à faire lever les yeux vers l'écran : il montre la
// forme qui arrive, une pile de lignes numérotées, et le nombre exact.

import type { PreparedComponentProps } from "@razzia/web/features/questions/types"

const ClassementPrepa = ({ totalAnswers }: PreparedComponentProps) => (
  <div className="anim-quizz flex aspect-square w-60 flex-col gap-2 rounded-2xl bg-gray-700 p-5 md:w-60">
    {Array.from({ length: totalAnswers }).map((_, place) => (
      <div
        key={place}
        className="bg-primary shadow-inset flex h-full w-full items-center gap-2 rounded-lg px-2"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-black/20 text-xs font-bold text-white">
          {place + 1}
        </span>
        {/* Une barre muette : il n'y a rien à lire, seulement une forme à
            reconnaître. Les libellés arrivent avec l'énoncé. */}
        <span className="h-1.5 w-full rounded-full bg-white/40" />
      </div>
    ))}
  </div>
)

export default ClassementPrepa
