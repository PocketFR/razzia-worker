import { EVENTS } from "@razzia/common/constants"
import AlertDialog from "@razzia/web/components/AlertDialog"
import Button from "@razzia/web/components/Button"
import Input from "@razzia/web/components/Input"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import ConversionMusicale from "@razzia/web/features/quizz/components/ConversionMusicale"
import ImportDepuisQuizz from "@razzia/web/features/quizz/components/ImportDepuisQuizz"
import {
  parcourir,
  useQuizzEditor,
} from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { useNavigate } from "@tanstack/react-router"
import type { ChangeEvent } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

const QuizzEditorHeader = () => {
  const { quizzId, subject, setSubject, questions, melangerQuestions } =
    useQuizzEditor()
  // Le service retenu pour le contenu nouveau : c'est vers lui que la
  // conversion propose d'aller. Le bouton s'efface tout seul quand le quiz
  // n'a rien à y porter.
  const vers = useManagerStore((e) => e.config?.musicProvider) ?? "deezer"
  const { socket } = useSocket()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const handleChangeSubject = (e: ChangeEvent<HTMLInputElement>) => {
    setSubject(e.target.value)
  }

  const handleSave = () => {
    if (quizzId) {
      socket.emit(EVENTS.QUIZZ.UPDATE, { id: quizzId, subject, questions })
    } else {
      socket.emit(EVENTS.QUIZZ.SAVE, { subject, questions })
    }
  }

  useEvent(EVENTS.QUIZZ.SAVE_SUCCESS, () => {
    toast.success(t("quizz:quizzSaved"))
    navigate({ to: "/manager/config" })
  })

  useEvent(EVENTS.QUIZZ.UPDATE_SUCCESS, (_data) => {
    toast.success(t("quizz:quizzUpdated"))
    navigate({ to: "/manager/config" })
  })

  useEvent(EVENTS.QUIZZ.ERROR, (message) => {
    toast.error(t(message))
  })

  return (
    <header className="bg-background z-20 flex h-14 items-center justify-between gap-4 px-4 shadow-sm">
      <div className="flex items-center gap-6">
        <Input
          variant="sm"
          className="w-64"
          value={subject}
          onChange={handleChangeSubject}
          placeholder={t("quizz:titleQuizzPlaceholder")}
        />
      </div>

      <div className="flex gap-2">
        <ImportDepuisQuizz />

        {/* LE MÉLANGE SE CONFIRME. Il ne perd rien — l'ordre seul change, et
            quitter sans enregistrer l'annule — mais sur un quiz de cent
            cinquante questions patiemment ordonnées, un clic de trop coûte
            une reprise entière. */}
        {parcourir(questions).length > 1 && (
          <AlertDialog
            trigger={
              <Button className="text-md bg-accent text-accent-foreground px-4 py-2 font-semibold">
                {t("quizz:melange.bouton")}
              </Button>
            }
            title={t("quizz:melange.titre")}
            description={t("quizz:melange.aide")}
            confirmLabel={t("quizz:melange.confirmer")}
            variante="neutre"
            onConfirm={() => {
              melangerQuestions()
              toast.success(t("quizz:melange.fait"))
            }}
          />
        )}

        <ConversionMusicale vers={vers} />
        <Button
          className="text-md bg-accent text-accent-foreground px-4 py-2 font-semibold"
          onClick={() => navigate({ to: "/manager" })}
        >
          {t("common:exit")}
        </Button>
        <Button className="bg-primary text-md px-4 py-2" onClick={handleSave}>
          {t("common:save")}
        </Button>
      </div>
    </header>
  )
}

export default QuizzEditorHeader
