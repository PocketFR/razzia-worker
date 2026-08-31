// Enchaînement automatique des questions.
//
// Portage de razzia-auto.js, dont il faut reprendre la mécanique EXACTE.
//
// POURQUOI PAS UN useEffect, qui semblait naturel. La séquence des questions
// de classement enchaîne DEUX attentes : afficher le classement, puis passer
// à la question suivante. Or afficher le classement change le statut, ce qui
// relance l'effet et déclenche son nettoyage — lequel annulait la seconde
// attente. La partie se figeait alors sur le classement.
//
// Le minuteur vit donc dans une référence, hors du cycle de rendu, et n'est
// annulé que sur les deux événements qui l'invalident réellement : une
// nouvelle question — l'animateur a cliqué lui-même — et la fin de partie.
//
// LA RÈGLE DU CLASSEMENT est celle de l'amont : toutes les cinq questions ET
// systématiquement après la dernière. Sans ce « et », un quiz de quatorze
// questions n'afficherait jamais de classement final, le compte ne tombant
// pas juste.

import { EVENTS } from "@razzia/common/constants"
import { STATUS } from "@razzia/common/types/game/status"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { useCallback, useEffect, useRef, useState } from "react"

const DELAI_MS = 10000
const TOUS_LES = 5
const CLE = "razzia_auto"

export const useEnchainementAuto = (gameId: string | null) => {
  const { socket } = useSocket()

  const [actif, setActif] = useState(() => {
    try {
      return localStorage.getItem(CLE) === "1"
    } catch {
      return false
    }
  })

  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Les rappels différés lisent l'état par référence : capturé par valeur, un
  // décochage pendant l'attente resterait invisible.
  const actifRef = useRef(actif)
  const partieRef = useRef(gameId)
  const avancement = useRef<{ current: number; total: number } | null>(null)

  actifRef.current = actif
  partieRef.current = gameId

  const annuler = useCallback(() => {
    if (minuteur.current) {
      clearTimeout(minuteur.current)
      minuteur.current = null
    }
  }, [])

  const planifier = useCallback(
    (fn: () => void) => {
      annuler()
      minuteur.current = setTimeout(() => {
        minuteur.current = null

        // L'état a pu changer pendant l'attente : décochage, fin de partie.
        if (actifRef.current && partieRef.current) {
          fn()
        }
      }, DELAI_MS)
    },
    [annuler],
  )

  const basculer = useCallback(
    (valeur: boolean) => {
      setActif(valeur)

      try {
        localStorage.setItem(CLE, valeur ? "1" : "0")
      } catch {
        /* Navigation privée : le réglage ne survivra pas au rechargement */
      }

      // Décocher rend la main tout de suite, sans attendre la fin d'une
      // temporisation déjà lancée.
      if (!valeur) {
        annuler()
      }
    },
    [annuler],
  )

  useEvent(
    EVENTS.GAME.UPDATE_QUESTION,
    useCallback(
      (etat) => {
        avancement.current = etat ?? null
        // Une nouvelle question rend caduque une attente en cours, par
        // exemple si l'animateur a cliqué lui-même.
        annuler()
      },
      [annuler],
    ),
  )

  useEvent(
    EVENTS.GAME.STATUS,
    useCallback(
      ({ name }) => {
        if (name === STATUS.FINISHED) {
          annuler()

          return
        }

        if (name !== STATUS.SHOW_RESPONSES) {
          return
        }

        if (!actifRef.current || !partieRef.current) {
          return
        }

        // La partie est CAPTURÉE ici, et pas relue dans les fermetures.
        //
        // Celles-ci s'exécutent après un délai : entre la garde ci-dessus et
        // leur déclenchement, la référence peut être redevenue nulle — une
        // partie terminée, un animateur qui a quitté. On émettait alors avec
        // un gameId nul, ce qu'un `!` masquait au compilateur.
        const partie = partieRef.current
        const index = avancement.current?.current
        const total = avancement.current?.total
        const derniere = Boolean(total && index === total)

        const suivante = () =>
          socket.emit(EVENTS.MANAGER.NEXT_QUESTION, {
            gameId: partie,
          })

        if (index && (index % TOUS_LES === 0 || derniere)) {
          planifier(() => {
            socket.emit(EVENTS.MANAGER.SHOW_LEADERBOARD, {
              gameId: partie,
            })
            // La seconde attente est posée DEPUIS la première : c'est elle
            // que le nettoyage d'un effet supprimait.
            planifier(suivante)
          })

          return
        }

        planifier(suivante)
      },
      [annuler, planifier, socket],
    ),
  )

  useEffect(() => annuler, [annuler])

  return { actif, basculer }
}
