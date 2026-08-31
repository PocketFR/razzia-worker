// Métadonnées d'un morceau, à partir d'une URI « spotify:ID[:offset] ».
//
// Trois endroits en ont besoin — l'éditeur de quiz, l'écran des réponses, et
// demain sans doute d'autres — et refaire la requête à chaque fois serait du
// gaspillage de quota autant que de code. Le cache est au niveau du module :
// un même morceau revu plusieurs fois dans une soirée n'est demandé qu'une
// fois, et le passage d'un écran à l'autre est instantané.

import { useEffect, useState } from "react"

export const URI_SPOTIFY = /^spotify:(?:([A-Za-z0-9]{22})(?::(\d+))?)?$/

export interface Piste {
  id: string
  titre: string
  artiste: string
  album: string
  annee: number | null
  duree: number
  cover: string | null
}

const cache = new Map<string, Piste>()

export const lireUri = (url?: string) => {
  const trouve = URI_SPOTIFY.exec(url ?? "")

  return trouve
    ? { id: trouve[1] ?? "", depart: parseInt(trouve[2] ?? "0", 10) || 0 }
    : null
}

export interface EtatPiste {
  piste: Piste | null
  /** Vrai quand la requête a abouti sans rien trouver d'exploitable. */
  introuvable: boolean
}

export const usePisteSpotify = (id: string): EtatPiste => {
  const [etat, setEtat] = useState<EtatPiste>(() => ({
    piste: id ? (cache.get(id) ?? null) : null,
    introuvable: false,
  }))

  useEffect(() => {
    if (!id) {
      setEtat({ piste: null, introuvable: false })

      return
    }

    const connue = cache.get(id)

    if (connue) {
      setEtat({ piste: connue, introuvable: false })

      return
    }

    let vivant = true
    setEtat({ piste: null, introuvable: false })

    void fetch(`/spotify/track/${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!vivant) {
          return
        }

        if (d?.ok && d.track) {
          cache.set(id, d.track)
          setEtat({ piste: d.track, introuvable: false })
        } else {
          setEtat({ piste: null, introuvable: true })
        }
      })
      .catch(() => vivant && setEtat({ piste: null, introuvable: true }))

    return () => {
      vivant = false
    }
  }, [id])

  return etat
}
