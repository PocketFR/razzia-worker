import type { QuestionMediaType } from "@razzia/common/types/game"
import { questionMediaValidator } from "@razzia/common/validators/quizz"
import Button from "@razzia/web/components/Button"
import Card from "@razzia/web/components/Card"
import Input from "@razzia/web/components/Input"
import QuestionMedia from "@razzia/web/components/QuestionMedia"
import SpotifyMedia, {
  URI_SPOTIFY,
} from "@razzia/web/features/quizz/components/QuestionEditor/SpotifyMedia"
import { useQuestionEditee } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { Image, ImageOff, Music, Video } from "lucide-react"
import { type ChangeEvent } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

const QuestionEditorMedia = () => {
  const { updateQuestion, currentId, currentQuestion } = useQuestionEditee()
  const questionMedia = currentQuestion.media
  const { t } = useTranslation()

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
      {questionMedia && URI_SPOTIFY.test(questionMedia.url) ? (
        // Le lecteur <audio> natif reste inerte sur une URI spotify: — on
        // montre le morceau plutôt qu'un contrôle qui ne répond pas.
        // L'expression accepte « spotify: » sans identifiant : c'est
        // précisément l'état où l'animateur a besoin de la recherche.
        <SpotifyMedia
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
            {/* Raccourci vers le cadre Spotify : sans lui il fallait taper
                « spotify: » à la main dans le champ d'URL pour faire
                apparaître la recherche, ce que rien n'indiquait. */}
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
