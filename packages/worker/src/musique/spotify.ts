// Le catalogue Spotify.
//
// Ce fichier ne fait que DÉMÉNAGER ce qui vivait dans quizia/core.ts — jeton
// d'application, client HTTP, filtre des versions parasites, normalisation.
// Aucun comportement ne change ; ce qui change, c'est que le générateur ne
// s'adresse plus à Spotify directement mais au catalogue sélectionné, dont
// celui-ci est une implantation parmi deux.
//
// LE JETON RESTE ICI, en cache d'isolat. Un Worker n'a pas de processus qui
// dure, mais un isolat sert plusieurs requêtes. Un jeton déjà émis reste
// d'ailleurs valable même si le secret est renouvelé entre-temps, jusqu'à sa
// propre expiration.

import type { Fournisseur, Piste } from "@razzia/common/musique"
import type { Catalogue } from "./catalogue"
import { anneeDe, dedupliquer, norm, NOISE, type Morceau } from "./texte"

export interface ClesSpotify {
  spotifyId: string
  spotifySecret: string
}

const MARKET = "FR"
const TIMEOUT_MS = 15000
// Plafond constaté sur /search comme sur /artists/{id}/albums.
const LIMITE = 10

const ALBUM_KO = new Set(["compilation"])

const log = (...a: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 19), ...a)

const pause = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms)
  })

let jeton: string | null = null
let jetonExpire = 0

/** Expose la remise à zéro du cache, pour les tests. */
export const oublierJeton = () => {
  jeton = null
  jetonExpire = 0
}

async function jetonSpotify(cles: ClesSpotify): Promise<string> {
  if (jeton && Date.now() < jetonExpire) {
    return jeton
  }

  const basic = btoa(`${cles.spotifyId}:${cles.spotifySecret}`)
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })

  if (!r.ok) {
    throw new Error(`token Spotify HTTP ${r.status}`)
  }

  // `r.json<T>()` et non `as T` : l'assertion faisait clignoter oxlint — sa
  // passe typée la jugeait tantôt nécessaire, tantôt superflue, une fois sur
  // quatre environ, ce qui suffit à rendre la CI capricieuse.
  const j = await r.json<{ access_token: string; expires_in: number }>()
  jeton = j.access_token
  jetonExpire = Date.now() + (j.expires_in - 60) * 1000

  return jeton
}

/** GET sur l'API Spotify, avec respect du Retry-After en cas de 429. */
async function spotify(
  cles: ClesSpotify,
  chemin: string,
  essai = 0,
): Promise<any> {
  const t = await jetonSpotify(cles)
  const r = await fetch(`https://api.spotify.com/v1${chemin}`, {
    headers: { Authorization: `Bearer ${t}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (r.status === 429) {
    const attente = Math.min(
      30,
      parseInt(r.headers.get("retry-after") || "2", 10),
    )

    if (essai >= 2) {
      throw new Error(`quota Spotify épuisé (429 après ${essai + 1} essais)`)
    }

    log(`quota Spotify atteint, pause ${attente}s`)
    await pause(attente * 1000)

    return spotify(cles, chemin, essai + 1)
  }

  if (r.status === 401 && essai < 1) {
    // Jeton périmé plus tôt que prévu
    jeton = null

    return spotify(cles, chemin, essai + 1)
  }

  if (!r.ok) {
    const detail = await r.text()
    throw new Error(
      `Spotify HTTP ${r.status} sur ${chemin.split("?")[0]} ` +
        `— ${detail.slice(0, 120)}`,
    )
  }

  return r.json()
}

/** Normalise une piste Spotify, ou null si elle n'est pas exploitable. */
function retenirPiste(t: any, nomArtiste: string): Morceau | null {
  if (!t?.id || !t.name) {
    return null
  }

  if (NOISE.test(t.name)) {
    return null
  }

  const album = t.album || {}

  if (ALBUM_KO.has(String(album.album_type || "").toLowerCase())) {
    return null
  }

  if (NOISE.test(album.name || "")) {
    return null
  }

  // La recherche remonte reprises et artistes voisins : sur « Indochine »,
  // Louise Attaque figurait dans les résultats.
  const interprete = ((t.artists || [])[0] || {}).name || ""

  if (norm(interprete) !== norm(nomArtiste)) {
    return null
  }

  // L'identifiant est la raison d'être de cette passe : c'est lui qui finira
  // dans le champ media du quiz. Le résoudre ici, contre le catalogue réel,
  // est le seul moyen d'être sûr qu'il désigne bien ce morceau-là.
  return {
    id: t.id,
    artiste: interprete,
    titre: t.name,
    // Le format varie : "1982" pour l'un, "1985-12-10" pour l'autre.
    annee: anneeDe(album.release_date),
  }
}

/** Métadonnées affichables d'un objet track, pour l'éditeur. */
function decrireTrack(t: any): Piste | null {
  if (!t?.id) {
    return null
  }

  const album = t.album || {}
  const images = album.images || []
  // On prend LA PLUS GRANDE. Ces métadonnées ne servaient au départ qu'à une
  // vignette d'éditeur, et la plus petite (64 px) suffisait ; elles alimentent
  // maintenant aussi la carte de fin de question, affichée sur un téléviseur,
  // où ce format-là est franchement flou. Une pochette de 640 px pèse une
  // cinquantaine de kilo-octets, chargée une fois par question : le confort de
  // l'éditeur ne justifie pas de dégrader l'écran de jeu.
  //
  // L'ordre décroissant est documenté mais on ne s'y fie pas : un tableau
  // renvoyé dans un autre ordre donnerait ici, en silence, la vignette.
  let cover: string | null = null
  let large = -1
  for (const i of images) {
    if (i?.url && (i.width || 0) > large) {
      cover = i.url
      large = i.width || 0
    }
  }

  const artistes = []
  for (const a of t.artists || []) {
    if (a?.name) {
      artistes.push(a.name)
    }
  }

  return {
    fournisseur: "spotify",
    id: t.id,
    titre: t.name,
    artiste: artistes.join(", "),
    album: album.name || "",
    annee: anneeDe(album.release_date),
    duree: Math.round((t.duration_ms || 0) / 1000),
    cover,
  }
}

export const catalogueSpotify = (cles: ClesSpotify): Catalogue => ({
  nom: "spotify" as Fournisseur,

  manque: () => {
    const manque: string[] = []

    if (!cles.spotifyId) {
      manque.push("SPOTIFY_CLIENT_ID")
    }

    if (!cles.spotifySecret) {
      manque.push("SPOTIFY_CLIENT_SECRET")
    }

    return manque
  },

  chercher: async (q: string) => {
    const res = await spotify(
      cles,
      "/search?type=track" +
        `&limit=${LIMITE}&market=${MARKET}` +
        `&q=${encodeURIComponent(q)}`,
    )
    const sortie: Piste[] = []
    for (const t of (res.tracks || {}).items || []) {
      const info = decrireTrack(t)

      if (info) {
        sortie.push(info)
      }
    }

    return sortie
  },

  piste: async (id: string) =>
    decrireTrack(await spotify(cles, `/tracks/${id}?market=${MARKET}`)),

  /** Pistes d'un artiste, en UN appel. La période est un qualificateur. */
  pistesDeLArtiste: async (nom, anneeMin, anneeMax) => {
    let requete = `artist:${nom}`

    if (anneeMin || anneeMax) {
      requete += ` year:${anneeMin || 1900}-${anneeMax || new Date().getFullYear()}`
    }

    const res = await spotify(
      cles,
      "/search?type=track" +
        `&limit=${LIMITE}&market=${MARKET}` +
        `&q=${encodeURIComponent(requete)}`,
    )

    const pistes: Morceau[] = []
    for (const t of (res.tracks || {}).items || []) {
      const p = retenirPiste(t, nom)

      if (p) {
        pistes.push(p)
      }
    }

    return dedupliquer(pistes)
  },

  resoudre: async (artiste, titre) => {
    const requete = `artist:${artiste} track:${titre}`
    let res

    try {
      res = await spotify(
        cles,
        "/search?type=track" +
          `&limit=${LIMITE}&market=${MARKET}` +
          `&q=${encodeURIComponent(requete)}`,
      )
    } catch (e) {
      console.error(
        `! résolution "${artiste} — ${titre}": ${(e as Error).message}`,
      )

      return null
    }

    const vise = norm(titre)
    for (const t of (res.tracks || {}).items || []) {
      // RetenirPiste applique déjà le filtre NOISE et l'égalité d'artiste.
      const p = retenirPiste(t, artiste)

      if (!p) {
        continue
      }

      const nom = norm(p.titre)

      // Garde-fou contre les homonymies : la recherche remonte volontiers un
      // autre titre du même artiste quand celui demandé n'existe pas.
      if (nom.includes(vise) || vise.includes(nom)) {
        return p
      }
    }

    return null
  },
})
