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

// Le cadrage : à quelle échelle dessiner la piste, et où regarder.
//
// La piste est dessinée à la largeur de l'écran de l'ANIMATEUR, pas à celle de
// l'appareil qui regarde. Un téléphone n'écrase donc pas la course : il en
// montre une fenêtre, cadrée sur le peloton. L'écart entre deux chevaux y
// occupe le même nombre de pixels que sur la télévision — et c'est cet écart,
// seul, qui dit qui est en train de gagner.
//
// Tout est en pixels et calculé ICI, y compris la taille du cheval et celle du
// damier : les mêmes nombres servent à dessiner et à placer. Les séparer avait
// déjà valu une arrivée qui s'arrêtait avant la ligne sur les petits écrans.

/** Part de la piste occupée par un cheval, et ses bornes en pixels. */
const CHEVAL_PART = 0.033
const CHEVAL_MIN = 32
const CHEVAL_MAX = 68

export interface Cadrage {
  /** Largeur totale de la piste dessinée. */
  piste: number
  /** Largeur réellement visible. */
  vue: number
  /** De combien la piste est décalée vers la gauche. */
  decalage: number
  cheval: number
  damier: number
  /** Le centre d'un cheval, en pixels dans la piste, pour une position 0 à 1. */
  abscisse: (_position: number) => number
}

export const cadrage = (
  largeurLocale: number,
  largeurReference: number | undefined,
  positions: number[],
): Cadrage => {
  // Avant la première mesure, la largeur locale vaut zéro : on se rabat sur la
  // référence pour ne pas dessiner une piste de largeur nulle le temps d'une
  // image.
  const vue = largeurLocale > 0 ? largeurLocale : (largeurReference ?? 0)
  const piste = Math.max(vue, largeurReference ?? vue)
  const cheval = Math.round(
    Math.min(CHEVAL_MAX, Math.max(CHEVAL_MIN, piste * CHEVAL_PART)),
  )
  const damier = Math.round(Math.max(14, cheval * 0.45))
  const abscisse = (position: number) =>
    cheval / 2 + position * (piste - cheval)

  // La caméra suit la MOYENNE des positions : elle garde le peloton au centre
  // sans s'accrocher au meneur, ce qui ferait sortir les retardataires.
  const moyenne = positions.length
    ? positions.reduce((somme, p) => somme + abscisse(p), 0) / positions.length
    : 0
  const course = Math.max(0, piste - vue)
  const decalage = Math.min(course, Math.max(0, moyenne - vue / 2))

  return { piste, vue, decalage, cheval, damier, abscisse }
}

// Le calage horizontal du gazon, propre à chaque couloir.
//
// Sans lui, les répétitions de la texture s'alignent d'un couloir à l'autre :
// quatre coutures verticales à la même abscisse, que l'œil repère aussitôt.
// Décalées, elles se dissolvent dans le motif.
//
// Tiré de la GRAINE, comme le reste : la télévision et les téléphones doivent
// montrer le même gazon, pas chacun le sien. La graine est mêlée à une
// constante pour ne pas rejouer la suite qui décide déjà de la course — deux
// usages du même tirage se corréleraient sans qu'on sache lequel biaise
// l'autre.
const SEL_DU_GAZON = 0x5bf03635

// Proportions de public/herbe.png. La tuile affichée fait la hauteur du
// couloir multipliée par ce rapport — c'est la période au-delà de laquelle un
// décalage revient au même.
export const RATIO_HERBE = 1636 / 120

/** Hauteur d'un couloir : elle suit l'échelle commune, comme le cheval. */
export const hauteurCouloir = (cheval: number) => Math.round(cheval * 1.9)

// Le tirage est STRATIFIÉ, pas libre : chaque couloir reçoit sa part de la
// tuile, et l'on tire à l'intérieur. Un tirage libre alignait deux couloirs
// une fois sur cent trente — rare, mais c'est précisément ce qu'on cherchait
// à éviter, et le rare finit par tomber en soirée.
//
// La part est resserrée à ses trois cinquièmes centraux : deux couloirs
// voisins gardent ainsi un écart d'au moins deux cinquièmes de part, même
// tombés chacun au bord de la sienne.
const MARGE = 0.2

export const calageDuGazon = (
  graine: number,
  couloirs: number,
  tuile: number,
): number[] => {
  const dé = alea(graine ^ SEL_DU_GAZON)
  const part = tuile / couloirs

  return Array.from({ length: couloirs }, (_, couloir) =>
    Math.round((couloir + MARGE + dé() * (1 - 2 * MARGE)) * part),
  )
}
