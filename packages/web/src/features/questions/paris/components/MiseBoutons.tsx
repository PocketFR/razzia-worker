import type { TypePari } from "@razzia/common/paris"
import AnswerButton from "@razzia/web/features/game/components/AnswerButton"
import { ANSWERS_LABELS } from "@razzia/web/features/game/utils/reponses"
import {
  couleursDuPari,
  HABILLAGES,
} from "@razzia/web/features/questions/paris/types"
import type { AnswerComponentProps } from "@razzia/web/features/questions/types"
import { useTranslation } from "react-i18next"

// Les boutons de mise.
//
// Ils prennent les couleurs du thème, comme les réponses ordinaires : un pari
// est une question, et la salle n'a pas à réapprendre un code couleur entre
// deux écrans. Rouge ou noir fait exception — là, le libellé EST la couleur.
//
// Les libellés, eux, viennent selon le jeu du quiz ou de l'habillage. Un
// cheval se nomme — c'est la moitié du plaisir —, tandis que « Rouge » n'est
// pas une réponse qu'on écrit : c'est le jeu lui-même, et il doit rester
// traduit dans la langue de chacun.
export const creerMiseBoutons = (type: TypePari) => {
  const { choix, nommables } = HABILLAGES[type]
  const couleurs = couleursDuPari(type)

  const MiseBoutons = ({
    answers,
    onSubmit,
    readOnly,
  }: AnswerComponentProps) => {
    const { t } = useTranslation()
    const libelles = choix.map((cle, index) =>
      nommables ? (answers[index] ?? t(cle)) : t(cle),
    )

    return (
      <div className="mx-auto mb-4 grid w-full max-w-7xl grid-cols-2 gap-1 px-2 text-lg font-bold text-white md:text-xl">
        {libelles.map((libelle, index) => (
          <AnswerButton
            key={index}
            className={couleurs[index]}
            label={ANSWERS_LABELS[index]}
            onClick={() => onSubmit([index])}
            disabled={readOnly}
          >
            {libelle}
          </AnswerButton>
        ))}
      </div>
    )
  }

  return MiseBoutons
}
