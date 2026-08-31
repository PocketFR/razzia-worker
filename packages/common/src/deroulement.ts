import {
  estGroupe,
  type BlocQuizz,
  type Groupe,
  type Question,
} from "@razzia/common/types/game"

// Le quiz déroulé en une suite plate d'étapes.
//
// L'imbrication est le bon modèle pour ÉCRIRE un quiz — elle rend un groupe
// dans un groupe impossible, et garde les réglages d'un interlude sur l'objet
// qui les porte. Elle est en revanche le mauvais modèle pour le JOUER : la
// manche avance question par question, sans se soucier des frontières.
//
// Cette fonction réconcilie les deux. Le reste du moteur ne voit qu'un
// tableau, indexé par `manche.question` comme avant ; ce qu'il a besoin de
// savoir du groupe voyage sur chaque étape.
export interface Etape {
  question: Question
  /** Le groupe auquel cette question appartient, ou null hors interlude. */
  groupe: Groupe | null
  /** Rang du groupe dans le quiz, pour le distinguer d'un groupe identique. */
  groupeIndex: number | null
  /** Dernière question de son groupe : le moment où l'interlude se conclut. */
  finDeGroupe: boolean
}

export const derouler = (blocs: BlocQuizz[]): Etape[] => {
  const etapes: Etape[] = []

  blocs.forEach((bloc, index) => {
    if (!estGroupe(bloc)) {
      etapes.push({
        question: bloc,
        groupe: null,
        groupeIndex: null,
        finDeGroupe: false,
      })

      return
    }

    bloc.questions.forEach((question, rang) => {
      etapes.push({
        question,
        groupe: bloc,
        groupeIndex: index,
        finDeGroupe: rang === bloc.questions.length - 1,
      })
    })
  })

  return etapes
}
