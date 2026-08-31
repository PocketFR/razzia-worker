import { alea } from "@razzia/web/features/questions/paris/alea"

// La course du PMU.
//
// La difficulté n'est pas de faire gagner le bon — il suffit de caler son
// arrivée — mais que la course reste crédible en chemin. Un cheval qui file
// devant du départ à l'arrivée ne trompe personne.
//
// Chaque cheval reçoit donc un profil de vitesse en dix tronçons, tiré de la
// graine : il accélère, il faiblit, il reprend. Les profils se croisent, les
// places changent, et c'est seulement la DATE D'ARRIVÉE qui est imposée.
export const TRONCONS = 10

/** L'instant, dans l'animation, où le vainqueur coupe la ligne. */
export const FIN_DE_COURSE = 0.82

export interface Coureur {
  cumul: number[]
  arrivee: number
}

export const profils = (
  graine: number,
  chevaux: number,
  gagnant: number,
): Coureur[] => {
  const dé = alea(graine)

  // Les arrivées : le gagnant d'abord, les autres échelonnés derrière dans un
  // ordre lui aussi tiré au sort.
  const retards = Array.from(
    { length: chevaux - 1 },
    (_, i) => 0.86 + i * 0.045,
  )

  for (let i = retards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(dé() * (i + 1))
    ;[retards[i], retards[j]] = [retards[j], retards[i]]
  }

  let suivant = 0

  return Array.from({ length: chevaux }, (_, cheval) => {
    // Des tronçons irréguliers, mais jamais à l'arrêt : un cheval qui stoppe
    // net se voit tout de suite.
    const poids = Array.from({ length: TRONCONS }, () => 0.55 + dé() * 0.9)
    const total = poids.reduce((a, b) => a + b, 0)
    const cumul: number[] = [0]

    for (const p of poids) {
      cumul.push(cumul[cumul.length - 1] + p / total)
    }

    return {
      cumul,
      arrivee: cheval === gagnant ? FIN_DE_COURSE : retards[suivant++],
    }
  })
}

/** La position d'un cheval, entre 0 et 1, à l'instant `t` de l'animation. */
export const positionA = (coureur: Coureur, t: number) => {
  const u = Math.min(1, t / coureur.arrivee)
  const position = Math.min(0.9999, Math.max(0, u)) * TRONCONS
  const index = Math.floor(position)
  const reste = position - index

  return (
    coureur.cumul[index] +
    (coureur.cumul[index + 1] - coureur.cumul[index]) * reste
  )
}
