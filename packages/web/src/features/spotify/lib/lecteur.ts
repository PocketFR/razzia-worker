// Lecteur Spotify Web Playback, dans l'onglet de l'animateur.
//
// POURQUOI DANS CET ONGLET — le jukebox vivait dans un onglet séparé pilotant
// Music Assistant. Deux défauts rédhibitoires, constatés sur tablette
// Android : les navigateurs mettent en veille un onglet qu'on ne regarde
// pas, ce qui fait décrocher la lecture ; et la chaîne librespot vers FFmpeg
// vers flux ajoutait une latence sensible. Le SDK dans l'onglet actif
// supprime les deux.

import { jeton, oublierSession } from "./session"

interface SpotifyGlobal {
  Player: new (_o: {
    name: string
    getOAuthToken: (_cb: (_t: string) => void) => void
    volume: number
  }) => LecteurSDK
}

interface LecteurSDK {
  addListener: (
    _e: string,
    // Les deux formes que le SDK envoie : l'annonce du device, et les
    // erreurs. Un `any` laissait passer n'importe quoi ; un `unknown`
    // obligerait à valider ce que le SDK garantit déjà.
    _cb: (_d: { device_id?: string; message?: string }) => void,
  ) => void
  connect: () => Promise<boolean>
  disconnect: () => void
  /* Débloque l'élément audio du SDK. Voir activerAudio plus bas. */
  activateElement: () => Promise<void>
}

declare global {
  interface Window {
    Spotify?: SpotifyGlobal
    onSpotifyWebPlaybackSDKReady?: () => void
  }
}

let lecteur: LecteurSDK | null = null
let deviceId: string | null = null
let enCours = false

const chargerSDK = () =>
  new Promise<void>((resoudre, rejeter) => {
    if (window.Spotify?.Player) {
      resoudre()

      return
    }

    window.onSpotifyWebPlaybackSDKReady = () => resoudre()

    const s = document.createElement("script")
    s.src = "https://sdk.scdn.co/spotify-player.js"
    s.onerror = () => rejeter(new Error("SDK injoignable"))
    document.head.appendChild(s)
  })

export const demarrerLecteur = async (
  clientId: string,
  surErreur?: (_cle: string) => void,
): Promise<boolean> => {
  if (lecteur) {
    return true
  }

  if (!(await jeton(clientId))) {
    return false
  }

  try {
    await chargerSDK()
  } catch (e) {
    console.error("[spotify]", (e as Error).message)

    return false
  }

  // Charger le SDK ne rend la main qu'une fois window.Spotify posé, mais
  // s'en remettre à un « ! » transformerait le moindre écart en TypeError
  // sans message. Un refus explicite se lit dans la console.
  if (!window.Spotify) {
    console.error("[spotify] SDK chargé sans exposer window.Spotify")

    return false
  }

  lecteur = new window.Spotify.Player({
    name: "Razzia",
    getOAuthToken: (cb) => {
      void jeton(clientId).then((v) => v && cb(v))
    },
    volume: 1,
  })

  lecteur.addListener("ready", ({ device_id }) => {
    // `?? null` : le champ est facultatif dans le type, parce que le même
    // rappel sert aussi aux erreurs, qui ne le portent pas.
    deviceId = device_id ?? null
    console.log("[spotify] lecteur prêt")
  })

  lecteur.addListener("not_ready", () => {
    deviceId = null
    console.warn("[spotify] lecteur hors ligne")
  })

  // Un compte non Premium échoue ICI, pas à l'autorisation — d'où un message
  // explicite, sans quoi la panne est incompréhensible en pleine soirée.
  lecteur.addListener("account_error", (e) => {
    console.error("[spotify] compte :", e.message)
    surErreur?.("spotify.premiumRequired")
  })

  lecteur.addListener("authentication_error", (e) => {
    console.error("[spotify] authentification :", e.message)
    oublierSession()
    lecteur = null
  })

  lecteur.addListener("initialization_error", (e) => {
    console.error("[spotify] initialisation :", e.message)
  })

  if (!(await lecteur.connect())) {
    lecteur = null

    return false
  }

  return true
}

let audioActive = false

/**
 * Débloque la lecture, depuis un geste utilisateur.
 *
 * LE SYMPTÔME EST TROMPEUR : le lecteur s'annonce « prêt », les commandes de
 * lecture renvoient 204, et pourtant rien ne sort. Les navigateurs — Firefox
 * en tête — refusent qu'un son démarre sans geste de l'utilisateur, et
 * l'élément audio que le SDK crée en coulisse reste muet tant qu'il n'a pas
 * été activé pendant une interaction réelle.
 *
 * activateElement existe précisément pour ça, et n'a de valeur qu'appelée
 * depuis un gestionnaire d'événement d'entrée. Une seule fois suffit.
 */
export const activerAudio = async () => {
  if (audioActive || !lecteur) {
    return
  }

  try {
    await lecteur.activateElement()
    audioActive = true
    console.log("[spotify] audio débloqué")
  } catch (e) {
    console.error("[spotify] activation refusée :", e)
  }
}

export const arreterLecteur = () => {
  lecteur?.disconnect()
  lecteur = null
  deviceId = null
  enCours = false
  audioActive = false
}

/** "spotify:ID:offset" -> {id, depart}, ou null. */
export const lireMedia = (media?: { url?: string } | null) => {
  const m = /^spotify:([A-Za-z0-9]{22})(?::(\d+))?$/.exec(media?.url ?? "")

  return m ? { id: m[1], depart: parseInt(m[2], 10) || 0 } : null
}

export const enLecture = () => enCours

export const jouer = async (clientId: string, id: string, depart: number) => {
  if (!deviceId && !(await demarrerLecteur(clientId))) {
    return
  }

  // Le device met un instant à être annoncé après connect().
  //
  // deviceId est posé par l'écouteur « ready » du SDK, que l'analyse statique
  // ne relie pas à cette boucle : elle la croit donc infinie. C'est bien une
  // attente active, bornée à deux secondes.
  // oxlint-disable-next-line no-unmodified-loop-condition
  for (let i = 0; i < 20 && !deviceId; i++) {
    await new Promise((r) => {
      setTimeout(r, 100)
    })
  }

  if (!deviceId) {
    console.warn("[spotify] aucun lecteur disponible")

    return
  }

  const t = await jeton(clientId)

  if (!t) {
    return
  }

  try {
    const r = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${t}`,
          "Content-Type": "application/json",
        },
        // Position_ms évite la séquence muet puis saut du jukebox : Spotify
        // démarre directement au bon endroit.
        body: JSON.stringify({
          uris: [`spotify:track:${id}`],
          position_ms: depart * 1000,
        }),
      },
    )

    if (!r.ok) {
      console.error(`[spotify] lecture refusée : HTTP ${r.status}`)

      return
    }

    enCours = true
    console.log("[spotify] lecture", id, depart ? `@${depart}s` : "")
  } catch (e) {
    console.error("[spotify] lecture :", e)
  }
}

export const arreter = async (clientId: string) => {
  if (!enCours) {
    return
  }

  enCours = false

  const t = await jeton(clientId)

  if (!t || !deviceId) {
    return
  }

  try {
    await fetch(
      `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`,
      { method: "PUT", headers: { Authorization: `Bearer ${t}` } },
    )
  } catch {
    /* Sans conséquence */
  }
}

export const nouvelleQuestion = () => {
  enCours = false
}

/**
 * Arrête, mais seulement s'il y a de quoi.
 *
 * Sans identifiant client il n'y a pas de session, donc rien qui joue de ce
 * côté : appeler `arreter` irait chercher un jeton pour ne rien en faire.
 * L'aiguillage s'en sert pour couper Spotify avant de lancer Deezer, sur des
 * installations où Spotify n'est pas configuré du tout.
 */
export const arreterSi = async (clientId: string | null) => {
  if (clientId) {
    await arreter(clientId)
  }
}
