import type { TypePari } from "@razzia/common/paris"
import { ANSWERS_COLORS } from "@razzia/web/features/game/utils/reponses"

// L'habillage d'un pari : ce qui le distingue des deux autres une fois retiré
// le mécanisme commun — choisir parmi N sans information.
export interface Habillage {
  // Les libellés par défaut des choix, dans l'ordre où les boutons
  // s'affichent. Clés i18n.
  choix: string[]
  // Les choix se nomment-ils dans l'éditeur ? Le PMU, oui — on baptise ses
  // chevaux. Rouge ou noir, non : « Rouge » est le jeu, pas une réponse.
  nommables: boolean
  labelKey: string
  // Ce que l'écran demande au moment de miser.
  consigneKey: string
  // Les couleurs des boutons, quand celles du thème n'auraient pas de sens.
  //
  // Un pari reste une question et prend donc les couleurs des réponses — sauf
  // rouge ou noir, où le libellé EST la couleur : un bouton « Rouge » en bleu
  // demande au joueur de traduire, et ce n'est pas ce qu'on veut d'une mise
  // qu'il prend en trois secondes.
  couleurs?: string[]
}

/** Les couleurs des boutons d'un pari : les siennes, ou celles du thème. */
export const couleursDuPari = (type: TypePari) =>
  HABILLAGES[type].couleurs ?? ANSWERS_COLORS

export const HABILLAGES: Record<TypePari, Habillage> = {
  "rouge-noir": {
    choix: ["game:paris.rougeNoir.rouge", "game:paris.rougeNoir.noir"],
    nommables: false,
    couleurs: ["bg-[#c62828] text-white", "bg-[#111111] text-white"],
    labelKey: "quizz:questionType.rouge-noir",
    consigneKey: "game:paris.rougeNoir.consigne",
  },
  bonneteau: {
    // Gauche, milieu, droite : l'ordre des cartes sur le tapis, lu comme on
    // le regarde.
    choix: [
      "game:paris.bonneteau.gauche",
      "game:paris.bonneteau.milieu",
      "game:paris.bonneteau.droite",
    ],
    nommables: false,
    labelKey: "quizz:questionType.bonneteau",
    consigneKey: "game:paris.bonneteau.consigne",
  },
  pmu: {
    choix: [
      "game:paris.pmu.cheval1",
      "game:paris.pmu.cheval2",
      "game:paris.pmu.cheval3",
      "game:paris.pmu.cheval4",
    ],
    nommables: true,
    labelKey: "quizz:questionType.pmu",
    consigneKey: "game:paris.pmu.consigne",
  },
}
