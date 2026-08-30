/*
 * La musique d'attente pendant qu'on répond.
 *
 * Elle a son composant, et ce n'est pas un découpage de confort : useSound
 * CONSTRUIT LE HOWL AU MONTAGE, ce qui télécharge le fichier — 1,2 Mo, le
 * plus lourd de l'application. Son option `soundEnabled: false` n'empêche que
 * la lecture, pas le téléchargement. Un simple drapeau autour de l'appel à
 * play() aurait donc laissé chaque téléphone de la soirée payer la bande
 * passante d'un morceau qu'il ne joue pas.
 *
 * En isolant le hook dans un composant, le rendre facultatif redevient ce
 * qu'il doit être : on ne le monte pas.
 */

import { SFX } from "@razzia/web/features/game/utils/constants"
import { useEffect } from "react"
import useSound from "use-sound"

const MusiqueDesReponses = () => {
  const [jouer, { stop: arreter }] = useSound(SFX.ANSWERS.MUSIC, {
    volume: 0.2,
    interrupt: true,
    loop: true,
  })

  useEffect(() => {
    jouer()

    return () => {
      arreter()
    }
    // arreter change à chaque rendu chez use-sound : l'inclure relancerait
    // la musique depuis le début à chaque fois.
    // oxlint-disable-next-line exhaustive-deps
  }, [jouer])

  return null
}

export default MusiqueDesReponses
