import { urlDeMediaValidator } from "@razzia/common/validators/quizz"
import Button from "@razzia/web/components/Button"
import Input from "@razzia/web/components/Input"
import BoutonTeleversement from "@razzia/web/features/media/components/BoutonTeleversement"
import ConfigField from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig/ConfigField"
import { useQuestionEditee } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { Wallpaper } from "lucide-react"
import { useTranslation } from "react-i18next"

/**
 * Le fond propre à une question, facultatif.
 *
 * Il vaut pour tous les types, diapo comprise, et s'affiche sur tous les
 * écrans le temps de l'étape. Un lien ou un fichier téléversé ; vide, le fond
 * du thème reprend sa place.
 */
const ChampFond = () => {
  const { currentQuestion, currentId, updateQuestion } = useQuestionEditee()
  const { t } = useTranslation()
  const { fond } = currentQuestion

  // Une chaîne vide n'est pas un fond : on retire le champ plutôt que
  // d'enregistrer une adresse que le validateur refuserait.
  const changer = (valeur?: string) => {
    const propre = valeur?.trim()

    if (!propre) {
      updateQuestion(currentId, { fond: undefined })

      return
    }

    updateQuestion(currentId, { fond: propre })
  }

  const valide = !fond || urlDeMediaValidator.safeParse(fond).success

  return (
    <ConfigField>
      <ConfigField.Label
        icon={<Wallpaper className="size-4" />}
        label={t("quizz:question.config.fond")}
      />
      <Input
        variant="sm"
        placeholder={t("quizz:question.config.fondPlaceholder")}
        value={fond ?? ""}
        onChange={(e) => changer(e.target.value)}
      />
      {!valide && (
        <p className="text-xs text-red-500">
          {t("errors:quizz.invalidMediaUrl")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <BoutonTeleversement
          genres={["image"]}
          onTermine={(url) => changer(url)}
          className="bg-accent text-accent-foreground hover:bg-accent text-sm transition-colors disabled:opacity-70"
        />
        {fond && (
          <Button
            size="sm"
            className="bg-accent text-accent-foreground hover:bg-accent transition-colors"
            onClick={() => changer(undefined)}
          >
            {t("common:delete")}
          </Button>
        )}
      </div>
      <ConfigField.Description>
        {t("quizz:question.config.fondAide")}
      </ConfigField.Description>
    </ConfigField>
  )
}

export default ChampFond
