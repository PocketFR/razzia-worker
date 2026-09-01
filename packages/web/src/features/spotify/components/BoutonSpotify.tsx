// Connexion Spotify, dans la configuration de l'animateur.
//
// Le bouton n'a de sens qu'AVANT la soirée : il sert autant d'alerte que de
// remède. Découvrir qu'on n'est pas connecté au moment de lancer le blind
// test est précisément ce qu'il faut éviter.

import {
  autoriser,
  lireSession,
  oublierSession,
} from "@razzia/web/features/spotify/lib/session"
import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

interface Props {
  clientId: string | null
  /**
   * Rapporte l'état de la session au parent.
   *
   * L'écran des réglages l'affiche dans l'en-tête replié du groupe Spotify :
   * « configuré » ne dit rien de la CONNEXION, et c'est elle qui décide si le
   * blind test sortira du son ce soir. Les deux se confondaient.
   */
  onEtat?: (_connecte: boolean) => void
}

const BoutonSpotify = ({ clientId, onEtat }: Props) => {
  const { t } = useTranslation("manager")
  const [connecte, setConnecte] = useState(false)

  useEffect(() => {
    const ouverte = Boolean(lireSession())
    setConnecte(ouverte)
    onEtat?.(ouverte)
    // oxlint-disable-next-line exhaustive-deps
  }, [])

  const connecter = async () => {
    if (!clientId) {
      toast.error(t("spotify.noClientId"))

      return
    }

    try {
      await autoriser(clientId)
    } catch {
      // Crypto.subtle manque : le code_challenge PKCE est impossible.
      toast.error(t("spotify.httpsRequired"))
    }
  }

  const deconnecter = () => {
    oublierSession()
    setConnecte(false)
    onEtat?.(false)
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-bold">{t("spotify.title")}</h2>
      <p className="text-sm opacity-70">
        {connecte ? t("spotify.connected") : t("spotify.disconnected")}
      </p>

      <button
        type="button"
        onClick={connecte ? deconnecter : connecter}
        className={`self-start rounded-lg px-4 py-2 font-semibold text-black ${
          connecte ? "bg-red-400" : "bg-green-400"
        }`}
      >
        {connecte ? t("spotify.disconnect") : t("spotify.connect")}
      </button>
    </section>
  )
}

export default BoutonSpotify
