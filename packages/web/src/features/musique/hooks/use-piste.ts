// Métadonnées d'un morceau, à partir de son URI « <service>:ID[:offset] ».
//
// Trois endroits en ont besoin — l'éditeur de quiz, l'écran des réponses, et
// demain sans doute d'autres — et refaire la requête à chaque fois serait du
// gaspillage de quota autant que de code. Le cache est au niveau du module :
// un même morceau revu plusieurs fois dans une soirée n'est demandé qu'une
// fois, et le passage d'un écran à l'autre est instantané.
//
// IL EST INDEXÉ PAR URI COMPLÈTE, service compris. Les identifiants des deux
// catalogues ne se ressemblent pas, mais rien ne garantit qu'ils ne se
// croiseront jamais, et un cache qui rendrait la fiche Spotify d'un morceau
// Deezer serait une panne incompréhensible.
//
// L'APERÇU N'EST PAS MIS EN CACHE, et c'est le point à ne pas manquer : le
// lien d'écoute que rend Deezer est signé pour un quart d'heure. Le garder
// avec le reste ferait échouer la lecture d'un morceau consulté en début de
// soirée. Le lecteur le redemande de son côté, au moment de jouer.

import { lireUriMusique, type Piste } from "@razzia/common/musique"
import { useEffect, useState } from "react"

export type { Piste }

/** Ce que rendent /spotify/track, /deezer/track et leurs recherches. */
export interface ReponseMusique {
  ok?: boolean
  track?: Piste
  tracks?: Piste[]
  message?: string
}

const cache = new Map<string, Piste>()

export interface EtatPiste {
  piste: Piste | null
  /** Vrai quand la requête a abouti sans rien trouver d'exploitable. */
  introuvable: boolean
}

const vide: EtatPiste = { piste: null, introuvable: false }

export const usePiste = (uri: string): EtatPiste => {
  const [etat, setEtat] = useState<EtatPiste>(() => {
    const connue = uri ? cache.get(uri) : undefined

    return connue ? { piste: connue, introuvable: false } : vide
  })

  useEffect(() => {
    const lue = lireUriMusique(uri)

    if (!lue?.id) {
      setEtat(vide)

      return
    }

    const connue = cache.get(uri)

    if (connue) {
      setEtat({ piste: connue, introuvable: false })

      return
    }

    let vivant = true
    setEtat(vide)

    void fetch(`/${lue.fournisseur}/track/${encodeURIComponent(lue.id)}`, {
      cache: "no-store",
    })
      .then((r) => r.json() as Promise<ReponseMusique>)
      .then((d) => {
        if (!vivant) {
          return
        }

        if (d?.ok && d.track) {
          // L'aperçu est retiré AVANT la mise en cache : il expire, le reste
          // non.
          const { apercu: _apercu, ...stable } = d.track
          cache.set(uri, stable)
          setEtat({ piste: stable, introuvable: false })
        } else {
          setEtat({ piste: null, introuvable: true })
        }
      })
      .catch(() => vivant && setEtat({ piste: null, introuvable: true }))

    return () => {
      vivant = false
    }
  }, [uri])

  return etat
}
