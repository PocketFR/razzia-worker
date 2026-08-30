/*
 * Le morceau d'une question, montré aux joueurs.
 *
 * Sur l'écran des réponses, le blind test se termine sans jamais dire ce
 * qu'on vient d'entendre : la bonne réponse donne le titre OU l'artiste,
 * rarement les deux, et jamais l'album ni l'année. Cette carte referme la
 * question — c'est le moment où tout le monde regarde l'écran en commentant.
 *
 * Elle ne s'affiche que quand les métadonnées sont là : un cadre vide ou un
 * « chargement » perpétuel vaudrait moins que rien à cet endroit.
 *
 * DIMENSIONNÉE POUR UN TÉLÉVISEUR, pas pour un écran de bureau à cinquante
 * centimètres : cet écran se regarde de l'autre bout de la pièce, et la
 * première version, calée sur les tailles de l'éditeur, était illisible.
 */

import { usePisteSpotify } from "@razzia/web/features/spotify/hooks/use-piste"

interface Props {
  id: string
}

const CartePiste = ({ id }: Props) => {
  const { piste } = usePisteSpotify(id)

  if (!piste) {
    return null
  }

  const details = [piste.artiste, piste.album, piste.annee ? String(piste.annee) : ""]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex max-w-3xl items-center gap-5 rounded-2xl bg-black/50 p-4 text-white shadow-xl backdrop-blur-sm md:gap-7 md:p-6">
      {piste.cover && (
        <img
          src={piste.cover}
          alt=""
          className="size-28 shrink-0 rounded-xl object-cover shadow-lg md:size-40"
        />
      )}

      <div className="min-w-0 text-left">
        <p className="truncate text-3xl font-bold drop-shadow md:text-5xl">
          {piste.titre}
        </p>
        <p className="mt-1 truncate text-lg opacity-85 md:mt-2 md:text-2xl">
          {details}
        </p>
      </div>
    </div>
  )
}

export default CartePiste
