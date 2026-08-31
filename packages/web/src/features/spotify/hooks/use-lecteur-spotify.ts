// Branche le lecteur Spotify sur le déroulement de la partie.
//
// Le morceau démarre dès l'ÉNONCÉ, quelques secondes avant l'ouverture des
// réponses, sur un événement game:audioCue adressé à l'animateur SEUL — le
// média sonore n'accompagne pas SHOW_QUESTION, qui est diffusé à tous et
// livrerait la réponse.
//
// La surcouche devait, elle, précharger tout le quiz à la création puis
// recouper par l'intitulé de la question, avec un repli quand les deux
// divergeaient. Tout cela disparaît.
//
// Le repli sur SELECT_ANSWER reste, pour un seul cas mais un cas réel :
// l'animateur qui se reconnecte en cours de question a manqué l'amorce, qui
// ne sera pas rejouée.

import { EVENTS } from "@razzia/common/constants"
import { STATUS } from "@razzia/common/types/game/status"
import { useEvent } from "@razzia/web/features/game/contexts/socket-context"
import {
  activerAudio,
  demarrerLecteur,
  enLecture,
  jouer,
  lireMedia,
  nouvelleQuestion,
} from "@razzia/web/features/spotify/lib/lecteur"
import { lireSession } from "@razzia/web/features/spotify/lib/session"
import { useEffect } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

export const useLecteurSpotify = (clientId: string | null) => {
  const { t } = useTranslation()

  // Le lecteur démarre à l'ouverture de l'écran pour être prêt avant la
  // première question, mais seulement si une session existe : sans cela on
  // déclencherait une autorisation non sollicitée.
  useEffect(() => {
    if (!clientId || !lireSession()) {
      return
    }

    void demarrerLecteur(clientId, (cle) => toast.error(t(cle)))
  }, [clientId, t])

  useEvent(EVENTS.GAME.UPDATE_QUESTION, () => {
    nouvelleQuestion()
  })

  // Le premier geste de l'animateur débloque l'audio.
  //
  // Sans lui, tout paraît fonctionner — lecteur prêt, commandes acceptées en
  // 204 — et rien ne sort des enceintes. N'importe quel geste convient ;
  // en pratique c'est le clic sur « Démarrer la partie », soit juste avant
  // la première question.
  useEffect(() => {
    if (!clientId) {
      return
    }

    const surGeste = () => void activerAudio()
    const options = { once: true, capture: true } as const

    addEventListener("pointerup", surGeste, options)
    addEventListener("keydown", surGeste, options)

    return () => {
      removeEventListener("pointerup", surGeste, options)
      removeEventListener("keydown", surGeste, options)
    }
  }, [clientId])

  useEvent(EVENTS.GAME.AUDIO_CUE, ({ id, depart }) => {
    if (clientId) {
      void jouer(clientId, id, depart)
    }
  })

  useEvent(EVENTS.GAME.STATUS, ({ name, data }) => {
    if (!clientId) {
      return
    }

    const media = (data as { media?: { url?: string } })?.media

    // Repli : si l'amorce a été manquée, l'URI arrive au plus tard ici.
    if (name === STATUS.SELECT_ANSWER && !enLecture()) {
      const piste = lireMedia(media)

      if (piste) {
        void jouer(clientId, piste.id, piste.depart)
      }
    }
  })
}
