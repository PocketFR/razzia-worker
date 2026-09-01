import { estProposable, estUriMusique } from "@razzia/common/musique"
import type { QuestionMediaType } from "@razzia/common/types/game"
import { questionMediaValidator } from "@razzia/common/validators/quizz"
import Button from "@razzia/web/components/Button"
import Card from "@razzia/web/components/Card"
import Input from "@razzia/web/components/Input"
import QuestionMedia from "@razzia/web/components/QuestionMedia"
import MediaMusique from "@razzia/web/features/quizz/components/QuestionEditor/MediaMusique"
import { useQuestionEditee } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { Image, ImageOff, Music, Video } from "lucide-react"
import { type ChangeEvent } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

const QuestionEditorMedia = () => {
  const { updateQuestion, currentId, currentQuestion } = useQuestionEditee()
  const questionMedia = currentQuestion.media
  const { t } = useTranslation()
  const spotifyId = useManagerStore((e) => e.config?.spotifyClientId) ?? null

  const hadnleChangeMediaType = (type: QuestionMediaType) => () => {
    const result = questionMediaValidator.safeParse({
      type,
      url: questionMedia?.url,
    })

    if (!result.success) {
      toast.error(t(result.error.issues[0].message))

      return
    }

    updateQuestion(currentId, { media: result.data })
  }

  const handleRemoveMedia = () => {
    if (!questionMedia) {
      return
    }

    updateQuestion(currentId, { media: undefined })
  }

  const handleChangeMedia = (e: ChangeEvent<HTMLInputElement>) => {
    updateQuestion(currentId, {
      media: { url: e.target.value },
    })
  }

  return (
    <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 p-4">
      {questionMedia && estUriMusique(questionMedia.url) ? (
        // Le lecteur <audio> natif reste inerte sur une URI spotify: ou
        // deezer: — on montre le morceau plutôt qu'un contrôle qui ne répond
        // pas. Le préfixe suffit, sans identifiant : c'est précisément l'état
        // où l'animateur a besoin de la recherche.
        <MediaMusique
          media={questionMedia}
          onChange={(media) => updateQuestion(currentId, { media })}
        />
      ) : (
        <QuestionMedia media={currentQuestion.media} alt="Question Media" />
      )}

      {!questionMedia?.type && (
        <Card className="my-auto flex max-h-100 w-full max-w-xl flex-1 flex-col items-center justify-center gap-2">
          <ImageOff className="stroke-accent-foreground size-16" />
          <p className="text-accent-foreground text-center text-sm">
            {t("quizz:question.addMediaHint")}
          </p>
          <Input
            variant="sm"
            className="w-full max-w-md"
            placeholder={t("quizz:question.mediaUrlPlaceholder")}
            value={questionMedia?.url ?? ""}
            onChange={handleChangeMedia}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              onClick={hadnleChangeMediaType("image")}
              className={`bg-accent text-accent-foreground hover:bg-accent transition-colors`}
            >
              <div className="flex items-center gap-1.5">
                <Image className="size-6" />
                <p>{t("quizz:question.media.image")}</p>
              </div>
            </Button>
            <Button
              onClick={hadnleChangeMediaType("video")}
              className={`bg-accent text-accent-foreground hover:bg-accent transition-colors`}
            >
              <div className="flex items-center gap-1.5">
                <Video className="size-6" />
                <p>{t("quizz:question.media.video")}</p>
              </div>
            </Button>
            <Button
              onClick={hadnleChangeMediaType("audio")}
              className={`bg-accent text-accent-foreground hover:bg-accent transition-colors`}
            >
              <div className="flex items-center gap-1.5">
                <Music className="size-6" />
                <p>{t("quizz:question.media.audio")}</p>
              </div>
            </Button>
            {/* Raccourcis vers les cadres musicaux : sans eux il fallait
                taper « spotify: » ou « deezer: » à la main dans le champ
                d'URL pour faire apparaître la recherche, ce que rien
                n'indiquait.

                LES DEUX SONT TOUJOURS LÀ. Un compte Spotify configuré
                n'empêche pas d'aller chercher un morceau chez Deezer : ce
                sont deux catalogues côte à côte, et une même soirée peut
                mêler les deux. Le bouton Spotify s'efface seulement quand
                son identifiant client manque, cas où il n'y aurait rien à
                tenter ; Deezer ne demande aucune clé et reste toujours là. */}
            {estProposable("spotify", spotifyId) && (
              <Button
                onClick={() =>
                  updateQuestion(currentId, {
                    media: { type: "audio", url: "spotify:" },
                  })
                }
                className="bg-accent text-accent-foreground hover:bg-accent transition-colors"
              >
                {/* Le logotype porte déjà le nom — 512 x 123, texte compris.
                    L'alt n'est donc pas décoratif : c'est le seul nom
                    accessible du bouton une fois la légende retirée. */}
                <img src="/spotify.svg" alt="Spotify" className="h-6 w-auto" />
              </Button>
            )}
            <Button
              onClick={() =>
                updateQuestion(currentId, {
                  media: { type: "audio", url: "deezer:" },
                })
              }
              className="bg-accent text-accent-foreground hover:bg-accent transition-colors"
            >
              {/* Comme celui de Spotify, ce logotype porte déjà le nom :
                  l'alt est le nom accessible du bouton, pas une décoration. */}
              <img src="/deezer.svg" alt="Deezer" className="h-5 w-auto" />
            </Button>
            <Button
              onClick={() =>
                updateQuestion(currentId, {
                  media: { type: "audio", url: "soundtrack:" },
                })
              }
              className="bg-accent text-accent-foreground hover:bg-accent transition-colors"
            >
              <img
                src="/soundtrack.svg"
                alt="Soundtrack"
                className="h-4 w-auto"
              />
            </Button>
          </div>
        </Card>
      )}

      {questionMedia?.type && (
        <div className="absolute bottom-4">
          <Button
            className="bg-accent text-foreground hover:bg-accent rounded-sm px-4 py-2 font-semibold transition-colors"
            onClick={handleRemoveMedia}
          >
            {t("common:delete")}
          </Button>
        </div>
      )}
    </div>
  )
}

export default QuestionEditorMedia
