// L'écran du joueur : ranger les réponses, puis valider.
//
// L'ORDRE DE DÉPART VIENT DE LA GRAINE, pas du quiz : les réponses y sont
// saisies dans le bon ordre, les afficher telles quelles répondrait à la
// question. Chaque appareil calcule le même mélange à partir de la graine
// diffusée par le serveur, ce qui laisse les indices intacts — le joueur
// renvoie les indices du quiz, dans SON ordre, et le barème les compare à
// `solutions` sans rien avoir à retraduire.
//
// TOUT LE MONDE VOIT LE MÊME ORDRE, y compris le grand écran : la salle
// commente une liste, pas quinze listes différentes.

import { ordreMelange } from "@razzia/common/classement"
import Button from "@razzia/web/components/Button"
import {
  ColonneOrdonnable,
  LigneOrdonnable,
} from "@razzia/web/features/questions/classement/components/ColonneOrdonnable"
import type { AnswerComponentProps } from "@razzia/web/features/questions/types"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

const ClassementAnswers = ({
  answers,
  graine,
  onSubmit,
  readOnly,
}: AnswerComponentProps) => {
  const { t } = useTranslation()
  const [ordre, setOrdre] = useState<number[]>(() =>
    ordreMelange(graine ?? 0, answers.length),
  )

  // La question suivante réutilise ce composant : sans ce réarmement, elle
  // hériterait de l'ordre de la précédente.
  useEffect(() => {
    setOrdre(ordreMelange(graine ?? 0, answers.length))
  }, [graine, answers.length])

  return (
    <div className="mx-auto mb-4 flex w-full max-w-2xl flex-col gap-3 px-2">
      {!readOnly && (
        <p className="rounded-lg bg-black/40 px-3 py-1.5 text-center text-sm font-semibold text-white md:text-base">
          {t("game:classement.consigne")}
        </p>
      )}

      <ColonneOrdonnable
        ids={ordre.map(String)}
        onOrdre={(suivant) => setOrdre(suivant.map(Number))}
      >
        {ordre.map((indice, place) => (
          <LigneOrdonnable
            key={indice}
            id={String(indice)}
            rang={place + 1}
            mobile={!readOnly}
          >
            {answers[indice]}
          </LigneOrdonnable>
        ))}
      </ColonneOrdonnable>

      {!readOnly && (
        <Button
          onClick={() => onSubmit(ordre)}
          className="mx-auto w-full max-w-xs"
        >
          {t("game:confirm")}
        </Button>
      )}
    </div>
  )
}

export default ClassementAnswers
