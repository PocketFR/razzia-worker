// Les réglages d'un interlude.
//
// Il n'a que deux champs — un titre et un pot — et une explication de la
// règle. Ses questions se modifient une par une, dans la barre latérale : ce
// panneau ne s'occupe que de ce qui appartient au groupe lui-même.
//
// Attention au z-index : GameBackground est en `fixed` sans z-index, donc
// peint au-dessus de tout frère statique. Chaque panneau de l'éditeur porte
// `z-10` pour cette raison — sans quoi il est bien dans le DOM, et invisible.

import GameBackground from "@razzia/web/components/GameBackground"
import Input from "@razzia/web/components/Input"
import { useQuizzEditor } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { Layers } from "lucide-react"
import { useTranslation } from "react-i18next"

const GroupeEditor = () => {
  const { currentGroupe, updateGroupe } = useQuizzEditor()
  const { t } = useTranslation()

  if (!currentGroupe) {
    return null
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <GameBackground />

      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div className="bg-background flex items-center gap-2 rounded-xl p-4 shadow-sm">
          <Layers className="text-muted-foreground size-6 shrink-0" />
          <h2 className="text-foreground truncate text-xl font-semibold">
            {currentGroupe.titre?.trim()
              ? currentGroupe.titre
              : t("quizz:groupe.untitled")}
          </h2>
        </div>

        <div className="bg-background flex flex-col gap-4 rounded-xl p-4 shadow-sm">
          <label className="flex flex-col gap-1">
            <span className="text-foreground font-semibold">
              {t("quizz:groupe.title")}
            </span>
            <Input
              value={currentGroupe.titre ?? ""}
              placeholder={t("quizz:groupe.titlePlaceholder")}
              onChange={(e) =>
                updateGroupe(currentGroupe.id, { titre: e.target.value })
              }
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-foreground font-semibold">
              {t("quizz:groupe.points")}
            </span>
            <Input
              type="number"
              min={0}
              value={currentGroupe.points ?? 0}
              onChange={(e) =>
                updateGroupe(currentGroupe.id, {
                  points: Math.max(0, parseInt(e.target.value, 10) || 0),
                })
              }
            />
          </label>
        </div>

        <p className="bg-background text-muted-foreground rounded-xl p-4 text-sm shadow-sm">
          {t("quizz:groupe.explain")}
        </p>
      </main>
    </div>
  )
}

export default GroupeEditor
