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
    <div className="flex items-center gap-4 rounded-xl bg-black/45 p-3 text-white backdrop-blur-sm">
      {piste.cover && (
        <img
          src={piste.cover}
          alt=""
          className="size-20 shrink-0 rounded-lg object-cover shadow-lg"
        />
      )}

      <div className="min-w-0 text-left">
        <p className="truncate text-xl font-bold drop-shadow md:text-2xl">
          {piste.titre}
        </p>
        <p className="truncate text-sm opacity-80 md:text-base">{details}</p>
      </div>
    </div>
  )
}

export default CartePiste
