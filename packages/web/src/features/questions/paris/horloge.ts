import { decalageHorloge } from "@razzia/web/features/game/lib/socket-client"
import { useEffect, useState } from "react"

// L'avancement d'une animation, entre 0 et 1, rafraîchi à chaque image.
//
// Le temps ne part pas du montage du composant mais de l'ÉCHÉANCE annoncée
// par le serveur : deux écrans allumés à une seconde d'intervalle jouent ainsi
// la même image au même moment, et celui qui rejoint en retard prend le film
// en cours au lieu de le reprendre au début.
//
// L'échéance est une date du SERVEUR. La comparer telle quelle à `Date.now()`
// suppose que les deux horloges s'accordent — elles ne s'accordent pas. Sur un
// poste dont l'heure retardait, `t` restait bloqué à zéro : la carte de rouge
// ou noir gardait une opacité nulle et ne s'affichait jamais, le bonneteau
// restait sur sa première image, et la course partait avec le retard exact de
// l'horloge. Tout marchait sur un téléphone, dont l'heure vient du réseau.
//
// La correction existait déjà pour les décomptes ; elle est posée ICI, dans
// l'horloge, et non chez les appelants — c'est le seul endroit où on ne peut
// pas l'oublier.
//
// Elle est relue à chaque image plutôt que capturée au montage : la trame qui
// la porte arrive à la connexion, mais si elle arrivait en cours d'animation,
// mieux vaut un saut qu'un écran figé.
export const avancementA = (finAt: number, dureeMs: number) => {
  const debut = finAt - decalageHorloge() - dureeMs

  return Math.min(1, Math.max(0, (Date.now() - debut) / dureeMs))
}

export const useHorloge = (finAt: number, dureeMs: number) => {
  const [avancement, setAvancement] = useState(() =>
    avancementA(finAt, dureeMs),
  )

  useEffect(() => {
    let image = 0

    const battre = () => {
      const t = avancementA(finAt, dureeMs)

      setAvancement(t)

      if (t < 1) {
        image = requestAnimationFrame(battre)
      }
    }

    image = requestAnimationFrame(battre)

    return () => cancelAnimationFrame(image)
  }, [finAt, dureeMs])

  return avancement
}

/** Interpolation adoucie, pour des départs et des arrêts qui ne claquent pas. */
export const adoucir = (t: number) => t * t * (3 - 2 * t)

/** Ramène t sur [0,1] à l'intérieur d'une fenêtre [debut, fin]. */
export const fenetre = (t: number, debut: number, fin: number) =>
  Math.min(1, Math.max(0, (t - debut) / (fin - debut)))
