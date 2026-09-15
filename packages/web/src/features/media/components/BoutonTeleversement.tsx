import {
  genreDuMime,
  MIME_MEDIA,
  TAILLE_MAX_MEDIA,
  type GenreMedia,
} from "@razzia/common/media"
import Button from "@razzia/web/components/Button"
import { socketClient } from "@razzia/web/features/game/lib/socket-client"
import { Upload } from "lucide-react"
import { useRef, useState, type ChangeEvent } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

interface Props {
  /** Les genres acceptés. Tous par défaut. */
  genres?: readonly GenreMedia[]
  /** Appelé avec l'adresse `/media/<uuid>` et le genre du fichier envoyé. */
  onTermine: (_url: string, _genre: GenreMedia) => void
  className?: string
}

const Mo = 1024 * 1024

/**
 * Choisit un fichier et le téléverse, avec sa progression.
 *
 * LES REFUS ÉVIDENTS SE FONT ICI, AVANT D'ENVOYER UN OCTET : un type refusé ou
 * un fichier trop gros ne mérite pas d'attendre la fin d'un envoi de 25 Mo
 * pour l'apprendre. Le serveur refait les mêmes contrôles — celui-ci n'est
 * qu'une politesse, jamais une garde.
 */
const BoutonTeleversement = ({
  genres = ["image", "audio", "video"],
  onTermine,
  className,
}: Props) => {
  const { t } = useTranslation()
  const champ = useRef<HTMLInputElement>(null)
  const [avancement, setAvancement] = useState<number | null>(null)

  const choisir = async (ev: ChangeEvent<HTMLInputElement>) => {
    const fichier = ev.target.files?.[0]

    // Vidé tout de suite : sans cela, rechoisir le même fichier après un
    // échec ne déclencherait aucun changement.
    ev.target.value = ""

    if (!fichier) {
      return
    }

    const genre = genreDuMime(fichier.type)

    if (!genre || !genres.includes(genre)) {
      toast.error(t("errors:media.type"))

      return
    }

    if (fichier.size > TAILLE_MAX_MEDIA[genre]) {
      toast.error(
        t("errors:media.tropGros", { max: TAILLE_MAX_MEDIA[genre] / Mo }),
      )

      return
    }

    setAvancement(0)

    try {
      const url = await socketClient.televerserMedia(fichier, setAvancement)

      onTermine(url, genre)
      toast.success(t("quizz:media.televerse"))
    } catch (erreur) {
      toast.error(
        t((erreur as Error).message, {
          max: TAILLE_MAX_MEDIA[genre] / Mo,
        }),
      )
    } finally {
      setAvancement(null)
    }
  }

  return (
    <>
      <input
        ref={champ}
        type="file"
        className="hidden"
        accept={genres.flatMap((genre) => MIME_MEDIA[genre]).join(",")}
        onChange={choisir}
      />
      <Button
        type="button"
        disabled={avancement !== null}
        onClick={() => champ.current?.click()}
        className={
          className ??
          "bg-accent text-accent-foreground hover:bg-accent transition-colors disabled:opacity-70"
        }
      >
        <div className="flex items-center gap-1.5">
          <Upload className="size-5" />
          <p className="tabular-nums">
            {avancement === null
              ? t("quizz:media.televerser")
              : `${Math.round(avancement * 100)} %`}
          </p>
        </div>
      </Button>
    </>
  )
}

export default BoutonTeleversement
