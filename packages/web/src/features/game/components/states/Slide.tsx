import { lireUriMusique } from "@razzia/common/musique"
import { urlDuMedia } from "@razzia/common/types/game"
import type { CommonStatusDataMap } from "@razzia/common/types/game/status"
import QuestionMedia from "@razzia/web/components/QuestionMedia"
import CartePiste from "@razzia/web/features/musique/components/CartePiste"

interface Props {
  data: CommonStatusDataMap["SHOW_SLIDE"]
}

/**
 * Une diapo : un titre et un élément, sans réponses.
 *
 * TOUT LE MONDE VOIT LA MÊME CHOSE, vidéo comprise — le téléversement est
 * servi par le cache de Cloudflare, cent téléphones ne réveillent ni le Worker
 * ni R2. Seul le son reste au grand écran : la vidéo s'y lit avec le son, les
 * téléphones la lisent muette.
 *
 * Une musique de catalogue (Spotify, Deezer, Soundtrack) se montre par sa
 * pochette : il n'y a pas de réponse à trahir sur une diapo. Le son, lui, part
 * par l'amorce de l'animateur, comme pour une question.
 */
const Diapo = ({
  data: { titre, media },
  animateur,
}: Props & { animateur: boolean }) => {
  const url = urlDuMedia(media)
  const piste = url ? lireUriMusique(url) : null

  return (
    <section className="mx-auto flex h-full w-full max-w-7xl flex-1 flex-col items-center justify-center gap-6 px-4">
      <h2 className="text-center text-3xl font-bold text-balance text-white drop-shadow-lg md:text-5xl lg:text-6xl">
        {titre}
      </h2>

      {piste?.id ? (
        <CartePiste uri={url ?? ""} />
      ) : (
        <QuestionMedia media={media} alt={titre} muet={!animateur} />
      )}
    </section>
  )
}

/** L'écran d'un joueur : vidéo muette, pas de son. */
const Slide = (props: Props) => <Diapo {...props} animateur={false} />

/** Le grand écran : la vidéo et le son se jouent. */
export const SlideAnimateur = (props: Props) => <Diapo {...props} animateur />

export default Slide
