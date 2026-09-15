import { QUESTION_TYPES } from "@razzia/common/constants"
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
  /**
   * Dernière QUESTION de son groupe : le moment où l'interlude se conclut.
   *
   * La dernière question, pas la dernière étape. Le verdict tombe au résultat
   * d'une question ; une diapo n'en a pas. Une diapo placée en fin de groupe
   * aurait sinon empêché le groupe de jamais se refermer — ni pot partagé, ni
   * survivants annoncés. Elle se joue désormais APRÈS le verdict.
   */
  finDeGroupe: boolean
}

export const estDiapo = (question: Question) =>
  question.type === QUESTION_TYPES.DIAPO

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

    // À la main plutôt que `findLastIndex` : la bibliothèque du Worker
    // s'arrête avant ES2023.
    const derniereQuestion = bloc.questions.reduce(
      (dernier, question, rang) => (estDiapo(question) ? dernier : rang),
      -1,
    )

    bloc.questions.forEach((question, rang) => {
      etapes.push({
        question,
        groupe: bloc,
        groupeIndex: index,
        finDeGroupe: rang === derniereQuestion,
      })
    })
  })

  return etapes
}

/**
 * Le numéro de chaque étape, diapos exclues, et le nombre de questions.
 *
 * LE COMPTEUR « 3 / 20 » NE COMPTE QUE DES QUESTIONS. Une diapo n'en est pas
 * une : la compter annoncerait vingt questions là où l'on n'en pose que dix-
 * sept, et décalerait le classement qu'on affiche toutes les cinq questions.
 * Une diapo reçoit `null`, ce qui masque le compteur pendant qu'elle est
 * affichée.
 */
export const numeroter = (
  etapes: Etape[],
): { numeros: Array<number | null>; total: number } => {
  let n = 0
  const numeros = etapes.map((etape) => (estDiapo(etape.question) ? null : ++n))

  return { numeros, total: n }
}

/** Où en est la manche, tel que l'annonce `game:updateQuestion`. */
export const avancement = (etapes: Etape[], index: number) => {
  const { numeros, total } = numeroter(etapes)

  return {
    current: numeros[index] ?? null,
    total,
    fond: etapes[index]?.question.fond,
  }
}
