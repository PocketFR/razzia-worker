// Ce que les deux catalogues partagent avant de parler à qui que ce soit :
// comparer des noms écrits par des humains, et écarter les versions
// parasites.
//
// Ces trois éléments vivaient dans quizia/core.ts, où ils servaient au seul
// client Spotify. Ils remontent ici parce que Deezer en a le même besoin, et
// que les dupliquer laisserait les deux filtres diverger — celui de Spotify
// évoluant sans celui de Deezer, pour un défaut qu'on ne verrait qu'en
// soirée, sur un karaoké passé au travers.

export const norm = (s: unknown) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

// Versions parasites : un blind test sur un live ou un karaoké ne marche pas.
export const NOISE =
  /\b(live|remaster\w*|karaoke|tribute|instrumental|acoustic|demo|re-?recorded|sped\s*up|slowed|cover|version)\b/i

/** Un morceau retenu par un catalogue, réduit à ce dont la génération a besoin. */
export interface Morceau {
  id: string
  artiste: string
  titre: string
  annee: number | null
}

/** Un titre par nom normalisé, avec l'année de sortie la plus ancienne. */
export const dedupliquer = (pistes: Morceau[]) => {
  const parTitre = new Map<string, Morceau>()
  for (const p of pistes) {
    const cle = norm(p.titre)

    if (!cle) {
      continue
    }

    const connue = parTitre.get(cle)

    if (!connue) {
      parTitre.set(cle, p)

      continue
    }

    if (p.annee && (!connue.annee || p.annee < connue.annee)) {
      parTitre.set(cle, { ...connue, annee: p.annee })
    }
  }

  return [...parTitre.values()]
}

/** L'année d'une date de sortie, quel qu'en soit le format. */
export const anneeDe = (date: unknown) =>
  parseInt(String(date || "").slice(0, 4), 10) || null

/** La période demandée, quand elle l'est. */
export const dansLaPeriode = (
  annee: number | null,
  min: number | null,
  max: number | null,
) => {
  if (!min && !max) {
    return true
  }

  // Année inconnue et période demandée : on ne peut pas trancher. On garde,
  // plutôt que d'écarter — un morceau hors période est un défaut mineur, un
  // artiste rendu muet parce que son catalogue n'est pas daté en est un vrai.
  if (annee === null) {
    return true
  }

  return annee >= (min || 1900) && annee <= (max || new Date().getFullYear())
}
