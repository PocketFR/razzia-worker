import type { TypePari } from "@razzia/common/paris"
import { creerApercuDesChoix } from "@razzia/web/features/questions/paris/components/ApercuDesChoix"
import { creerMiseBoutons } from "@razzia/web/features/questions/paris/components/MiseBoutons"
import { HABILLAGES } from "@razzia/web/features/questions/paris/types"
import { creerReglagesDePari } from "@razzia/web/features/questions/paris/components/ReglagesDePari"

// Les trois paris sont le même module, paramétré par le type. Ce qui les
// sépare — le nombre de choix, les couleurs, les libellés — vit dans
// HABILLAGES ; ce qui les rassemble est ici.
export const entreeDePari = (type: TypePari) => ({
  labelKey: HABILLAGES[type].labelKey,
  choixFiges: HABILLAGES[type].choix,
  // Le nombre de choix appartient au jeu : deux couleurs, trois cartes,
  // quatre chevaux. On peut renommer, jamais ajouter ni retirer.
  nombreDeReponsesFige: HABILLAGES[type].choix.length,
  AnswerComponent: creerMiseBoutons(type),
  // Un pari dont les choix se nomment — le PMU — garde la grille de saisie
  // ordinaire : c'est là qu'on baptise ses chevaux. Les autres la remplacent
  // par un aperçu, n'ayant rien à saisir.
  AnswersEditor: HABILLAGES[type].nommables
    ? undefined
    : creerApercuDesChoix(type),
  // Les réglages ordinaires — points, pénalité, durée d'affichage, temps de
  // mise — valent aussi pour un pari : c'est par là qu'on décide s'il ne se
  // joue que pour le pot de l'interlude. Seule l'absence de limite de temps
  // lui est refusée.
  ConfigComponent: creerReglagesDePari(type),
  // Aucune solution à désigner : c'est le serveur qui tire.
  SolutionPicker: () => null,
})
