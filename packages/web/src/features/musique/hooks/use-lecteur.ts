// Branche le lecteur musical sur le déroulement de la partie.
//
// Le morceau démarre dès l'ÉNONCÉ, quelques secondes avant l'ouverture des
// réponses, sur un événement game:audioCue adressé à l'animateur SEUL — le
// média sonore n'accompagne pas SHOW_QUESTION, qui est diffusé à tous et
// livrerait la réponse.
//
// L'ÉVÉNEMENT PORTE L'URI COMPLÈTE, pas un identifiant : c'est elle qui dit
// par quel lecteur le morceau se joue. Une exception, et une seule : quand une
// zone sonore Soundtrack est configurée, c'est le Worker qui a déjà envoyé le
// morceau sur les enceintes du lieu, et le navigateur se tait. Un quiz Spotify et un quiz Deezer
// peuvent se succéder dans la même soirée, et rien ici n'a besoin de
// consulter les réglages pour s'y retrouver.
//
// Le repli sur SELECT_ANSWER reste, pour un seul cas mais un cas réel :
// l'animateur qui se reconnecte en cours de question a manqué l'amorce, qui
// ne sera pas rejouée.

import { EVENTS } from "@razzia/common/constants"
import { lireUriMusique } from "@razzia/common/musique"
import { STATUS } from "@razzia/common/types/game/status"
import { useEvent } from "@razzia/web/features/game/contexts/socket-context"
import {
  activerAudio,
  enLecture,
  jouer,
  nouvelleQuestion,
} from "@razzia/web/features/musique/lib/lecteur"
import { demarrerLecteur } from "@razzia/web/features/spotify/lib/lecteur"
import { lireSession } from "@razzia/web/features/spotify/lib/session"
import { useEffect } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

export const useLecteurMusique = (clientId: string | null, zone = false) => {
  const { t } = useTranslation()
  const ctx = { clientId, zone }

  // Le lecteur Spotify démarre à l'ouverture de l'écran pour être prêt avant
  // la première question, mais seulement si une session existe : sans cela on
  // déclencherait une autorisation non sollicitée. Deezer n'a rien à
  // préparer — c'est une balise <audio>.
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
  //
  // Il n'est plus conditionné à la présence d'un identifiant Spotify : sur
  // une installation qui n'utilise que Deezer, il n'y en a pas, et l'élément
  // audio resterait bloqué toute la soirée.
  useEffect(() => {
    const surGeste = () => void activerAudio()
    const options = { once: true, capture: true } as const

    addEventListener("pointerup", surGeste, options)
    addEventListener("keydown", surGeste, options)

    return () => {
      removeEventListener("pointerup", surGeste, options)
      removeEventListener("keydown", surGeste, options)
    }
  }, [])

  useEvent(EVENTS.GAME.AUDIO_CUE, ({ uri }) => {
    void jouer(ctx, uri)
  })

  useEvent(EVENTS.GAME.STATUS, ({ name, data }) => {
    const media = (data as { media?: { url?: string } })?.media

    // Repli : si l'amorce a été manquée, l'URI arrive au plus tard ici.
    if (name === STATUS.SELECT_ANSWER && !enLecture()) {
      const lue = lireUriMusique(media?.url)

      if (lue?.id) {
        void jouer(ctx, media?.url ?? "")
      }
    }
  })
}
