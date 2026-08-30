/*
 * Enchaînement automatique des questions.
 *
 * Reprend razzia-auto.js. Trois contorsions de la surcouche disparaissent :
 * elle interceptait le socket faute d'y avoir accès, repérait le bouton
 * « Passer » par la forme du compteur voisin — son libellé changeant avec la
 * langue — et réinsérait sa case à chaque rendu de React. Ici, tout est à
 * portée de main.
 *
 * LA RÈGLE DU CLASSEMENT vaut d'être conservée telle quelle : il s'intercale
 * toutes les cinq questions ET systématiquement après la dernière. Sans ce
 * « et », un quiz de quatorze questions n'afficherait jamais de classement
 * final, le compte ne tombant pas juste.
 */

import { EVENTS } from "@razzia/common/constants"
import { STATUS } from "@razzia/common/types/game/status"
import { useSocket } from "@razzia/web/features/game/contexts/socket-context"
import { useQuestionStore } from "@razzia/web/features/game/stores/question"
import { useCallback, useEffect, useRef, useState } from "react"

const DELAI_MS = 10000
const TOUS_LES = 5
const CLE = "razzia_auto"

export const useEnchainementAuto = (
  gameId: string | null,
  statut: string | undefined,
) => {
  const { socket } = useSocket()
  const { questionStates } = useQuestionStore()

  const [actif, setActif] = useState(() => {
    try {
      return localStorage.getItem(CLE) === "1"
    } catch {
      return false
    }
  })

  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null)

  const annuler = useCallback(() => {
    if (minuteur.current) {
      clearTimeout(minuteur.current)
      minuteur.current = null
    }
  }, [])

  const basculer = useCallback((valeur: boolean) => {
    setActif(valeur)

    try {
      localStorage.setItem(CLE, valeur ? "1" : "0")
    } catch {
      /* navigation privée : le réglage ne survivra pas au rechargement */
    }
  }, [])

  // Décocher interrompt une attente en cours : l'animateur reprend la main
  // immédiatement, sans avoir à deviner s'il reste une minuterie armée.
  useEffect(() => {
    if (!actif) {
      annuler()
    }
  }, [actif, annuler])

  useEffect(() => {
    if (!actif || !gameId || statut !== STATUS.SHOW_RESPONSES) {
      return
    }

    const planifier = (fn: () => void) => {
      annuler()
      minuteur.current = setTimeout(() => {
        minuteur.current = null
        fn()
      }, DELAI_MS)
    }

    const suivante = () => socket.emit(EVENTS.MANAGER.NEXT_QUESTION, { gameId })

    const index = questionStates?.current
    const total = questionStates?.total
    const derniere = Boolean(total && index === total)

    if (index && (index % TOUS_LES === 0 || derniere)) {
      planifier(() => {
        socket.emit(EVENTS.MANAGER.SHOW_LEADERBOARD, { gameId })
        planifier(suivante)
      })
    } else {
      planifier(suivante)
    }

    // Un changement de question annule une attente devenue caduque, par
    // exemple si l'animateur a cliqué lui-même entre-temps.
    return annuler
  }, [actif, gameId, statut, questionStates, socket, annuler])

  return { actif, basculer }
}
