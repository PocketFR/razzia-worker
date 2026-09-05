// Recopier les questions d'un autre quiz à la suite de celui-ci.
//
// LE BESOIN : les soirées se construisent souvent par assemblage — une manche
// reprise du quiz du mois dernier, un interlude qu'on rejoue. Sans ce bouton
// il fallait rouvrir l'autre quiz, retaper chaque question, et se tromper.
//
// RIEN N'EST ÉCRIT DANS LE QUIZ SOURCE. On lit, on recopie, on referme. Le
// quiz d'origine n'est pas touché, et le nôtre ne l'est qu'après validation —
// puis, comme toute modification de l'éditeur, il faut encore enregistrer.
//
// Les identifiants des blocs recopiés sont REFAITS par le contexte : deux
// blocs de même identifiant dans un même éditeur rendraient la sélection, le
// glissé-déposé et la suppression incapables de les distinguer.

import { EVENTS } from "@razzia/common/constants"
import type { QuizzWithId } from "@razzia/common/types/game"
import Button from "@razzia/web/components/Button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@razzia/web/components/Select"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { useQuizzEditor } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

/** Le nombre de questions d'un quiz, groupes aplatis. */
const compter = (quizz: QuizzWithId) =>
  quizz.questions.reduce(
    (total, bloc) => total + ("questions" in bloc ? bloc.questions.length : 1),
    0,
  )

const ImportDepuisQuizz = () => {
  const { quizzId, importerBlocs } = useQuizzEditor()
  const { socket } = useSocket()
  const { t } = useTranslation("quizz")
  const [ouvert, setOuvert] = useState(false)
  const [choisi, setChoisi] = useState("")
  const [enCours, setEnCours] = useState(false)

  // Le quiz courant est exclu : s'importer soi-même doublerait chaque
  // question, ce que personne ne demande et que le bouton ne devrait pas
  // rendre possible par inadvertance.
  const disponibles = (useManagerStore((e) => e.config?.quizz) ?? []).filter(
    (q) => q.id !== quizzId,
  )

  // La liste vient de la configuration animateur, qui peut ne pas avoir été
  // rechargée depuis la création d'un quiz dans un autre onglet.
  useEffect(() => {
    if (ouvert) {
      socket.emit(EVENTS.MANAGER.GET_CONFIG)
    }
  }, [ouvert, socket])

  useEvent(EVENTS.QUIZZ.DATA, (data) => {
    // La page de l'éditeur écoute le même événement pour SON quiz : on ne
    // retient que celui qu'on a demandé, et seulement pendant qu'on attend.
    if (!enCours || data.id !== choisi) {
      return
    }

    setEnCours(false)
    setOuvert(false)

    const combien = compter(data)

    if (!combien) {
      toast.error(t("import.vide"))

      return
    }

    importerBlocs(data.questions)
    toast.success(t("import.fait", { count: combien }))
  })

  useEvent(EVENTS.QUIZZ.ERROR, () => {
    if (enCours) {
      setEnCours(false)
    }
  })

  if (!disponibles.length) {
    return null
  }

  if (!ouvert) {
    return (
      <Button
        className="text-md bg-accent text-accent-foreground px-4 py-2 font-semibold"
        onClick={() => setOuvert(true)}
      >
        {t("import.bouton")}
      </Button>
    )
  }

  return (
    <div className="bg-background/95 fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6">
      <div className="flex w-full max-w-lg flex-col gap-3">
        <div>
          <h2 className="text-xl font-bold">{t("import.titre")}</h2>
          <p className="text-sm opacity-70">{t("import.aide")}</p>
        </div>

        <Select value={choisi} onValueChange={setChoisi}>
          <SelectTrigger>
            <SelectValue placeholder={t("import.choisir")} />
          </SelectTrigger>
          <SelectContent>
            {disponibles.map((q) => (
              <SelectItem key={q.id} value={q.id}>
                {q.subject}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex justify-end gap-2">
          <Button
            className="bg-accent text-accent-foreground px-4 py-2"
            onClick={() => {
              setOuvert(false)
              setChoisi("")
            }}
          >
            {t("import.annuler")}
          </Button>
          <Button
            className="bg-primary px-4 py-2 disabled:cursor-default disabled:opacity-40"
            disabled={!choisi || enCours}
            onClick={() => {
              setEnCours(true)
              socket.emit(EVENTS.QUIZZ.GET, choisi)
            }}
          >
            {t("import.confirmer")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ImportDepuisQuizz
