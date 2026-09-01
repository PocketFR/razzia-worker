import { MEDIA_TYPES } from "@razzia/common/constants"
import { estUriMusique } from "@razzia/common/musique"
import type { QuestionMedia as QuestionMediaType } from "@razzia/common/types/game"

interface Props {
  media?: QuestionMediaType
  alt?: string
}

const QuestionMedia = ({ media, alt = "" }: Props) => {
  if (media?.type === MEDIA_TYPES.IMAGE) {
    return (
      <img
        alt={alt}
        src={media.url}
        className="max-h-60 w-auto rounded-md sm:max-h-100"
      />
    )
  }

  if (media?.type === MEDIA_TYPES.VIDEO) {
    return (
      <video
        className="m-4 mb-2 aspect-video max-h-60 w-auto rounded-md px-4 sm:max-h-100"
        src={media.url}
        autoPlay
        controls
      />
    )
  }

  if (media?.type === MEDIA_TYPES.AUDIO) {
    // Une URI « spotify: » ou « deezer: » n'est pas jouable par le
    // navigateur : le contrôle resterait inerte, et la surcouche le masquait
    // en CSS. Le morceau est joué côté animateur — par le SDK Spotify ou par
    // l'extrait Deezer — et surtout pas ici : ce composant s'affiche AUSSI
    // sur le téléphone des joueurs, où le son donnerait la réponse.
    if (estUriMusique(media.url)) {
      return null
    }

    return (
      <audio
        className="m-4 mb-2 w-auto rounded-md"
        src={media.url}
        autoPlay
        controls
      />
    )
  }

  return null
}

export default QuestionMedia
