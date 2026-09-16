// Un générateur pseudo-aléatoire à graine, pour rejouer une animation.
//
// Le serveur tire une graine et la diffuse ; chaque client rejoue la même
// suite de tirages, donc le même mélange, la même course. Sans cela il
// faudrait piloter l'animation image par image depuis le serveur — beaucoup
// de trames pour un résultat qui saccade au moindre retard réseau.
//
// mulberry32 : trente-deux bits d'état, quatre opérations, une qualité
// largement suffisante pour décider de l'écart entre deux chevaux.
export const alea = (graine: number) => {
  let etat = graine >>> 0

  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0
    let t = etat
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
