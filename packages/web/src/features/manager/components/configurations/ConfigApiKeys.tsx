/*
 * Saisie des clés API.
 *
 * Le secret Spotify expire tous les 180 jours : le renouveler ne doit pas
 * demander la ligne de commande ni un redéploiement. D'où cet écran.
 *
 * LES SECRETS NE SONT JAMAIS PRÉ-REMPLIS. Le serveur ne les renvoie pas, et
 * c'est délibéré : personne n'a besoin de relire une clé Mistral, alors que
 * l'afficher dans un champ l'exposerait à qui passe derrière l'écran — en
 * soirée, précisément. Un champ laissé vide signifie donc « ne pas changer »,
 * et non « effacer » ; c'est le bouton dédié qui efface.
 *
 * Pas de Card ici : le contenu d'un onglet est déjà dans celle de
 * Configurations, et l'imbriquer lui imposait son max-w-80 — d'où le
 * débordement constaté au premier essai en navigateur.
 */

import { EVENTS } from "@razzia/common/constants"
import type { CleApi } from "@razzia/common/types/game/socket"
import Button from "@razzia/web/components/Button"
import Input from "@razzia/web/components/Input"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import BoutonSpotify from "@razzia/web/features/spotify/components/BoutonSpotify"
import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

const LIBELLES: Record<string, string> = {
  MISTRAL_API_KEY: "Clé API Mistral",
  MISTRAL_MODEL: "Modèle Mistral",
  SPOTIFY_CLIENT_ID: "Identifiant client Spotify",
  SPOTIFY_CLIENT_SECRET: "Secret client Spotify",
}

const ConfigApiKeys = () => {
  const { socket } = useSocket()
  const { t } = useTranslation("manager")

  const [cles, setCles] = useState<CleApi[]>([])
  const [saisies, setSaisies] = useState<Record<string, string>>({})

  useEffect(() => {
    socket.emit(EVENTS.SETTINGS.GET)
  }, [socket])

  useEvent(EVENTS.SETTINGS.DATA, ({ keys }) => {
    setCles(keys)
    setSaisies({})
  })

  useEvent(EVENTS.SETTINGS.ERROR, (erreur) => {
    toast.error(String(erreur))
  })

  const enregistrer = () => {
    const aEnvoyer = Object.fromEntries(
      Object.entries(saisies).filter(([, v]) => v.trim() !== ""),
    )

    if (Object.keys(aEnvoyer).length === 0) {
      return
    }

    socket.emit(EVENTS.SETTINGS.SAVE, aEnvoyer)
    toast.success(t("keys.saved"))
  }

  const effacer = (nom: string) => {
    socket.emit(EVENTS.SETTINGS.SAVE, { [nom]: "" })
    toast.success(t("keys.cleared"))
  }

  const etatDe = (cle: CleApi) => {
    if (cle.origine === "base") {
      return t("keys.fromDatabase", {
        date: cle.modifiee ? new Date(cle.modifiee).toLocaleDateString() : "",
      })
    }

    return cle.origine === "liaison" ? t("keys.fromBinding") : t("keys.unset")
  }

  const modifie = Object.values(saisies).some((v) => v.trim() !== "")

  return (
    // Même découpage que les autres onglets : une zone défilante, et ce qui
    // doit rester atteignable en dehors. Le bouton d'enregistrement sortait
    // du cadre quand les quatre champs étaient dépliés.
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-6 overflow-auto p-0.5">
        <BoutonSpotify />

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-bold">{t("keys.title")}</h2>
            <p className="text-sm opacity-70">{t("keys.subtitle")}</p>
          </div>

          {cles.map((cle) => (
            <div key={cle.nom} className="flex flex-col gap-1">
              <label className="font-semibold" htmlFor={`cle-${cle.nom}`}>
                {LIBELLES[cle.nom] ?? cle.nom}
              </label>
              <span className="text-xs opacity-60">{etatDe(cle)}</span>

              <div className="flex items-center gap-2">
                <Input
                  id={`cle-${cle.nom}`}
                  variant="sm"
                  className="min-w-0 flex-1"
                  type={cle.secrete ? "password" : "text"}
                  autoComplete="off"
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
                  <Button
                    size="sm"
                    className="bg-accent text-foreground shrink-0"
                    onClick={() => effacer(cle.nom)}
                  >
                    {t("keys.clear")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>

      <Button
        className="shrink-0 disabled:cursor-default disabled:opacity-40"
        disabled={!modifie}
        onClick={enregistrer}
      >
        {t("keys.save")}
      </Button>
    </div>
  )
}

export default ConfigApiKeys
