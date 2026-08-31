import { DUREE_PARI, PARIS, type TypePari } from "@razzia/common/paris"
import BaseConfig from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig/BaseConfig"
import ConfigField from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig/ConfigField"
import ConfigNumberInput from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig/ConfigNumberInput"
import ConfigSection from "@razzia/web/features/quizz/components/QuestionEditor/QuestionEditorConfig/ConfigSection"
import { useQuestionEditee } from "@razzia/web/features/quizz/contexts/quizz-editor-context"
import { Hourglass } from "lucide-react"
import { useTranslation } from "react-i18next"

// Un pari se règle comme n'importe quelle question, à deux différences près.
//
// Il ne peut pas être sans limite de temps : les mises ne se fermeraient
// jamais, et le tirage n'aurait jamais lieu.
//
// Et il a une durée de jeu propre — le tirage, ou le mélange du bonneteau.
// C'est le réglage qui change le plus la partie : un mélange long se suit
// difficilement, une course longue se savoure.
export const creerReglagesDePari = (type: TypePari) => {
  // Le bonneteau mélange pendant l'énoncé : sa durée de jeu EST celle de la
  // phase, et « Affichage de la question » n'a plus rien à régler.
  const pendantLEnonce = !PARIS[type].apresLesMises

  const ReglagesDePari = () => {
    const { currentQuestion, currentId, updateQuestion } = useQuestionEditee()
    const { t } = useTranslation()

    return (
      <>
        <ConfigSection title={t("quizz:paris.jeu")}>
          <ConfigField>
            <ConfigField.Label
              icon={<Hourglass className="size-4" />}
              label={t("quizz:paris.duree")}
              unit="sec"
            />
            <ConfigNumberInput
              value={currentQuestion.dureePari ?? PARIS[type].duree}
              min={DUREE_PARI.min}
              max={DUREE_PARI.max}
              onChange={(valeur) =>
                updateQuestion(currentId, { dureePari: valeur })
              }
            />
            <ConfigField.Description>
              {t(
                pendantLEnonce
                  ? "quizz:paris.dureeHintMelange"
                  : "quizz:paris.dureeHintTirage",
              )}
            </ConfigField.Description>
          </ConfigField>
        </ConfigSection>

        <BaseConfig sansLimite={false} affichage={!pendantLEnonce} />
      </>
    )
  }

  return ReglagesDePari
}
