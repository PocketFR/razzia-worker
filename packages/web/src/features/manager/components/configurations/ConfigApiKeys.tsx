/*
 * Saisie des clés API.
 *
 * Le secret Spotify expire tous les 180 jours : le renouveler ne doit pas
 * demander la ligne de commande ni un redéploiement. D'où cet écran.
 *
 * LES SECRETS NE SONT JAMAIS PRÉ-REMPLIS. Le serveur ne les renvoie pas, et
 * c'est délibéré : personne n'a besoin de relire une clé Mistral, alors que
 * l'afficher dans un champ l'exposerait à toute personne passant derrière
 * l'écran — en soirée, précisément. Un champ laissé vide signifie donc
 * « ne pas changer », et non « effacer ».
 */

import { EVENTS } from "@razzia/common/constants"
import type { CleApi } from "@razzia/common/types/game/socket"
import Card from "@razzia/web/components/Card"
import BoutonSpotify from "@razzia/web/features/spotify/components/BoutonSpotify"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

const LIBELLES: Record<string, string> = {
  MISTRAL_API_KEY: "Clé API Mistral",
  MISTRAL_MODEL: "Modèle Mistral",
  SPOTIFY_CLIENT_ID: "Identifiant client Spotify",
  SPOTIFY_CLIENT_SECRET: "Secret client Spotify",
}

const ConfigApiKeys = () => {
  const { socket } = useSocket()
  const { config } = useManagerStore()
  const { t } = useTranslation("manager")

  const [cles, setCles] = useState<CleApi[]>([])
  const [saisies, setSaisies] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    socket.emit(EVENTS.SETTINGS.GET)
  }, [socket])

  useEvent(EVENTS.SETTINGS.DATA, ({ keys }) => {
    setCles(keys)
    setSaisies({})
    setMessage(t("keys.saved"))
  })

  useEvent(EVENTS.SETTINGS.ERROR, (erreur) => {
    setMessage(String(erreur))
  })

  const enregistrer = () => {
    const aEnvoyer = Object.fromEntries(
      Object.entries(saisies).filter(([, v]) => v !== ""),
    )

    if (Object.keys(aEnvoyer).length === 0) {
      return
    }

    setMessage(null)
    socket.emit(EVENTS.SETTINGS.SAVE, aEnvoyer)
  }

  const effacer = (nom: string) => {
    setMessage(null)
    socket.emit(EVENTS.SETTINGS.SAVE, { [nom]: "" })
  }

  const etatDe = (cle: CleApi) => {
    if (cle.origine === "base") {
      const quand = cle.modifiee
        ? new Date(cle.modifiee).toLocaleDateString()
        : ""

      return t("keys.fromDatabase", { date: quand })
    }

    return cle.origine === "liaison" ? t("keys.fromBinding") : t("keys.unset")
  }

  return (
    <div className="flex flex-col gap-4">
      <BoutonSpotify clientId={config?.spotifyClientId ?? null} />
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold">{t("keys.title")}</h2>
          <p className="text-sm opacity-70">{t("keys.subtitle")}</p>
        </div>

        {cles.map((cle) => (
          <label key={cle.nom} className="flex flex-col gap-1">
            <span className="text-sm font-semibold">
              {LIBELLES[cle.nom] ?? cle.nom}
            </span>
            <span className="text-xs opacity-60">{etatDe(cle)}</span>

            <div className="flex gap-2">
              <input
                type={cle.secrete ? "password" : "text"}
                autoComplete="off"
                className="flex-1 rounded-lg border border-white/20 bg-white/5 px-3 py-2"
                placeholder={
                  cle.secrete && cle.definie
                    ? t("keys.leaveEmpty")
                    : (cle.valeur ?? "")
                }
                value={saisies[cle.nom] ?? ""}
                onChange={(e) =>
                  setSaisies((s) => ({ ...s, [cle.nom]: e.target.value }))
                }
              />

              {cle.origine === "base" && (
                <button
                  type="button"
                  className="rounded-lg bg-white/10 px-3 py-2 text-sm"
                  onClick={() => effacer(cle.nom)}
                >
                  {t("keys.clear")}
                </button>
              )}
            </div>
          </label>
        ))}

        {message && <p className="text-sm opacity-70">{message}</p>}


        <button
          type="button"
          className="bg-primary self-start rounded-lg px-5 py-2 font-semibold"
          onClick={enregistrer}
        >
          {t("keys.save")}
        </button>
      </Card>
    </div>
  )
}

export default ConfigApiKeys
