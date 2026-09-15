import { MEDIA_TYPES } from "@razzia/common/constants"
import { estUriMusique } from "@razzia/common/musique"
import {
  estMediaTexte,
  type QuestionMedia as QuestionMediaType,
} from "@razzia/common/types/game"
import { useMediaEntier } from "@razzia/web/features/media/hooks/use-media-entier"
import { attributsImage } from "@razzia/web/features/media/lib"
import { Music } from "lucide-react"

interface Props {
  media?: QuestionMediaType
  alt?: string
  /**
   * Écran de joueur pendant une diapo : la vidéo se lit sans le son, et le son
   * seul ne se joue pas du tout. Cent téléphones décalés d'une fraction de
   * seconde feraient une cacophonie ; le son vient du grand écran.
   *
   * Absent, le comportement d'une question est inchangé.
   */
  muet?: boolean
}

const Video = ({ url, muet }: { url: string; muet: boolean }) => {
  const lien = useMediaEntier(url)

  // Le fichier arrive en entier avant de se lire : on réserve sa place plutôt
  // que de faire sauter la mise en page à son arrivée.
  if (!lien) {
    return (
      <div className="bg-background/30 m-4 mb-2 aspect-video h-60 animate-pulse rounded-md sm:h-100" />
    )
  }

  return (
    <video
      className="m-4 mb-2 aspect-video max-h-60 w-auto rounded-md px-4 sm:max-h-100"
      src={lien}
      autoPlay
      playsInline
      muted={muet}
      loop={muet}
      controls={!muet}
    />
  )
}

const Son = ({ url }: { url: string }) => {
  const lien = useMediaEntier(url)

  return lien ? (
    <audio
      className="m-4 mb-2 w-auto rounded-md"
      src={lien}
      autoPlay
      controls
    />
  ) : null
}

const QuestionMedia = ({ media, alt = "", muet = false }: Props) => {
  if (!media) {
    return null
  }

  if (estMediaTexte(media)) {
    return (
      <p className="bg-background/90 text-foreground max-w-3xl rounded-xl px-6 py-4 text-center text-lg whitespace-pre-line shadow-lg md:text-2xl">
        {media.texte}
      </p>
    )
  }

  if (media.type === MEDIA_TYPES.IMAGE) {
    return (
      <img
        alt={alt}
        className="max-h-60 w-auto rounded-md sm:max-h-100"
        {...attributsImage(media.url)}
        sizes="(min-width: 640px) 60vw, 100vw"
      />
    )
  }

  if (media.type === MEDIA_TYPES.VIDEO) {
    return <Video url={media.url} muet={muet} />
  }

  if (media.type === MEDIA_TYPES.AUDIO) {
    // Une URI « spotify: » ou « deezer: » n'est pas jouable par le
    // navigateur : le contrôle resterait inerte, et la surcouche le masquait
    // en CSS. Le morceau est joué côté animateur — par le SDK Spotify ou par
    // l'extrait Deezer — et surtout pas ici : ce composant s'affiche AUSSI
    // sur le téléphone des joueurs, où le son donnerait la réponse.
    if (estUriMusique(media.url)) {
      return null
    }

    if (muet) {
      return (
        <div className="bg-background/80 text-foreground flex items-center justify-center rounded-full p-6 shadow-lg">
          <Music className="size-12" />
        </div>
      )
    }

    return <Son url={media.url} />
  }

  return null
}

export default QuestionMedia
