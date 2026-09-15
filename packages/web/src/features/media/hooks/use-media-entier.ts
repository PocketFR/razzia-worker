// Un média sonore ou vidéo, chargé en entier avant d'être lu.
//
// POURQUOI PAS SIMPLEMENT `src`. Une balise <video> ou <audio> demande son
// fichier par morceaux, en requêtes `Range`. Le cache de Cloudflare ne
// conserve jamais une réponse partielle : chaque morceau réveillerait le
// Worker et relirait R2, pour chacun des cent téléphones. Mesuré le
// 15/09/2026 : une requête `Range` sur un objet en cache est servie sans
// invocation, mais en entier, en 200 — et Safari refuse de lire une vidéo
// sans vraie réponse partielle.
//
// On demande donc le fichier entier, une fois, par une requête ordinaire que
// le cache sert sans rien réveiller, puis on le lit depuis un lien `blob:`
// local. Le navigateur n'a plus rien à redemander au serveur.
//
// Seuls les médias téléversés passent par là. Une adresse externe garde son
// comportement : elle ne coûte rien à razzia.

import { estMediaLocal } from "@razzia/common/media"
import { useEffect, useState } from "react"

export const useMediaEntier = (url?: string): string | null => {
  const [lien, setLien] = useState<string | null>(() =>
    url && !estMediaLocal(url) ? url : null,
  )

  useEffect(() => {
    if (!url || !estMediaLocal(url)) {
      setLien(url ?? null)

      return
    }

    let vivant = true
    let cree: string | null = null

    setLien(null)

    fetch(url)
      .then((reponse) =>
        reponse.ok ? reponse.blob() : Promise.reject(new Error("média absent")),
      )
      .then((blob) => {
        if (!vivant) {
          return
        }

        cree = URL.createObjectURL(blob)
        setLien(cree)
      })
      .catch(() => {
        // Repli sur l'adresse directe : la lecture se fera par morceaux, au
        // prix de quelques invocations, plutôt que pas du tout.
        if (vivant) {
          setLien(url)
        }
      })

    return () => {
      vivant = false

      if (cree) {
        URL.revokeObjectURL(cree)
      }
    }
  }, [url])

  return lien
}
