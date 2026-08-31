import { QUESTION_TYPES } from "@razzia/common/constants"
import type { QuestionType } from "@razzia/common/types/game"

// Les trois jeux de pari.
//
// Ils sont le même mécanisme — choisir parmi N sans information — et ne
// diffèrent que par N et par l'habillage. Ce qui les sépare vraiment, et qui
// se voit ici, c'est l'ORDRE des phases :
//
//   - « voir puis choisir » : le bonneteau. Le mélange se joue AVANT la
//     réponse, dans la phase d'énoncé qui existe déjà. Le jeu consiste à
//     suivre la dame des yeux, donc sa position est connue du client avant
//     qu'on réponde — lisible dans les trames, et c'est normal.
//   - « choisir puis voir » : rouge ou noir et le PMU. Le tirage se joue
//     APRÈS la fermeture des mises, ce qui demande une phase de plus.
//
// L'animation devant être réaliste, elle doit être déterministe : le serveur
// tire une graine, les clients rejouent la même chose à partir d'elle. Le
// tirage est fait dans le Durable Object et persisté AVANT d'être révélé,
// sans quoi un réveil après hibernation retirerait une autre carte.
export interface Pari {
  /** Le nombre de possibilités. Tout le reste est décor. */
  choix: number
  /** Le tirage se fait-il après la fermeture des mises ? */
  apresLesMises: boolean
  /**
   * Durée du jeu, en secondes. C'est le temps du tirage pour un pari joué
   * après les mises, et celui du mélange pour le bonneteau — qui occupe alors
   * la phase d'énoncé.
   *
   * Une valeur PAR DÉFAUT : `question.dureePari` la remplace quand elle est
   * renseignée. Un mélange plus long se suit plus difficilement, une course
   * plus longue se savoure.
   */
  duree: number
}

export const PARIS = {
  [QUESTION_TYPES.ROUGE_NOIR]: { choix: 2, apresLesMises: true, duree: 5 },
  [QUESTION_TYPES.BONNETEAU]: { choix: 3, apresLesMises: false, duree: 8 },
  [QUESTION_TYPES.PMU]: { choix: 4, apresLesMises: true, duree: 13 },
} as const satisfies Partial<Record<QuestionType, Pari>>

export type TypePari = keyof typeof PARIS

// Prend une chaîne quelconque, et non un QuestionType : le validateur s'en
// sert sur une donnée qui n'est pas encore typée, et c'est précisément là
// qu'il faut savoir si l'on a affaire à un pari.
export const estPari = (type: string): type is TypePari => type in PARIS

/** Bornes de la durée réglable, en secondes. */
export const DUREE_PARI = { min: 3, max: 60 } as const

/**
 * Ce qu'il faut à un client pour rejouer l'animation à l'identique.
 *
 * `gagnant` y figure dès l'envoi : pour le bonneteau c'est le principe même
 * du jeu, et pour les autres la trame ne part qu'une fois les mises closes.
 */
export interface Tirage {
  type: TypePari
  choix: number
  gagnant: number
  graine: number
}
