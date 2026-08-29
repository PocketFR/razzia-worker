/*
 * Décompte rendu localement, à partir d'une date de fin.
 *
 * Le serveur émettait auparavant un événement par seconde. Sur un Durable
 * Object, ce serait un réveil par seconde : l'hibernation n'économiserait
 * plus rien. Il annonce donc une échéance, une seule fois, et c'est ici
 * qu'elle est égrenée.
 *
 * Ce n'est pas qu'une économie. Le compteur suit désormais l'HORLOGE et non
 * le rythme des tics : un onglet ralenti, une trame perdue ou une alarme
 * servie en retard ne décalent plus l'affichage, alors qu'ils faisaient
 * dériver l'ancien compteur sans jamais le rattraper.
 *
 * `surSeconde` sert aux composants qui sonnent à chaque unité.
 */

import { useEffect, useRef, useState } from "react"

const restant = (finAt: number) =>
  Math.max(0, Math.ceil((finAt - Date.now()) / 1000))

export const useDecompte = (
  finAt: number | null | undefined,
  parDefaut: number,
  surSeconde?: () => void,
) => {
  const [valeur, setValeur] = useState(() =>
    finAt ? restant(finAt) : parDefaut,
  )
  const rappel = useRef(surSeconde)
  rappel.current = surSeconde

  useEffect(() => {
    // Sans échéance — question sans limite de temps — il n'y a rien à
    // décompter : on garde la valeur d'origine, comme le faisait l'amont.
    if (!finAt) {
      setValeur(parDefaut)

      return
    }

    setValeur(restant(finAt))

    // Quatre relevés par seconde : l'affichage reste franc même si le
    // navigateur étire les intervalles d'un onglet en arrière-plan.
    const minuteur = setInterval(() => {
      const reste = restant(finAt)

      setValeur((precedent) => {
        if (reste !== precedent) {
          rappel.current?.()
        }

        return reste
      })

      if (reste <= 0) {
        clearInterval(minuteur)
      }
    }, 250)

    return () => clearInterval(minuteur)
    // oxlint-disable-next-line exhaustive-deps
  }, [finAt, parDefaut])

  return valeur
}
