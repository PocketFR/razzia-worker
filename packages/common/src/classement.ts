// Le classement : ordonner des réponses plutôt que d'en choisir une.
//
// CE QUE LE JOUEUR ENVOIE EST UNE PERMUTATION, et rien d'autre : les indices
// des réponses du quiz, rangés dans l'ordre qu'il propose. La bonne réponse,
// elle, est l'ordre de saisie de l'éditeur — `solutions` vaut donc
// `[0, 1, 2, …]`. Le format des réponses ne change pas d'un iota par rapport
// aux autres types, et c'est ce qui permet à l'historique, au barème et à
// l'écran des réponses de continuer à ne manipuler que des indices.
//
// L'ORDRE AFFICHÉ EST MÉLANGÉ, sans quoi la question se répondrait toute
// seule : les réponses sont saisies dans le bon ordre. Le mélange est tiré
// d'une graine que le serveur diffuse, comme pour le bonneteau — chaque
// appareil calcule alors le même ordre, et le serveur n'a aucune permutation
// à mémoriser ni à retraduire.

import { alea } from "@razzia/common/alea"

/**
 * L'ordre d'affichage des réponses, tiré de la graine.
 *
 * JAMAIS L'ORDRE D'ORIGINE quand il y a plus d'une réponse : un mélange
 * honnête rend la solution une fois sur vingt-quatre à quatre éléments, et
 * cette fois-là la question est offerte. On retire tant que le tirage retombe
 * sur l'identité — en changeant de graine, pour ne pas boucler sur le même
 * tirage.
 */
export const ordreMelange = (graine: number, nombre: number): number[] => {
  for (let essai = 0; essai < 8; essai += 1) {
    const ordre = melanger(graine + essai, nombre)

    if (nombre < 2 || ordre.some((place, i) => place !== i)) {
      return ordre
    }
  }

  // Huit tirages identité de suite : hors d'atteinte en pratique, mais un
  // ordre inversé vaut mieux qu'une solution servie.
  return Array.from({ length: nombre }, (_, i) => nombre - 1 - i)
}

/** Fisher-Yates, du dernier au premier, avec le dé de la graine. */
const melanger = (graine: number, nombre: number): number[] => {
  const de = alea(graine)
  const ordre = Array.from({ length: nombre }, (_, i) => i)

  for (let i = nombre - 1; i > 0; i -= 1) {
    const j = Math.floor(de() * (i + 1))

    ;[ordre[i], ordre[j]] = [ordre[j], ordre[i]]
  }

  return ordre
}

/**
 * Est-ce bien un classement complet des mêmes éléments ?
 *
 * Le barème en dépend : une réponse qui répète un indice ou en oublie un ne
 * se compare à rien, et la compter quand même donnerait des points à qui
 * envoie n'importe quoi. Une trame se fabrique à la main.
 */
export const estClassementComplet = (
  propose: number[],
  attendu: number[],
): boolean =>
  propose.length === attendu.length &&
  new Set(propose).size === propose.length &&
  propose.every((indice) => attendu.includes(indice))

/**
 * Les paires bien et mal ordonnées entre la proposition et la solution.
 *
 * C'EST LA PAIRE QUI COMPTE, PAS LA PLACE. Échanger deux voisins coûte une
 * paire sur six à quatre éléments, là où la note aux places en efface deux
 * sur quatre. Une liste tournée d'un cran, qui n'a plus aucun élément à sa
 * place, garde encore la moitié de ses couples — et elle le mérite : le
 * joueur avait l'enchaînement, il s'est trompé de point de départ.
 */
export const pairesDuClassement = (propose: number[], attendu: number[]) => {
  const rang = new Map(attendu.map((indice, place) => [indice, place]))
  let bien = 0
  let mal = 0

  for (let i = 0; i < propose.length; i += 1) {
    for (let j = i + 1; j < propose.length; j += 1) {
      const avant = rang.get(propose[i]) ?? 0
      const apres = rang.get(propose[j]) ?? 0

      if (avant < apres) {
        bien += 1
      } else {
        mal += 1
      }
    }
  }

  return { bien, mal, total: bien + mal }
}
